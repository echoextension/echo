import { PIXEL_PNG } from './fixtures/local-server.js';
import { expect, test } from './fixtures/extension.js';

const BING_API_PATTERN = /^https:\/\/cn\.bing\.com\/HPImageArchive\.aspx(?:\?|$)/;
const BING_IMAGE_PATTERN = /^https:\/\/cn\.bing\.com\/th\?/;

async function readCachedBingEntries(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('echo_wallpaper_cache', 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction('images', 'readonly');
      const getAll = transaction.objectStore('images').getAll();
      getAll.onerror = () => reject(getAll.error);
      getAll.onsuccess = () => resolve(getAll.result
        .filter(item => item.url?.startsWith('https://cn.bing.com/th?'))
        .map(item => ({ size: item.blob?.size || 0, url: item.url })));
    };
  }));
}

async function waitForWallpaper(page, diagnostics) {
  try {
    await expect(page.locator('#wallpaperBg img')).toBeVisible({ timeout: 15_000 });
  } catch (error) {
    const state = await page.evaluate(() => {
      try {
        return {
          bodyClass: document.body.className,
          current: typeof wallpaperState === 'undefined' ? null : wallpaperState.current,
          historyLength: typeof wallpaperState === 'undefined' ? null : wallpaperState.history.length,
          loading: typeof wallpaperState === 'undefined' ? null : wallpaperState.isWallpaperLoading,
          mode: typeof wallpaperState === 'undefined' ? null : wallpaperState.settings.mode
        };
      } catch (stateError) {
        return { stateError: stateError.message };
      }
    });
    throw new Error(`${error.message}\nNTP state: ${JSON.stringify(state)}\nDiagnostics: ${diagnostics.join('\n')}`);
  }
}

test('restores a wallpaper from IndexedDB while external requests are offline', async ({ extension }) => {
  const { anchorPage, context, extensionUrl } = extension;
  await extension.setStorage('local', {
    echo_ntp_trending: false,
    echo_ntp_wallpaper_v2: { mode: 'daily', blankMode: false, quality: '4k' }
  });
  let imageRequests = 0;
  const diagnostics = [];
  anchorPage.on('console', message => diagnostics.push(`console:${message.type()}:${message.text()}`));
  anchorPage.on('pageerror', error => diagnostics.push(`pageerror:${error.message}`));
  anchorPage.on('requestfailed', request => diagnostics.push(
    `requestfailed:${request.url()}:${request.failure()?.errorText || 'unknown'}`
  ));

  await context.route(BING_API_PATTERN, route => route.fulfill({
    body: JSON.stringify({ images: [] }),
    contentType: 'application/json',
    status: 200
  }));
  await context.route('https://www.echoextension.com/**', route => route.abort('internetdisconnected'));
  await context.route(BING_IMAGE_PATTERN, route => {
    imageRequests += 1;
    return route.fulfill({
      body: PIXEL_PNG,
      headers: { 'Cache-Control': 'no-store' },
      contentType: 'image/png',
      status: 200
    });
  });

  await anchorPage.goto(extensionUrl('ntp/ntp.html'));
  await waitForWallpaper(anchorPage, diagnostics);
  await expect.poll(async () => (await readCachedBingEntries(anchorPage)).length, {
    message: '等待网络壁纸写入 IndexedDB'
  }).toBeGreaterThan(0);
  expect(imageRequests).toBeGreaterThan(0);
  const cached = await readCachedBingEntries(anchorPage);
  expect(cached[0].size).toBeGreaterThan(0);

  await context.unroute(BING_IMAGE_PATTERN);
  await context.setOffline(true);
  const offlinePage = await context.newPage();
  try {
    await offlinePage.goto(extensionUrl('ntp/ntp.html'));
    await waitForWallpaper(offlinePage, diagnostics);
    await expect.poll(async () => (await readCachedBingEntries(offlinePage)).length).toBe(cached.length);
  } finally {
    await context.setOffline(false);
  }
});
