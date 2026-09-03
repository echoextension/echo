// @vitest-environment node

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createFakeChrome } from '../helpers/fake-chrome.js';
import { createScriptDom, executeWindowScript, flushAsyncWork } from '../helpers/script-harness.js';

let dom;

function deferred() {
  let resolve;
  const promise = new Promise(value => { resolve = value; });
  return { promise, resolve };
}

async function setup(overrides = {}) {
  const chrome = overrides.chrome || createFakeChrome();
  dom = await createScriptDom({ chrome });
  await executeWindowScript(dom, 'ntp/modules/wallpaper-sync-controller.js');
  const applySyncedFavorites = vi.fn(async () => {});
  const refreshIfVisible = vi.fn();
  const { chrome: _ignoredChrome, ...controllerOverrides } = overrides;
  const controller = dom.window.EchoNtpWallpaperSyncController.create({
    chrome,
    favoritesKey: 'favorites',
    favoritesMetaKey: 'favorites_meta',
    fingerprintFavorites: favorites => JSON.stringify(favorites),
    commands: { applySyncedFavorites },
    collection: { refreshIfVisible },
    ...controllerOverrides
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

  it('applies a consistent snapshot when favorites and metadata arrive separately', async () => {
    const chrome = createFakeChrome();
    const getLocalFallbackTimestamp = vi.fn(async () => 20);
    const { applySyncedFavorites } = await setup({ chrome, getLocalFallbackTimestamp });

    await chrome.storage.sync.set({ favorites: ['new-remote'] });
    await flushAsyncWork();
    expect(applySyncedFavorites).not.toHaveBeenCalled();

    await chrome.storage.sync.set({
      favorites_meta: {
        schemaVersion: 1,
        updatedAt: 30,
        fingerprint: JSON.stringify(['new-remote'])
      }
    });
    await flushAsyncWork();

    expect(applySyncedFavorites).toHaveBeenCalledOnce();
    expect(applySyncedFavorites).toHaveBeenCalledWith(['new-remote'], ['new-remote']);
  });

  it('does not combine newer metadata with older favorites', async () => {
    const chrome = createFakeChrome({
      storage: {
        sync: {
          favorites: ['old-remote'],
          favorites_meta: {
            schemaVersion: 1,
            updatedAt: 10,
            fingerprint: JSON.stringify(['old-remote'])
          }
        }
      }
    });
    const { applySyncedFavorites } = await setup({ chrome });

    await chrome.storage.sync.set({
      favorites_meta: {
        schemaVersion: 1,
        updatedAt: 20,
        fingerprint: JSON.stringify(['new-remote'])
      }
    });
    await flushAsyncWork();

    expect(applySyncedFavorites).not.toHaveBeenCalled();

    await chrome.storage.sync.set({ favorites: ['new-remote'] });
    await flushAsyncWork();

    expect(applySyncedFavorites).toHaveBeenCalledOnce();
    expect(applySyncedFavorites).toHaveBeenCalledWith(['new-remote'], ['new-remote']);
  });

  it('applies a legacy snapshot after both keys arrive in separate events', async () => {
    const chrome = createFakeChrome();
    const { applySyncedFavorites } = await setup({ chrome });

    await chrome.storage.sync.set({ favorites_meta: { schemaVersion: 1, updatedAt: 10 } });
    await flushAsyncWork();
    expect(applySyncedFavorites).not.toHaveBeenCalled();

    await chrome.storage.sync.set({ favorites: ['legacy-remote'] });
    await flushAsyncWork();

    expect(applySyncedFavorites).toHaveBeenCalledOnce();
    expect(applySyncedFavorites).toHaveBeenCalledWith(['legacy-remote'], ['legacy-remote']);
  });

  it('applies a favorites-only update from an older client despite a stale fingerprinted meta', async () => {
    const chrome = createFakeChrome({
      storage: {
        sync: {
          favorites: ['baseline'],
          favorites_meta: {
            schemaVersion: 1,
            updatedAt: 10,
            fingerprint: JSON.stringify(['baseline'])
          }
        }
      }
    });
    const { applySyncedFavorites } = await setup({ chrome, now: () => 20 });

    await chrome.storage.sync.set({ favorites: ['legacy-client-update'] });
    await flushAsyncWork();

    expect(applySyncedFavorites).toHaveBeenCalledOnce();
    expect(applySyncedFavorites).toHaveBeenCalledWith(
      ['legacy-client-update'],
      ['legacy-client-update']
    );
  });

  it('does not let a slow older snapshot overwrite a newer synchronized snapshot', async () => {
    const firstResolution = deferred();
    const resolveAvailableFavorites = vi.fn(favorites => favorites[0] === 'first'
      ? firstResolution.promise
      : Promise.resolve(favorites));
    const { applySyncedFavorites, chrome } = await setup({ resolveAvailableFavorites });

    await chrome.storage.sync.set({
      favorites: ['first'],
      favorites_meta: {
        schemaVersion: 1,
        updatedAt: 10,
        fingerprint: JSON.stringify(['first'])
      }
    });
    await flushAsyncWork();
    await chrome.storage.sync.set({
      favorites: ['second'],
      favorites_meta: {
        schemaVersion: 1,
        updatedAt: 20,
        fingerprint: JSON.stringify(['second'])
      }
    });
    await flushAsyncWork();
    firstResolution.resolve(['first']);
    await flushAsyncWork(8);

    expect(applySyncedFavorites).toHaveBeenCalledOnce();
    expect(applySyncedFavorites).toHaveBeenCalledWith(['second'], ['second']);
  });
});
