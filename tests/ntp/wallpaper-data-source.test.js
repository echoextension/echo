// @vitest-environment node

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createFakeChrome } from '../helpers/fake-chrome.js';
import { createScriptDom, executeWindowScript, flushAsyncWork } from '../helpers/script-harness.js';

let dom;

async function loadModule() {
  dom = await createScriptDom({ chrome: createFakeChrome(), url: 'https://extension.test/' });
  await executeWindowScript(dom, 'ntp/modules/wallpaper-data-source.js');
  return dom.window.EchoNtpWallpaperDataSource;
}

afterEach(() => {
  vi.useRealTimers();
  dom?.window.close();
  dom = null;
});

describe('wallpaper data source', () => {
  async function setupRefresh(fetchBing, fetchRemote = async () => new Response('[]')) {
    const module = await loadModule();
    const previous = { id: 'previous', date: '2026-09-16' };
    const state = {
      settings: { mode: 'daily', pinnedDate: null }, history: [previous], current: previous
    };
    const onDailyWallpaper = vi.fn();
    const fetch = vi.fn((url, init) => {
      if (url === module.BING_API) return fetchBing(init);
      if (url === module.REMOTE_URL) return fetchRemote(init);
      return Promise.resolve(new Response('[]'));
    });
    const source = module.create({
      fetch,
      localStorage: dom.window.localStorage,
      runtimeGetUrl: path => `chrome-extension://test/${path}`,
      state,
      getLatestBingWallpaper: () => state.history.find(wallpaper => wallpaper.type !== 'custom'),
      onDailyWallpaper
    });
    return { module, state, source, onDailyWallpaper, fetch };
  }

  function bingResponse() {
    return new Response(JSON.stringify({ images: [{ urlbase: '/th?id=OHR.latest', enddate: '20260917' }] }));
  }

  it('caches and applies a Bing result arriving after the former five-second deadline', async () => {
    let resolveBing;
    const response = new Promise(resolve => { resolveBing = resolve; });
    const { module, source, state, onDailyWallpaper } = await setupRefresh(() => response);
    vi.useFakeTimers();

    const refresh = source.refresh();
    await vi.advanceTimersByTimeAsync(6000);
    expect(state.current.id).toBe('previous');
    resolveBing(bingResponse());
    await refresh;

    expect(state.history[0].id).toBe('latest');
    expect(onDailyWallpaper).toHaveBeenCalledWith(expect.objectContaining({ id: 'latest' }));
    expect(JSON.parse(dom.window.localStorage.getItem(module.BING_CACHE_KEY)).data[0].id).toBe('latest');
  });

  it('coalesces concurrent refreshes and retries a failed Bing request once', async () => {
    const fetchBing = vi.fn()
      .mockRejectedValueOnce(new Error('network unavailable'))
      .mockImplementationOnce(async () => bingResponse());
    const { source, onDailyWallpaper } = await setupRefresh(fetchBing);

    const refresh = source.refresh();
    expect(source.refresh()).toBe(refresh);
    await refresh;

    expect(fetchBing).toHaveBeenCalledTimes(2);
    expect(fetchBing.mock.calls[0][0].signal).toBeInstanceOf(AbortSignal);
    expect(onDailyWallpaper).toHaveBeenCalledOnce();
  });

  it('bounds retries and keeps existing data when Bing remains unavailable', async () => {
    const fetchBing = vi.fn(async () => new Response('', { status: 503 }));
    const { source, state, onDailyWallpaper } = await setupRefresh(fetchBing);

    await source.refresh();

    expect(fetchBing).toHaveBeenCalledTimes(2);
    expect(state.history[0].id).toBe('previous');
    expect(onDailyWallpaper).not.toHaveBeenCalled();
  });

  it('applies fresh remote data when Bing is unavailable', async () => {
    const { source, onDailyWallpaper } = await setupRefresh(
      async () => new Response('', { status: 503 }),
      async () => new Response(JSON.stringify([{ id: 'remote', date: '2026-09-17' }]))
    );

    await source.refresh();

    expect(onDailyWallpaper).toHaveBeenCalledWith({ id: 'remote', date: '2026-09-17' });
  });

  it('preserves custom records and Bing precedence when remote data arrives later', async () => {
    let resolveRemote;
    const remote = new Promise(resolve => { resolveRemote = resolve; });
    const { source, state, onDailyWallpaper } = await setupRefresh(async () => bingResponse(), () => remote);
    const custom = { id: 'custom', date: 'custom:1', type: 'custom' };
    state.history.unshift(custom);
    vi.spyOn(dom.window.Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded');
    });

    const refresh = source.refresh();
    await flushAsyncWork();
    state.current = state.history.find(wallpaper => wallpaper.id === 'latest');
    resolveRemote(new Response(JSON.stringify([{ id: 'remote', date: '2026-09-17' }])));
    await refresh;

    expect(state.history).toContain(custom);
    expect(state.history.find(wallpaper => wallpaper.date === '2026-09-17').id).toBe('latest');
    expect(onDailyWallpaper).toHaveBeenCalledOnce();
  });

  it.each(['collection', 'off', 'pinned', 'blank', 'preview'])(
    'updates metadata without replacing the image while %s is active', async kind => {
      const { source, state, onDailyWallpaper } = await setupRefresh(async () => bingResponse());
      if (['collection', 'off'].includes(kind)) state.settings.mode = kind;
      if (kind === 'pinned') state.settings.pinnedDate = '2026-09-16';
      if (kind === 'blank') state.settings.blankMode = true;
      if (kind === 'preview') state.isPreview = true;

      await source.refresh();

      expect(state.history[0].id).toBe('latest');
      expect(onDailyWallpaper).not.toHaveBeenCalled();
    }
  );

  it('returns local history without waiting for or starting network refreshes', async () => {
    const module = await loadModule();
    const cached = { id: 'cached', date: '2026-09-01' };
    dom.window.localStorage.setItem(module.BING_CACHE_KEY, JSON.stringify({ data: [cached] }));
    const fetch = vi.fn(url => String(url).startsWith('chrome-extension://')
      ? Promise.resolve(new Response('[]'))
      : new Promise(() => {}));
    const state = { settings: { mode: 'daily', pinnedDate: null }, history: [], current: null };
    const source = module.create({
      fetch,
      localStorage: dom.window.localStorage,
      runtimeGetUrl: path => `chrome-extension://test/${path}`,
      state,
      getLatestBingWallpaper: () => state.history[0],
      onDailyWallpaper: vi.fn()
    });
    let history;

    void source.mergeHistory().then(data => { history = data; });
    await flushAsyncWork(8);

    expect(history).toEqual([cached]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

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

    state.history = await source.mergeHistory();
    await source.refresh();

    expect(dom.window.localStorage.getItem(module.REMOTE_CACHE_KEY)).toBeNull();
  });

  it('applies a late remote refresh after local history is initialized', async () => {
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

    state.history = await source.mergeHistory();
    expect(state.history).toEqual([{ id: 'packaged', date: '2026-09-01' }]);
    const refreshed = source.refresh();
    resolveRemote(new Response(JSON.stringify([
      { id: 'remote', date: '2026-09-02' }
    ])));
    await flushAsyncWork();
    resolveBing(new Response(JSON.stringify({ images: [] })));

    await refreshed;
    expect(state.history).toEqual([
      { id: 'remote', date: '2026-09-02' },
      { id: 'packaged', date: '2026-09-01' }
    ]);
  });
});