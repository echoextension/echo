// @vitest-environment node

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createScriptDom, executeWindowScript, flushAsyncWork } from '../helpers/script-harness.js';

let dom;

function deferred() {
  let resolve;
  const promise = new Promise(value => { resolve = value; });
  return { promise, resolve };
}

async function setup(overrides = {}) {
  dom = await createScriptDom();
  await executeWindowScript(dom, 'ntp/modules/wallpaper-domain.js');
  await executeWindowScript(dom, 'ntp/modules/custom-wallpaper-controller.js');
  const state = {
    settings: { mode: 'daily', pinnedDate: null },
    current: null,
    history: [{ id: 'daily', date: '2026-01-01' }],
    favorites: [],
    isPreview: false
  };
  const cache = {
    get: vi.fn(async () => null),
    put: vi.fn(async () => true),
    remove: vi.fn(async () => true)
  };
  const options = {
    state,
    domain: dom.window.EchoNtpWallpaperDomain,
    cache,
    imageProcessor: {
      createDisplayImage: vi.fn(async () => new Blob(['display'], { type: 'image/jpeg' })),
      createThumbnail: vi.fn(async () => new Blob(['thumbnail'], { type: 'image/jpeg' })),
      renderDisplayBlob: vi.fn(async () => new Blob(['compressed'], { type: 'image/jpeg' }))
    },
    saveFavorites: vi.fn(async () => {}),
    saveSettings: vi.fn(async () => {}),
    display: vi.fn(async wallpaper => { state.current = wallpaper; }),
    select: vi.fn(() => state.history.find(item => item.type !== 'custom')),
    showToast: vi.fn(),
    refreshStatus: vi.fn(),
    now: () => 1234,
    ...overrides
  };
  const controller = dom.window.EchoNtpCustomWallpaperController.create(options);
  return { cache, controller, options, state };
}

afterEach(() => {
  dom?.window.close();
  dom = null;
});

