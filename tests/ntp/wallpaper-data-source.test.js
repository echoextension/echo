// @vitest-environment node

import { afterEach, describe, expect, it } from 'vitest';

import { createFakeChrome } from '../helpers/fake-chrome.js';
import { createScriptDom, executeWindowScript, flushAsyncWork } from '../helpers/script-harness.js';

let dom;

async function loadModule() {
  dom = await createScriptDom({ chrome: createFakeChrome(), url: 'https://extension.test/' });
  await executeWindowScript(dom, 'ntp/modules/wallpaper-data-source.js');
  return dom.window.EchoNtpWallpaperDataSource;
}

afterEach(() => {
  dom?.window.close();
  dom = null;
});

describe('wallpaper data source', () => {
  it('normalizes Bing metadata without retaining the OHR URL prefix', async () => {
    const module = await loadModule();
    expect(module.normalizeBingResponse({
      images: [{
        urlbase: '/th?id=OHR.Fixture_ZH-CN123',
        enddate: '20260901',
        copyright: 'Fixture place (© Fixture Author)'
      }]
    })).toEqual([{
      id: 'Fixture_ZH-CN123',
      date: '2026-09-01',
      desc: 'Fixture place',
      copyright: '(© Fixture Author)'
    }]);
  });

  it('gives later sources precedence by date and sorts descending', async () => {
    const module = await loadModule();
    expect(module.mergeByDate(
      [{ id: 'packaged', date: '2026-08-31' }],
      [{ id: 'remote', date: '2026-09-01' }],
      [{ id: 'bing', date: '2026-08-31' }]
    )).toEqual([
      { id: 'remote', date: '2026-09-01' },
      { id: 'bing', date: '2026-08-31' }
    ]);
  });

  it('ignores malformed wallpaper records before sorting or caching them', async () => {
    const module = await loadModule();
    expect(module.mergeByDate(
      [{ id: 'valid', date: '2026-09-03' }],
      [
        { id: 'invalid-number-date', date: 20260904 },
        { id: 'invalid-calendar-date', date: '2026-99-99' },
        null
      ]
    )).toEqual([{ id: 'valid', date: '2026-09-03' }]);

    const fetch = async (requestUrl) => {
      const url = String(requestUrl);
      if (url === module.REMOTE_URL) {
        return new Response(JSON.stringify([{ id: 'invalid', date: 20260904 }]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      if (url.includes('wallpaper-data.json')) {
        return new Response(JSON.stringify([{ id: 'packaged', date: '2026-09-03' }]));
      }
      return new Response(JSON.stringify({ images: [] }));
    };
    const state = { settings: { mode: 'off' }, history: [], current: null };
    const source = module.create({
      fetch,
      localStorage: dom.window.localStorage,
      runtimeGetUrl: path => `chrome-extension://test/${path}`,
      state,
      getLatestBingWallpaper: () => null,
      onDailyWallpaper() {}
    });

    await source.mergeHistory();
    await flushAsyncWork(8);

    expect(dom.window.localStorage.getItem(module.REMOTE_CACHE_KEY)).toBeNull();
  });

  it('includes a background remote refresh that resolves before mergeHistory returns', async () => {
    const module = await loadModule();
    let resolveRemote;
    let resolveBing;
    const remoteResponse = new Promise(resolve => { resolveRemote = resolve; });
    const bingResponse = new Promise(resolve => { resolveBing = resolve; });
    const fetch = (requestUrl) => {
      const url = String(requestUrl);
      if (url === module.REMOTE_URL) return remoteResponse;
      if (url.includes('wallpaper-data.json')) {
        return Promise.resolve(new Response(JSON.stringify([
          { id: 'packaged', date: '2026-09-01' }
        ])));
      }
      return bingResponse;
    };
    const state = {
      settings: { mode: 'daily', pinnedDate: null },
      history: [],
      current: null
    };
    const source = module.create({
      fetch,
      localStorage: dom.window.localStorage,
      runtimeGetUrl: path => `chrome-extension://test/${path}`,
      state,
      getLatestBingWallpaper: () => null,
      onDailyWallpaper() {}
    });

    const merged = source.mergeHistory();
    await flushAsyncWork();
    resolveRemote(new Response(JSON.stringify([
      { id: 'remote', date: '2026-09-02' }
    ])));
    await flushAsyncWork();
    resolveBing(new Response(JSON.stringify({ images: [] })));

    await expect(merged).resolves.toEqual([
      { id: 'remote', date: '2026-09-02' },
      { id: 'packaged', date: '2026-09-01' }
    ]);
  });
});