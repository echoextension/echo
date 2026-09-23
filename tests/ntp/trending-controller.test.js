// @vitest-environment node

import { afterEach, describe, expect, it } from 'vitest';

import { createFakeChrome } from '../helpers/fake-chrome.js';
import { createScriptDom, executeWindowScript, flushAsyncWork } from '../helpers/script-harness.js';

let dom;

afterEach(() => {
  dom?.window.close();
  dom = null;
});

describe('trending controller cache validation', () => {
  it('does not cache a short response and can recover on the next refresh', async () => {
    const chrome = createFakeChrome();
    let itemCount = 2;
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message.action !== 'proxyFetch') return false;
      const content = Array.from({ length: itemCount }, (_, index) => ({ word: `item-${index}` }));
      sendResponse({
        success: true,
        data: { success: true, data: { cards: [{ content: [{ content }] }] } }
      });
      return false;
    });
    dom = await createScriptDom({
      chrome,
      html: '<!doctype html><html><body><div id="trendingList"></div></body></html>'
    });
    await executeWindowScript(dom, 'ntp/modules/trending-controller.js');
    const controller = dom.window.EchoNtpTrendingController.create({
      chrome,
      document: dom.window.document,
      window: dom.window,
      actions: { PROXY_FETCH: 'proxyFetch' },
      minimumItems: 3,
      storageKeys: {
        enabled: 'trending',
        cache: 'trending_cache',
        category: 'trending_category'
      }
    });

    await controller.loadData(true);
    await expect(chrome.storage.local.get('trending_cache_baidu_realtime')).resolves.toEqual({
      trending_cache_baidu_realtime: undefined
    });

    itemCount = 3;
    await controller.loadData(true, 0);
    await flushAsyncWork();

    const stored = await chrome.storage.local.get('trending_cache_baidu_realtime');
    expect(stored.trending_cache_baidu_realtime.data).toHaveLength(3);
  });
});