(function(root) {
  'use strict';

  function create(options) {
    const windowApi = options.window;
    const documentApi = options.document;

    function init() {
      if (windowApi.LowPolyBg && !windowApi.LowPolyBg.isInitialized) windowApi.LowPolyBg.init();
    }

    function show() {
      if (!windowApi.LowPolyBg?.isInitialized) init();
      windowApi.LowPolyBg?.show();
    }

    function hide() {
      windowApi.LowPolyBg?.hide();
    }

    function register(isBlankModeEnabled) {
      documentApi.addEventListener('DOMContentLoaded', () => {
        if (isBlankModeEnabled()) return;
        documentApi.body.style.setProperty('--gradient-angle', `${Math.floor(Math.random() * 360)}deg`);
        windowApi.requestAnimationFrame(() => setTimeout(init, 100));
      });
    }

    return Object.freeze({ hide, init, register, show });
  }

  root.EchoNtpLowPolyAdapter = Object.freeze({ create });
})(globalThis);
