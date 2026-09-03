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
    let refreshedRemoteData = [];

    async function fetchBing() {
      try {
        const response = await fetchImpl(BING_API);
        if (!response.ok) return [];
        return normalizeBingResponse(await response.json());
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
      fetchImpl(REMOTE_URL, { signal: AbortSignal.timeout(5000) })
        .then(response => response.ok ? response.json() : Promise.reject(new Error(`HTTP ${response.status}`)))
        .then(data => {
          const normalized = normalizeWallpaperList(data);
          if (!normalized.length) return;
          refreshedRemoteData = normalized;
          writeCache(localStorageApi, REMOTE_CACHE_KEY, normalized);
          state.history = mergeByDate(state.history, normalized);
        })
        .catch(() => {});
    }

    function applyBingRefresh(data) {
      if (!data.length) return;
      writeCache(localStorageApi, BING_CACHE_KEY, data);
      state.history = mergeByDate(state.history, data);
      if (state.settings.mode === 'daily' && !state.settings.pinnedDate) {
        const latest = options.getLatestBingWallpaper();
        if (latest && state.current?.id !== latest.id) onDailyWallpaper(latest);
      }
    }

    async function mergeHistory() {
      const packaged = await loadPackaged();
      const remoteCache = readCache(localStorageApi, REMOTE_CACHE_KEY);
      refreshRemoteInBackground(remoteCache);
      const bingCache = readCache(localStorageApi, BING_CACHE_KEY);
      let bingData = bingCache?.data || [];
      const today = new Date().toISOString().split('T')[0];
      const needsBingNow = state.settings.mode === 'daily'
        && !bingData.some(wallpaper => wallpaper.date === today);

      if (needsBingNow) {
        try {
          const data = await Promise.race([
            fetchBing(),
            new Promise((_, reject) => setTimeout(() => reject(new Error('API timeout')), 5000))
          ]);
          if (data.length) {
            bingData = data;
            writeCache(localStorageApi, BING_CACHE_KEY, data);
          }
        } catch (error) {
          console.warn('[ECHO NTP] API 请求超时或失败，使用已有数据:', error.message);
        }
      } else {
        void fetchBing().then(applyBingRefresh);
      }

      return mergeByDate(packaged, remoteCache?.data || [], refreshedRemoteData, bingData);
    }

    return Object.freeze({ fetchBing, loadPackaged, mergeHistory });
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