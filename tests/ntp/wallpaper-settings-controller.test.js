// @vitest-environment node

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createScriptDom, executeWindowScript, flushAsyncWork } from '../helpers/script-harness.js';

let dom;

async function setup({ mode = 'daily', minimalMode = false, switchToCollection = true } = {}) {
  dom = await createScriptDom({
    html: `<!doctype html><html><body>
      <div id="wallpaperSubSettings"></div>
      <input id="minimalModeSwitch" type="checkbox">
      <input id="showBrandSwitch" type="checkbox">
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
  const loadBrandPreference = vi.fn(async () => true);
  const showToast = vi.fn();
  const controller = dom.window.EchoNtpWallpaperSettingsController.create({
    state,
    document: dom.window.document,
    commands,
    view,
    blankMode,
    saveSettings,
    loadBrandPreference,
    showToast,
    openCollection: vi.fn()
  });
  return { blankMode, commands, controller, saveSettings, loadBrandPreference, showToast, state, view };
}

afterEach(() => {
  dom?.window.close();
  dom = null;
});

describe('wallpaper settings controller', () => {
  it('recovers the authoritative brand value when another appearance save succeeds before a failure', async () => {
    const { controller, state, saveSettings, loadBrandPreference } = await setup();
    let rejectBrand;
    let stored = { showBrand: true, minimalMode: false };
    saveSettings.mockImplementationOnce(() => new Promise((resolve, reject) => { rejectBrand = reject; }))
      .mockImplementation(async settings => { stored = structuredClone(settings || state.settings); });
    loadBrandPreference.mockImplementation(async () => stored.showBrand !== false);
    controller.init();
    const brand = dom.window.document.getElementById('showBrandSwitch');
    brand.checked = false;
    brand.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    await flushAsyncWork();
    const minimal = dom.window.document.getElementById('minimalModeSwitch');
    minimal.checked = true;
    minimal.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    await flushAsyncWork();
    expect(stored).toMatchObject({ showBrand: false, minimalMode: true });
    rejectBrand(new Error('first brand save failed'));
    await flushAsyncWork(8);
    expect(state.settings).toMatchObject({ showBrand: false, minimalMode: true });
    expect(brand.checked).toBe(false);
    expect(dom.window.document.documentElement.classList.contains('brand-hidden')).toBe(true);
    expect(loadBrandPreference).toHaveBeenCalledOnce();
  });

  it('keeps the brand preference independent of wallpaper and minimal mode', async () => {
    const { controller, state, saveSettings } = await setup({ mode: 'off', minimalMode: true });
    controller.init();
    const toggle = dom.window.document.getElementById('showBrandSwitch');
    expect(toggle.checked).toBe(true);
    toggle.checked = false;
    toggle.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    await flushAsyncWork();
    expect(state.settings.showBrand).toBe(false);
    expect(dom.window.document.documentElement.classList.contains('brand-hidden')).toBe(true);
    expect(state.settings.mode).toBe('off');
    expect(state.settings.minimalMode).toBe(true);
    expect(saveSettings).toHaveBeenCalledWith(expect.objectContaining({ showBrand: false }));
  });

  it('restores the persisted brand preference if saving fails', async () => {
    const { controller, state, saveSettings } = await setup();
    saveSettings.mockRejectedValueOnce(new Error('storage unavailable'));
    controller.init();
    const toggle = dom.window.document.getElementById('showBrandSwitch');
    toggle.checked = false;
    toggle.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    await flushAsyncWork();
    expect(toggle.checked).toBe(true);
    expect(state.settings.showBrand).toBe(true);
    expect(dom.window.document.documentElement.classList.contains('brand-hidden')).toBe(false);
  });

  it('preserves another appearance change while rapid brand writes are queued', async () => {
    const { controller, state, saveSettings } = await setup();
    let releaseFirst;
    const writes = [];
    saveSettings.mockImplementation(async settings => {
      writes.push(structuredClone(settings || state.settings));
      if (writes.length === 1) await new Promise(resolve => { releaseFirst = resolve; });
    });
    controller.init();
    const brand = dom.window.document.getElementById('showBrandSwitch');
    brand.checked = false;
    brand.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    await flushAsyncWork();
    brand.checked = true;
    brand.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    const minimal = dom.window.document.getElementById('minimalModeSwitch');
    minimal.checked = true;
    minimal.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    await flushAsyncWork();
    releaseFirst();
    await flushAsyncWork(8);
    expect(writes.at(-1)).toMatchObject({ showBrand: true, minimalMode: true });
    expect(state.settings.minimalMode).toBe(true);
  });

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
