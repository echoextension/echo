// @vitest-environment node

import { afterEach, describe, expect, it } from 'vitest';

import { createFakeChrome } from '../helpers/fake-chrome.js';
import { createScriptDom, executeWindowScript } from '../helpers/script-harness.js';

let dom;
const keys = {
  settings: 'settings',
  favorites: 'favorites',
  blankMode: 'blank',
  viewHistory: 'history'
};

async function loadRepository(chrome, options = {}) {
  dom = await createScriptDom({ chrome, url: 'https://extension.test/' });
  await executeWindowScript(dom, 'ntp/modules/wallpaper-repository.js');
  return dom.window.EchoNtpWallpaperRepository.create(chrome, dom.window.localStorage, keys, options);
}

afterEach(() => {
  dom?.window.close();
  dom = null;
});

describe('wallpaper settings repository', () => {
  it('loads typed settings, sync favorites and sanitized history', async () => {
    const chrome = createFakeChrome({
      storage: {
        local: { settings: { mode: 'off' } },
        sync: { favorites: ['2026-09-01', '2026-09-01', 5] }
      }
    });
    const repository = await loadRepository(chrome);
    dom.window.localStorage.setItem('blank', 'true');
    dom.window.localStorage.setItem('history', JSON.stringify(['a', 'a', 1, 'b']));
    const state = { settings: { mode: 'daily', blankMode: false }, favorites: [], viewHistory: [] };

    await repository.load(state);

    expect(state).toEqual({
      settings: { mode: 'off', blankMode: true },
      favorites: ['2026-09-01'],
      availableFavorites: ['2026-09-01'],
      viewHistory: ['a', 'b']
    });
  });

  it('uses a valid local fallback as the last local operation and retries sync', async () => {
    const chrome = createFakeChrome({
      storage: {
        local: { favorites: { schemaVersion: 1, favorites: ['local'], updatedAt: 1 } },
        sync: { favorites: ['remote'] }
      }
    });
    const repository = await loadRepository(chrome);
    const state = { settings: {}, favorites: [], viewHistory: [] };

    await repository.load(state);

    expect(state.favorites).toEqual(['local']);
    await expect(chrome.storage.sync.get('favorites')).resolves.toEqual({ favorites: ['local'] });
    await expect(chrome.storage.local.get('favorites')).resolves.toEqual({ favorites: undefined });
  });

  it('recovers from malformed view history', async () => {
    const chrome = createFakeChrome();
    const repository = await loadRepository(chrome);
    dom.window.localStorage.setItem('history', '{not json');

    expect(repository.loadViewHistory()).toEqual([]);
  });

  it('keeps synchronized favorites when their metadata is newer than the local fallback', async () => {
    const chrome = createFakeChrome({
      storage: {
        local: { favorites: { schemaVersion: 1, favorites: ['stale-local'], updatedAt: 10 } },
        sync: {
          favorites: ['new-remote'],
          favorites_meta: { schemaVersion: 1, updatedAt: 20 }
        }
      }
    });
    const repository = await loadRepository(chrome);
    const state = { settings: {}, favorites: [], viewHistory: [] };

    await repository.load(state);

    expect(state.favorites).toEqual(['new-remote']);
    await expect(chrome.storage.local.get('favorites')).resolves.toEqual({ favorites: undefined });
  });

  it('retries a newer local fallback with its original timestamp', async () => {
    const chrome = createFakeChrome({
      storage: {
        local: { favorites: { schemaVersion: 1, favorites: ['new-local'], updatedAt: 30 } },
        sync: {
          favorites: ['stale-remote'],
          favorites_meta: { schemaVersion: 1, updatedAt: 20 }
        }
      }
    });
    const repository = await loadRepository(chrome, { now: () => 40 });
    const state = { settings: {}, favorites: [], viewHistory: [] };

    await repository.load(state);

    expect(state.favorites).toEqual(['new-local']);
    await expect(chrome.storage.sync.get(['favorites', 'favorites_meta'])).resolves.toEqual({
      favorites: ['new-local'],
      favorites_meta: { schemaVersion: 1, updatedAt: 30 }
    });
  });
});