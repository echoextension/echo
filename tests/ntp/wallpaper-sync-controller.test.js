// @vitest-environment node

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createFakeChrome } from '../helpers/fake-chrome.js';
import { createScriptDom, executeWindowScript, flushAsyncWork } from '../helpers/script-harness.js';

let dom;

async function setup(overrides = {}) {
  const chrome = createFakeChrome();
  dom = await createScriptDom({ chrome });
  await executeWindowScript(dom, 'ntp/modules/wallpaper-sync-controller.js');
  const applySyncedFavorites = vi.fn(async () => {});
  const refreshIfVisible = vi.fn();
  const controller = dom.window.EchoNtpWallpaperSyncController.create({
    chrome,
    favoritesKey: 'favorites',
    favoritesMetaKey: 'favorites_meta',
    commands: { applySyncedFavorites },
    collection: { refreshIfVisible },
    ...overrides
  });
  controller.register();
  return { applySyncedFavorites, chrome, refreshIfVisible };
}

afterEach(() => {
  dom?.window.close();
  dom = null;
});

describe('wallpaper sync controller', () => {
  it('applies valid synchronized favorites and refreshes a visible collection', async () => {
    const { applySyncedFavorites, chrome, refreshIfVisible } = await setup();

    await chrome.storage.sync.set({
      favorites: ['2026-01-01'],
      favorites_meta: { schemaVersion: 1, updatedAt: 10 }
    });
    await flushAsyncWork();

    expect(applySyncedFavorites).toHaveBeenCalledWith(['2026-01-01'], ['2026-01-01']);
    expect(refreshIfVisible).toHaveBeenCalledOnce();
  });

  it('ignores non-array favorites and unrelated storage areas', async () => {
    const { applySyncedFavorites, chrome } = await setup();

    await chrome.storage.sync.set({ favorites: { invalid: true } });
    await chrome.storage.local.set({ favorites: ['local'] });
    await flushAsyncWork();

    expect(applySyncedFavorites).not.toHaveBeenCalled();
  });

  it('passes separately resolved local favorites to the command state machine', async () => {
    const resolveAvailableFavorites = vi.fn(async () => ['bing']);
    const { applySyncedFavorites, chrome } = await setup({ resolveAvailableFavorites });

    await chrome.storage.sync.set({
      favorites: ['bing', 'custom:remote'],
      favorites_meta: { schemaVersion: 1, updatedAt: 10 }
    });
    await flushAsyncWork();

    expect(resolveAvailableFavorites).toHaveBeenCalledWith(['bing', 'custom:remote']);
    expect(applySyncedFavorites).toHaveBeenCalledWith(['bing', 'custom:remote'], ['bing']);
  });

  it('ignores remote favorites older than a pending local fallback', async () => {
    const getLocalFallbackTimestamp = vi.fn(async () => 20);
    const { applySyncedFavorites, chrome, refreshIfVisible } = await setup({
      getLocalFallbackTimestamp
    });

    await chrome.storage.sync.set({
      favorites: ['stale-remote'],
      favorites_meta: { schemaVersion: 1, updatedAt: 10 }
    });
    await flushAsyncWork();

    expect(applySyncedFavorites).not.toHaveBeenCalled();
    expect(refreshIfVisible).not.toHaveBeenCalled();
  });
});
