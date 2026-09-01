// @vitest-environment node

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createFakeChrome } from '../helpers/fake-chrome.js';
import {
  createScriptDom,
  executeExtensionWindowScript,
  executeWindowScript,
  flushAsyncWork,
  responseJson
} from '../helpers/script-harness.js';

let dom;

function installNtpRuntimeResponder(chrome, messages) {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    messages.push(message);
    if (message.action === 'bingSuggest') sendResponse({ suggestions: ['fixture suggestion'] });
    else sendResponse({ ok: true });
    return false;
  });
}

async function loadNtp({ htmlPath, storage, dispatchReady = false, fetchOverride, runtimeHandler } = {}) {
  const chrome = createFakeChrome({
    storage: {
      sync: storage?.sync || {},
      local: storage?.local || {}
    }
  });
  const messages = [];
  if (runtimeHandler) chrome.runtime.onMessage.addListener(runtimeHandler);
  else installNtpRuntimeResponder(chrome, messages);
  const fetch = fetchOverride || vi.fn(async (requestUrl) => {
    const url = String(requestUrl);
    if (url.includes('website/wallpaper-data.json')) {
      return responseJson([
        { id: 'latest', date: '2026-09-01', desc: 'Latest', copyright: 'Fixture' },
        { id: 'older', date: '2026-08-31', desc: 'Older', copyright: 'Fixture' }
      ]);
    }
    if (url.includes('HPImageArchive.aspx')) return responseJson({ images: [] });
    return new Response('', { status: 503 });
  });
  dom = await createScriptDom({
    chrome,
    htmlPath,
    html: htmlPath ? undefined : '<!doctype html><html><body><div class="container"></div></body></html>',
    url: 'https://extension.test/ntp/ntp.html',
    fetch
  });
  dom.window.LowPolyBg = {
    isInitialized: false,
    init() { this.isInitialized = true; },
    show() {},
    hide() {},
    pause() {},
    resume() {}
  };
  await executeWindowScript(dom, 'ntp/modules/wallpaper-domain.js');
  await executeWindowScript(dom, 'ntp/modules/wallpaper-state.js');
  await executeWindowScript(dom, 'ntp/modules/wallpaper-cache.js');
  await executeWindowScript(dom, 'ntp/modules/wallpaper-repository.js');
  await executeWindowScript(dom, 'ntp/modules/wallpaper-data-source.js');
  await executeWindowScript(dom, 'ntp/modules/wallpaper-image-processor.js');
  await executeWindowScript(dom, 'ntp/modules/custom-wallpaper-controller.js');
  await executeWindowScript(dom, 'ntp/modules/wallpaper-command-controller.js');
  await executeWindowScript(dom, 'ntp/modules/wallpaper-status-view.js');
  await executeWindowScript(dom, 'ntp/modules/wallpaper-settings-controller.js');
  await executeWindowScript(dom, 'ntp/modules/wallpaper-collection-controller.js');
  await executeWindowScript(dom, 'ntp/modules/wallpaper-page-controller.js');
  await executeWindowScript(dom, 'ntp/modules/wallpaper-sync-controller.js');
  await executeWindowScript(dom, 'ntp/modules/wallpaper-theme.js');
  await executeWindowScript(dom, 'ntp/modules/notification-view.js');
  await executeWindowScript(dom, 'ntp/modules/wallpaper-info-controller.js');
  await executeWindowScript(dom, 'ntp/modules/wallpaper-renderer.js');
  await executeWindowScript(dom, 'ntp/modules/trending-controller.js');
  await executeWindowScript(dom, 'ntp/modules/search-controller.js');
  await executeWindowScript(dom, 'ntp/modules/zoom-controller.js');
  await executeWindowScript(dom, 'ntp/modules/input-adapter.js');
  await executeWindowScript(dom, 'ntp/modules/lowpoly-adapter.js');
  await executeWindowScript(dom, 'ntp/modules/blank-mode-controller.js');
  await executeWindowScript(dom, 'ntp/modules/startup.js');
  await executeExtensionWindowScript(dom, 'ntp/ntp.js', `
    globalThis.__echoNtpTestState = wallpaperState;
    globalThis.__echoNtpTrendingController = trendingController;
    globalThis.__echoNtpWallpaperCache = wallpaperCache;
  `);
  if (dispatchReady) {
    dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
    await flushAsyncWork(20);
  }
  return { chrome, fetch, messages, window: dom.window };
}

afterEach(() => {
  dom?.window.close();
  dom = null;
});

