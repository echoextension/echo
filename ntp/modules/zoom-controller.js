(function(root) {
  'use strict';

  function create(options) {
    const chromeApi = options.chrome;
    const documentApi = options.document;
    const storageKey = options.storageKey || 'echo_ntp_zoom';
    let currentZoom = 1;
    let indicator = null;
    let indicatorTimer = null;

    function apply() {
      const container = documentApi.querySelector('.container');
      if (!container) return;
      container.style.transform = `scale(${currentZoom})`;
      container.style.transformOrigin = 'center center';
      const EventConstructor = documentApi.defaultView?.CustomEvent;
      if (EventConstructor) {
        documentApi.dispatchEvent(new EventConstructor('echo-ntp-zoom-change', {
          detail: { zoom: currentZoom }
        }));
      }
    }

    function showIndicator() {
      if (!indicator) {
        indicator = documentApi.createElement('div');
        indicator.id = 'echo-zoom-indicator';
        indicator.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:rgba(0,0,0,.8);color:white;padding:16px 32px;border-radius:8px;font-size:24px;font-weight:bold;z-index:999999;pointer-events:none;transition:opacity .3s';
        documentApi.body.appendChild(indicator);
      }
      indicator.textContent = `${Math.round(currentZoom * 100)}%`;
      indicator.style.opacity = '1';
      if (indicatorTimer) clearTimeout(indicatorTimer);
      indicatorTimer = setTimeout(() => {
        if (indicator) indicator.style.opacity = '0';
      }, 1000);
    }

    async function load() {
      try {
        const result = await chromeApi.storage.local.get(storageKey);
        const stored = result[storageKey];
        if (Number.isFinite(stored) && stored >= 0.25 && stored <= 5) {
          currentZoom = stored;
          apply();
        }
      } catch {}
      return currentZoom;
    }

    async function save() {
      try { await chromeApi.storage.local.set({ [storageKey]: currentZoom }); } catch {}
    }

    function set(value, options = {}) {
      currentZoom = Math.max(0.25, Math.min(5, value));
      apply();
      void save();
      if (options.indicator !== false) showIndicator();
      return currentZoom;
    }

    return Object.freeze({
      apply,
      get: () => currentZoom,
      load,
      save,
      set,
      showIndicator
    });
  }

  root.EchoNtpZoomController = Object.freeze({ create });
})(globalThis);
