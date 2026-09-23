(function(root) {
  'use strict';

  function create(options) {
    const state = options.state;
    const documentApi = options.document;
    let initialized = false;

    function initMinimalMode() {
      const toggle = documentApi.getElementById('minimalModeSwitch');
      if (!toggle) return;
      toggle.checked = state.settings.minimalMode === true;
      documentApi.body.classList.toggle('minimal-mode', toggle.checked);
      toggle.addEventListener('change', async () => {
        const previous = state.settings.minimalMode === true;
        state.settings.minimalMode = toggle.checked;
        documentApi.body.classList.toggle('minimal-mode', toggle.checked);
        try {
          await options.saveSettings();
        } catch (error) {
          state.settings.minimalMode = previous;
          toggle.checked = previous;
          documentApi.body.classList.toggle('minimal-mode', previous);
          console.error('[ECHO NTP] 极简模式保存失败:', error);
        }
      });
    }

    function rejectCollection(dailyRadio, collectionRadio, anchor) {
      if (dailyRadio) dailyRadio.checked = true;
      if (collectionRadio) collectionRadio.checked = false;
      options.showToast('请先收藏一些壁纸', anchor);
    }

    function initSourceSelector() {
      const dailyRadio = documentApi.getElementById('sourceDaily');
      const collectionRadio = documentApi.getElementById('sourceCollection');
      const dailyCard = documentApi.getElementById('sourceDailyCard');

      dailyCard?.addEventListener('click', event => {
        event.preventDefault();
        if (dailyRadio) dailyRadio.checked = true;
        if (collectionRadio) collectionRadio.checked = false;
        void options.commands.switchToDaily();
      });

      collectionRadio?.addEventListener('change', async event => {
        if (!event.target.checked) return;
        const switched = await options.commands.switchToCollection();
        if (!switched) rejectCollection(dailyRadio, collectionRadio,
          documentApi.getElementById('sourceCollectionCard'));
      });
    }

    function initPlaybackButtons() {
      documentApi.getElementById('playModeRandomBtn')?.addEventListener('click', () => {
        void options.commands.setCollectionPlayback('random');
      });
      documentApi.getElementById('playModeFixedBtn')?.addEventListener('click', () => {
        void options.commands.setCollectionPlayback('fixed');
      });
      options.view.updatePlayModeButtons();
    }

    function initUnlock() {
      const button = documentApi.getElementById('lockedStatusUnlock');
      button?.addEventListener('click', async () => {
        await options.commands.unlock();
        options.showToast('已解除锁定', button);
      });
    }

    function initLegacySourceSelector() {
      documentApi.querySelectorAll('input[name="collectionWallpaperSource"]').forEach(radio => {
        radio.addEventListener('change', async event => {
          const body = documentApi.getElementById('collectionBody');
          const playMode = documentApi.getElementById('playModeInline');
          const divider = documentApi.getElementById('sourceDivider');
          if (event.target.value === 'daily') {
            playMode?.classList.remove('visible');
            divider?.classList.remove('visible');
            body?.classList.add('disabled');
            await options.commands.switchToDaily();
            return;
          }

          if (event.target.value !== 'collection') return;
          const switched = await options.commands.switchToCollection();
          if (!switched) {
            const daily = documentApi.querySelector(
              'input[name="collectionWallpaperSource"][value="daily"]'
            );
            if (daily) daily.checked = true;
            options.showToast('请先收藏一些壁纸', event.target);
            return;
          }
          playMode?.classList.add('visible');
          divider?.classList.add('visible');
          body?.classList.remove('disabled');
          options.openCollection();
        });
      });
    }

    function init() {
      if (initialized) return;
      initialized = true;
      const subSettings = documentApi.getElementById('wallpaperSubSettings');
      subSettings?.classList.toggle('hidden', state.settings.mode === 'off');
      options.view.refresh();
      options.blankMode.initSwitch();
      options.blankMode.updateUi();
      initMinimalMode();
      initSourceSelector();
      initPlaybackButtons();
      initUnlock();
      initLegacySourceSelector();
    }

    return Object.freeze({ init });
  }

  root.EchoNtpWallpaperSettingsController = Object.freeze({ create });
})(globalThis);
