(function(root) {
  'use strict';

  const FALLBACK_SCHEMA_VERSION = 1;

  function normalizeFavorites(value) {
    return Array.isArray(value)
      ? [...new Set(value.filter(item => typeof item === 'string'))]
      : [];
  }

  function fingerprintFavorites(value) {
    const serialized = JSON.stringify(normalizeFavorites(value));
    let hash = 2166136261;
    for (let index = 0; index < serialized.length; index += 1) {
      hash ^= serialized.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return `${serialized.length}:${(hash >>> 0).toString(16).padStart(8, '0')}`;
  }

  function sameFavorites(left, right) {
    return left.length === right.length && left.every((item, index) => item === right[index]);
  }

  function create(chromeApi, localStorageApi, keys, options = {}) {
    const favoritesMetaKey = keys.favoritesMeta || `${keys.favorites}_meta`;
    const now = options.now || Date.now;

    function validTimestamp(value) {
      return Number.isFinite(value) && value >= 0 ? value : 0;
    }

    function createMeta(updatedAt, favorites) {
      return {
        schemaVersion: FALLBACK_SCHEMA_VERSION,
        updatedAt: validTimestamp(updatedAt) || now(),
        fingerprint: fingerprintFavorites(favorites)
      };
    }

    function normalizeFallback(value) {
      if (Array.isArray(value)) {
        return { favorites: normalizeFavorites(value), updatedAt: 0 };
      }
      if (value?.schemaVersion !== FALLBACK_SCHEMA_VERSION) return null;
      return {
        favorites: normalizeFavorites(value.favorites),
        updatedAt: validTimestamp(value.updatedAt)
      };
    }

    async function readCurrentFavorites() {
      const [localStored, syncStored] = await Promise.all([
        chromeApi.storage.local.get(keys.favorites),
        chromeApi.storage.sync.get([keys.favorites, favoritesMetaKey])
      ]);
      const syncFavorites = normalizeFavorites(syncStored[keys.favorites]);
      const syncMeta = syncStored[favoritesMetaKey];
      const syncUpdatedAt = syncMeta?.schemaVersion === FALLBACK_SCHEMA_VERSION
        ? validTimestamp(syncMeta.updatedAt)
        : 0;
      const syncSnapshotValid = !syncMeta?.fingerprint
        || syncMeta.fingerprint === fingerprintFavorites(syncFavorites);
      const fallback = normalizeFallback(localStored[keys.favorites]);
      const useFallback = fallback && syncSnapshotValid
        && (syncUpdatedAt === 0 || fallback.updatedAt >= syncUpdatedAt);
      return useFallback ? fallback.favorites : syncFavorites;
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
      try {
        localStorageApi.setItem(keys.viewHistory, JSON.stringify(viewHistory.slice(-100)));
      } catch (error) {
        console.warn('[ECHO NTP] 保存浏览历史失败:', error);
      }
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
      if (typeof storedSettings?.blankMode === 'boolean') {
        try {
          localStorageApi.setItem(keys.blankMode, storedSettings.blankMode ? 'true' : 'false');
        } catch {}
      } else if (cachedBlankMode !== null) {
        state.settings.blankMode = cachedBlankMode === 'true';
      }

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
      const syncSnapshotValid = !syncMeta?.fingerprint
        || syncMeta.fingerprint === fingerprintFavorites(syncFavorites);
      const useSynchronizedFavorites = fallbackFavorites !== null
        && syncSnapshotValid
        && syncUpdatedAt > 0
        && syncUpdatedAt >= fallbackUpdatedAt;
      const shouldRetryFallback = fallbackFavorites !== null
        && syncSnapshotValid
        && (syncUpdatedAt === 0 || fallbackUpdatedAt > syncUpdatedAt);

      if (fallbackFavorites !== null && !useSynchronizedFavorites) {
        state.favorites = fallbackFavorites;
        if (shouldRetryFallback) {
          try {
            await chromeApi.storage.sync.set({
              [keys.favorites]: fallbackFavorites,
              [favoritesMetaKey]: createMeta(fallbackUpdatedAt, fallbackFavorites)
            });
            await chromeApi.storage.local.remove(keys.favorites);
          } catch (error) {
            console.warn('[ECHO NTP] 收藏仍无法同步，继续使用本地降级记录:', error);
          }
        }
      } else {
        state.favorites = syncFavorites;
        if (!syncSnapshotValid) {
          console.warn('[ECHO NTP] 同步收藏快照尚未完整，等待后续存储事件');
        }
        if (fallbackFavorites !== null) await chromeApi.storage.local.remove(keys.favorites);
      }
      state.availableFavorites = [...state.favorites];
      state.viewHistory = loadViewHistory();
      return state;
    }

    async function saveSettings(settings) {
      const storedSettings = { ...settings };
      const blankMode = storedSettings.blankMode === true;
      await chromeApi.storage.local.set({ [keys.settings]: storedSettings });
      try {
        localStorageApi.setItem(keys.blankMode, blankMode ? 'true' : 'false');
      } catch (error) {
        console.warn('[ECHO NTP] 更新空白模式首屏缓存失败:', error);
      }
    }

    async function saveFavorites(value, saveOptions = {}) {
      let favorites = normalizeFavorites(value);
      const updatedAt = now();
      const addFavorites = normalizeFavorites(saveOptions.addFavorites);
      const removeFavorites = new Set(normalizeFavorites(saveOptions.removeFavorites));
      if (addFavorites.length || removeFavorites.size) {
        favorites = (await readCurrentFavorites()).filter(item => !removeFavorites.has(item));
        for (const item of addFavorites) {
          if (!favorites.includes(item)) favorites.push(item);
        }
      }
      if (Array.isArray(saveOptions.expectedFavorites)) {
        const expectedFavorites = normalizeFavorites(saveOptions.expectedFavorites);
        const currentFavorites = await readCurrentFavorites();
        if (!sameFavorites(currentFavorites, expectedFavorites)) {
          return { favorites: currentFavorites, fallback: false, skipped: true };
        }
      }
      try {
        await chromeApi.storage.sync.set({
          [keys.favorites]: favorites,
          [favoritesMetaKey]: createMeta(updatedAt, favorites)
        });
        await chromeApi.storage.local.remove(keys.favorites);
        return { favorites, fallback: false, skipped: false };
      } catch (error) {
        console.warn('[ECHO NTP] 收藏同步失败，保存到本地降级记录:', error);
        await chromeApi.storage.local.set({
          [keys.favorites]: {
            schemaVersion: FALLBACK_SCHEMA_VERSION,
            favorites,
            updatedAt
          }
        });
        return { favorites, fallback: true, skipped: false };
      }
    }

    return Object.freeze({
      addViewHistory,
      load,
      loadViewHistory,
      normalizeFavorites,
      readCurrentFavorites,
      saveFavorites,
      saveSettings,
      saveViewHistory
    });
  }

  root.EchoNtpWallpaperRepository = Object.freeze({
    FALLBACK_SCHEMA_VERSION,
    create,
    fingerprintFavorites,
    normalizeFavorites
  });
})(globalThis);