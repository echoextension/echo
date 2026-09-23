(function(root) {
  'use strict';

  function create(options = {}) {
    return {
      settings: {
        mode: 'daily',
        quality: '4k',
        pinnedDate: null,
        collectionPlayMode: 'random',
        lastActiveMode: 'daily',
        autoHideInfo: true,
        minimalMode: false,
        blankMode: options.blankMode === true,
        infoPositionY: null,
        lastShownWallpaperId: null,
        previousMode: null
      },
      current: null,
      browseIndex: 0,
      favorites: [],
      availableFavorites: [],
      viewHistory: [],
      history: [],
      lastApiUpdate: null,
      isPreview: false,
      preloadedImages: new Map(),
      isWallpaperLoading: false,
      wallpaperRenderRequestId: 0
    };
  }

  root.EchoNtpWallpaperState = Object.freeze({ create });
})(globalThis);