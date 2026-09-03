(function(root) {
  'use strict';

  function create(options) {
    const state = options.state;
    const domain = options.domain;
    const randomValue = options.random || Math.random;

    function availableFavorites() {
      return state.availableFavorites || state.favorites;
    }

    function select() {
      return domain.selectWallpaper(state);
    }

    function display(wallpaper) {
      if (wallpaper) void options.display(wallpaper);
      return wallpaper || null;
    }

    function snapshot() {
      return {
        settings: { ...state.settings },
        favorites: [...state.favorites],
        availableFavorites: [...availableFavorites()],
        current: state.current,
        isPreview: state.isPreview,
        browseIndex: state.browseIndex
      };
    }

    function restore(previous) {
      state.settings = previous.settings;
      state.favorites = previous.favorites;
      state.availableFavorites = previous.availableFavorites;
      state.isPreview = previous.isPreview;
      state.browseIndex = previous.browseIndex;
      options.refresh();
    }

    async function runTransaction(operation) {
      const previous = snapshot();
      try {
        return await operation();
      } catch (error) {
        restore(previous);
        console.error('[ECHO NTP] 壁纸状态保存失败:', error);
        return false;
      }
    }

    async function ensureDailyFallback() {
      if (state.settings.mode !== 'collection'
          || state.settings.pinnedDate
          || availableFavorites().length > 0) {
        return false;
      }
      state.settings.mode = 'daily';
      state.settings.lastActiveMode = 'daily';
      const wallpaper = select();
      display(wallpaper);
      await options.saveSettings();
      return true;
    }

    function sameFavorites(left, right) {
      return left.length === right.length && left.every((item, index) => item === right[index]);
    }

    function canRestoreRemoval(previous, removedFavorites, fallbackAttempted) {
      if (!sameFavorites(state.favorites, removedFavorites)) return false;
      if (state.settings.pinnedDate !== previous.settings.pinnedDate) return false;
      return !fallbackAttempted
        || (state.settings.mode === 'daily' && state.settings.lastActiveMode === 'daily');
    }

    async function restoreRemovedFavorite(previous, removedFavorites, favoritesPersisted, fallbackAttempted) {
      if (!canRestoreRemoval(previous, removedFavorites, fallbackAttempted)) return false;
      state.favorites = previous.favorites;
      state.availableFavorites = previous.availableFavorites;
      state.settings.mode = previous.settings.mode;
      state.settings.lastActiveMode = previous.settings.lastActiveMode;
      options.refresh();
      if (favoritesPersisted) {
        const restoredDates = previous.favorites.filter(item => !removedFavorites.includes(item));
        await options.saveFavorites(previous.favorites, { addFavorites: restoredDates });
      }
      if (fallbackAttempted) display(previous.current);
      return true;
    }

    function randomPreview() {
      const { history, preloadedImages, settings } = state;
      if (!history.length) return null;
      const currentUrl = state.current && !domain.isCustomWallpaper(state.current)
        ? domain.buildBingUrl(state.current.id, settings.quality)
        : null;

      let selected = null;
      for (const [url, image] of preloadedImages) {
        if (url === currentUrl || !image.complete || image.naturalWidth <= 0 || image.error) continue;
        selected = image.wpData
          || history.find(wallpaper => !domain.isCustomWallpaper(wallpaper)
            && domain.buildBingUrl(wallpaper.id, settings.quality) === url);
        if (!selected) continue;
        preloadedImages.delete(url);
        break;
      }

      if (!selected) {
        let attempts = 0;
        do {
          selected = history[Math.floor(randomValue() * history.length)];
          attempts += 1;
        } while (selected === state.current && attempts < 10);
      }

      state.isPreview = true;
      state.browseIndex = history.indexOf(selected);
      display(selected);
      options.refresh();
      return selected;
    }

    async function togglePin() {
      return runTransaction(async () => {
        const wallpaper = state.current;
        if (!wallpaper) return null;
        let selected = wallpaper;
        let pinned = true;
        if (state.settings.pinnedDate === wallpaper.date) {
          state.settings.pinnedDate = null;
          selected = select();
          pinned = false;
        } else {
          state.settings.pinnedDate = wallpaper.date;
        }
        await options.saveSettings();
        if (!pinned) display(selected);
        options.refresh();
        return { pinned, wallpaper: selected };
      });
    }

    async function toggleFavorite() {
      const wallpaper = state.current;
      if (!wallpaper) return null;
      const previous = snapshot();
      const existingIndex = state.favorites.indexOf(wallpaper.date);
      if (existingIndex === -1) {
        try {
          state.favorites.push(wallpaper.date);
          if (!availableFavorites().includes(wallpaper.date)) availableFavorites().push(wallpaper.date);
          await options.saveFavorites([...state.favorites]);
          options.refresh();
          return { action: 'added', wallpaper };
        } catch (error) {
          restore(previous);
          console.error('[ECHO NTP] 壁纸收藏保存失败:', error);
          return { action: 'failed', wallpaper };
        }
      }

      if (domain.isCustomWallpaper(wallpaper)) {
        const removed = await options.removeCustomWallpaper(wallpaper.date);
        if (removed === false) return { action: 'failed', wallpaper };
        display(select());
      } else {
        let favoritesPersisted = false;
        let fallbackAttempted = false;
        let removedFavorites = null;
        try {
          state.favorites.splice(existingIndex, 1);
          state.availableFavorites = availableFavorites().filter(date => date !== wallpaper.date);
          removedFavorites = [...state.favorites];
          await options.saveFavorites(removedFavorites);
          favoritesPersisted = true;
          fallbackAttempted = state.settings.mode === 'collection'
            && !state.settings.pinnedDate
            && availableFavorites().length === 0;
          await ensureDailyFallback();
        } catch (error) {
          try {
            await restoreRemovedFavorite(
              previous,
              removedFavorites || [],
              favoritesPersisted,
              fallbackAttempted
            );
          } catch (rollbackError) {
            console.error('[ECHO NTP] 壁纸收藏补偿保存失败:', rollbackError);
          }
          console.error('[ECHO NTP] 壁纸收藏保存失败:', error);
          return { action: 'failed', wallpaper };
        }
      }
      options.refresh();
      return { action: 'removed', wallpaper };
    }

    async function removeFavorite(date) {
      const removedCurrentWallpaper = state.current?.date === date;
      const previous = snapshot();
      if (domain.isCustomDate(date)) {
        const removed = await options.removeCustomWallpaper(date);
        if (removed === false) return false;
        if (removedCurrentWallpaper || removed?.fellBack) display(select());
        options.refresh();
        return true;
      } else {
        let favoritesPersisted = false;
        let fallbackAttempted = false;
        let removedFavorites = null;
        try {
          state.favorites = state.favorites.filter(item => item !== date);
          state.availableFavorites = availableFavorites().filter(item => item !== date);
          removedFavorites = [...state.favorites];
          await options.saveFavorites(removedFavorites);
          favoritesPersisted = true;
          fallbackAttempted = state.settings.mode === 'collection'
            && !state.settings.pinnedDate
            && availableFavorites().length === 0;
          const fellBack = await ensureDailyFallback();
          if (removedCurrentWallpaper && !fellBack) display(select());
        } catch (error) {
          try {
            await restoreRemovedFavorite(
              previous,
              removedFavorites || [],
              favoritesPersisted,
              fallbackAttempted
            );
          } catch (rollbackError) {
            console.error('[ECHO NTP] 壁纸收藏补偿保存失败:', rollbackError);
          }
          console.error('[ECHO NTP] 壁纸收藏保存失败:', error);
          return false;
        }
        options.refresh();
        return true;
      }
      return true;
    }

    async function switchToDaily() {
      return runTransaction(async () => {
        state.settings.pinnedDate = null;
        state.settings.mode = 'daily';
        state.settings.lastActiveMode = 'daily';
        state.isPreview = false;
        state.browseIndex = 0;
        const wallpaper = select();
        await options.saveSettings();
        display(wallpaper);
        options.refresh();
        return wallpaper;
      });
    }

    async function switchToCollection() {
      if (!availableFavorites().length) return false;
      return runTransaction(async () => {
        state.settings.mode = 'collection';
        state.settings.lastActiveMode = 'collection';
        state.isPreview = false;
        const wallpaper = select();
        await options.saveSettings();
        display(wallpaper);
        options.refresh();
        return true;
      });
    }

    async function setCollectionPlayback(mode) {
      return runTransaction(async () => {
        let wallpaper = null;
        state.settings.collectionPlayMode = mode;
        if (mode === 'random') {
          state.settings.pinnedDate = null;
          if (state.settings.mode === 'collection') wallpaper = select();
        } else if (mode === 'fixed') {
          if (!state.settings.pinnedDate && availableFavorites().length) {
            state.settings.pinnedDate = availableFavorites().at(-1);
          }
          wallpaper = state.history.find(item => item.date === state.settings.pinnedDate);
        }
        await options.saveSettings();
        display(wallpaper);
        options.refresh();
        return true;
      });
    }

    async function unlock() {
      return runTransaction(async () => {
        state.settings.pinnedDate = null;
        const wallpaper = select();
        await options.saveSettings();
        display(wallpaper);
        options.refresh();
        return wallpaper;
      });
    }

    async function applySyncedFavorites(favorites, available = null) {
      state.favorites = [...favorites];
      state.availableFavorites = available ? [...available] : favorites.filter(date => !domain.isCustomDate(date)
        || state.history.some(wallpaper => wallpaper.date === date && domain.isCustomWallpaper(wallpaper)));
      await ensureDailyFallback();
      options.refresh();
    }

    return Object.freeze({
      applySyncedFavorites,
      randomPreview,
      removeFavorite,
      setCollectionPlayback,
      switchToCollection,
      switchToDaily,
      toggleFavorite,
      togglePin,
      unlock
    });
  }

  root.EchoNtpWallpaperCommandController = Object.freeze({ create });
})(globalThis);
