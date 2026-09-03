(function(root) {
  'use strict';

  function create(options) {
    let registered = false;
    let changeVersion = 0;
    let legacyFavoritesChanged = false;
    let legacyMetadataChanged = false;

    async function getLocalFallbackTimestamp() {
      if (!options.getLocalFallbackTimestamp) return 0;
      return options.getLocalFallbackTimestamp();
    }

    async function apply(favorites, meta, version) {
      const remoteTimestamp = Number.isFinite(meta?.updatedAt) ? meta.updatedAt : 0;
      const localTimestamp = await getLocalFallbackTimestamp();
      if (version !== changeVersion || localTimestamp > remoteTimestamp) return;
      const availableFavorites = options.resolveAvailableFavorites
        ? await options.resolveAvailableFavorites(favorites)
        : favorites;
      if (version !== changeVersion) return;
      await options.commands.applySyncedFavorites(favorites, availableFavorites);
      if (version === changeVersion) options.collection.refreshIfVisible();
    }

    async function onChanged(changes, areaName) {
      if (areaName !== 'sync') return;
      const hasFavoritesChange = Boolean(changes[options.favoritesKey]);
      const hasMetadataChange = Boolean(changes[options.favoritesMetaKey]);
      if (!hasFavoritesChange && !hasMetadataChange) return;
      const version = ++changeVersion;
      if (hasFavoritesChange) legacyFavoritesChanged = true;
      if (hasMetadataChange
          && typeof changes[options.favoritesMetaKey].newValue?.fingerprint !== 'string') {
        legacyMetadataChanged = true;
      }
      const stored = await options.chrome.storage.sync.get([
        options.favoritesKey,
        options.favoritesMetaKey
      ]);
      if (version !== changeVersion) return;
      const favorites = stored[options.favoritesKey];
      if (!Array.isArray(favorites)) return;
      const meta = stored[options.favoritesMetaKey];
      if (typeof meta?.fingerprint === 'string') {
        legacyFavoritesChanged = false;
        legacyMetadataChanged = false;
        if (meta.fingerprint !== options.fingerprintFavorites(favorites)) {
          if (!hasFavoritesChange || hasMetadataChange) return;
          await apply(favorites, meta, version);
          return;
        }
      } else {
        if (!legacyFavoritesChanged || !legacyMetadataChanged) return;
        legacyFavoritesChanged = false;
        legacyMetadataChanged = false;
      }
      await apply(favorites, meta, version);
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
