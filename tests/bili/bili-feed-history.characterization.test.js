// @vitest-environment node

import { afterEach, describe, expect, it } from 'vitest';

import { createFakeChrome } from '../helpers/fake-chrome.js';
import { createScriptDom, executeExtensionWindowScript, flushAsyncWork, readFixture } from '../helpers/script-harness.js';

let dom;

async function waitForTimers(milliseconds = 120) {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
  await flushAsyncWork(4);
}

async function loadFeedHistory(restoredState = null, options = {}) {
  const chrome = createFakeChrome({
    storage: { sync: { biliFeedHistory: options.enabled ?? true } }
  });
  const savedStates = [];
  let clearCount = 0;
  let pendingLoadResponse = null;
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.action === 'loadBiliFeedHistory') {
      if (options.deferLoad) {
        pendingLoadResponse = sendResponse;
        return true;
      }
      sendResponse({ ok: true, state: restoredState });
    }
    else if (message.action === 'saveBiliFeedHistory') {
      savedStates.push(structuredClone(message.state));
      sendResponse({ ok: true });
    } else if (message.action === 'clearBiliFeedHistory') {
      clearCount += 1;
      sendResponse({ ok: true });
    }
    return false;
  });
  dom = await createScriptDom({
    chrome,
    html: await readFixture('bili/feed.html'),
    url: options.url || 'https://www.bilibili.com/',
    animationFrames: 'immediate'
  });
  options.configureWindow?.(dom.window);
  await executeExtensionWindowScript(dom, 'bili-feed-history/bili-feed-history.js');
  if (options.skipInitialWait) await flushAsyncWork();
  else await waitForTimers();
  return {
    chrome,
    savedStates,
    getClearCount: () => clearCount,
    releaseLoad: () => pendingLoadResponse?.({ ok: true, state: restoredState }),
    window: dom.window
  };
}

afterEach(() => {
  dom?.window.close();
  dom = null;
});

describe('Bilibili feed history', () => {
  it('extracts native video and ad cards into schema v3 session state', async () => {
    const { savedStates, window } = await loadFeedHistory();
    const latest = savedStates.at(-1);

    expect(window.document.querySelector('.echo-bili-feed-navigation')).not.toBeNull();
    expect(latest.schemaVersion).toBe(3);
    expect(latest.batches).toHaveLength(1);
    expect(latest.batches[0].cards[0]).toMatchObject({
      schemaVersion: 3,
      type: 'video',
      title: 'Fixture A',
      duration: '03:21',
      metrics: { playCount: '1万', danmakuCount: '200' },
      presentation: { kind: 'video' }
    });
    expect(latest.batches[0].cards[1]).toMatchObject({
      title: 'Fixture Ad',
      presentation: { kind: 'ad', adLabel: '广告' }
    });
  });

  it('restores valid session batches and follows the latest native batch', async () => {
    const restoredState = {
      schemaVersion: 3,
      currentIndex: 0,
      batches: [{
        identity: 'https://www.bilibili.com/video/BV1old',
        cards: [{
          schemaVersion: 3,
          type: 'video',
          url: 'https://www.bilibili.com/video/BV1old',
          coverUrl: 'https://i.example/old.webp',
          title: 'Old',
          author: { name: 'Old Author', url: '' },
          dateLabel: '',
          presentation: { kind: 'video', videoCardClass: '', authorLinkClass: '', hasAuthorIcon: false, badgeText: '', adLabel: '' },
          duration: '',
          metrics: { playCount: '', danmakuCount: '' }
        }]
      }]
    };

    const { savedStates } = await loadFeedHistory(restoredState);

    expect(savedStates.at(-1).batches).toHaveLength(2);
    expect(savedStates.at(-1).currentIndex).toBe(1);
  });

  it('removes observers and UI and clears session state when disabled', async () => {
    const { chrome, getClearCount, window } = await loadFeedHistory();

    await chrome.storage.sync.set({ biliFeedHistory: false });
    await flushAsyncWork();

    expect(window.document.querySelector('.echo-bili-feed-navigation')).toBeNull();
    expect(window.document.querySelector('.echo-bili-feed-overlay')).toBeNull();
    expect(getClearCount()).toBe(1);
  });

  it('does not revive a late session restore after the feature is disabled', async () => {
    const restoredState = {
      schemaVersion: 3,
      currentIndex: 0,
      batches: [{ identity: 'old', cards: [] }]
    };
    const { chrome, releaseLoad, window } = await loadFeedHistory(restoredState, {
      deferLoad: true
    });

    await chrome.storage.sync.set({ biliFeedHistory: false });
    releaseLoad();
    await flushAsyncWork(8);
    await chrome.storage.sync.set({ biliFeedHistory: true });
    await waitForTimers();

    const navigation = window.document.querySelector('.echo-bili-feed-navigation');
    expect(navigation).not.toBeNull();
    expect(navigation.dataset.batchCount).toBe('1');
  });

  it('starts on the homepage after a same-document route change from a video page', async () => {
    const { window } = await loadFeedHistory(null, {
      url: 'https://www.bilibili.com/video/BV1fixture'
    });
    expect(window.document.querySelector('.echo-bili-feed-navigation')).toBeNull();

    window.history.pushState({}, '', '/');
    window.document.body.appendChild(window.document.createElement('div'));
    await waitForTimers();

    expect(window.document.querySelector('.echo-bili-feed-navigation')).not.toBeNull();
  });

  it('removes homepage UI after a same-document route change to a video page', async () => {
    const { window } = await loadFeedHistory();
    expect(window.document.querySelector('.echo-bili-feed-navigation')).not.toBeNull();

    window.history.pushState({}, '', '/video/BV1fixture');
    window.document.body.appendChild(window.document.createElement('div'));
    await waitForTimers();

    expect(window.document.querySelector('.echo-bili-feed-navigation')).toBeNull();
    expect(window.document.querySelector('.echo-bili-feed-overlay')).toBeNull();
  });

  it('restarts initial settling after a refresh invalidates the pending attempt', async () => {
    const frames = [];
    const { window } = await loadFeedHistory(null, {
      skipInitialWait: true,
      configureWindow(testWindow) {
        const nativeSetTimeout = testWindow.setTimeout.bind(testWindow);
        testWindow.requestAnimationFrame = callback => {
          frames.push(callback);
          return frames.length;
        };
        testWindow.setTimeout = (callback, delay, ...args) => {
          if (delay === 100) return 100;
          return nativeSetTimeout(callback, delay, ...args);
        };
      }
    });
    const nativeButton = window.document.querySelector('.feed-roll-btn .primary-btn.roll-btn');
    nativeButton.click();

    for (let round = 0; round < 8; round += 1) {
      const pendingFrames = frames.splice(0);
      pendingFrames.forEach(callback => callback(window.performance.now()));
      await flushAsyncWork();
    }

    expect(window.document.querySelector('.echo-bili-feed-navigation').dataset.initialState)
      .toBe('complete');
  });

  it('does not register a full-page route observer while the feature is disabled', async () => {
    let observerCount = 0;

    await loadFeedHistory(null, {
      enabled: false,
      configureWindow(window) {
        window.MutationObserver = class {
          constructor() { observerCount += 1; }
          disconnect() {}
          observe() {}
        };
      }
    });

    expect(observerCount).toBe(0);
  });
});