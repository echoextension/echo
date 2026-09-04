// @vitest-environment node

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createFakeChrome } from '../helpers/fake-chrome.js';
import { createScriptDom, executeWindowScript, flushAsyncWork } from '../helpers/script-harness.js';

let dom;

function deferred() {
  let resolve;
  const promise = new Promise(value => { resolve = value; });
  return { promise, resolve };
}

afterEach(() => {
  dom?.window.close();
  dom = null;
});

describe('floating search trending controller', () => {
  it('does not restart its interval when a hidden request resolves late', async () => {
    const chrome = createFakeChrome();
    const response = deferred();
    chrome.runtime.onMessage.addListener((message) => {
      if (message.action === 'proxyFetch') return response.promise;
      return undefined;
    });
    dom = await createScriptDom({
      chrome,
      html: '<!doctype html><html><body><div class="trending-panel"><div class="trending-scroll-wrapper"><div class="trending-scroll-track"></div></div></div></body></html>'
    });
    await executeWindowScript(dom, 'search-box/trending-controller.js');
    const setInterval = vi.fn(() => 1);
    const clearInterval = vi.fn();
    const controller = dom.window.EchoSearchBoxTrendingController.create({
      chrome,
      document: dom.window.document,
      panel: dom.window.document.querySelector('.trending-panel'),
      actions: { OPEN_IN_NEW_TAB: 'openInNewTab', PROXY_FETCH: 'proxyFetch' },
      setInterval,
      clearInterval
    });

    controller.start();
    controller.stop();
    response.resolve({
      success: true,
      data: { data: [{ Title: 'First' }, { Title: 'Second' }] }
    });
    await flushAsyncWork(8);

    expect(setInterval).not.toHaveBeenCalled();
  });

  it('ignores an older request that resolves after a newer request', async () => {
    const chrome = createFakeChrome();
    const first = deferred();
    const second = deferred();
    let requestCount = 0;
    chrome.runtime.onMessage.addListener(message => {
      if (message.action !== 'proxyFetch') return undefined;
      requestCount += 1;
      return requestCount === 1 ? first.promise : second.promise;
    });
    dom = await createScriptDom({
      chrome,
      html: '<!doctype html><html><body><div class="trending-panel"><div class="trending-scroll-wrapper"><div class="trending-scroll-track"></div></div></div></body></html>'
    });
    await executeWindowScript(dom, 'search-box/trending-controller.js');
    const panel = dom.window.document.querySelector('.trending-panel');
    const controller = dom.window.EchoSearchBoxTrendingController.create({
      chrome,
      document: dom.window.document,
      panel,
      actions: { OPEN_IN_NEW_TAB: 'openInNewTab', PROXY_FETCH: 'proxyFetch' },
      setInterval: () => 1,
      clearInterval() {}
    });

    controller.start();
    controller.start();
    second.resolve({
      success: true,
      data: { data: [{ Title: 'New first' }, { Title: 'New second' }] }
    });
    await flushAsyncWork(8);
    first.resolve({
      success: true,
      data: { data: [{ Title: 'Old first' }, { Title: 'Old second' }] }
    });
    await flushAsyncWork(8);

    expect(panel.querySelector('.trending-word.active').textContent).toBe('New first');
  });

  it('hides the panel without retrying when the initial request fails', async () => {
    const chrome = createFakeChrome();
    chrome.runtime.onMessage.addListener(message => {
      if (message.action === 'proxyFetch') {
        return Promise.resolve({ success: false, error: 'network unavailable' });
      }
      return undefined;
    });
    dom = await createScriptDom({
      chrome,
      html: '<!doctype html><html><body><div class="trending-panel show"><div class="trending-scroll-wrapper"><div class="trending-scroll-track"></div></div></div></body></html>'
    });
    await executeWindowScript(dom, 'search-box/trending-controller.js');
    const panel = dom.window.document.querySelector('.trending-panel');
    const onAvailabilityChange = vi.fn((available) => {
      if (!available) panel.classList.remove('show');
    });
    const setInterval = vi.fn(() => 1);
    const controller = dom.window.EchoSearchBoxTrendingController.create({
      chrome,
      document: dom.window.document,
      panel,
      actions: { OPEN_IN_NEW_TAB: 'openInNewTab', PROXY_FETCH: 'proxyFetch' },
      onAvailabilityChange,
      setInterval,
      clearInterval() {}
    });

    controller.start();
    await flushAsyncWork(8);

    expect(onAvailabilityChange).toHaveBeenCalledWith(false);
    expect(panel.classList.contains('show')).toBe(false);
    expect(setInterval).not.toHaveBeenCalled();

    controller.start();
    await flushAsyncWork(4);
    expect(setInterval).not.toHaveBeenCalled();
  });
});