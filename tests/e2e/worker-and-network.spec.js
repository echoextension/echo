import { expect, test } from './fixtures/extension.js';

async function stopAllServiceWorkers(extension) {
  const session = await extension.context.newCDPSession(extension.anchorPage);
  try {
    await session.send('ServiceWorker.enable');
    await session.send('ServiceWorker.stopAllWorkers');
  } finally {
    await session.detach();
  }
}

test('recovers message handling after the MV3 worker is stopped', async ({ extension }) => {
  expect(await extension.sendMessage({ action: 'getZoom' })).toMatchObject({ zoom: 1 });

  await stopAllServiceWorkers(extension);

  await expect.poll(async () => {
    try {
      const response = await extension.sendMessage({ action: 'getZoom' });
      return response?.zoom;
    } catch {
      return null;
    }
  }, {
    message: '等待停止后的 MV3 Worker 按需恢复',
    timeout: 15_000
  }).toBe(1);
});

test('adds a scoped Referer rule for an image request and removes it afterwards', async ({
  extension,
  fixtureServer
}, testInfo) => {
  const token = `dnr-${testInfo.workerIndex}-${testInfo.retry}`;
  const imageUrl = fixtureServer.url('/protected-image', token);
  const result = await extension.sendMessage({
    action: 'fetchImageAsDataUrl',
    imageUrl,
    pageUrl: fixtureServer.url('/fixture/referer-source')
  });

  expect(result.dataUrl).toMatch(/^data:image\/png;base64,/);
  const matchingRequests = fixtureServer.requestsFor(token);
  expect(matchingRequests, JSON.stringify(fixtureServer.snapshotRequests(), null, 2)).not.toHaveLength(0);
  expect(matchingRequests.some(request => request.headers.referer === `${fixtureServer.origin}/`),
    JSON.stringify(matchingRequests, null, 2)).toBe(true);
  await expect.poll(() => extension.serviceWorker.evaluate(async () => {
    const rules = await chrome.declarativeNetRequest.getDynamicRules();
    return rules.filter(rule => rule.id >= 90000 && rule.id <= 99999).length;
  })).toBe(0);
});

test('migrates legacy settings through the real installed background worker', async ({ extension }) => {
  await extension.serviceWorker.evaluate(() => chrome.storage.sync.remove('closeTabActivate'));
  await extension.setStorage('sync', {
    activateLeftTab: false,
    bookmarkBarDensity: 'compact',
    mouseGesture: 'invalid',
    sidepanelEnhanced: true
  });

  await extension.serviceWorker.evaluate(() => settingsService.initializeInstalledSettings({
    reason: 'update',
    previousVersion: '1.2.0'
  }));

  const values = await extension.getStorage('sync', [
    'activateLeftTab',
    'bookmarkBarDensity',
    'closeTabActivate',
    'mouseGesture',
    'sidepanelEnhanced'
  ]);
  expect(values.closeTabActivate).toBe('right');
  expect(values.mouseGesture).toBe(true);
  expect(values).not.toHaveProperty('activateLeftTab');
  expect(values).not.toHaveProperty('bookmarkBarDensity');
  expect(values).not.toHaveProperty('sidepanelEnhanced');
});
