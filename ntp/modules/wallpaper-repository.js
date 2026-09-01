(function(root) {
  'use strict';

  const FALLBACK_SCHEMA_VERSION = 1;

  function normalizeFavorites(value) {
    return Array.isArray(value)
      ? [...new Set(value.filter(item => typeof item === 'string'))]
      : [];
  }

  function create(chromeApi, localStorageApi, keys, options = {}) {
    const favoritesMetaKey = keys.favoritesMeta || `${keys.favorites}_meta`;
    const now = options.now || Date.now;

    function validTimestamp(value) {
      return Number.isFinite(value) && value >= 0 ? value : 0;
    }

    function createMeta(updatedAt) {
      return { schemaVersion: FALLBACK_SCHEMA_VERSION, updatedAt: validTimestamp(updatedAt) || now() };
    }

    function loadViewHistory() {
      try {
        const parsed = JSON.parse(localStorageApi.getItem(keys.viewHistory) || '[]');
        return normalizeFavorites(parsed).slice(-100);
      } catch {
        return [];
      }
    }

    function saveViewHistory(viewHistory) {
      localStorageApi.setItem(keys.viewHistory, JSON.stringify(viewHistory.slice(-100)));
    }

    function addViewHistory(state, date) {
      if (!date) return;
      state.viewHistory = state.viewHistory.filter(item => item !== date);
      state.viewHistory.push(date);
      if (state.viewHistory.length > 100) state.viewHistory = state.viewHistory.slice(-100);
      saveViewHistory(state.viewHistory);
    }

    async function load(state) {
      const cachedBlankMode = localStorageApi.getItem(keys.blankMode);
      const localStored = await chromeApi.storage.local.get([keys.settings, keys.favorites]);
      const syncStored = await chromeApi.storage.sync.get([keys.favorites, favoritesMetaKey]);

      const storedSettings = localStored[keys.settings];
      if (storedSettings && typeof storedSettings === 'object' && !Array.isArray(storedSettings)) {
        Object.assign(state.settings, storedSettings);
      }
      if (cachedBlankMode !== null) state.settings.blankMode = cachedBlankMode === 'true';

      const syncFavorites = normalizeFavorites(syncStored[keys.favorites]);
      const fallback = localStored[keys.favorites];
      const fallbackFavorites = Array.isArray(fallback)
        ? normalizeFavorites(fallback)
        : fallback?.schemaVersion === FALLBACK_SCHEMA_VERSION
          ? normalizeFavorites(fallback.favorites)
          : null;
      const fallbackUpdatedAt = validTimestamp(fallback?.updatedAt);
      const syncMeta = syncStored[favoritesMetaKey];
      const syncUpdatedAt = syncMeta?.schemaVersion === FALLBACK_SCHEMA_VERSION
        ? validTimestamp(syncMeta.updatedAt)
        : 0;
      const useSynchronizedFavorites = fallbackFavorites !== null
        && syncUpdatedAt > 0
        && syncUpdatedAt >= fallbackUpdatedAt;

      if (fallbackFavorites !== null && !useSynchronizedFavorites) {
        state.favorites = fallbackFavorites;
        try {
          await chromeApi.storage.sync.set({
            [keys.favorites]: fallbackFavorites,
            [favoritesMetaKey]: createMeta(fallbackUpdatedAt)
          });
          await chromeApi.storage.local.remove(keys.favorites);
        } catch (error) {
          console.warn('[ECHO NTP] 收藏仍无法同步，继续使用本地降级记录:', error);
        }
      } else {
        state.favorites = syncFavorites;
        if (fallbackFavorites !== null) await chromeApi.storage.local.remove(keys.favorites);
      }
      state.availableFavorites = [...state.favorites];
      state.viewHistory = loadViewHistory();
      return state;
    }

    async function saveSettings(settings) {
      localStorageApi.setItem(keys.blankMode, settings.blankMode ? 'true' : 'false');
      await chromeApi.storage.local.set({ [keys.settings]: settings });
    }

    async function saveFavorites(value) {
      const favorites = normalizeFavorites(value);
      const updatedAt = now();
      try {
        await chromeApi.storage.sync.set({
          [keys.favorites]: favorites,
          [favoritesMetaKey]: createMeta(updatedAt)
        });
        await chromeApi.storage.local.remove(keys.favorites);
        return { favorites, fallback: false };
      } catch (error) {
        console.warn('[ECHO NTP] 收藏同步失败，保存到本地降级记录:', error);
        await chromeApi.storage.local.set({
          [keys.favorites]: {
            schemaVersion: FALLBACK_SCHEMA_VERSION,
            favorites,
            updatedAt
          }
        });
        return { favorites, fallback: true };
      }
    }

    return Object.freeze({
      addViewHistory,
      load,
      loadViewHistory,
      normalizeFavorites,
      saveFavorites,
      saveSettings,
      saveViewHistory
    });
  }

  root.EchoNtpWallpaperRepository = Object.freeze({ FALLBACK_SCHEMA_VERSION, create, normalizeFavorites });
})(globalThis);