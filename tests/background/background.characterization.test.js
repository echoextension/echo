import { afterEach, describe, expect, it } from 'vitest';

import { createFakeChrome } from '../helpers/fake-chrome.js';
import { executeWorkerScript, flushAsyncWork } from '../helpers/script-harness.js';

const activeTab = { id: 1, windowId: 1, index: 0, active: true, url: 'https://one.example/' };

async function loadBackground(options = {}) {
  const syncSettings = {
    tabSwitchKey: true,
    newTabPosition: 'afterCurrent',
    newTabOrder: 'ordered',
    applyToPlusButton: false,
    closeTabActivate: 'left',
    ...(options.sync || {})
  };
  if (options.omitCloseTabActivate) delete syncSettings.closeTabActivate;
  const chrome = createFakeChrome({
    currentWindowId: 1,
    tabs: options.tabs || [activeTab],
    storage: {
      sync: syncSettings,
      local: options.local || {},
      session: options.session || {}
    },
    runtimeSender: options.runtimeSender || { tab: activeTab },
    removalEventOrder: options.removalEventOrder || 'activated-first'
  });
  await executeWorkerScript(chrome, 'background.js', options.workerGlobals || {});
  await flushAsyncWork();
  return chrome;
}

afterEach(() => {
  delete globalThis.chrome;
});

describe('background installation and messages', () => {
  it('migrates activateLeftTab into closeTabActivate', async () => {
    const chrome = await loadBackground({
      omitCloseTabActivate: true,
      sync: { activateLeftTab: false, sidepanelEnhanced: true }
    });

    await chrome.runtime.onInstalled.emitAsync({ reason: 'update' });
    await flushAsyncWork();

    const settings = await chrome.storage.sync.get(null);
    expect(settings.closeTabActivate).toBe('right');
    expect(settings.mouseGesture).toBe(true);
    expect(settings.biliFeedHistory).toBe(true);
    expect(settings).not.toHaveProperty('activateLeftTab');
    expect(settings).not.toHaveProperty('sidepanelEnhanced');
  });

  it('stores Bilibili history under the sender tab ID', async () => {
    const biliTab = { ...activeTab, url: 'https://www.bilibili.com/' };
    const chrome = await loadBackground({ tabs: [biliTab], runtimeSender: { tab: biliTab, url: biliTab.url } });
    const state = { schemaVersion: 3, batches: [{ identity: 'one', cards: [] }], currentIndex: 0 };

    await expect(chrome.runtime.sendMessage({ action: 'saveBiliFeedHistory', state })).resolves.toEqual({ ok: true });
    await expect(chrome.runtime.sendMessage({ action: 'loadBiliFeedHistory' })).resolves.toEqual({ ok: true, state });

    expect(chrome.__testing.storageState.session['echoBiliFeedHistory:1']).toEqual(state);
  });

  it('rejects Bilibili session writes without a tab sender', async () => {
    const chrome = await loadBackground();
    chrome.__testing.setRuntimeSender({});

    await expect(chrome.runtime.sendMessage({
      action: 'saveBiliFeedHistory',
      state: { schemaVersion: 3, batches: [] }
    })).resolves.toEqual({ ok: false, error: 'Invalid Bilibili tab sender' });
  });

  it('rejects unknown actions and invalid capability parameters at the router boundary', async () => {
    const chrome = await loadBackground();

    await expect(chrome.runtime.sendMessage({ action: 'unknownAction' })).resolves.toMatchObject({
      ok: false,
      success: false,
      error: expect.stringContaining('未知消息 action')
    });
    await expect(chrome.runtime.sendMessage({ action: 'setZoom', zoom: 99 })).resolves.toMatchObject({
      ok: false,
      success: false,
      error: '缩放比例无效'
    });
  });
});

