(function(root) {
  'use strict';

  function isCustomWallpaper(wallpaper) {
    return wallpaper?.type === 'custom';
  }

  function isCustomDate(date) {
    return typeof date === 'string' && date.startsWith('custom:');
  }

  function getLatestBingWallpaper(history) {
    return history.find(wallpaper => !isCustomWallpaper(wallpaper)) || null;
  }

  function buildBingUrl(id, quality = '4k') {
    const baseUrl = `https://cn.bing.com/th?id=OHR.${id}_UHD.jpg`;
    if (quality === '1080p') return `${baseUrl}&pid=hp&w=1920&h=1080&rs=1&c=4`;
    return `${baseUrl}&rf=LaDigue_UHD.jpg&pid=hp&w=3840&h=2160&rs=1&c=4`;
  }

  function selectWallpaper(state, today = new Date().toISOString().split('T')[0]) {
    const { settings, history } = state;
    const favorites = state.availableFavorites || state.favorites;
    if (!history.length) return null;

    if (settings.pinnedDate) {
      const pinned = history.find(wallpaper => wallpaper.date === settings.pinnedDate);
      if (pinned) {
        state.browseIndex = history.indexOf(pinned);
        return pinned;
      }
      settings.pinnedDate = null;
    }

    if (settings.mode === 'collection') {
      if (!favorites.length) {
        settings.mode = 'daily';
        settings.lastActiveMode = 'daily';
      } else {
        const seed = today.replaceAll('-', '');
        const date = favorites[Number.parseInt(seed, 10) % favorites.length];
        const selected = history.find(wallpaper => wallpaper.date === date)
          || history.find(wallpaper => wallpaper.date === favorites.at(-1));
        if (selected) {
          state.browseIndex = history.indexOf(selected);
          return selected;
        }
      }
    }

    const daily = getLatestBingWallpaper(history) || history[0];
    state.browseIndex = history.indexOf(daily);
    return daily;
  }

  root.EchoNtpWallpaperDomain = Object.freeze({
    buildBingUrl,
    getLatestBingWallpaper,
    isCustomDate,
    isCustomWallpaper,
    selectWallpaper
  });
})(globalThis);