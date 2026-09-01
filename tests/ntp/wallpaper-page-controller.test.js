// @vitest-environment node

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createScriptDom, executeWindowScript, flushAsyncWork } from '../helpers/script-harness.js';

let dom;

async function setup({ mode = 'daily', blank = false } = {}) {
  dom = await createScriptDom({
    html: `<!doctype html><html><body>
      <input id="wallpaperSwitch" type="checkbox"><div id="wallpaperBg"></div>
      <div id="wallpaperSubSettings"></div>
      <button id="wpRandom"></button><button id="wpSetWallpaper"></button>
      <button id="wpFavorite"></button><button id="wpFavoriteManage"></button>
      <button id="wpSettingsBtn"></button><div id="settingsPanel"></div>
      <button id="manageCollectionBtn"></button><button id="echoSettingsBtn"></button>
    </body></html>`
  });
  await executeWindowScript(dom, 'ntp/modules/wallpaper-domain.js');
  await executeWindowScript(dom, 'ntp/modules/wallpaper-page-controller.js');
  const wallpaper = { id: 'daily', date: '2026-01-01', desc: 'Daily' };
  const state = {
    settings: { mode, lastActiveMode: mode === 'off' ? 'collection' : mode, pinnedDate: null },
    current: null,
    history: [],
    favorites: [],
    isWallpaperLoading: false,
    isPreview: false,
    browseIndex: 0
  };
  const options = {
    state,
    document: dom.window.document,
    domain: dom.window.EchoNtpWallpaperDomain,
    repository: { load: vi.fn(async () => state), saveSettings: vi.fn(async () => {}) },
    dataSource: { mergeHistory: vi.fn(async () => [wallpaper]) },
    custom: { restoreMetadata: vi.fn(async () => {}) },
    renderer: { display: vi.fn(async item => { state.current = item; }) },
    commands: {
      randomPreview: vi.fn(),
      togglePin: vi.fn(async () => ({ pinned: true })),
      toggleFavorite: vi.fn(async () => ({ action: 'added' }))
    },
    statusView: { updateActions: vi.fn() },
    collection: { init: vi.fn(), show: vi.fn(), hide: vi.fn() },
    settings: { init: vi.fn() },
    info: { init: vi.fn() },
    blankMode: { isEnabled: vi.fn(() => blank), apply: vi.fn(async () => {}), focusSearch: vi.fn() },
    lowPoly: { show: vi.fn(), hide: vi.fn() },
    notifications: { showToast: vi.fn() },
    cleanCache: vi.fn(),
    schedule: vi.fn(),
    openOptions: vi.fn()
  };
  const controller = dom.window.EchoNtpWallpaperPageController.create(options);
  return { controller, options, state, wallpaper };
}

afterEach(() => {
  dom?.window.close();
  dom = null;
});

describe('wallpaper page controller', () => {
  it('initializes the enabled wallpaper path and its child controllers', async () => {
    const { controller, options, wallpaper } = await setup();

    await controller.init();

    expect(dom.window.document.body.classList.contains('wallpaper-mode')).toBe(true);
    expect(options.renderer.display).toHaveBeenCalledWith(wallpaper);
    expect(options.collection.init).toHaveBeenCalledOnce();
    expect(options.settings.init).toHaveBeenCalledOnce();
    expect(options.info.init).toHaveBeenCalledOnce();
    expect(options.blankMode.apply).toHaveBeenCalledOnce();
    expect(options.schedule).toHaveBeenCalledWith(options.cleanCache, 5000);
  });

  it('initializes the disabled path with low poly and no wallpaper display', async () => {
    const { controller, options } = await setup({ mode: 'off' });

    await controller.init();

    expect(dom.window.document.body.classList.contains('no-wallpaper')).toBe(true);
    expect(options.lowPoly.show).toHaveBeenCalledOnce();
    expect(options.renderer.display).not.toHaveBeenCalled();
  });

  it('restores the last active mode without clearing a pin when enabled', async () => {
    const { controller, options, state, wallpaper } = await setup({ mode: 'off' });
    state.settings.pinnedDate = wallpaper.date;
    await controller.init();
    const toggle = dom.window.document.getElementById('wallpaperSwitch');
    toggle.checked = true;

    toggle.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    await flushAsyncWork();

    expect(state.settings.mode).toBe('collection');
    expect(state.settings.pinnedDate).toBe(wallpaper.date);
    expect(options.renderer.display).toHaveBeenCalledWith(wallpaper);
    expect(options.repository.saveSettings).toHaveBeenCalled();
  });

  it('records the previous mode and clears the rendered image when disabled', async () => {
    const { controller, options, state, wallpaper } = await setup({ mode: 'collection' });
    state.favorites = [wallpaper.date];
    await controller.init();
    const background = dom.window.document.getElementById('wallpaperBg');
    background.appendChild(dom.window.document.createElement('img'));
    const toggle = dom.window.document.getElementById('wallpaperSwitch');
    toggle.checked = false;

    toggle.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    await flushAsyncWork();

    expect(state.settings.mode).toBe('off');
    expect(state.settings.lastActiveMode).toBe('collection');
    expect(background.children).toHaveLength(0);
    expect(options.lowPoly.show).toHaveBeenCalled();
  });

  it('binds settings controls before wallpaper history finishes loading', async () => {
    const { controller, options } = await setup();
    let resolveHistory;
    options.dataSource.mergeHistory.mockReturnValue(new Promise(resolve => {
      resolveHistory = resolve;
    }));

    const initialization = controller.init();
    await flushAsyncWork();
    dom.window.document.getElementById('wpSettingsBtn').click();
    const toggle = dom.window.document.getElementById('wallpaperSwitch');
    toggle.checked = false;
    toggle.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    await flushAsyncWork();

    expect(options.settings.init).toHaveBeenCalledOnce();
    expect(dom.window.document.getElementById('settingsPanel').classList.contains('visible')).toBe(true);
    expect(options.repository.saveSettings).toHaveBeenCalled();
    resolveHistory([]);
    await initialization;
  });

  it('rolls back the wallpaper switch when settings persistence fails', async () => {
    const { controller, options, state } = await setup();
    options.repository.saveSettings.mockRejectedValueOnce(new Error('storage unavailable'));
    await controller.init();
    const toggle = dom.window.document.getElementById('wallpaperSwitch');
    toggle.checked = false;

    toggle.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    await flushAsyncWork();

    expect(state.settings.mode).toBe('daily');
    expect(toggle.checked).toBe(true);
    expect(dom.window.document.body.classList.contains('wallpaper-mode')).toBe(true);
    expect(dom.window.document.body.classList.contains('no-wallpaper')).toBe(false);
  });
});