describe('background image request rules', () => {
  it('keeps each concurrent image request Referer rule isolated', async () => {
    const pendingFetches = new Map();
    class FakeFileReader {
      readAsDataURL() {
        this.result = 'data:image/png;base64,AA==';
        queueMicrotask(() => this.onload?.());
      }
    }
    const fetch = (url) => new Promise((resolve) => pendingFetches.set(String(url), resolve));
    const chrome = await loadBackground({ workerGlobals: { fetch, FileReader: FakeFileReader } });

    const first = chrome.runtime.sendMessage({
      action: 'fetchImageAsDataUrl',
      imageUrl: 'https://images.example/first.png',
      pageUrl: 'https://page-one.example/article'
    });
    const second = chrome.runtime.sendMessage({
      action: 'fetchImageAsDataUrl',
      imageUrl: 'https://images.example/second.png',
      pageUrl: 'https://page-two.example/article'
    });
    await flushAsyncWork();
    expect(await chrome.declarativeNetRequest.getDynamicRules()).toHaveLength(2);

    pendingFetches.get('https://images.example/first.png')(
      new Response(new Uint8Array([0]), { status: 200, headers: { 'Content-Type': 'image/png' } })
    );
    await first;
    await flushAsyncWork();

    const rulesWhileSecondIsPending = await chrome.declarativeNetRequest.getDynamicRules();
    expect(rulesWhileSecondIsPending).toHaveLength(1);
    expect(rulesWhileSecondIsPending[0].condition.regexFilter).toContain('second');

    pendingFetches.get('https://images.example/second.png')(
      new Response(new Uint8Array([0]), { status: 200, headers: { 'Content-Type': 'image/png' } })
    );
    await second;
    await expect(chrome.declarativeNetRequest.getDynamicRules()).resolves.toEqual([]);
  });
});

describe('background command persistence', () => {
  it('restores minimized windows after a Service Worker restart', async () => {
    const firstChrome = await loadBackground({ sync: { bossKey: true } });
    await firstChrome.commands.onCommand.emitAsync('boss-key');
    await flushAsyncWork();
    const minimizedWindows = await firstChrome.windows.getAll();
    expect(minimizedWindows[0].state).toBe('minimized');

    const restartedChrome = createFakeChrome({
      currentWindowId: 1,
      tabs: [activeTab],
      windows: minimizedWindows,
      storage: {
        sync: { bossKey: true },
        session: structuredClone(firstChrome.__testing.storageState.session)
      }
    });
    await executeWorkerScript(restartedChrome);
    await flushAsyncWork();
    await restartedChrome.commands.onCommand.emitAsync('boss-key');
    await flushAsyncWork();

    const restoredWindows = await restartedChrome.windows.getAll();
    expect(restoredWindows[0].state).toBe('normal');
  });
});

