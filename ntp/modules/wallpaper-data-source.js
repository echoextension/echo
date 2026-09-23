(function(root) {
  'use strict';

  const BING_API = 'https://cn.bing.com/HPImageArchive.aspx?format=js&idx=0&n=8&mkt=zh-CN';
  const REMOTE_URL = 'https://www.echoextension.com/wallpaper-data.json';
  const REMOTE_CACHE_KEY = 'echo_remote_wallpaper_cache';
  const BING_CACHE_KEY = 'echo_bing_api_cache';
  const DAY_MS = 24 * 60 * 60 * 1000;

  function isValidDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.valueOf()) && date.toISOString().startsWith(value);
  }

  function normalizeWallpaperList(value) {
    return Array.isArray(value)
      ? value.filter(wallpaper => wallpaper
        && typeof wallpaper.id === 'string'
        && wallpaper.id.length > 0
        && typeof wallpaper.date === 'string'
        && isValidDate(wallpaper.date))
      : [];
  }

  function readCache(localStorageApi, key) {
    try {
      const value = JSON.parse(localStorageApi.getItem(key) || 'null');
      if (!value || !Array.isArray(value.data)) return null;
      const data = normalizeWallpaperList(value.data);
      return data.length === value.data.length ? { ...value, data } : null;
    } catch {
      return null;
    }
  }

  function writeCache(localStorageApi, key, data) {
    try {
      localStorageApi.setItem(key, JSON.stringify({ timestamp: Date.now(), data }));
    } catch {}
  }

  function normalizeBingResponse(body) {
    if (!Array.isArray(body?.images)) return [];
    return body.images.map(image => {
      const date = image.enddate || '';
      return {
        id: image.urlbase?.replace('/th?id=OHR.', '') || 'unknown',
        date: /^\d{8}$/.test(date)
          ? `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`
          : date,
        desc: image.copyright?.split(' (©')[0] || image.title || '必应每日壁纸',
        copyright: image.copyright?.match(/\(©[^)]+\)/)?.[0] || ''
      };
    });
  }

  function mergeByDate(...sources) {
    const merged = new Map();
    for (const source of sources) {
      for (const wallpaper of Array.isArray(source) ? source : []) {
        if (normalizeWallpaperList([wallpaper]).length) merged.set(wallpaper.date, wallpaper);
      }
    }
    return [...merged.values()].sort((left, right) => right.date.localeCompare(left.date));
  }

  function create(options) {
    const fetchImpl = options.fetch;
    const localStorageApi = options.localStorage;
    const runtimeGetUrl = options.runtimeGetUrl;
    const state = options.state;
    const onDailyWallpaper = options.onDailyWallpaper;
    let refreshing = null;
    let bingData = [];

    async function fetchBing() {
      try {
        const response = await fetchImpl(BING_API, { signal: AbortSignal.timeout(15000) });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return normalizeWallpaperList(normalizeBingResponse(await response.json()));
      } catch (error) {
        console.error('[ECHO NTP] Bing API 请求失败:', error);
        return [];
      }
    }

    async function loadPackaged() {
      try {
        const response = await fetchImpl(runtimeGetUrl('website/wallpaper-data.json'));
        return response.ok ? await response.json() : [];
      } catch (error) {
        console.warn('[ECHO NTP] 本地壁纸数据加载失败:', error.message);
        return [];
      }
    }

    function refreshRemoteInBackground(cached) {
      if (cached && Date.now() - (cached.timestamp || 0) < DAY_MS) return;
      return fetchImpl(REMOTE_URL, { signal: AbortSignal.timeout(5000) })
        .then(response => response.ok ? response.json() : Promise.reject(new Error(`HTTP ${response.status}`)))
        .then(data => applyRefresh(normalizeWallpaperList(data), REMOTE_CACHE_KEY))
        .catch(() => {});
    }

    function applyRefresh(data, cacheKey) {
      if (!data.length) return;
      if (cacheKey === BING_CACHE_KEY) bingData = data;
      writeCache(localStorageApi, cacheKey, data);
      const custom = state.history.filter(wallpaper => wallpaper.type === 'custom');
      state.history = [...custom, ...mergeByDate(state.history, data,
        cacheKey === REMOTE_CACHE_KEY ? bingData : [])];
      if (state.settings.mode === 'daily' && !state.settings.pinnedDate
          && !state.settings.blankMode && !state.isPreview) {
        const latest = options.getLatestBingWallpaper();
        if (latest && state.current?.id !== latest.id) return onDailyWallpaper(latest);
      }
    }

    async function mergeHistory() {
      const packaged = await loadPackaged();
      const remoteCache = readCache(localStorageApi, REMOTE_CACHE_KEY);
      const bingCache = readCache(localStorageApi, BING_CACHE_KEY);
      bingData = bingCache?.data || [];
      return mergeByDate(packaged, remoteCache?.data || [], bingData);
    }

    function refresh() {
      if (refreshing) return refreshing;
      refreshing = Promise.all([
        refreshRemoteInBackground(readCache(localStorageApi, REMOTE_CACHE_KEY)),
        (async () => {
          let data = await fetchBing();
          if (!data.length) data = await fetchBing();
          return applyRefresh(data, BING_CACHE_KEY);
        })()
      ]).catch(error => {
        console.warn('[ECHO NTP] 壁纸刷新失败:', error);
      }).finally(() => { refreshing = null; });
      return refreshing;
    }

    return Object.freeze({ fetchBing, loadPackaged, mergeHistory, refresh });
  }

  root.EchoNtpWallpaperDataSource = Object.freeze({
    BING_API,
    BING_CACHE_KEY,
    REMOTE_CACHE_KEY,
    REMOTE_URL,
    create,
    mergeByDate,
    normalizeWallpaperList,
    normalizeBingResponse
  });
})(globalThis);