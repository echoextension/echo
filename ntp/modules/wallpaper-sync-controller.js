(function(root) {
  'use strict';

  function create(options) {
    let registered = false;
    let pendingFavorites = null;
    let pendingMeta = null;

    async function getLocalFallbackTimestamp() {
      if (!options.getLocalFallbackTimestamp) return 0;
      return options.getLocalFallbackTimestamp();
    }

    async function apply(favorites, meta) {
      const remoteTimestamp = Number.isFinite(meta?.updatedAt) ? meta.updatedAt : 0;
      const localTimestamp = await getLocalFallbackTimestamp();
      if (localTimestamp > remoteTimestamp) return;
      const availableFavorites = options.resolveAvailableFavorites
        ? await options.resolveAvailableFavorites(favorites)
        : favorites;
      await options.commands.applySyncedFavorites(favorites, availableFavorites);
      options.collection.refreshIfVisible();
    }

    async function onChanged(changes, areaName) {
      if (areaName !== 'sync') return;
      if (changes[options.favoritesKey]) pendingFavorites = changes[options.favoritesKey].newValue;
      if (changes[options.favoritesMetaKey]) pendingMeta = changes[options.favoritesMetaKey].newValue;
      if (!Array.isArray(pendingFavorites)) return;
      const favorites = pendingFavorites;
      const meta = pendingMeta;
      pendingFavorites = null;
      pendingMeta = null;
      await apply(favorites, meta);
    }

    function register() {
      if (registered) return;
      registered = true;
      options.chrome.storage.onChanged.addListener(onChanged);
    }

    return Object.freeze({ onChanged, register });
  }

  root.EchoNtpWallpaperSyncController = Object.freeze({ create });
})(globalThis);
