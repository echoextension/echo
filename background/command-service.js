(function(root) {
  'use strict';

  const BOSS_KEY_STATE_KEY = 'echoBossKeyStateV1';

  function create(chromeApi, getSetting) {
    async function loadBossKeyState() {
      const stored = await chromeApi.storage.session.get(BOSS_KEY_STATE_KEY);
      const state = stored[BOSS_KEY_STATE_KEY];
      if (!state?.isMinimized || !Array.isArray(state.windowStates)) {
        return { isMinimized: false, windowStates: [] };
      }
      const windowStates = state.windowStates.filter(saved =>
        Number.isInteger(saved?.id) && typeof saved?.state === 'string'
      );
      if (windowStates.length !== state.windowStates.length) {
        await chromeApi.storage.session.remove(BOSS_KEY_STATE_KEY);
        return { isMinimized: false, windowStates: [] };
      }
      return { isMinimized: true, windowStates };
    }

    async function handleBossKey() {
      if (!await getSetting('bossKey')) return;
      try {
        const windows = await chromeApi.windows.getAll();
        const state = await loadBossKeyState();
        if (!state.isMinimized) {
          const windowStates = windows.map(windowInfo => ({
            id: windowInfo.id,
            state: windowInfo.state
          }));
          await chromeApi.storage.session.set({
            [BOSS_KEY_STATE_KEY]: { isMinimized: true, windowStates }
          });
          await Promise.all(windows.map(windowInfo =>
            chromeApi.windows.update(windowInfo.id, { state: 'minimized' })
          ));
          return;
        }

        await Promise.all(state.windowStates.map(saved => {
          const restoreState = saved.state === 'minimized' ? 'normal' : saved.state;
          return chromeApi.windows.update(saved.id, { state: restoreState }).catch(() => {});
        }));
        await chromeApi.storage.session.remove(BOSS_KEY_STATE_KEY);
      } catch (error) {
        console.error('Boss key error:', error);
      }
    }

    async function handleToggleMute() {
      if (!await getSetting('quickMute')) return;
      try {
        const tabs = await chromeApi.tabs.query({});
        const audibleTabs = tabs.filter(tab => tab.audible || tab.mutedInfo?.muted);
        if (!audibleTabs.length) return;
        const shouldMute = audibleTabs.some(tab => tab.audible && !tab.mutedInfo?.muted);
        await Promise.all(audibleTabs.map(tab => chromeApi.tabs.update(tab.id, { muted: shouldMute })));
      } catch (error) {
        console.error('Toggle mute error:', error);
      }
    }

    async function handleCommand(command) {
      if (command === 'boss-key') await handleBossKey();
      else if (command === 'toggle-mute') await handleToggleMute();
    }

    function register() {
      chromeApi.commands.onCommand.addListener(handleCommand);
    }

    return Object.freeze({ handleBossKey, handleCommand, handleToggleMute, loadBossKeyState, register });
  }

  root.EchoBackgroundCommandService = Object.freeze({ BOSS_KEY_STATE_KEY, create });
})(globalThis);