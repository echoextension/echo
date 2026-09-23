// @vitest-environment node

import { afterEach, describe, expect, it } from 'vitest';

import { createFakeChrome } from '../helpers/fake-chrome.js';
import { createScriptDom, executeExtensionWindowScript, flushAsyncWork } from '../helpers/script-harness.js';

let dom;

async function loadSearchBox(sync = {}, configureWindow = null, runtimeResponder = null) {
  const chrome = createFakeChrome({
    storage: {
      sync: {
        floatingSearchBox: true,
        floatingSearchBoxAlwaysShow: false,
        floatingSearchBoxTrending: false,
        floatingSearchBoxFollowZoom: true,
        ...sync
      }
    }
  });
  const messages = [];
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    messages.push(message);
    const customResult = runtimeResponder?.(message, sendResponse);
    if (customResult !== undefined) return customResult;
    if (message.action === 'getZoom') sendResponse({ zoom: 1 });
    else sendResponse({ success: true, data: { data: [] } });
    return false;
  });
  dom = await createScriptDom({
    chrome,
    html: '<!doctype html><html><body><input id="page-input"><main>Page</main></body></html>',
    url: 'https://example.test/'
  });
  configureWindow?.(dom.window);
  await executeExtensionWindowScript(dom, 'search-box/trending-controller.js');
  await executeExtensionWindowScript(dom, 'search-box/search-box.js');
  await flushAsyncWork();
  return { chrome, messages, window: dom.window };
}

function pressCtrlB(window, target = window.document.body) {
  const event = new window.KeyboardEvent('keydown', {
    key: 'b',
    ctrlKey: true,
    bubbles: true,
    cancelable: true
  });
  target.dispatchEvent(event);
  return event;
}

afterEach(() => {
  dom?.window.close();
  dom = null;
});

describe('floating search box', () => {
  it('does not register an active search box when the main switch is disabled', async () => {
    const { window } = await loadSearchBox({ floatingSearchBox: false });

    const event = pressCtrlB(window);

    expect(event.defaultPrevented).toBe(false);
    expect(window.document.getElementById('echo-search-box-host')).toBeNull();
    expect(window.echoToggleSearchBox).toBeUndefined();
  });

  it('opens and closes its isolated iframe with Ctrl+B', async () => {
    const { window } = await loadSearchBox();

    const openingEvent = pressCtrlB(window);
    await flushAsyncWork();
    const host = window.document.getElementById('echo-search-box-host');
    const wrapper = host.contentDocument.querySelector('.search-wrapper');

    expect(openingEvent.defaultPrevented).toBe(true);
    expect(host).not.toBeNull();
    expect(wrapper.classList.contains('show')).toBe(true);
    expect(host.style.pointerEvents).toBe('auto');

    pressCtrlB(window);
    expect(wrapper.classList.contains('show')).toBe(false);
    expect(host.style.pointerEvents).toBe('none');
  });

  it('does not intercept Ctrl+B in a page input', async () => {
    const { window } = await loadSearchBox();
    const input = window.document.getElementById('page-input');
    input.focus();

    const event = pressCtrlB(window, input);

    expect(event.defaultPrevented).toBe(false);
    expect(window.document.getElementById('echo-search-box-host')).toBeNull();
  });

  it('updates the trending setting through storage changes', async () => {
    const { chrome, window } = await loadSearchBox({}, null, (message, sendResponse) => {
      if (message.action !== 'proxyFetch') return undefined;
      sendResponse({
        success: true,
        data: { data: [{ Title: '正常热搜' }] }
      });
      return false;
    });
    pressCtrlB(window);
    await flushAsyncWork();
    const panel = window.document.getElementById('echo-search-box-host').contentDocument.querySelector('.trending-panel');
    expect(panel.classList.contains('show')).toBe(false);

    await chrome.storage.sync.set({ floatingSearchBoxTrending: true });
    await flushAsyncWork();

    expect(panel.classList.contains('show')).toBe(true);
  });

  it('renders three escaped Toutiao trends and opens the active item', async () => {
    const { messages, window } = await loadSearchBox(
      { floatingSearchBoxAlwaysShow: true, floatingSearchBoxTrending: true },
      null,
      (message, sendResponse) => {
        if (message.action !== 'proxyFetch') return undefined;
        sendResponse({
          success: true,
          data: {
            data: [
              { Title: 'First trend' },
              { Title: '<unsafe trend>' },
              { Title: 'Third trend' }
            ]
          }
        });
        return false;
      }
    );
    await flushAsyncWork(8);
    const panel = window.document.getElementById('echo-search-box-host')
      .contentDocument.querySelector('.trending-panel');
    const words = [...panel.querySelectorAll('.trending-word')];

    expect(words).toHaveLength(3);
    expect(words.map(word => word.textContent)).toEqual([
      'Third trend',
      'First trend',
      '<unsafe trend>'
    ]);
    expect(panel.querySelector('.trending-word.active').innerHTML).toBe('First trend');

    panel.querySelector('.trending-word.active').click();
    expect(messages).toContainEqual({
      action: 'openInNewTab',
      url: 'https://www.bing.com/search?q=First%20trend',
      active: true,
      forceAdjacentPosition: true
    });
  });

  it('stops zoom polling and spectrum animation when hidden', async () => {
    const activeIntervals = new Set();
    const cancelledAnimationFrames = [];
    let nextTimerId = 1;
    let nextFrameId = 1;
    const { window } = await loadSearchBox(
      { floatingSearchBoxFollowZoom: false },
      (testWindow) => {
        testWindow.setInterval = () => {
          const id = nextTimerId++;
          activeIntervals.add(id);
          return id;
        };
        testWindow.clearInterval = (id) => activeIntervals.delete(id);
        testWindow.requestAnimationFrame = () => nextFrameId++;
        testWindow.cancelAnimationFrame = (id) => cancelledAnimationFrames.push(id);
      }
    );

    pressCtrlB(window);
    await flushAsyncWork();
    expect(activeIntervals.size).toBe(1);

    pressCtrlB(window);

    expect(activeIntervals.size).toBe(0);
    expect(cancelledAnimationFrames.length).toBeGreaterThan(0);
  });
});