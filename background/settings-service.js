(function(root) {
  'use strict';

  function create(chromeApi, settingsSchema) {
    const defaults = settingsSchema.getAreaDefaults('sync', { includeDeprecated: false });

    async function getSetting(key) {
      const fallback = settingsSchema.getDefault(key);
      const result = await chromeApi.storage.sync.get({ [key]: fallback });
      return settingsSchema.isValid(key, result[key]) ? result[key] : fallback;
    }

    async function initializeInstalledSettings(details) {
      if (details.reason === 'install') {
        await chromeApi.storage.local.set({ echo_ntp_trending: false });
      }

      const items = await chromeApi.storage.sync.get(null);
      const candidateSettings = { ...items };
      if ('activateLeftTab' in candidateSettings && !('closeTabActivate' in candidateSettings)) {
        candidateSettings.closeTabActivate = candidateSettings.activateLeftTab ? 'left' : 'right';
      }

      const { sanitized } = settingsSchema.sanitize('sync', candidateSettings, {
        includeDeprecated: false
      });
      await chromeApi.storage.sync.set({ ...defaults, ...sanitized });
      await chromeApi.storage.sync.remove([
        'activateLeftTab',
        'sidepanelEnhanced',
        'customBookmarkBar',
        'bookmarkBarPinned',
        'bookmarkOpenInNewTab',
        'bookmarkBarDensity',
        'searchEngine'
      ]);

      if (details.reason === 'install') {
        const { freCompleted } = await chromeApi.storage.local.get('freCompleted');
        if (!freCompleted) await chromeApi.tabs.create({ url: 'fre/fre-step1.html' });
      }
    }

    function register() {
      chromeApi.runtime.onInstalled.addListener(initializeInstalledSettings);
      chromeApi.action.onClicked.addListener(() => chromeApi.runtime.openOptionsPage());
    }

    return Object.freeze({ defaults, getSetting, initializeInstalledSettings, register });
  }

  root.EchoBackgroundSettingsService = Object.freeze({ create });
})(globalThis);