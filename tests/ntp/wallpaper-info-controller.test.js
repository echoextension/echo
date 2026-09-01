// @vitest-environment node

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createFakeChrome } from '../helpers/fake-chrome.js';
import { createScriptDom, executeWindowScript, flushAsyncWork } from '../helpers/script-harness.js';

let dom;

async function setup(settings = {}) {
  dom = await createScriptDom({
    chrome: createFakeChrome(),
    html: `<!doctype html><html><body class="wallpaper-mode">
      <div id="wallpaperInfoWrapper">
        <button id="wallpaperInfoDot"></button>
        <article id="wallpaperInfo">
          <a class="wallpaper-search-link" href="#">搜索</a>
          <span id="wallpaperTitle"></span>
          <span id="wallpaperCopyright"></span>
          <span id="wallpaperDate"></span>
        </article>
      </div>
      <input id="autoHideInfoSwitch" type="checkbox">
    </body></html>`
  });
  await executeWindowScript(dom, 'ntp/modules/wallpaper-info-controller.js');
  const state = {
    settings: { autoHideInfo: false, infoPositionY: null, lastShownWallpaperId: null, ...settings },
    current: { id: 'wallpaper-1' }
  };
  const saveSettings = vi.fn(async () => {});
  const openSearch = vi.fn();
  const controller = dom.window.EchoNtpWallpaperInfoController.create({
    state,
    document: dom.window.document,
    window: dom.window,
    saveSettings,
    openSearch,
    now: () => new Date(2026, 8, 1)
  });
  return { controller, openSearch, saveSettings, state };
}

afterEach(() => {
  dom?.window.close();
  dom = null;
});

describe('wallpaper info controller', () => {
  it('keeps the card expanded when auto-hide is disabled', async () => {
    const { controller } = await setup();
    controller.init();
    expect(dom.window.document.getElementById('wallpaperInfoWrapper').classList.contains('expanded')).toBe(true);
  });

  it('restores a saved position and records the current wallpaper when enabled', async () => {
    const { controller, saveSettings, state } = await setup({ autoHideInfo: true, infoPositionY: 120 });
    controller.init();
    controller.onWallpaperChange();
    await flushAsyncWork();
    const wrapper = dom.window.document.getElementById('wallpaperInfoWrapper');
    expect(wrapper.style.getPropertyValue('--info-position-y')).toBe('120px');
    expect(wrapper.classList.contains('custom-position')).toBe(true);
    expect(state.settings.lastShownWallpaperId).toBe('wallpaper-1');
    expect(saveSettings).toHaveBeenCalled();
  });

  it('updates metadata and hides dates outside the recent API window', async () => {
    const { controller } = await setup();
    const title = dom.window.document.getElementById('wallpaperTitle');
    const copyright = dom.window.document.getElementById('wallpaperCopyright');
    const date = dom.window.document.getElementById('wallpaperDate');

    controller.update({ date: '2026-08-31', desc: 'Recent', copyright: 'Fixture' });
    expect(title.textContent).toBe('Recent');
    expect(copyright.textContent).toBe('Fixture');
    expect(date.textContent).toBe('2026-08-31');
    expect(date.style.display).toBe('');

    controller.update({ date: '2025-01-01', desc: 'Historic', copyright: '' });
    expect(date.textContent).toBe('');
    expect(date.style.display).toBe('none');
  });

  it('opens a Bing search when the information card is clicked outside the drag handle', async () => {
    const { controller, openSearch, state } = await setup();
    state.current = { id: 'wallpaper-1', desc: 'snow otters' };
    controller.init();
    const card = dom.window.document.getElementById('wallpaperInfo');

    card.dispatchEvent(new dom.window.MouseEvent('mousedown', { bubbles: true, clientX: 40 }));
    card.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, clientX: 40 }));

    expect(openSearch).toHaveBeenCalledWith('https://www.bing.com/search?q=snow%20otters');
  });
});