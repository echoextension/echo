(function(root) {
  'use strict';

  function create(options) {
    const state = options.state;
    const documentApi = options.document;
    const schedule = options.schedule || root.setTimeout.bind(root);
    let initialized = false;
    let initialization = null;
    let toggleVersion = 0;
    let togglePersistenceQueue = Promise.resolve();
    let persistedToggleState = null;

    function select() {
      return options.domain.selectWallpaper(state);
    }

    function display(wallpaper) {
      if (wallpaper) void options.renderer.display(wallpaper);
      return wallpaper;
    }

    function hideWallpaper() {
      documentApi.getElementById('wallpaperBg')?.replaceChildren();
    }

    function captureToggleState(background) {
      return {
        settings: { ...state.settings },
        isPreview: state.isPreview,
        wallpaperMode: documentApi.body.classList.contains('wallpaper-mode'),
        noWallpaper: documentApi.body.classList.contains('no-wallpaper'),
        backgroundChildren: background ? [...background.childNodes] : []
      };
    }

    async function restoreToggleState(previous, toggle, background) {
      if (toggle.checked) options.renderer.cancel?.();
      state.settings = {
        ...state.settings,
        mode: previous.settings.mode,
        lastActiveMode: previous.settings.lastActiveMode
      };
      state.isPreview = previous.isPreview;
      toggle.checked = state.settings.mode !== 'off';
      documentApi.body.classList.toggle('wallpaper-mode', previous.wallpaperMode);
      documentApi.body.classList.toggle('no-wallpaper', previous.noWallpaper);
      documentApi.getElementById('wallpaperSubSettings')?.classList.toggle(
        'hidden', state.settings.mode === 'off'
      );
      if (previous.wallpaperMode) options.lowPoly.hide();
      else if (!options.blankMode.isEnabled()) options.lowPoly.show();
      background?.replaceChildren(...previous.backgroundChildren);
      options.statusView.updateActions();
      if (previous.wallpaperMode && !background?.querySelector('img')) {
        const wallpaper = state.current || select();
        if (wallpaper) await options.renderer.display(wallpaper);
      }
    }

    async function ensureRendered() {
      if (options.blankMode.isEnabled()
          || state.settings.mode === 'off'
          || !documentApi.body.classList.contains('wallpaper-mode')
          || state.isWallpaperLoading) {
        return;
      }
      const background = documentApi.getElementById('wallpaperBg');
      if (background?.querySelector('img')) return;
      const wallpaper = state.current || select();
      if (wallpaper) await options.renderer.display(wallpaper);
    }

    async function onToggle() {
      const toggle = documentApi.getElementById('wallpaperSwitch');
      if (!toggle) return;
      const operationVersion = ++toggleVersion;
      const background = documentApi.getElementById('wallpaperBg');
      const visualBefore = captureToggleState(background);
      if (toggle.checked) {
        if (state.settings.mode === 'off') {
          state.settings.mode = state.settings.lastActiveMode || 'daily';
        }
        state.isPreview = false;
        documentApi.body.classList.add('wallpaper-mode');
        documentApi.body.classList.remove('no-wallpaper');
        options.lowPoly.hide();
        display(select());
        documentApi.getElementById('wallpaperSubSettings')?.classList.remove('hidden');
      } else {
        if (state.settings.mode !== 'off') state.settings.lastActiveMode = state.settings.mode;
        state.settings.mode = 'off';
        documentApi.body.classList.add('no-wallpaper');
        documentApi.body.classList.remove('wallpaper-mode');
        options.lowPoly.show();
        options.renderer.cancel?.();
        hideWallpaper();
        documentApi.getElementById('wallpaperSubSettings')?.classList.add('hidden');
      }
      if (options.blankMode.isEnabled()) options.lowPoly.hide();
      options.statusView.updateActions();
      const desired = captureToggleState(background);
      const persistence = togglePersistenceQueue.then(async () => {
        try {
          if (options.saveSettings) await options.saveSettings(desired.settings);
          else await options.repository.saveSettings(desired.settings);
          persistedToggleState = desired;
          return true;
        } catch (error) {
          if (operationVersion !== toggleVersion) {
            console.error('[ECHO NTP] 已过期的壁纸开关保存失败:', error);
            return false;
          }
          const rollbackState = visualBefore.settings.mode === persistedToggleState.settings.mode
            ? {
                ...persistedToggleState,
                isPreview: visualBefore.isPreview,
                wallpaperMode: visualBefore.wallpaperMode,
                noWallpaper: visualBefore.noWallpaper,
                backgroundChildren: visualBefore.backgroundChildren
              }
            : persistedToggleState;
          await restoreToggleState(rollbackState, toggle, background);
          console.error('[ECHO NTP] 壁纸开关保存失败:', error);
          return false;
        }
      });
      togglePersistenceQueue = persistence.then(() => undefined, () => undefined);
      return persistence;
    }

    function initControls() {
      options.collection.init();
      documentApi.getElementById('wpRandom')?.addEventListener('click', () => {
        options.commands.randomPreview();
      });
      documentApi.getElementById('wpSetWallpaper')?.addEventListener('click', async () => {
        const button = documentApi.getElementById('wpSetWallpaper');
        const result = await options.commands.togglePin();
        if (!result) return;
        options.notifications.showToast(
          result.pinned ? '已锁定壁纸，自动更新已暂停' : '已恢复自动轮播',
          button
        );
      });
      documentApi.getElementById('wpFavorite')?.addEventListener('click', async () => {
        const button = documentApi.getElementById('wpFavorite');
        const result = await options.commands.toggleFavorite();
        if (result?.action === 'added') options.notifications.showToast('已加入收藏', button);
      });
      documentApi.getElementById('wpFavoriteManage')?.addEventListener('click', () => options.collection.show());
      documentApi.getElementById('wpSettingsBtn')?.addEventListener('click', event => {
        event.stopPropagation();
        documentApi.getElementById('settingsPanel')?.classList.toggle('visible');
        options.collection.hide();
      });
      documentApi.getElementById('settingsClose')?.addEventListener('click', () => {
        documentApi.getElementById('settingsPanel')?.classList.remove('visible');
      });
      documentApi.getElementById('manageCollectionBtn')?.addEventListener('click', event => {
        event.stopPropagation();
        documentApi.getElementById('settingsPanel')?.classList.remove('visible');
        options.collection.show();
      });
      documentApi.getElementById('echoSettingsBtn')?.addEventListener('click', event => {
        event.stopPropagation();
        documentApi.getElementById('settingsPanel')?.classList.remove('visible');
        options.openOptions();
      });
      documentApi.addEventListener('click', event => {
        const panel = documentApi.getElementById('settingsPanel');
        const button = documentApi.getElementById('wpSettingsBtn');
        if (panel?.classList.contains('visible')
            && !panel.contains(event.target)
            && !button?.contains(event.target)) {
          panel.classList.remove('visible');
        }
      });
    }

    function handleKeyboard(event) {
      if (options.blankMode.isEnabled()) {
        if (event.key === 'Escape') {
          documentApi.getElementById('settingsPanel')?.classList.remove('visible');
          options.collection.hide();
        }
        return;
      }
      if (!documentApi.body.classList.contains('wallpaper-mode')) return;
      if (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA') return;
      if (event.key === 'r' || event.key === 'R') documentApi.getElementById('wpRandom')?.click();
      else if (event.key === 'f' || event.key === 'F') documentApi.getElementById('wpFavorite')?.click();
      else if (event.key === 'Escape') {
        documentApi.getElementById('settingsPanel')?.classList.remove('visible');
        options.collection.hide();
      }
    }

    async function initialize() {
      if (initialized) return;
      const toggle = documentApi.getElementById('wallpaperSwitch');
      const background = documentApi.getElementById('wallpaperBg');
      if (!toggle || !background) return;
      if (options.loadState) await options.loadState();
      else await options.repository.load(state);
      persistedToggleState = captureToggleState(background);
      persistedToggleState.wallpaperMode = state.settings.mode !== 'off';
      persistedToggleState.noWallpaper = state.settings.mode === 'off';
      initialized = true;
      schedule(options.cleanCache, 5000);
      initControls();
      options.settings.init();
      options.info.init();
      toggle.addEventListener('change', onToggle);
      documentApi.addEventListener('keydown', handleKeyboard);
      await options.blankMode.apply();
      state.history = await options.dataSource.mergeHistory();
      await options.custom.restoreMetadata();
      if (!state.history.length) {
        console.warn('[ECHO NTP] 没有可用的壁纸数据');
        return;
      }

      if (state.settings.mode !== 'off') {
        toggle.checked = true;
        documentApi.body.classList.add('wallpaper-mode');
        documentApi.body.classList.remove('no-wallpaper');
        options.lowPoly.hide();
        display(select());
      } else {
        toggle.checked = false;
        documentApi.body.classList.add('no-wallpaper');
        options.lowPoly.show();
      }

      await ensureRendered();
      persistedToggleState = captureToggleState(background);
    }

    async function init() {
      if (initialized) return;
      if (initialization) return initialization;
      initialization = initialize();
      try {
        await initialization;
      } finally {
        initialization = null;
      }
    }

    return Object.freeze({ ensureRendered, handleKeyboard, init, onToggle });
  }

  root.EchoNtpWallpaperPageController = Object.freeze({ create });
})(globalThis);
