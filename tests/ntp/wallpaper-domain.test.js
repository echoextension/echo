// @vitest-environment node

import { afterEach, describe, expect, it } from 'vitest';

import { createFakeChrome } from '../helpers/fake-chrome.js';
import { createScriptDom, executeWindowScript } from '../helpers/script-harness.js';

let dom;

async function loadDomain() {
  dom = await createScriptDom({ chrome: createFakeChrome() });
  await executeWindowScript(dom, 'ntp/modules/wallpaper-domain.js');
  return dom.window.EchoNtpWallpaperDomain;
}

afterEach(() => {
  dom?.window.close();
  dom = null;
});

describe('wallpaper domain', () => {
  it('selects a stable daily favorite for collection mode', async () => {
    const domain = await loadDomain();
    const state = {
      settings: { mode: 'collection', pinnedDate: null, lastActiveMode: 'collection' },
      history: [
        { id: 'a', date: '2026-09-01' },
        { id: 'b', date: '2026-08-31' }
      ],
      favorites: ['2026-09-01', '2026-08-31'],
      browseIndex: 0
    };

    const selected = domain.selectWallpaper(state, '2026-09-01');

    expect(state.favorites).toContain(selected.date);
    expect(domain.selectWallpaper(state, '2026-09-01')).toBe(selected);
  });

  it('clears an invalid pin and falls back to the latest non-custom wallpaper', async () => {
    const domain = await loadDomain();
    const state = {
      settings: { mode: 'daily', pinnedDate: 'missing', lastActiveMode: 'daily' },
      history: [
        { id: 'custom', date: 'custom:1', type: 'custom' },
        { id: 'daily', date: '2026-09-01' }
      ],
      favorites: [],
      browseIndex: 0
    };

    expect(domain.selectWallpaper(state)).toEqual({ id: 'daily', date: '2026-09-01' });
    expect(state.settings.pinnedDate).toBeNull();
  });

  it('builds the two supported Bing image qualities', async () => {
    const domain = await loadDomain();
    expect(domain.buildBingUrl('fixture', '4k')).toContain('w=3840&h=2160');
    expect(domain.buildBingUrl('fixture', '1080p')).toContain('w=1920&h=1080');
  });
});