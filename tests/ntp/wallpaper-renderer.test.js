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
    settings: { quality: '4k', mode: 'daily' },
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
    cache: {
      get: vi.fn(async () => null),
      getFirst: vi.fn(async () => null),
      put: vi.fn(async () => true),
      remove: vi.fn(async () => true)
    },
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
  it.each([false, true])('allows cache decoding alongside a daily target (new image first: %s)', async newFirst => {
    const { images, renderer, state, options } = await setup();
    renderer.setRefreshPending(true);
    const old = { id: 'old', date: '2026-10-19' };
    const latest = { id: 'new', date: '2026-10-20' };
    state.history = [latest, old];
    options.cache.getFirst.mockResolvedValue({ url: 'https://images.test/old', blob: new Blob(['old']) });
    options.fetch.mockResolvedValue(new Response(new Blob(['new']), { headers: { 'Content-Type': 'image/jpeg' } }));
    const cached = renderer.displayCached(state.history, () => true);
    await flushAsyncWork();
    const target = renderer.display(latest, 0, () => true);
    const duplicate = renderer.display(latest, 0, () => true);
    await flushAsyncWork();
    expect(options.fetch).toHaveBeenCalledOnce();
    expect(images).toHaveLength(2);
    if (newFirst) {
      images[1].dispatchEvent(new dom.window.Event('load'));
      await target;
      images[0].dispatchEvent(new dom.window.Event('load'));
    } else {
      images[0].dispatchEvent(new dom.window.Event('load'));
      await cached;
      expect(state.current).toBe(old);
      expect(state.isWallpaperLoading).toBe(true);
      images[1].dispatchEvent(new dom.window.Event('load'));
    }
    await Promise.all([cached, target, duplicate]);
    expect(state.current).toBe(latest);
    expect(state.isWallpaperLoading).toBe(false);
    expect(options.cache.put).toHaveBeenCalledOnce();
  });

  it('lets an explicit user choice invalidate the pending first paint and daily target', async () => {
    const { images, renderer, state, options } = await setup();
    renderer.setRefreshPending(true);
    state.history = [{ id: 'old', date: '2026-10-19' }];
    options.cache.getFirst.mockResolvedValue({ url: 'https://images.test/old', blob: new Blob(['old']) });
    options.fetch.mockImplementation(async () => new Response(new Blob(['image']), { headers: { 'Content-Type': 'image/jpeg' } }));
    const cached = renderer.displayCached(state.history, () => true);
    await flushAsyncWork();
    const daily = renderer.display({ id: 'daily', date: '2026-10-20' }, 0, () => true);
    await flushAsyncWork();
    const user = renderer.display({ id: 'user', date: '2026-10-18' });
    await flushAsyncWork();
    images[2].dispatchEvent(new dom.window.Event('load'));
    images[0].dispatchEvent(new dom.window.Event('load'));
    images[1].dispatchEvent(new dom.window.Event('load'));
    await Promise.all([cached, daily, user]);
    expect(state.current.id).toBe('user');
  });

  it('restores the warm five-image batch after the primary update, without a slow image blocking its peers', async () => {
    let nextCandidate = 0;
    const { images, renderer, state } = await setup({
      random: () => (nextCandidate++ % 6) / 6
    });
    state.current = { id: 'current' };
    state.history = ['one', 'two', 'three', 'four', 'five', 'six'].map(id => ({ id }));
    renderer.setRefreshPending(true);
    renderer.preload();
    expect(images).toHaveLength(0);
    renderer.setRefreshPending(false);
    expect(images).toHaveLength(5);
    for (const image of images.slice(1)) image.dispatchEvent(new dom.window.Event('load'));
    expect(state.preloadedImages.size).toBe(5);
    renderer.setRefreshPending(true);
    expect(state.preloadedImages.size).toBe(4);
    expect(images[0].hasAttribute('src')).toBe(false);
  });

  it('does not cancel warm preloads when the user displays a wallpaper', async () => {
    let nextCandidate = 0;
    const { images, renderer, state, options } = await setup({
      random: () => (nextCandidate++ % 6) / 6
    });
    state.current = { id: 'today', date: '2099-01-01' };
    state.history = [state.current, ...['one', 'two', 'three', 'four', 'five'].map(id => ({ id }))];
    renderer.preload();
    expect(images).toHaveLength(5);
    const urls = images.map(image => image.src);
    options.cache.get.mockResolvedValue(new Blob(['chosen']));
    const display = renderer.display({ id: 'chosen' });
    await flushAsyncWork();
    expect(state.preloadedImages.size).toBe(5);
    expect(images.slice(0, 5).map(image => image.src)).toEqual(urls);
    images[5].dispatchEvent(new dom.window.Event('load'));
    await display;
  });

  it('refills the warm pool immediately after consuming a ready random image', async () => {
    let nextCandidate = 0;
    const { images, renderer, state, options } = await setup({
      random: () => (nextCandidate++ % 7) / 7
    });
    await executeWindowScript(dom, 'ntp/modules/wallpaper-command-controller.js');
    state.current = { id: 'today', date: '2099-01-01' };
    state.history = [state.current, ...['one', 'two', 'three', 'four', 'five', 'six']
      .map(id => ({ id, date: `2026-10-${id}` }))];
    renderer.preload();
    expect(images).toHaveLength(5);
    const pending = images.slice(1).map(image => image.src);
    Object.defineProperty(images[0], 'complete', { value: true });
    Object.defineProperty(images[0], 'naturalWidth', { value: 100 });
    const commands = dom.window.EchoNtpWallpaperCommandController.create({
      state, domain: options.domain, display: renderer.display, refresh() {}
    });
    const selected = commands.randomPreview();
    expect(state.current).toBe(selected);
    expect(dom.window.document.getElementById('wallpaperBg').firstElementChild).toBe(images[0]);
    expect(images).toHaveLength(6);
    expect(state.preloadedImages.size).toBe(5);
    expect(images.slice(1, 5).map(image => image.src)).toEqual(pending);
    expect(options.cache.get).not.toHaveBeenCalled();
    expect(options.fetch).not.toHaveBeenCalled();
  });

  it('continues warm preloads while revalidating metadata for an already current daily image', async () => {
    let nextCandidate = 0;
    const { images, renderer, state } = await setup({
      random: () => (nextCandidate++ % 6) / 6, today: () => '2026-10-20'
    });
    state.current = { id: 'today', date: '2026-10-20' };
    state.history = [state.current, ...['one', 'two', 'three', 'four', 'five'].map(id => ({ id }))];
    renderer.setRefreshPending(true);
    renderer.preload();
    expect(images).toHaveLength(5);
  });

  it('consumes an already loaded random candidate directly without IndexedDB, fetch or another Image', async () => {
    const { images, renderer, state, options } = await setup({ random: () => 0 });
    await executeWindowScript(dom, 'ntp/modules/wallpaper-command-controller.js');
    state.current = { id: 'today', date: '2099-01-01' };
    const next = { id: 'ready', date: '2026-10-19' };
    state.history = [state.current, next];
    const ready = dom.window.document.createElement('img');
    Object.defineProperty(ready, 'complete', { value: true });
    Object.defineProperty(ready, 'naturalWidth', { value: 100 });
    ready.wpData = next;
    state.preloadedImages.set(options.domain.buildBingUrl(next.id), ready);
    const commands = dom.window.EchoNtpWallpaperCommandController.create({
      state, domain: options.domain, display: renderer.display, refresh() {}
    });
    expect(commands.randomPreview()).toBe(next);
    // Commit is synchronous on the ready path, before promise work.
    expect(state.current).toBe(next);
    expect(dom.window.document.getElementById('wallpaperBg').firstElementChild).toBe(ready);
    expect(state.preloadedImages.has(options.domain.buildBingUrl(next.id))).toBe(false);
    expect(images.filter(image => image.src === options.domain.buildBingUrl(next.id))).toHaveLength(0);
    expect(options.cache.get).not.toHaveBeenCalled();
    expect(options.fetch).not.toHaveBeenCalled();
    await flushAsyncWork();
  });

  it('transfers preload ownership before a queued load event so later pauses cannot clear the displayed image', async () => {
    const { images, renderer, state, options } = await setup({ random: () => 0.75 });
    state.current = { id: 'today', date: '2099-01-01' };
    const ready = { id: 'ready', date: '2026-10-19' };
    state.history = [state.current, ready];
    renderer.preload();
    const image = images[0];
    const source = image.src;
    // The resource is available but its load event has not run yet.
    Object.defineProperty(image, 'complete', { value: true });
    Object.defineProperty(image, 'naturalWidth', { value: 100 });
    await renderer.display(ready);
    expect(dom.window.document.getElementById('wallpaperBg').firstElementChild).toBe(image);
    renderer.setRefreshPending(true);
    expect(image.src).toBe(source);
    expect(state.current).toBe(ready);
    expect(options.fetch).not.toHaveBeenCalled();
  });

  it('displays an older cached image before starting any wallpaper download', async () => {
    const { images, renderer, state, options } = await setup();
    const latest = { id: 'latest', date: '2026-09-17' };
    const cached = { id: 'cached', date: '2026-09-16' };
    state.history = [latest, cached];
    options.cache.getFirst.mockResolvedValue({
      url: 'https://images.test/cached', blob: new Blob(['cached'], { type: 'image/jpeg' })
    });

    const display = renderer.displayCached(state.history);
    await flushAsyncWork();
    expect(options.cache.getFirst).toHaveBeenCalledWith([
      'https://images.test/latest', 'https://images.test/cached'
    ]);
    images[0].dispatchEvent(new dom.window.Event('load'));
    await expect(display).resolves.toBe(true);

    expect(state.current).toBe(cached);
    expect(state.browseIndex).toBe(1);
    expect(options.fetch).not.toHaveBeenCalled();
  });

  it('skips a corrupt cached image and displays the next available one', async () => {
    const { images, renderer, state, options } = await setup();
    state.history = [{ id: 'broken', date: '2026-09-17' }, { id: 'cached', date: '2026-09-16' }];
    options.cache.getFirst
      .mockResolvedValueOnce({ url: 'https://images.test/broken', blob: new Blob(['broken']) })
      .mockResolvedValueOnce({ url: 'https://images.test/cached', blob: new Blob(['cached']) });

    const display = renderer.displayCached(state.history);
    await flushAsyncWork();
    images[0].dispatchEvent(new dom.window.Event('error'));
    await flushAsyncWork();
    images[1].dispatchEvent(new dom.window.Event('load'));
    await expect(display).resolves.toBe(true);

    expect(options.cache.remove).toHaveBeenCalledWith('https://images.test/broken');
    expect(state.current.id).toBe('cached');
  });

  it('retains the visible image until a background replacement has decoded', async () => {
    const { images, renderer, state, options } = await setup();
    const previous = dom.window.document.createElement('img');
    const background = dom.window.document.getElementById('wallpaperBg');
    background.appendChild(previous);
    state.current = { id: 'previous', date: '2026-09-16' };
    options.fetch.mockResolvedValue(new Response(new Blob(['new'], { type: 'image/jpeg' })));

    const display = renderer.display({ id: 'new', date: '2026-09-17' }, 0, () => true);
    await flushAsyncWork();
    expect(background.firstElementChild).toBe(previous);
    expect(state.current.id).toBe('previous');
    images[0].dispatchEvent(new dom.window.Event('load'));
    await display;

    expect(background.firstElementChild).toBe(images[0]);
    expect(state.current.id).toBe('new');
  });

  it('does not replace an image if the background update is no longer allowed', async () => {
    const { images, renderer, state, options } = await setup();
    const previous = { id: 'previous', date: '2026-09-16' };
    state.current = previous;
    options.fetch.mockResolvedValue(new Response(new Blob(['new'], { type: 'image/jpeg' })));
    let allowed = true;

    const display = renderer.display({ id: 'new', date: '2026-09-17' }, 0, () => allowed);
    await flushAsyncWork();
    allowed = false;
    images[0].dispatchEvent(new dom.window.Event('load'));
    await display;

    expect(state.current).toBe(previous);
    expect(state.isWallpaperLoading).toBe(false);
    expect(options.cache.put).not.toHaveBeenCalled();
  });

  it('keeps the current image when a background download fails without falling back', async () => {
    const { renderer, state, options } = await setup();
    state.history = [{ id: 'new', date: '2026-09-17' }, { id: 'older', date: '2026-09-15' }];
    state.current = { id: 'previous', date: '2026-09-16' };
    options.fetch.mockResolvedValue(new Response('', { status: 503 }));

    await renderer.display(state.history[0], 0, () => true);

    expect(state.current.id).toBe('previous');
    expect(options.fetch).toHaveBeenCalledOnce();
  });

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

  it('does not commit a pending wallpaper after rendering is cancelled', async () => {
    const response = deferred();
    const fetch = vi.fn(() => response.promise);
    const { renderer, state, updateInfo } = await setup({ fetch });

    const display = renderer.display({ id: 'pending', date: '2026-01-01' });
    await flushAsyncWork();
    renderer.cancel();
    response.resolve(new Response(new Blob(['pending'], { type: 'image/jpeg' }), {
      headers: { 'Content-Type': 'image/jpeg' }
    }));
    await display;

    expect(state.current).toBeNull();
    expect(state.isWallpaperLoading).toBe(false);
    expect(updateInfo).not.toHaveBeenCalled();
    expect(dom.window.document.getElementById('wallpaperBg').children).toHaveLength(0);
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
