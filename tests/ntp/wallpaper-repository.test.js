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

async function loadRepository(chrome, options = {}, localStorageApi = null) {
  dom = await createScriptDom({ chrome, url: 'https://extension.test/' });
  await executeWindowScript(dom, 'ntp/modules/wallpaper-repository.js');
  return dom.window.EchoNtpWallpaperRepository.create(
    chrome,
    localStorageApi || dom.window.localStorage,
    keys,
    options
  );
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

  it('prefers an authoritative stored blank mode over a stale first-paint mirror', async () => {
    const chrome = createFakeChrome({
      storage: { local: { settings: { blankMode: false } } }
    });
    const repository = await loadRepository(chrome);
    dom.window.localStorage.setItem('blank', 'true');
    const state = { settings: { blankMode: true }, favorites: [], viewHistory: [] };

    await repository.load(state);

    expect(state.settings.blankMode).toBe(false);
    expect(dom.window.localStorage.getItem('blank')).toBe('false');
  });

  it('does not update the blank-mode mirror when authoritative persistence fails', async () => {
    const chrome = createFakeChrome();
    const repository = await loadRepository(chrome);
    dom.window.localStorage.setItem('blank', 'false');
    chrome.__testing.failNextStorageSet('local', new Error('storage unavailable'));

    await expect(repository.saveSettings({ blankMode: true })).rejects.toThrow('storage unavailable');

    expect(dom.window.localStorage.getItem('blank')).toBe('false');
  });

  it('persists the blank-mode value captured when saving begins', async () => {
    const chrome = createFakeChrome();
    const repository = await loadRepository(chrome);
    let releaseWrite;
    const writeGate = new Promise(resolve => { releaseWrite = resolve; });
    const originalSet = chrome.storage.local.set.bind(chrome.storage.local);
    chrome.storage.local.set = async items => {
      await writeGate;
      return originalSet(items);
    };
    const settings = { mode: 'daily', blankMode: false };

    const saving = repository.saveSettings(settings);
    settings.blankMode = true;
    releaseWrite();
    await saving;

    await expect(chrome.storage.local.get('settings')).resolves.toEqual({
      settings: { mode: 'daily', blankMode: false }
    });
    expect(dom.window.localStorage.getItem('blank')).toBe('false');
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

  it('keeps an in-memory view history update when localStorage is unavailable', async () => {
    const chrome = createFakeChrome();
    const localStorageApi = {
      getItem: () => null,
      setItem: () => { throw new Error('storage unavailable'); }
    };
    const repository = await loadRepository(chrome, {}, localStorageApi);
    const state = { viewHistory: [] };

    expect(() => repository.addViewHistory(state, '2026-09-03')).not.toThrow();
    expect(state.viewHistory).toEqual(['2026-09-03']);
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

  it('keeps but does not rewrite synchronized favorites whose fingerprint is pending', async () => {
    const chrome = createFakeChrome({
      storage: {
        sync: {
          favorites: ['old-remote'],
          favorites_meta: {
            schemaVersion: 1,
            updatedAt: 20,
            fingerprint: 'different-snapshot'
          }
        }
      }
    });
    const repository = await loadRepository(chrome);
    const state = { settings: {}, favorites: [], viewHistory: [] };

    await repository.load(state);

    expect(state.favorites).toEqual(['old-remote']);
    expect(state.availableFavorites).toEqual(['old-remote']);
    await expect(chrome.storage.sync.get('favorites_meta')).resolves.toEqual({
      favorites_meta: {
        schemaVersion: 1,
        updatedAt: 20,
        fingerprint: 'different-snapshot'
      }
    });
  });

  it('does not overwrite a newer incomplete sync snapshot with an older local fallback', async () => {
    const chrome = createFakeChrome({
      storage: {
        local: {
          favorites: { schemaVersion: 1, favorites: ['old-local'], updatedAt: 10 }
        },
        sync: {
          favorites: ['new-remote'],
          favorites_meta: {
            schemaVersion: 1,
            updatedAt: 20,
            fingerprint: 'pending-other-half'
          }
        }
      }
    });
    const repository = await loadRepository(chrome);
    const state = { settings: {}, favorites: [], viewHistory: [] };

    await repository.load(state);

    expect(state.favorites).toEqual(['old-local']);
    await expect(chrome.storage.sync.get(['favorites', 'favorites_meta'])).resolves.toEqual({
      favorites: ['new-remote'],
      favorites_meta: {
        schemaVersion: 1,
        updatedAt: 20,
        fingerprint: 'pending-other-half'
      }
    });
    await expect(chrome.storage.local.get('favorites')).resolves.toEqual({
      favorites: { schemaVersion: 1, favorites: ['old-local'], updatedAt: 10 }
    });
  });

  it('skips a compensating write when synchronized favorites no longer match the expected snapshot', async () => {
    const chrome = createFakeChrome({
      storage: {
        sync: {
          favorites: ['new-remote'],
          favorites_meta: {
            schemaVersion: 1,
            updatedAt: 20,
            fingerprint: 'new-remote-fingerprint'
          }
        }
      }
    });
    const repository = await loadRepository(chrome);

    await expect(repository.saveFavorites(['previous'], {
      expectedFavorites: ['locally-removed']
    })).resolves.toEqual({
      favorites: ['new-remote'],
      fallback: false,
      skipped: true
    });
    await expect(chrome.storage.sync.get('favorites')).resolves.toEqual({
      favorites: ['new-remote']
    });
  });

  it('applies a semantic compensation to a newer local fallback without losing entries', async () => {
    const chrome = createFakeChrome({
      storage: {
        local: {
          favorites: {
            schemaVersion: 1,
            favorites: ['concurrent'],
            updatedAt: 30
          }
        },
        sync: {
          favorites: ['old-sync'],
          favorites_meta: { schemaVersion: 1, updatedAt: 20 }
        }
      }
    });
    const repository = await loadRepository(chrome, { now: () => 40 });

    await expect(repository.saveFavorites([], {
      addFavorites: ['restored']
    })).resolves.toMatchObject({
      favorites: ['concurrent', 'restored'],
      fallback: false,
      skipped: false
    });
    await expect(chrome.storage.sync.get('favorites')).resolves.toEqual({
      favorites: ['concurrent', 'restored']
    });
    await expect(chrome.storage.local.get('favorites')).resolves.toEqual({ favorites: undefined });
  });

  it('removes only the failed custom date while preserving concurrent synchronized additions', async () => {
    const chrome = createFakeChrome({
      storage: {
        sync: {
          favorites: ['custom:failed', 'concurrent'],
          favorites_meta: { schemaVersion: 1, updatedAt: 20 }
        }
      }
    });
    const repository = await loadRepository(chrome, { now: () => 40 });

    await expect(repository.saveFavorites([], {
      removeFavorites: ['custom:failed']
    })).resolves.toMatchObject({
      favorites: ['concurrent']
    });
    await expect(chrome.storage.sync.get('favorites')).resolves.toEqual({ favorites: ['concurrent'] });
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
      favorites_meta: {
        schemaVersion: 1,
        updatedAt: 30,
        fingerprint: expect.any(String)
      }
    });
  });
});