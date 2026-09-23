// @vitest-environment node

import { afterEach, describe, expect, it } from 'vitest';

import { createScriptDom, executeWindowScript } from '../helpers/script-harness.js';

let dom;

async function setup() {
  dom = await createScriptDom({
    html: `<!doctype html><html><body>
      <div id="wpFavoriteGroup"><button id="wpFavorite"><svg class="wp-icon"></svg></button></div>
      <span id="wpFavoriteText"></span>
      <button id="wpSetWallpaper"><svg class="wp-icon"></svg></button>
      <span id="wpSetWallpaperText"></span>
      <span id="collectionCountDesc"></span>
      <span id="wallpaperStatusMode"></span><span id="wallpaperStatusTitle"></span>
      <div id="wallpaperSubSettings"></div>
      <input id="sourceDaily"><input id="sourceCollection">
      <span id="sourceDailyCurrent"></span><span id="sourceCollectionCount"></span>
      <span id="manageCollectionCount"></span><div id="playModeSelector"></div>
      <div id="lockedStatusCard"><span id="lockedStatusTitle"></span></div>
      <button id="playModeRandomBtn"></button><button id="playModeFixedBtn"></button>
      <button id="playModeRandom"></button><button id="playModeFixed"></button>
      <span id="collectionHintText"></span>
    </body></html>`
  });
  await executeWindowScript(dom, 'ntp/modules/wallpaper-domain.js');
  await executeWindowScript(dom, 'ntp/modules/wallpaper-status-view.js');
  const state = {
    settings: { mode: 'daily', pinnedDate: null, collectionPlayMode: 'random' },
    current: { id: 'daily', date: '2026-01-02', desc: 'Daily wallpaper' },
    history: [],
    favorites: []
  };
  state.history = [state.current];
  const view = dom.window.EchoNtpWallpaperStatusView.create({
    state,
    document: dom.window.document,
    domain: dom.window.EchoNtpWallpaperDomain
  });
  return { state, view };
}

afterEach(() => {
  dom?.window.close();
  dom = null;
});

describe('wallpaper status view', () => {
  it('renders daily and collection status from state', async () => {
    const { state, view } = await setup();

    view.refresh();
    expect(dom.window.document.getElementById('wallpaperStatusMode').textContent).toBe('必应每日');
    expect(dom.window.document.getElementById('sourceDaily').checked).toBe(true);

    state.settings.mode = 'collection';
    state.favorites = [state.current.date];
    view.refresh();
    expect(dom.window.document.getElementById('wallpaperStatusMode').textContent).toBe('每日随机 · 1张收藏');
    expect(dom.window.document.getElementById('sourceCollectionCount').textContent).toBe('(1张)');
    expect(dom.window.document.getElementById('playModeRandomBtn').classList.contains('active')).toBe(true);
  });

  it('renders a custom locked wallpaper independently from the source mode', async () => {
    const { state, view } = await setup();
    const custom = { id: 'custom', date: 'custom:1', type: 'custom', desc: '' };
    state.history.unshift(custom);
    state.current = custom;
    state.settings.pinnedDate = custom.date;

    view.refresh();

    expect(dom.window.document.getElementById('wallpaperSubSettings').classList.contains('is-locked')).toBe(true);
    expect(dom.window.document.getElementById('lockedStatusCard').classList.contains('visible')).toBe(true);
    expect(dom.window.document.getElementById('lockedStatusTitle').textContent).toBe('本地上传壁纸');
    expect(dom.window.document.getElementById('wpSetWallpaper').classList.contains('active')).toBe(true);
  });

  it('updates the legacy collection playback controls', async () => {
    const { state, view } = await setup();

    view.setCollectionPlayMode('fixed');

    expect(state.settings.collectionPlayMode).toBe('random');
    expect(dom.window.document.getElementById('playModeFixed').classList.contains('active')).toBe(true);
    expect(dom.window.document.getElementById('collectionHintText').textContent).toBe('点击下方壁纸将其设为固定壁纸');
   });

  it('does not count unavailable remote custom placeholders', async () => {
    const { state, view } = await setup();
    state.favorites = ['custom:remote'];
    state.availableFavorites = [];
    state.settings.mode = 'collection';

    view.refresh();

    expect(dom.window.document.getElementById('sourceCollectionCount').textContent).toBe('(0张)');
    expect(dom.window.document.getElementById('wallpaperStatusMode').textContent).toBe('每日随机 · 0张收藏');
  });
 });
