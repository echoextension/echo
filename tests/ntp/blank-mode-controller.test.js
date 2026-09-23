// @vitest-environment node

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createScriptDom, executeWindowScript, flushAsyncWork } from '../helpers/script-harness.js';

let dom;

async function setup(enabled = false) {
  dom = await createScriptDom({
    html: `<!doctype html><html><body class="wallpaper-mode">
      <button id="wpSettingsBtn"></button>
      <div id="settingsPanel"><input id="blankModeSwitch" type="checkbox"></div>
      <div id="blankModeNotice" hidden></div>
      <div id="settingsContent"><input id="nestedInput"><a id="nestedLink"></a></div>
      <form class="search-form"><input id="searchInput"></form>
    </body></html>`
  });
  await executeWindowScript(dom, 'ntp/modules/blank-mode-controller.js');
  const state = { settings: { blankMode: enabled } };
  const options = {
    state,
    document: dom.window.document,
    lowPoly: { hide: vi.fn(), show: vi.fn() },
    setBookmarkBarHeight: vi.fn(),
    ensureWallpaper: vi.fn(async () => {}),
    saveSettings: vi.fn(async () => {})
  };
  const controller = dom.window.EchoNtpBlankModeController.create(options);
  return { controller, options, state };
}

afterEach(() => {
  dom?.window.close();
  dom = null;
});

describe('blank mode controller', () => {
  it('hides decorative content and disables other settings while blank mode is active', async () => {
    const { controller, options } = await setup(true);

    await controller.apply();

    expect(dom.window.document.documentElement.classList.contains('blank-mode')).toBe(true);
    expect(dom.window.document.getElementById('nestedInput').disabled).toBe(true);
    expect(dom.window.document.getElementById('nestedLink').getAttribute('aria-disabled')).toBe('true');
    expect(options.lowPoly.hide).toHaveBeenCalledOnce();
    expect(options.setBookmarkBarHeight).toHaveBeenCalledWith(0);
  });

  it('restores wallpaper and search focus when blank mode is disabled', async () => {
    const { controller, options, state } = await setup(true);
    controller.initSwitch();
    const toggle = dom.window.document.getElementById('blankModeSwitch');
    toggle.checked = false;

    toggle.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    await flushAsyncWork();

    expect(state.settings.blankMode).toBe(false);
    expect(options.ensureWallpaper).toHaveBeenCalledOnce();
    expect(options.saveSettings).toHaveBeenCalledOnce();
    expect(dom.window.document.activeElement).toBe(dom.window.document.getElementById('searchInput'));
  });

  it('rolls back blank mode when persistence fails', async () => {
    const { controller, options, state } = await setup(true);
    options.saveSettings.mockRejectedValueOnce(new Error('storage unavailable'));
    controller.initSwitch();
    const toggle = dom.window.document.getElementById('blankModeSwitch');
    toggle.checked = false;

    toggle.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    await flushAsyncWork();

    expect(state.settings.blankMode).toBe(true);
    expect(toggle.checked).toBe(true);
    expect(dom.window.document.documentElement.classList.contains('blank-mode')).toBe(true);
    expect(options.ensureWallpaper).not.toHaveBeenCalled();
  });
});