describe('custom wallpaper controller', () => {
  it('rejects unsupported files before image processing', async () => {
    const { cache, controller, options } = await setup();

    const result = await controller.upload({ type: 'image/gif', size: 100 });

    expect(result).toBeNull();
    expect(options.showToast).toHaveBeenCalledWith('仅支持 JPG、PNG、WebP 格式');
    expect(cache.put).not.toHaveBeenCalled();
  });

  it('stores display and thumbnail blobs before committing metadata', async () => {
    const { cache, controller, options, state } = await setup();

    const wallpaper = await controller.upload({ type: 'image/jpeg', size: 100 });

    expect(cache.put).toHaveBeenCalledTimes(2);
    expect(state.favorites).toEqual(['custom:1234']);
    expect(state.history[0]).toEqual(wallpaper);
    expect(state.settings.pinnedDate).toBe('custom:1234');
    expect(options.saveFavorites).toHaveBeenCalledBefore(options.saveSettings);
    expect(options.display).toHaveBeenCalledWith(wallpaper);
  });

  it('rolls back both blobs when only part of an upload is stored', async () => {
    const cache = {
      put: vi.fn()
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false),
      remove: vi.fn(async () => true)
    };
    const { controller, options, state } = await setup({ cache });

    expect(await controller.upload({ type: 'image/jpeg', size: 100 })).toBeNull();

    expect(cache.remove).toHaveBeenCalledWith('custom:1234', 'custom_thumb:1234');
    expect(state.favorites).toEqual([]);
    expect(state.history).toHaveLength(1);
    expect(options.saveFavorites).not.toHaveBeenCalled();
  });

  it('rolls back blobs and in-memory metadata when favorites persistence fails', async () => {
    const saveFavorites = vi.fn()
      .mockRejectedValueOnce(new Error('storage unavailable'))
      .mockResolvedValueOnce();
    const { cache, controller, options, state } = await setup({ saveFavorites });

    expect(await controller.upload({ type: 'image/jpeg', size: 100 })).toBeNull();

    expect(state.favorites).toEqual([]);
    expect(state.history).toEqual([{ id: 'daily', date: '2026-01-01' }]);
    expect(state.settings.pinnedDate).toBeNull();
    expect(cache.remove).toHaveBeenCalledWith('custom:1234', 'custom_thumb:1234');
    expect(saveFavorites).toHaveBeenCalledTimes(2);
    expect(options.display).not.toHaveBeenCalled();
  });

  it('removes custom blobs and clears an active pin', async () => {
    const { cache, controller, options, state } = await setup();
    const custom = { id: 'custom_1234', date: 'custom:1234', type: 'custom', desc: '' };
    state.history.unshift(custom);
    state.favorites = [custom.date];
    state.settings.pinnedDate = custom.date;

    await controller.remove(custom.date);

    expect(cache.remove).toHaveBeenCalledWith('custom:1234', 'custom_thumb:1234');
    expect(state.history).not.toContain(custom);
    expect(state.favorites).toEqual([]);
    expect(state.settings.pinnedDate).toBeNull();
    expect(options.display).not.toHaveBeenCalled();
    expect(options.saveSettings).toHaveBeenCalledOnce();
  });

  it('restores only custom favorites whose blob exists on this device', async () => {
    const cache = {
      put: vi.fn(),
      remove: vi.fn(),
      get: vi.fn(async key => key === 'custom:local' ? new Blob(['local']) : null)
    };
    const { controller, state } = await setup({ cache });
    state.favorites = ['custom:remote', 'custom:local'];

    await controller.restoreMetadata();

    expect(state.history.some(wallpaper => wallpaper.date === 'custom:remote')).toBe(false);
    expect(state.history[0]).toMatchObject({ date: 'custom:local', type: 'custom' });
    expect(state.favorites).toEqual(['custom:remote', 'custom:local']);
    expect(state.availableFavorites).toEqual(['custom:local']);
  });

  it('serializes concurrent uploads so the maximum count cannot be exceeded', async () => {
    const { controller, state } = await setup();
    state.favorites = Array.from({ length: 9 }, (_, index) => `custom:existing-${index}`);
    state.history.unshift(...state.favorites.map((date, index) => ({
      id: `custom_existing_${index}`,
      date,
      type: 'custom',
      desc: ''
    })));

    const [first, second] = await Promise.all([
      controller.upload({ type: 'image/jpeg', size: 100 }),
      controller.upload({ type: 'image/jpeg', size: 100 })
    ]);

    expect(first).not.toBeNull();
    expect(second).toBeNull();
    expect(state.favorites).toHaveLength(10);
    expect(new Set(state.favorites).size).toBe(10);
  });

  it('does not count remote custom placeholders toward the local upload limit', async () => {
    const { controller, state } = await setup();
    state.favorites = Array.from({ length: 10 }, (_, index) => `custom:remote-${index}`);

    const uploaded = await controller.upload({ type: 'image/jpeg', size: 100 });

    expect(uploaded).not.toBeNull();
    expect(controller.count()).toBe(1);
  });

  it('keeps metadata when custom blob deletion fails', async () => {
    const cache = {
      put: vi.fn(),
      get: vi.fn(),
      remove: vi.fn(async () => false)
    };
    const { controller, options, state } = await setup({ cache });
    const custom = { id: 'custom_1234', date: 'custom:1234', type: 'custom', desc: '' };
    state.history.unshift(custom);
    state.favorites = [custom.date];

    expect(await controller.remove(custom.date)).toBe(false);

    expect(state.history).toContain(custom);
    expect(state.favorites).toEqual([custom.date]);
    expect(options.showToast).toHaveBeenCalledWith('删除失败，请重试');
  });

  it('does not delete blobs when removal metadata cannot be persisted', async () => {
    const saveFavorites = vi.fn()
      .mockRejectedValueOnce(new Error('storage unavailable'))
      .mockResolvedValueOnce();
    const { cache, controller, options, state } = await setup({ saveFavorites });
    const custom = { id: 'custom_1234', date: 'custom:1234', type: 'custom', desc: '' };
    state.history.unshift(custom);
    state.favorites = [custom.date];

    expect(await controller.remove(custom.date)).toBe(false);

    expect(cache.remove).not.toHaveBeenCalled();
    expect(state.history).toContain(custom);
    expect(state.favorites).toEqual([custom.date]);
    expect(saveFavorites).toHaveBeenCalledTimes(2);
    expect(options.showToast).toHaveBeenCalledWith('删除失败，请重试');
  });

  it('does not recreate a deleted blob when lazy recompression finishes late', async () => {
    const pending = deferred();
    const imageProcessor = {
      createDisplayImage: vi.fn(),
      createThumbnail: vi.fn(),
      renderDisplayBlob: vi.fn(() => pending.promise)
    };
    const { cache, controller, state } = await setup({ imageProcessor });
    const custom = { id: 'custom_1234', date: 'custom:1234', type: 'custom', desc: '' };
    state.history.unshift(custom);
    state.favorites = [custom.date];

    controller.recompress(custom.date, {});
    await controller.remove(custom.date);
    pending.resolve(new Blob(['late'], { type: 'image/jpeg' }));
    await flushAsyncWork();

    expect(cache.put).not.toHaveBeenCalled();
  });
});
