(function(root) {
  'use strict';

  const KEY_PREFIX = 'echoBiliFeedHistory:';

  function create(chromeApi, settingsSchema) {
    function keyForTab(tabId) {
      return `${KEY_PREFIX}${tabId}`;
    }

    function isFeedSender(sender) {
      try {
        const senderUrl = new URL(sender?.url || sender?.tab?.url || '');
        return senderUrl.protocol === 'https:' && senderUrl.hostname === 'www.bilibili.com';
      } catch {
        return false;
      }
    }

    function getSenderTabId(sender) {
      return Number.isInteger(sender?.tab?.id) && isFeedSender(sender) ? sender.tab.id : null;
    }

    async function load(sender) {
      const tabId = getSenderTabId(sender);
      if (tabId === null) return { ok: false, error: 'Invalid Bilibili tab sender' };
      const key = keyForTab(tabId);
      const result = await chromeApi.storage.session.get(key);
      return { ok: true, state: result[key] || null };
    }

    async function save(sender, state) {
      const tabId = getSenderTabId(sender);
      if (tabId === null) return { ok: false, error: 'Invalid Bilibili tab sender' };
      if (state?.schemaVersion !== 3 || !Array.isArray(state.batches) || state.batches.length > 10) {
        return { ok: false, error: 'Invalid history state' };
      }
      await chromeApi.storage.session.set({ [keyForTab(tabId)]: state });
      return { ok: true };
    }

    async function clear(sender) {
      const tabId = getSenderTabId(sender);
      if (tabId === null) return { ok: false, error: 'Invalid Bilibili tab sender' };
      await chromeApi.storage.session.remove(keyForTab(tabId));
      return { ok: true };
    }

    async function clearTab(tabId) {
      await chromeApi.storage.session.remove(keyForTab(tabId));
    }

    async function clearAll() {
      const stored = await chromeApi.storage.session.get(null);
      const keys = Object.keys(stored).filter(key => key.startsWith(KEY_PREFIX));
      if (keys.length) await chromeApi.storage.session.remove(keys);
    }

    async function ensureInjected() {
      const settings = await chromeApi.storage.sync.get({
        biliFeedHistory: settingsSchema.getDefault('biliFeedHistory')
      });
      if (!settings.biliFeedHistory) return;
      const tabs = await chromeApi.tabs.query({ url: ['https://www.bilibili.com/*'] });
      for (const tab of tabs) {
        if (!tab.id) continue;
        try {
          await chromeApi.scripting.executeScript({
            target: { tabId: tab.id },
            files: [
              'core/settings.js',
              'core/messages.js',
              'bili-feed-history/bili-feed-history.js'
            ]
          });
        } catch (error) {
          console.warn('[ECHO] Failed to inject Bilibili feed history:', error);
        }
      }
    }

    function handleStorageChanged(changes, areaName) {
      if (areaName !== 'sync' || !changes.biliFeedHistory) return;
      if (changes.biliFeedHistory.newValue) void ensureInjected();
      else void clearAll();
    }

    function register() {
      chromeApi.storage.onChanged.addListener(handleStorageChanged);
      void ensureInjected();
    }

    return Object.freeze({
      clear,
      clearAll,
      clearTab,
      ensureInjected,
      handleStorageChanged,
      isFeedSender,
      keyForTab,
      load,
      register,
      save
    });
  }

  root.EchoBackgroundBiliSessionService = Object.freeze({ KEY_PREFIX, create });
})(globalThis);