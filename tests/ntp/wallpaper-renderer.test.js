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
  dom = await createScriptDom({
    html: '<!doctype html><html><body><div id="wallpaperBg"></div></body></html>'
  });
  await executeWindowScript(dom, 'ntp/modules/wallpaper-renderer.js');

  const images = [];
  function ImageStub() {
    const image = dom.window.document.createElement('img');
    images.push(image);
    return image;
  }

  const state = {
    settings: { quality: '4k' },
    current: null,
    browseIndex: 0,
    history: [],
    preloadedImages: new Map(),
    isWallpaperLoading: false,
    wallpaperRenderRequestId: 0
  };
  const updateInfo = vi.fn();
  const options = {
    state,
    document: dom.window.document,
    Image: ImageStub,
    URL: { createObjectURL: vi.fn(() => 'blob:test'), revokeObjectURL: vi.fn() },
    fetch: vi.fn(),
    domain: {
      isCustomWallpaper: wallpaper => wallpaper?.type === 'custom',
      buildBingUrl: id => `https://images.test/${id}`
    },
    cache: { get: vi.fn(async () => null), put: vi.fn(async () => true), remove: vi.fn(async () => true) },
    custom: { recompress: vi.fn() },
    theme: { applyTextTheme: vi.fn(), applyInfoTheme: vi.fn() },
    infoController: { onWallpaperChange: vi.fn() },
    addToHistory: vi.fn(),
    updateInfo,
    updateStatus: vi.fn(),
    updateStatusText: vi.fn(),
    ...overrides
  };
  const renderer = dom.window.EchoNtpWallpaperRenderer.create(options);
  return { images, options, renderer, state, updateInfo };
}

afterEach(() => {
  dom?.window.close();
  dom = null;
});

describe('wallpaper renderer', () => {
  it('clears the loading state when custom wallpaper data is missing', async () => {
    const { renderer, state } = await setup();

    await renderer.display({ id: 'custom-1', date: 'custom:1', type: 'custom' });

    expect(state.isWallpaperLoading).toBe(false);
  });

  it('does not let an older network request overwrite newer wallpaper UI', async () => {
    const first = deferred();
    const second = deferred();
    const fetch = vi.fn(url => url.endsWith('/first') ? first.promise : second.promise);
    const { images, renderer, updateInfo } = await setup({ fetch });

    const firstDisplay = renderer.display({ id: 'first', date: '2026-01-01' });
    await flushAsyncWork();
    const secondDisplay = renderer.display({ id: 'second', date: '2026-01-02' });
    await flushAsyncWork();

    second.resolve(new Response(new Blob(['second'], { type: 'image/jpeg' }), {
      headers: { 'Content-Type': 'image/jpeg' }
    }));
    await flushAsyncWork();
    images[0].dispatchEvent(new dom.window.Event('load'));
    await secondDisplay;
    first.resolve(new Response(new Blob(['first'], { type: 'image/jpeg' }), {
      headers: { 'Content-Type': 'image/jpeg' }
    }));
    await firstDisplay;

    expect(updateInfo).toHaveBeenCalledTimes(1);
    expect(updateInfo).toHaveBeenCalledWith(expect.objectContaining({ id: 'second' }));
  });

  it('uses a cached image without requesting the network', async () => {
    const blob = new Blob(['cached'], { type: 'image/jpeg' });
    const cache = { get: vi.fn(async () => blob), put: vi.fn(), remove: vi.fn() };
    const fetch = vi.fn();
    const { images, renderer, state } = await setup({ cache, fetch });

    const display = renderer.display({ id: 'cached', date: '2026-01-01', desc: 'Cached' });
    await flushAsyncWork();
    images[0].dispatchEvent(new dom.window.Event('load'));
    await display;

    expect(fetch).not.toHaveBeenCalled();
    expect(cache.put).not.toHaveBeenCalled();
    expect(state.isWallpaperLoading).toBe(false);
    expect(dom.window.document.getElementById('wallpaperBg').firstElementChild).toBe(images[0]);
  });

  it('does not cache a non-image network response', async () => {
    const cache = { get: vi.fn(async () => null), put: vi.fn(), remove: vi.fn() };
    const fetch = vi.fn(async () => new Response('<html>error</html>', {
      headers: { 'Content-Type': 'text/html' }
    }));
    const { renderer, state } = await setup({ cache, fetch });

    await renderer.display({ id: 'invalid', date: '2026-01-01' });

    expect(cache.put).not.toHaveBeenCalled();
    expect(state.isWallpaperLoading).toBe(false);
  });

  it('calls an injected fetch function without binding it to the options object', async () => {
    const fetch = vi.fn(function() {
      expect(this).toBeUndefined();
      return Promise.resolve(new Response('<html>error</html>', {
        headers: { 'Content-Type': 'text/html' }
      }));
    });
    const { renderer } = await setup({ fetch });

    await renderer.display({ id: 'invalid', date: '2026-01-01' });

    expect(fetch).toHaveBeenCalledOnce();
  });

  it('keeps the committed wallpaper when a downloaded image cannot be decoded', async () => {
    const previous = { id: 'previous', date: '2025-12-31' };
    const cache = { get: vi.fn(async () => null), put: vi.fn(), remove: vi.fn() };
    const fetch = vi.fn(async () => new Response(new Blob(['invalid'], { type: 'image/jpeg' }), {
      headers: { 'Content-Type': 'image/jpeg' }
    }));
    const { images, renderer, state, updateInfo } = await setup({ cache, fetch });
    state.current = previous;

    const display = renderer.display({ id: 'broken', date: '2026-01-01' });
    await flushAsyncWork();
    images[0].dispatchEvent(new dom.window.Event('error'));
    await display;

    expect(state.current).toBe(previous);
    expect(updateInfo).not.toHaveBeenCalled();
    expect(cache.put).not.toHaveBeenCalled();
    expect(state.isWallpaperLoading).toBe(false);
  });

  it('never constructs Bing preload URLs for custom wallpapers', async () => {
    const { renderer, state } = await setup();
    state.history = [{ id: 'custom', date: 'custom:1', type: 'custom' }];

    renderer.preload(5);

    expect(state.preloadedImages.size).toBe(0);
  });

  it('bounds the fallback chain when multiple images cannot be decoded', async () => {
    function FailingImage() {
      const image = dom.window.document.createElement('img');
      Object.defineProperty(image, 'src', {
        set() { queueMicrotask(() => image.onerror?.()); }
      });
      return image;
    }
    const fetch = vi.fn(async () => new Response(new Blob(['broken'], { type: 'image/png' }), {
      headers: { 'Content-Type': 'image/png' }
    }));
    const { renderer, state } = await setup({ Image: FailingImage, fetch });
    state.history = Array.from({ length: 10 }, (_, index) => ({
      id: `broken-${index}`,
      date: `2026-01-${String(index + 1).padStart(2, '0')}`
    }));

    await renderer.display(state.history[0]);

    expect(fetch).toHaveBeenCalledTimes(4);
    expect(state.browseIndex).toBe(3);
    expect(state.current).toBeNull();
  });
});
