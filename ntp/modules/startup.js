(function(root) {
  'use strict';

  function create(options) {
    let initialized = false;
    let asynchronousInitialization = null;

    function init() {
      if (initialized) return asynchronousInitialization;
      initialized = true;

      void options.initTrending();
      void options.loadZoom();
      options.initSearch();
      options.focusSearch();

      asynchronousInitialization = (async () => {
        try {
          options.setBookmarkBarHeight(0);
          await options.initWallpaper();
          options.focusSearch();
        } catch (error) {
          console.error('[ECHO NTP] 页面异步初始化失败:', error);
        }
      })();
      return asynchronousInitialization;
    }

    function register(documentApi) {
      documentApi.addEventListener('DOMContentLoaded', init);
    }

    return Object.freeze({
      get initialized() { return initialized; },
      get pending() { return asynchronousInitialization; },
      init,
      register
    });
  }

  root.EchoNtpStartup = Object.freeze({ create });
})(globalThis);