describe('background tab behavior', () => {
  it('skips browser pages when switching tabs by keyboard', async () => {
    const chrome = await loadBackground({
      tabs: [
        activeTab,
        { id: 2, windowId: 1, index: 1, active: false, url: 'edge://settings/' },
        { id: 3, windowId: 1, index: 2, active: false, url: 'https://three.example/' }
      ]
    });

    await chrome.runtime.sendMessage({ action: 'switchTab', direction: 'right', source: 'keyboard' });

    expect(chrome.__testing.snapshotTabs().find((tab) => tab.active)?.id).toBe(3);
  });

  it('moves a browser-created background tab next to the active tab', async () => {
    const chrome = await loadBackground({
      tabs: [
        activeTab,
        { id: 2, windowId: 1, index: 1, active: false, url: 'https://two.example/' }
      ]
    });

    const created = await chrome.tabs.create({ url: 'https://new.example/', active: false });
    await flushAsyncWork(8);

    expect(chrome.__testing.snapshotTabs().map((tab) => tab.id)).toEqual([1, created.id, 2]);
  });

  it('keeps rapid ordered background tabs in creation order', async () => {
    const chrome = await loadBackground({
      tabs: [
        activeTab,
        { id: 2, windowId: 1, index: 1, active: false, url: 'https://two.example/' }
      ]
    });

    const first = await chrome.tabs.create({ url: 'https://first.example/', active: false });
    const second = await chrome.tabs.create({ url: 'https://second.example/', active: false });
    const third = await chrome.tabs.create({ url: 'https://third.example/', active: false });
    await flushAsyncWork(12);

    expect(chrome.__testing.snapshotTabs().map((tab) => tab.id)).toEqual([1, first.id, second.id, third.id, 2]);
  });

  it('uses the queried active tab when the cached insertion base is stale', async () => {
    const chrome = await loadBackground({
      tabs: [
        activeTab,
        { id: 2, windowId: 1, index: 1, active: false, url: 'chrome-extension://echo-test-extension-id/docs-viewer.html' }
      ]
    });
    chrome.__testing.activateTab(2);
    await flushAsyncWork();
    chrome.__testing.tabsById.get(1).active = true;
    chrome.__testing.tabsById.get(2).active = false;

    await chrome.runtime.sendMessage({
      action: 'openInNewTab',
      url: 'https://created.example/',
      active: false
    });
    await flushAsyncWork(8);

    expect(chrome.__testing.snapshotTabs().map(tab => tab.url)).toEqual([
      activeTab.url,
      'https://created.example/',
      'chrome-extension://echo-test-extension-id/docs-viewer.html'
    ]);
  });

  it('activates the left tab after closing an active middle tab', async () => {
    const chrome = await loadBackground({
      tabs: [
        { id: 1, windowId: 1, index: 0, active: false, url: 'https://one.example/' },
        { id: 2, windowId: 1, index: 1, active: true, url: 'https://two.example/' },
        { id: 3, windowId: 1, index: 2, active: false, url: 'https://three.example/' }
      ]
    });

    await chrome.tabs.remove(2);
    await flushAsyncWork();

    expect(chrome.__testing.snapshotTabs().find((tab) => tab.active)?.id).toBe(1);
  });

  it('accepts the browser default when closing the active leftmost or rightmost tab', async () => {
    const leftmostChrome = await loadBackground({
      tabs: [
        { id: 1, windowId: 1, index: 0, active: true, url: 'https://one.example/' },
        { id: 2, windowId: 1, index: 1, active: false, url: 'https://two.example/' }
      ]
    });
    await leftmostChrome.tabs.remove(1);
    await flushAsyncWork();
    expect(leftmostChrome.__testing.snapshotTabs().find((tab) => tab.active)?.id).toBe(2);

    const rightmostChrome = await loadBackground({
      tabs: [
        { id: 10, windowId: 1, index: 0, active: false, url: 'https://ten.example/' },
        { id: 11, windowId: 1, index: 1, active: true, url: 'https://eleven.example/' }
      ]
    });
    await rightmostChrome.tabs.remove(11);
    await flushAsyncWork();
    expect(rightmostChrome.__testing.snapshotTabs().find((tab) => tab.active)?.id).toBe(10);
  });

  it('does not override the browser when closeTabActivate is right', async () => {
    const chrome = await loadBackground({
      sync: { closeTabActivate: 'right' },
      tabs: [
        { id: 1, windowId: 1, index: 0, active: false, url: 'https://one.example/' },
        { id: 2, windowId: 1, index: 1, active: true, url: 'https://two.example/' },
        { id: 3, windowId: 1, index: 2, active: false, url: 'https://three.example/' }
      ]
    });

    await chrome.tabs.remove(2);
    await flushAsyncWork();

    expect(chrome.__testing.snapshotTabs().find((tab) => tab.active)?.id).toBe(3);
  });

  it('does not change focus when closing a previously active but now inactive tab', async () => {
    const chrome = await loadBackground({
      tabs: [
        { id: 1, windowId: 1, index: 0, active: false, url: 'https://one.example/' },
        { id: 2, windowId: 1, index: 1, active: true, url: 'https://two.example/' },
        { id: 3, windowId: 1, index: 2, active: false, url: 'https://three.example/' }
      ]
    });
    chrome.__testing.activateTab(3);
    await flushAsyncWork();

    await chrome.tabs.remove(2);
    await flushAsyncWork();

    expect(chrome.__testing.snapshotTabs().find((tab) => tab.active)?.id).toBe(3);
  });

  it('does not suppress activation state in another window during tab removal', async () => {
    const chrome = await loadBackground({
      removalEventOrder: 'removed-first',
      tabs: [
        { id: 1, windowId: 1, index: 0, active: false, url: 'https://one.example/' },
        { id: 2, windowId: 1, index: 1, active: true, url: 'https://two.example/' },
        { id: 9, windowId: 2, index: 0, active: false, url: 'https://nine.example/' },
        { id: 10, windowId: 2, index: 1, active: true, url: 'https://ten.example/' },
        { id: 11, windowId: 2, index: 2, active: false, url: 'https://eleven.example/' }
      ]
    });
    const originalGet = chrome.storage.sync.get.bind(chrome.storage.sync);
    let releaseCloseSetting;
    let closeSettingRequested = false;
    const closeSettingGate = new Promise((resolve) => { releaseCloseSetting = resolve; });
    chrome.storage.sync.get = (keys, callback) => {
      if (keys && typeof keys === 'object' && Object.prototype.hasOwnProperty.call(keys, 'closeTabActivate')) {
        closeSettingRequested = true;
        const pending = closeSettingGate.then(() => originalGet(keys));
        if (typeof callback === 'function') pending.then(callback);
        return typeof callback === 'function' ? undefined : pending;
      }
      return originalGet(keys, callback);
    };

    const removal = chrome.tabs.remove(2);
    for (let index = 0; index < 10 && !closeSettingRequested; index += 1) await Promise.resolve();
    expect(closeSettingRequested).toBe(true);
    chrome.__testing.activateTab(11);
    releaseCloseSetting();
    await removal;
    await flushAsyncWork();

    await chrome.tabs.remove(10);
    await flushAsyncWork();
    expect(chrome.__testing.snapshotTabs(2).find((tab) => tab.active)?.id).toBe(11);
  });
});