describe('NTP first paint and wallpaper selection', () => {
  it('applies blank and trending first-paint classes from localStorage', async () => {
    const chrome = createFakeChrome();
    dom = await createScriptDom({
      chrome,
      html: '<!doctype html><html><body></body></html>',
      url: 'https://extension.test/ntp/ntp.html'
    });
    dom.window.localStorage.setItem('echo_ntp_blank_mode', 'true');
    dom.window.localStorage.setItem('echo_ntp_trending', 'false');

    await executeWindowScript(dom, 'ntp/blank-init.js');

    expect(dom.window.__ECHO_NTP_BLANK_MODE__).toBe(true);
    expect(dom.window.document.documentElement.classList.contains('blank-mode')).toBe(true);
    expect(dom.window.document.documentElement.classList.contains('trending-hidden')).toBe(true);
  });

  it('gives a valid pinned wallpaper precedence over collection and daily modes', async () => {
    const { window } = await loadNtp();

    const state = window.__echoNtpTestState;
    state.history = [
        { id: 'latest', date: '2026-09-01' },
        { id: 'favorite', date: '2026-08-31' }
      ];
    state.favorites = ['2026-08-31'];
    state.settings.mode = 'collection';
    state.settings.pinnedDate = '2026-08-31';
    const selected = window.selectWallpaper();

    expect(selected).toEqual({ id: 'favorite', date: '2026-08-31' });
  });

  it('falls back from an empty collection to the latest daily wallpaper', async () => {
    const { window } = await loadNtp();

    const state = window.__echoNtpTestState;
    state.history = [
        { id: 'latest', date: '2026-09-01' },
        { id: 'older', date: '2026-08-31' }
      ];
    state.favorites = [];
    state.settings.mode = 'collection';
    state.settings.pinnedDate = null;
    const result = { selected: window.selectWallpaper(), mode: state.settings.mode };

    expect(result.selected).toEqual({ id: 'latest', date: '2026-09-01' });
    expect(result.mode).toBe('daily');
  });

  it('does not cache an HTTP error page as a wallpaper image', async () => {
    const fetch = vi.fn(async () => new Response('<html>not an image</html>', {
      status: 404,
      headers: { 'Content-Type': 'text/html' }
    }));
    const { window } = await loadNtp({ fetchOverride: fetch });
    const state = window.__echoNtpTestState;
    state.history = [{ id: 'missing', date: '2026-09-01', desc: 'Missing' }];
    state.browseIndex = 0;
    const imageUrl = window.EchoNtpWallpaperDomain.buildBingUrl('missing', '4k');

    await window.displayWallpaper(state.history[0]);

    await expect(window.__echoNtpWallpaperCache.get(imageUrl)).resolves.toBeNull();
  });
});

