// @vitest-environment node

import { afterEach, describe, expect, it } from 'vitest';

import { createFakeChrome } from '../helpers/fake-chrome.js';
import { createScriptDom, executeExtensionWindowScript, flushAsyncWork, readFixture } from '../helpers/script-harness.js';

let dom;

async function waitForTimers(milliseconds = 120) {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
  await flushAsyncWork(4);
}

async function loadFeedHistory(restoredState = null) {
  const chrome = createFakeChrome({ storage: { sync: { biliFeedHistory: true } } });
  const savedStates = [];
  let clearCount = 0;
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.action === 'loadBiliFeedHistory') sendResponse({ ok: true, state: restoredState });
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
    url: 'https://www.bilibili.com/',
    animationFrames: 'immediate'
  });
  await executeExtensionWindowScript(dom, 'bili-feed-history/bili-feed-history.js');
  await waitForTimers();
  return { chrome, savedStates, getClearCount: () => clearCount, window: dom.window };
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
});