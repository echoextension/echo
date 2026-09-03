// @vitest-environment node

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createScriptDom, executeWindowScript, flushAsyncWork } from '../helpers/script-harness.js';

let dom;

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

async function setup(overrides = {}) {
  dom = await createScriptDom();
  await executeWindowScript(dom, 'ntp/modules/wallpaper-domain.js');
  await executeWindowScript(dom, 'ntp/modules/wallpaper-command-controller.js');

  const state = {
    settings: {
      mode: 'daily',
      pinnedDate: null,
      lastActiveMode: 'daily',
      collectionPlayMode: 'random'
    },
    current: null,
    browseIndex: 0,
    history: [],
    favorites: [],
    preloadedImages: new Map(),
    isPreview: false
  };
  const dependencies = {
    state,
    domain: dom.window.EchoNtpWallpaperDomain,
    display: vi.fn(),
    saveSettings: vi.fn(async () => {}),
    saveFavorites: vi.fn(async () => {}),
    removeCustomWallpaper: vi.fn(async () => {}),
    refresh: vi.fn(),
    random: () => 0
  };
  Object.assign(dependencies, overrides);
  const controller = dom.window.EchoNtpWallpaperCommandController.create(dependencies);
  return { controller, dependencies, state };
}

afterEach(() => {
  dom?.window.close();
  dom = null;
});

