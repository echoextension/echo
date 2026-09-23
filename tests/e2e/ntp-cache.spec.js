import { PIXEL_PNG } from './fixtures/local-server.js';
import { expect, test } from './fixtures/extension.js';

const BING_API_PATTERN = /^https:\/\/cn\.bing\.com\/HPImageArchive\.aspx(?:\?|$)/;
const BING_IMAGE_PATTERN = /^https:\/\/cn\.bing\.com\/th\?/;

for (const pinDuringDownload of [false, true]) {
  test(`shows the cached wallpaper first and ${pinDuringDownload ? 'preserves a new pin' : 'replaces it only after the new image loads'}`, async ({ extension }, testInfo) => {
    const { anchorPage, controlPage, context, extensionUrl } = extension;
    await extension.setStorage('local', {
      echo_ntp_trending: false,
      echo_ntp_wallpaper_v2: { mode: 'daily', blankMode: false, quality: '4k' }
    });
    const cached = { id: 'EchoCached', date: '2099-01-01', desc: 'Cached fixture' };
    await controlPage.evaluate(async ({ cached, bytes }) => {
      localStorage.setItem('echo_bing_api_cache', JSON.stringify({ timestamp: 1, data: [cached] }));
      localStorage.setItem('echo_remote_wallpaper_cache', JSON.stringify({ timestamp: Date.now(), data: [] }));
      await new Promise((resolve, reject) => {
        const request = indexedDB.open('echo_wallpaper_cache', 1);
        request.onerror = () => reject(request.error);
        request.onupgradeneeded = () => request.result.createObjectStore('images', { keyPath: 'url' });
        request.onsuccess = () => {
          const database = request.result;
          const transaction = database.transaction('images', 'readwrite');
          transaction.objectStore('images').put({
            url: `https://cn.bing.com/th?id=OHR.${cached.id}_UHD.jpg&rf=LaDigue_UHD.jpg&pid=hp&w=3840&h=2160&rs=1&c=4`,
            blob: new Blob([new Uint8Array(bytes)], { type: 'image/png' }),
            timestamp: Date.now()
          });
          transaction.oncomplete = () => { database.close(); resolve(); };
          transaction.onerror = () => reject(transaction.error);
        };
      });
    }, { cached, bytes: [...PIXEL_PNG] });
    let releaseApi;
    let releaseImage;
    let imageRequested = false;
    const apiGate = new Promise(resolve => { releaseApi = resolve; });
    const imageGate = new Promise(resolve => { releaseImage = resolve; });
    const pageErrors = [];
    anchorPage.on('pageerror', error => pageErrors.push(error.message));
    await context.route('https://**/*', route => route.abort('internetdisconnected'));
    await context.route(BING_API_PATTERN, async route => {
      await apiGate;
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ images: [{ urlbase: '/th?id=OHR.EchoLatest', enddate: '20990102' }] })
      });
    });
    await context.route(BING_IMAGE_PATTERN, async route => {
      if (!route.request().url().includes('EchoLatest')) return route.abort('internetdisconnected');
      imageRequested = true;
      await imageGate;
      await route.fulfill({ body: PIXEL_PNG, contentType: 'image/png' });
    });

    try {
      await anchorPage.goto(extensionUrl('ntp/ntp.html'));
      const image = anchorPage.locator('#wallpaperBg img');
      await expect(image).toBeVisible();
      await expect(image).toHaveAttribute('alt', cached.desc);
      const cachedSrc = await image.getAttribute('src');
      await anchorPage.screenshot({ path: testInfo.outputPath('cached-first.png') });

      releaseApi();
      await expect.poll(() => imageRequested).toBe(true);
      await expect(image).toHaveAttribute('src', cachedSrc);
      if (pinDuringDownload) {
        await anchorPage.locator('#wpSetWallpaper').click();
        await expect.poll(() => anchorPage.evaluate(() => wallpaperState.settings.pinnedDate)).toBe(cached.date);
      }
      releaseImage();
      await expect.poll(() => anchorPage.evaluate(() => wallpaperState.isWallpaperLoading)).toBe(false);
      await expect.poll(() => anchorPage.evaluate(() => wallpaperState.current?.id))
        .toBe(pinDuringDownload ? cached.id : 'EchoLatest');
      await expect(image).toBeVisible();
      expect(await image.evaluate(element => element.naturalWidth)).toBeGreaterThan(0);
      if (pinDuringDownload) await expect(image).toHaveAttribute('src', cachedSrc);
      else expect(await image.getAttribute('src')).not.toBe(cachedSrc);
      await anchorPage.screenshot({ path: testInfo.outputPath('refresh-finished.png') });
      expect(pageErrors).toEqual([]);
    } finally {
      releaseApi();
      releaseImage();
    }
  });
}

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
