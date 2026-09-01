// @vitest-environment node

import { afterEach, describe, expect, it } from 'vitest';

import { IDBFactory } from 'fake-indexeddb';

import { createFakeChrome } from '../helpers/fake-chrome.js';
import { createScriptDom, executeWindowScript } from '../helpers/script-harness.js';

let dom;

async function loadCache(indexedDb, now = () => 10_000) {
  dom = await createScriptDom({ chrome: createFakeChrome() });
  await executeWindowScript(dom, 'ntp/modules/wallpaper-cache.js');
  return dom.window.EchoNtpWallpaperCache.create(indexedDb, { now });
}

afterEach(() => {
  dom?.window.close();
  dom = null;
});

describe('wallpaper cache repository', () => {
  it('stores, reads and removes Blob values', async () => {
    const cache = await loadCache(new IDBFactory());
    const blob = new Blob(['fixture'], { type: 'image/png' });

    await expect(cache.put('https://example.test/image.png', blob)).resolves.toBe(true);
    const stored = await cache.get('https://example.test/image.png');
    expect(stored.size).toBe(blob.size);
    await expect(cache.remove('https://example.test/image.png')).resolves.toBe(true);
    await expect(cache.get('https://example.test/image.png')).resolves.toBeNull();
  });

  it('expires remote images while retaining custom wallpaper blobs', async () => {
    let currentTime = 1_000;
    const cache = await loadCache(new IDBFactory(), () => currentTime);
    const blob = new Blob(['fixture']);
    await cache.put('https://example.test/old.jpg', blob);
    await cache.put('custom:1', blob);
    await cache.put('custom_thumb:1', blob);
    currentTime = 10_000;

    await expect(cache.cleanExpired(5_000)).resolves.toBe(1);
    await expect(cache.get('https://example.test/old.jpg')).resolves.toBeNull();
    await expect(cache.get('custom:1')).resolves.not.toBeNull();
    await expect(cache.get('custom_thumb:1')).resolves.not.toBeNull();
  });
});