describe('wallpaper command controller', () => {
  it('prefers a completed preloaded wallpaper for random preview', async () => {
    const { controller, dependencies, state } = await setup();
    const first = { id: 'first', date: '2026-01-01' };
    const second = { id: 'second', date: '2026-01-02' };
    const image = { complete: true, naturalWidth: 100, error: false, wpData: second };
    state.history = [first, second];
    state.current = first;
    state.preloadedImages.set(dependencies.domain.buildBingUrl(second.id, '4k'), image);

    const selected = controller.randomPreview();

    expect(selected).toBe(second);
    expect(state.isPreview).toBe(true);
    expect(state.browseIndex).toBe(1);
    expect(state.preloadedImages.size).toBe(0);
    expect(dependencies.display).toHaveBeenCalledWith(second);
  });

  it('pins the current wallpaper and restores automatic selection when toggled again', async () => {
    const { controller, dependencies, state } = await setup();
    const latest = { id: 'latest', date: '2026-01-02' };
    const current = { id: 'older', date: '2026-01-01' };
    state.history = [latest, current];
    state.current = current;

    expect(await controller.togglePin()).toEqual({ pinned: true, wallpaper: current });
    expect(state.settings.pinnedDate).toBe(current.date);

    expect(await controller.togglePin()).toEqual({ pinned: false, wallpaper: latest });
    expect(state.settings.pinnedDate).toBeNull();
    expect(dependencies.display).toHaveBeenLastCalledWith(latest);
    expect(dependencies.saveSettings).toHaveBeenCalledTimes(2);
  });

  it('falls back to daily mode when the last rotating favorite is removed', async () => {
    const { controller, dependencies, state } = await setup();
    const daily = { id: 'daily', date: '2026-01-02' };
    const favorite = { id: 'favorite', date: '2026-01-01' };
    state.history = [daily, favorite];
    state.current = favorite;
    state.favorites = [favorite.date];
    state.settings.mode = 'collection';
    state.settings.lastActiveMode = 'collection';

    const result = await controller.toggleFavorite();

    expect(result).toEqual({ action: 'removed', wallpaper: favorite });
    expect(state.favorites).toEqual([]);
    expect(state.settings.mode).toBe('daily');
    expect(state.settings.lastActiveMode).toBe('daily');
    expect(dependencies.display).toHaveBeenCalledWith(daily);
    expect(dependencies.saveFavorites).toHaveBeenCalledOnce();
    expect(dependencies.saveSettings).toHaveBeenCalledOnce();
  });

  it('keeps the immediate daily display order while fallback settings are pending', async () => {
    const settingsWrite = deferred();
    const { controller, dependencies, state } = await setup({
      saveSettings: vi.fn(() => settingsWrite.promise)
    });
    const daily = { id: 'daily', date: '2026-01-02' };
    const favorite = { id: 'favorite', date: '2026-01-01' };
    state.history = [daily, favorite];
    state.current = favorite;
    state.favorites = [favorite.date];
    state.availableFavorites = [favorite.date];
    state.settings.mode = 'collection';
    state.settings.quality = '4k';

    const removal = controller.toggleFavorite();
    await flushAsyncWork();

    expect(dependencies.display).toHaveBeenCalledWith(daily);
    settingsWrite.resolve();
    await removal;
  });

  it('displays the daily fallback committed by the custom removal transaction', async () => {
    const { controller, dependencies, state } = await setup();
    const daily = { id: 'daily', date: '2026-01-02' };
    const custom = { id: 'custom', date: 'custom:1', type: 'custom' };
    state.history = [custom, daily];
    state.current = custom;
    state.favorites = [custom.date];
    state.settings.mode = 'collection';
    dependencies.removeCustomWallpaper.mockImplementation(async date => {
      state.history = state.history.filter(wallpaper => wallpaper.date !== date);
      state.favorites = state.favorites.filter(item => item !== date);
      state.availableFavorites = [];
      state.settings.mode = 'daily';
      state.settings.lastActiveMode = 'daily';
      return { fellBack: true };
    });

    await controller.toggleFavorite();

    expect(state.settings.mode).toBe('daily');
    expect(dependencies.display).toHaveBeenCalledWith(daily);
    expect(dependencies.saveSettings).not.toHaveBeenCalled();
  });

  it('rejects collection mode when there are no favorites', async () => {
    const { controller, dependencies, state } = await setup();

    expect(await controller.switchToCollection()).toBe(false);
    expect(state.settings.mode).toBe('daily');
    expect(dependencies.saveSettings).not.toHaveBeenCalled();
    expect(dependencies.display).not.toHaveBeenCalled();
  });

  it('treats remote custom placeholders without local blobs as unavailable', async () => {
    const { controller, dependencies, state } = await setup();
    state.favorites = ['custom:remote'];
    state.availableFavorites = [];

    expect(await controller.switchToCollection()).toBe(false);
    expect(state.favorites).toEqual(['custom:remote']);
    expect(dependencies.saveSettings).not.toHaveBeenCalled();
  });

  it('applies an empty synchronized collection and persists the daily fallback', async () => {
    const { controller, dependencies, state } = await setup();
    const daily = { id: 'daily', date: '2026-01-02' };
    state.history = [daily];
    state.favorites = ['missing'];
    state.settings.mode = 'collection';

    await controller.applySyncedFavorites([]);

    expect(state.favorites).toEqual([]);
    expect(state.availableFavorites).toEqual([]);
    expect(state.settings.mode).toBe('daily');
    expect(dependencies.display).toHaveBeenCalledWith(daily);
    expect(dependencies.saveSettings).toHaveBeenCalledOnce();
  });

  it('selects another wallpaper after deleting the current custom favorite from the panel', async () => {
    const { controller, dependencies, state } = await setup();
    const custom = { id: 'custom', date: 'custom:1', type: 'custom' };
    const other = { id: 'other', date: '2026-01-02' };
    state.current = custom;
    state.history = [custom, other];
    state.favorites = [custom.date, other.date];
    state.availableFavorites = [custom.date, other.date];
    state.settings.mode = 'collection';
    dependencies.removeCustomWallpaper.mockImplementation(async date => {
      state.history = state.history.filter(wallpaper => wallpaper.date !== date);
      state.favorites = state.favorites.filter(item => item !== date);
      state.availableFavorites = state.availableFavorites.filter(item => item !== date);
      return true;
    });

    await controller.removeFavorite(custom.date);

    expect(dependencies.display).toHaveBeenCalledTimes(1);
    expect(dependencies.display).toHaveBeenCalledWith(other);
  });

  it('rolls back a pin change when settings persistence fails', async () => {
    const saveSettings = vi.fn(async () => { throw new Error('storage unavailable'); });
    const { controller, dependencies, state } = await setup({ saveSettings });
    state.current = { id: 'daily', date: '2026-01-01' };
    state.history = [state.current];

    expect(await controller.togglePin()).toBe(false);

    expect(state.settings.pinnedDate).toBeNull();
    expect(dependencies.display).not.toHaveBeenCalled();
  });

  it('rolls back a favorite addition when favorites persistence fails', async () => {
    const saveFavorites = vi.fn(async () => { throw new Error('storage unavailable'); });
    const { controller, state } = await setup({ saveFavorites });
    state.current = { id: 'daily', date: '2026-01-01' };
    state.history = [state.current];

    expect(await controller.toggleFavorite()).toEqual({ action: 'failed', wallpaper: state.current });
    expect(state.favorites).toEqual([]);
    expect(state.availableFavorites).toEqual([]);
  });

  it('compensates a persisted favorite removal when daily fallback persistence fails', async () => {
    const persistedFavorites = [];
    const saveSettings = vi.fn(async () => { throw new Error('storage unavailable'); });
    const { controller, dependencies, state } = await setup({ saveSettings });
    const daily = { id: 'daily', date: '2026-01-02' };
    const favorite = { id: 'favorite', date: '2026-01-01' };
    state.history = [daily, favorite];
    state.current = favorite;
    state.favorites = [favorite.date];
    state.availableFavorites = [favorite.date];
    state.settings.mode = 'collection';
    state.settings.lastActiveMode = 'collection';
    dependencies.saveFavorites.mockImplementation(async value => {
      persistedFavorites.push([...(value || state.favorites)]);
    });

    const result = await controller.toggleFavorite();

    expect(result).toEqual({ action: 'failed', wallpaper: favorite });
    expect(state.favorites).toEqual([favorite.date]);
    expect(state.settings.mode).toBe('collection');
    expect(persistedFavorites).toEqual([[], [favorite.date]]);
    expect(dependencies.saveFavorites).toHaveBeenLastCalledWith(
      [favorite.date],
      { addFavorites: [favorite.date] }
    );
    expect(dependencies.display).toHaveBeenNthCalledWith(1, daily);
    expect(dependencies.display).toHaveBeenNthCalledWith(2, favorite);
  });

  it('does not overwrite a newer favorite state while compensating a failed fallback', async () => {
    const settingsWrite = deferred();
    const persistedFavorites = [];
    const { controller, dependencies, state } = await setup({
      saveSettings: vi.fn(() => settingsWrite.promise)
    });
    const daily = { id: 'daily', date: '2026-01-02' };
    const favorite = { id: 'favorite', date: '2026-01-01' };
    state.history = [daily, favorite];
    state.current = favorite;
    state.favorites = [favorite.date];
    state.availableFavorites = [favorite.date];
    state.settings.mode = 'collection';
    dependencies.saveFavorites.mockImplementation(async value => {
      persistedFavorites.push([...(value || state.favorites)]);
    });

    const removal = controller.toggleFavorite();
    await flushAsyncWork();
    state.favorites = ['new-remote'];
    state.availableFavorites = ['new-remote'];
    state.settings.mode = 'collection';
    state.settings.lastActiveMode = 'collection';
    state.settings.quality = '1080p';
    settingsWrite.reject(new Error('storage unavailable'));

    expect(await removal).toEqual({ action: 'failed', wallpaper: favorite });
    expect(state.favorites).toEqual(['new-remote']);
    expect(state.settings.mode).toBe('collection');
    expect(state.settings.quality).toBe('1080p');
    expect(persistedFavorites).toEqual([[]]);
  });
});
