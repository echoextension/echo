// @vitest-environment node

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createScriptDom, executeWindowScript, flushAsyncWork } from '../helpers/script-harness.js';

let dom;

async function setup() {
  dom = await createScriptDom({
    html: `<!doctype html><html><body>
      <div id="collectionBackdrop"></div>
      <section id="collectionPanel">
        <button id="collectionClose"></button>
        <button id="tabFavorites" class="collection-tab active" data-tab="favorites"></button>
        <span id="tabFavoritesCount"></span>
        <button id="tabHistory" class="collection-tab" data-tab="history"></button>
        <span id="tabHistoryCount"></span>
        <div id="collectionEmpty"><svg class="empty-icon"></svg><p></p><p class="empty-hint"></p></div>
        <div id="collectionGrid"></div>
        <button id="playModeRandom"></button><button id="playModeFixed"></button>
        <a id="collectionBackupLink" href="#"></a>
        <input id="customWallpaperInput" type="file">
      </section>
    </body></html>`
  });
  await executeWindowScript(dom, 'ntp/modules/wallpaper-domain.js');
  await executeWindowScript(dom, 'ntp/modules/wallpaper-collection-controller.js');
  const first = { id: 'first', date: '2026-01-01', desc: 'First' };
  const second = { id: 'second', date: '2026-01-02', desc: 'Second' };
  const state = {
    settings: { pinnedDate: null, collectionPlayMode: 'random' },
    current: first,
    history: [first, second],
    favorites: [first.date],
    viewHistory: [second.date],
    browseIndex: 0,
    isPreview: false
  };
  const commands = {
    removeFavorite: vi.fn(async date => {
      state.favorites = state.favorites.filter(item => item !== date);
    }),
    setCollectionPlayback: vi.fn(async () => {})
  };
  const display = vi.fn();
  const controller = dom.window.EchoNtpWallpaperCollectionController.create({
    state,
    document: dom.window.document,
    URL: dom.window.URL,
    domain: dom.window.EchoNtpWallpaperDomain,
    cache: { get: vi.fn(async () => null) },
    commands,
    display,
    view: { setCollectionPlayMode: vi.fn(), updateActions: vi.fn() },
    loadHistory: vi.fn(),
    uploadCustomWallpaper: vi.fn(async () => null),
    openBackup: vi.fn()
  });
  return { commands, controller, display, state };
}

afterEach(() => {
  dom?.window.close();
  dom = null;
});

describe('wallpaper collection controller', () => {
  it('opens the active collection tab with synchronized counts', async () => {
    const { controller } = await setup();

    controller.show();

    expect(dom.window.document.getElementById('collectionPanel').classList.contains('visible')).toBe(true);
    expect(dom.window.document.getElementById('collectionBackdrop').classList.contains('visible')).toBe(true);
    expect(dom.window.document.getElementById('tabFavoritesCount').textContent).toBe('(1)');
    expect(dom.window.document.querySelectorAll('.collection-item')).toHaveLength(1);
    expect(dom.window.document.querySelector('.item-title').textContent).toBe('First');
  });

  it('previews a grid item without changing the pin', async () => {
    const { controller, display, state } = await setup();
    state.settings.pinnedDate = '2026-01-01';
    controller.show();

    dom.window.document.querySelector('.collection-item').click();

    expect(state.settings.pinnedDate).toBe('2026-01-01');
    expect(state.isPreview).toBe(true);
    expect(display).toHaveBeenCalledWith(state.history[0]);
    expect(dom.window.document.getElementById('collectionPanel').classList.contains('visible')).toBe(false);
  });

  it('delegates deletion and rerenders the empty favorites state', async () => {
    const { commands, controller } = await setup();
    controller.show();

    dom.window.document.querySelector('.item-delete').click();
    await flushAsyncWork();

    expect(commands.removeFavorite).toHaveBeenCalledWith('2026-01-01');
    expect(dom.window.document.getElementById('collectionGrid').classList.contains('hidden')).toBe(true);
    expect(dom.window.document.getElementById('collectionEmpty').classList.contains('hidden')).toBe(false);
  });

  it('switches to and renders browsing history', async () => {
    const { controller } = await setup();
    controller.init();

    dom.window.document.getElementById('tabHistory').click();

    expect(dom.window.document.getElementById('tabHistory').classList.contains('active')).toBe(true);
    expect(dom.window.document.querySelector('.item-title').textContent).toBe('Second');
    expect(dom.window.document.querySelector('.item-delete')).toBeNull();
  });
});
