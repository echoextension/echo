// @vitest-environment node

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createScriptDom, executeWindowScript, flushAsyncWork } from '../helpers/script-harness.js';

let dom;

async function setup({ mode = 'daily', minimalMode = false, switchToCollection = true } = {}) {
  dom = await createScriptDom({
    html: `<!doctype html><html><body>
      <div id="wallpaperSubSettings"></div>
      <input id="minimalModeSwitch" type="checkbox">
      <label id="sourceDailyCard"><input id="sourceDaily" type="radio"></label>
      <label id="sourceCollectionCard"><input id="sourceCollection" type="radio"></label>
      <button id="playModeRandomBtn"></button><button id="playModeFixedBtn"></button>
      <button id="lockedStatusUnlock"></button>
    </body></html>`
  });
  await executeWindowScript(dom, 'ntp/modules/wallpaper-settings-controller.js');
  const state = {
    settings: { mode, minimalMode, pinnedDate: null },
    favorites: []
  };
  const commands = {
    switchToDaily: vi.fn(async () => {}),
    switchToCollection: vi.fn(async () => switchToCollection),
    setCollectionPlayback: vi.fn(async () => {}),
    unlock: vi.fn(async () => {})
  };
  const view = { refresh: vi.fn(), updatePlayModeButtons: vi.fn() };
  const blankMode = { initSwitch: vi.fn(), updateUi: vi.fn() };
  const saveSettings = vi.fn(async () => {});
  const showToast = vi.fn();
  const controller = dom.window.EchoNtpWallpaperSettingsController.create({
    state,
    document: dom.window.document,
    commands,
    view,
    blankMode,
    saveSettings,
    showToast,
    openCollection: vi.fn()
  });
  return { blankMode, commands, controller, saveSettings, showToast, state, view };
}

afterEach(() => {
  dom?.window.close();
  dom = null;
});

describe('wallpaper settings controller', () => {
  it('initializes panel visibility, blank mode, minimal mode, and status views', async () => {
    const { blankMode, controller, state, view } = await setup({ mode: 'off', minimalMode: true });

    controller.init();

    expect(dom.window.document.getElementById('wallpaperSubSettings').classList.contains('hidden')).toBe(true);
    expect(dom.window.document.body.classList.contains('minimal-mode')).toBe(true);
    expect(dom.window.document.getElementById('minimalModeSwitch').checked).toBe(true);
    expect(blankMode.initSwitch).toHaveBeenCalledOnce();
    expect(blankMode.updateUi).toHaveBeenCalledOnce();
    expect(view.refresh).toHaveBeenCalled();
    expect(state.settings.minimalMode).toBe(true);
  });

  it('uses the whole daily source card to leave a locked state', async () => {
    const { commands, controller } = await setup();
    controller.init();

    dom.window.document.getElementById('sourceDailyCard').click();
    await flushAsyncWork();

    expect(commands.switchToDaily).toHaveBeenCalledOnce();
  });

  it('restores the daily radio and explains an empty collection rejection', async () => {
    const { commands, controller, showToast } = await setup({ switchToCollection: false });
    controller.init();
    const collection = dom.window.document.getElementById('sourceCollection');
    collection.checked = true;

    collection.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    await flushAsyncWork();

    expect(commands.switchToCollection).toHaveBeenCalledOnce();
    expect(dom.window.document.getElementById('sourceDaily').checked).toBe(true);
    expect(collection.checked).toBe(false);
    expect(showToast).toHaveBeenCalledWith('请先收藏一些壁纸', dom.window.document.getElementById('sourceCollectionCard'));
  });

  it('persists minimal mode changes', async () => {
    const { controller, saveSettings, state } = await setup();
    controller.init();
    const toggle = dom.window.document.getElementById('minimalModeSwitch');
    toggle.checked = true;

    toggle.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    await flushAsyncWork();

    expect(state.settings.minimalMode).toBe(true);
    expect(dom.window.document.body.classList.contains('minimal-mode')).toBe(true);
    expect(saveSettings).toHaveBeenCalledOnce();
  });

  it('rolls back minimal mode when persistence fails', async () => {
    const { controller, saveSettings, state } = await setup();
    saveSettings.mockRejectedValueOnce(new Error('storage unavailable'));
    controller.init();
    const toggle = dom.window.document.getElementById('minimalModeSwitch');
    toggle.checked = true;

    toggle.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    await flushAsyncWork();

    expect(state.settings.minimalMode).toBe(false);
    expect(toggle.checked).toBe(false);
    expect(dom.window.document.body.classList.contains('minimal-mode')).toBe(false);
  });
});
