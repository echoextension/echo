(function(root) {
  'use strict';

  function create(options) {
    const state = options.state;
    const documentApi = options.document;

    function isEnabled() {
      return state.settings.blankMode === true;
    }

    function focusSearch() {
      if (isEnabled()) return;
      const input = documentApi.getElementById('searchInput');
      const form = documentApi.querySelector('.search-form');
      if (!input || !form || root.getComputedStyle(form).display === 'none') return;
      input.focus();
    }

    function updateUi() {
      const enabled = isEnabled();
      const panel = documentApi.getElementById('settingsPanel');
      const content = documentApi.getElementById('settingsContent');
      const notice = documentApi.getElementById('blankModeNotice');
      const settingsButton = documentApi.getElementById('wpSettingsBtn');
      documentApi.documentElement.classList.toggle('blank-mode', enabled);
      documentApi.body.classList.toggle('blank-mode', enabled);
      panel?.classList.toggle('blank-mode-active', enabled);
      if (notice) notice.hidden = !enabled;
      if (content) {
        content.setAttribute('aria-hidden', enabled ? 'true' : 'false');
        content.querySelectorAll('input, button, select, textarea').forEach(element => {
          element.disabled = enabled;
        });
        content.querySelectorAll('a').forEach(element => {
          if (enabled) {
            element.setAttribute('tabindex', '-1');
            element.setAttribute('aria-disabled', 'true');
          } else {
            element.removeAttribute('tabindex');
            element.removeAttribute('aria-disabled');
          }
        });
      }
      if (settingsButton) {
        const label = enabled ? '新标签页设置' : '设置';
        settingsButton.title = label;
        settingsButton.setAttribute('aria-label', label);
      }
      const active = documentApi.activeElement;
      if (enabled && active instanceof root.HTMLElement
          && (active.id === 'searchInput' || active.classList.contains('search-input'))) {
        active.blur();
      }
    }

    async function syncLayout() {
      options.setBookmarkBarHeight(0);
      if (isEnabled()) {
        options.lowPoly.hide();
      } else if (documentApi.body.classList.contains('wallpaper-mode')) {
        options.lowPoly.hide();
      } else {
        options.lowPoly.show();
      }
    }

    async function apply() {
      updateUi();
      await syncLayout();
    }

    function initSwitch() {
      const toggle = documentApi.getElementById('blankModeSwitch');
      if (!toggle) return;
      toggle.checked = isEnabled();
      toggle.addEventListener('change', async () => {
        const previous = state.settings.blankMode === true;
        state.settings.blankMode = toggle.checked;
        await apply();
        try {
          await options.saveSettings();
        } catch (error) {
          state.settings.blankMode = previous;
          toggle.checked = previous;
          await apply();
          console.error('[ECHO NTP] 空白模式保存失败:', error);
          return;
        }
        if (!toggle.checked) {
          await options.ensureWallpaper();
          focusSearch();
        }
      });
    }

    return Object.freeze({ apply, focusSearch, initSwitch, isEnabled, syncLayout, updateUi });
  }

  root.EchoNtpBlankModeController = Object.freeze({ create });
})(globalThis);