describe('NTP stored state and interactions', () => {
  it('recovers favorites that were saved to local storage after a sync quota failure', async () => {
    const { chrome, window } = await loadNtp({
      storage: {
        local: { echo_ntp_wallpaper_favorites: ['2026-09-01'] },
        sync: {}
      }
    });

    await window.loadWallpaperSettings();

    expect(window.__echoNtpTestState.favorites).toEqual(['2026-09-01']);
    await expect(chrome.storage.sync.get('echo_ntp_wallpaper_favorites')).resolves.toEqual({
      echo_ntp_wallpaper_favorites: ['2026-09-01']
    });
  });

  it('writes a versioned local fallback on sync failure and removes it after recovery', async () => {
    const { chrome, window } = await loadNtp();
    window.__echoNtpTestState.favorites = ['2026-09-01'];
    chrome.__testing.failNextStorageSet('sync');

    await window.saveFavorites();

    const fallback = (await chrome.storage.local.get('echo_ntp_wallpaper_favorites')).echo_ntp_wallpaper_favorites;
    expect(fallback).toMatchObject({
      schemaVersion: 1,
      favorites: ['2026-09-01']
    });

    await window.saveFavorites();
    await expect(chrome.storage.local.get('echo_ntp_wallpaper_favorites')).resolves.toEqual({
      echo_ntp_wallpaper_favorites: undefined
    });
  });

  it('migrates a legacy numeric trending category to a stable tab name', async () => {
    const { chrome, window } = await loadNtp({ storage: { local: { echo_ntp_trending_category: 7 } } });

    await window.__echoNtpTrendingController.loadStoredCategory();

    await expect(chrome.storage.local.get('echo_ntp_trending_category')).resolves.toEqual({
      echo_ntp_trending_category: 'novel'
    });
  });

  it('sends an F3 tab-switch message from the NTP page', async () => {
    const { messages, window } = await loadNtp();

    window.document.body.dispatchEvent(new window.KeyboardEvent('keydown', {
      key: 'F3',
      bubbles: true,
      cancelable: true
    }));

    expect(messages).toContainEqual({ action: 'switchTab', direction: 'right', source: 'keyboard' });
  });

  it('does not intercept disabled NTP keyboard or zoom capabilities', async () => {
    const { messages, window } = await loadNtp({
      storage: {
        sync: { tabSwitchKey: false, fineZoom: false }
      }
    });
    const keyEvent = new window.KeyboardEvent('keydown', {
      key: 'F3', bubbles: true, cancelable: true
    });
    const wheelEvent = new window.WheelEvent('wheel', {
      ctrlKey: true, deltaY: -100, bubbles: true, cancelable: true
    });

    window.document.body.dispatchEvent(keyEvent);
    window.document.dispatchEvent(wheelEvent);

    expect(keyEvent.defaultPrevented).toBe(false);
    expect(wheelEvent.defaultPrevented).toBe(false);
    expect(messages.some(message => message.action === 'switchTab')).toBe(false);
  });

  it('binds the full NTP search form and opens submitted searches in a foreground tab', async () => {
    const { chrome, window } = await loadNtp({
      htmlPath: 'ntp/ntp.html',
      dispatchReady: true,
      storage: {
        local: {
          echo_ntp_wallpaper_v2: { mode: 'off', blankMode: false },
          echo_ntp_trending: false
        }
      }
    });
    const input = window.document.querySelector('.search-input');
    input.value = 'fixture query';

    window.document.querySelector('.search-form').dispatchEvent(new window.Event('submit', {
      bubbles: true,
      cancelable: true
    }));
    await flushAsyncWork();

    const opened = chrome.__testing.snapshotTabs().find((tab) => tab.url.includes('bing.com/search'));
    expect(opened.url).toContain('fixture%20query');
    expect(opened.active).toBe(true);
  });

  it('binds search without waiting for a pending wallpaper data request', async () => {
    let resolveWallpaperData;
    const pendingWallpaperData = new Promise((resolve) => { resolveWallpaperData = resolve; });
    const fetch = vi.fn((requestUrl) => {
      const url = String(requestUrl);
      if (url.includes('website/wallpaper-data.json')) return pendingWallpaperData;
      if (url.includes('HPImageArchive.aspx')) return Promise.resolve(responseJson({ images: [] }));
      return Promise.resolve(new Response('', { status: 503 }));
    });
    const { chrome, window } = await loadNtp({
      htmlPath: 'ntp/ntp.html',
      dispatchReady: true,
      fetchOverride: fetch,
      storage: { local: { echo_ntp_wallpaper_v2: { mode: 'daily', blankMode: false } } }
    });
    const input = window.document.querySelector('.search-input');
    input.value = 'available immediately';
    const submit = new window.Event('submit', { bubbles: true, cancelable: true });

    window.document.querySelector('.search-form').dispatchEvent(submit);
    await flushAsyncWork();

    expect(submit.defaultPrevented).toBe(true);
    expect(chrome.__testing.snapshotTabs().some((tab) => tab.url.includes('available%20immediately'))).toBe(true);

    resolveWallpaperData(responseJson([]));
    await flushAsyncWork();
  });

  it('ignores an older search suggestion response that arrives after a newer query', async () => {
    const pendingResponses = new Map();
    const { window } = await loadNtp({
      htmlPath: 'ntp/ntp.html',
      dispatchReady: true,
      storage: {
        local: {
          echo_ntp_wallpaper_v2: { mode: 'off', blankMode: false },
          echo_ntp_trending: false
        }
      },
      runtimeHandler(message, _sender, sendResponse) {
        if (message.action !== 'bingSuggest') return false;
        pendingResponses.set(message.query, sendResponse);
        return true;
      }
    });
    const input = window.document.querySelector('.search-input');
    input.value = 'old';
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 230));
    input.value = 'new';
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 230));

    pendingResponses.get('new')({ suggestions: ['new suggestion'] });
    await flushAsyncWork();
    pendingResponses.get('old')({ suggestions: ['old suggestion'] });
    await flushAsyncWork();

    expect(window.document.querySelector('.search-suggest-text').textContent).toBe('new suggestion');
  });
});