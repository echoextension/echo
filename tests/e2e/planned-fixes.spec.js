import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { expect, test } from './fixtures/extension.js';
import { PIXEL_PNG } from './fixtures/local-server.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('the mobile landing page contains only its introduction, with the desktop CTA retained above the breakpoint', async ({ browser }) => {
  for (const viewport of [{ width: 375, height: 667 }, { width: 390, height: 844 },
    { width: 768, height: 1024 }, { width: 769, height: 900 }, { width: 1440, height: 900 }]) {
    const page = await browser.newPage({ viewport });
    await page.route('https://**/*', route => route.abort('internetdisconnected'));
    await page.goto(pathToFileURL(path.join(root, 'website/index.html')).href);
    if (viewport.width <= 768) {
      await expect(page.locator('.mobile-hint')).toBeVisible();
      await expect(page.locator('.cta-section')).toBeHidden();
      await expect(page.locator('.site-footer')).toBeHidden();
      expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(viewport.height);
      await expect(page.locator('.mobile-hint .mh-links a')).toHaveCount(2);
    } else {
      await expect(page.locator('.mobile-hint')).toBeHidden();
      await expect(page.locator('.cta-section')).toBeVisible();
      await expect(page.locator('main')).toBeVisible();
    }
    await page.close();
  }
});

for (const order of ['ordered', 'newest']) {
  test(`preserves ${order} browser-created opener tabs after a real worker restart`, async ({ extension, fixtureServer }) => {
    const { anchorPage, controlPage, context } = extension;
    await extension.setStorage('sync', { newTabOrder: order, newTabPosition: 'afterCurrent', floatingSearchBox: false });
    await anchorPage.goto(fixtureServer.url('/fixture/cold-base'));
    await anchorPage.bringToFront();
    const base = await controlPage.evaluate(async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0]);
    const session = await context.newCDPSession(anchorPage);
    await session.send('ServiceWorker.enable');
    await session.send('ServiceWorker.stopAllWorkers');
    await session.detach();
    const children = await controlPage.evaluate(async ({ openerTabId, origin }) => {
      const tabs = [];
      for (const name of ['first', 'second', 'third']) {
        tabs.push(await chrome.tabs.create({ url: `${origin}/fixture/cold-${name}`, active: false, openerTabId }));
      }
      return tabs.map(tab => tab.id);
    }, { openerTabId: base.id, origin: fixtureServer.origin });
    const expected = [base.id, ...(order === 'ordered' ? children : [...children].reverse())];
    await expect.poll(() => controlPage.evaluate(async ids => (await chrome.tabs.query({ currentWindow: true }))
      .filter(tab => ids.includes(tab.id)).sort((a, b) => a.index - b.index).map(tab => tab.id), expected))
      .toEqual(expected);
  });
}

test('external titles remain data in the real floating-search iframe and search the complete title', async ({ extension, fixtureServer }) => {
  const title = '他说"你好" <img src=x onerror=alert(1)> " onmouseover="globalThis.unexpected=true';
  await extension.setStorage('sync', { floatingSearchBox: true, floatingSearchBoxTrending: true, floatingSearchBoxAlwaysShow: true });
  await extension.context.route('https://www.toutiao.com/hot-event/hot-board/**', route => route.fulfill({
    contentType: 'application/json', body: JSON.stringify({ data: [{ Title: title }, { Title: 'Second' }] })
  }));
  await extension.context.route('https://www.bing.com/search?**', route => route.fulfill({ contentType: 'text/html', body: '<h1>Results</h1>' }));
  await extension.anchorPage.goto(fixtureServer.url('/fixture/trending-title'));
  const frame = extension.anchorPage.frameLocator('#echo-search-box-host');
  const word = frame.locator('.trending-word.active');
  await expect(word).toHaveText(title);
  await expect(word).toHaveAttribute('data-query', title);
  await expect(word).toHaveAttribute('title', title);
  expect(await word.evaluate(el => el.getAttributeNames().sort())).toEqual(['class', 'data-offset', 'data-query', 'title']);
  await expect(frame.locator('.trending-scroll-track img')).toHaveCount(0);
  const created = extension.context.waitForEvent('page');
  await word.click();
  const result = await created;
  await result.waitForURL('https://www.bing.com/search?**');
  expect(new URL(result.url()).searchParams.get('q')).toBe(title);
});

test('the NTP-only branding preference persists, applies before async settings, and respects blank mode', async ({ extension }, testInfo) => {
  const { context } = extension;
  await context.route('https://**/*', route => route.abort('internetdisconnected'));
  await extension.setStorage('local', { echo_ntp_trending: false, echo_ntp_wallpaper_v2: { mode: 'off', blankMode: false } });
  const page = await extension.openExtensionPage('ntp/ntp.html');
  await expect(page.locator('#trendingSection')).toBeHidden();
  const viewports = [{ width: 1920, height: 1080 }, { width: 1440, height: 900 },
    { width: 1280, height: 720 }, { width: 1024, height: 768 }];
  const searchLayout = () => page.locator('.search-form').evaluate(element => {
    const form = element.getBoundingClientRect();
    const box = element.querySelector('.search-box').getBoundingClientRect();
    return { x: form.x, y: form.y, width: form.width, boxWidth: box.width };
  });
  const originalLayouts = [];
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    originalLayouts.push(await searchLayout());
  }
  await expect(page.locator('.brand')).toBeVisible();
  await page.locator('#wpSettingsBtn').click();
  const brand = page.locator('#showBrandSwitch');
  await expect(brand).toBeChecked();
  await page.locator('label').filter({ has: brand }).click();
  await expect(page.locator('.brand')).toBeHidden();
  await expect(page.locator('#searchInput')).toBeVisible();
  for (const [index, viewport] of viewports.entries()) {
    await page.setViewportSize(viewport);
    expect(await searchLayout()).toEqual(originalLayouts[index]);
  }
  await expect.poll(() => extension.getStorage('local', 'echo_ntp_wallpaper_v2').then(r => r.echo_ntp_wallpaper_v2.showBrand)).toBe(false);
  await expect.poll(() => page.evaluate(() => localStorage.getItem('echo_ntp_show_brand'))).toBe('false');
  await page.addInitScript(() => {
    if (!location.pathname.endsWith('/ntp/ntp.html')) return;
    const get = chrome.storage.local.get.bind(chrome.storage.local);
    const gate = new Promise(resolve => { window.releaseSettings = resolve; });
    chrome.storage.local.get = async keys => {
      if (Array.isArray(keys) && keys.includes('echo_ntp_wallpaper_v2')) await gate;
      return get(keys);
    };
  });
  await page.reload();
  await expect(page.locator('.brand')).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.classList.contains('brand-hidden'))).toBe(true);
  await page.evaluate(() => window.releaseSettings());
  await expect(brand).not.toBeChecked();
  for (const [index, viewport] of viewports.entries()) {
    await page.setViewportSize(viewport);
    expect(await searchLayout()).toEqual(originalLayouts[index]);
  }
  await page.screenshot({ path: testInfo.outputPath('brand-hidden.png') });
  await page.locator('#wpSettingsBtn').click();
  const blank = page.locator('#blankModeSwitch');
  await page.locator('label').filter({ has: blank }).click();
  await expect(page.locator('#searchInput')).toBeHidden();
  await expect(brand).toBeDisabled();
  await page.locator('label').filter({ has: blank }).click();
  await expect(page.locator('#searchInput')).toBeVisible();
  await expect(page.locator('.brand')).toBeHidden();
  await expect(brand).not.toBeChecked();
  const trending = page.locator('#trendingSwitch');
  await page.locator('label').filter({ has: trending }).click();
  await expect(page.locator('#trendingSection')).toBeVisible();
  await expect(page.locator('body')).not.toHaveClass(/trending-transitioning/);
  await expect.poll(async () => {
    const searchRect = await page.locator('.search-box').boundingBox();
    const trendingRect = await page.locator('#trendingSection').boundingBox();
    return trendingRect.y - searchRect.y - searchRect.height;
  }).toBeGreaterThan(0);
  const trendingLayouts = [];
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    trendingLayouts.push(await searchLayout());
  }
  await page.screenshot({ path: testInfo.outputPath('brand-hidden-trending.png') });
  await page.locator('label').filter({ has: brand }).click();
  await expect(page.locator('.brand')).toBeVisible();
  await expect(brand).toBeChecked();
  await expect(page.locator('#searchInput')).toBeVisible();
  for (const [index, viewport] of viewports.entries()) {
    await page.setViewportSize(viewport);
    expect(await searchLayout()).toEqual(trendingLayouts[index]);
  }
});

test('production collection playback buttons retain their complete pin and unlock chain', async ({ extension }) => {
  await extension.context.route('https://**/*', route => route.abort('internetdisconnected'));
  await extension.context.route('https://cn.bing.com/th?**', route => route.fulfill({ contentType: 'image/png', body: PIXEL_PNG }));
  await extension.setStorage('local', { echo_ntp_trending: false,
    echo_ntp_wallpaper_v2: { mode: 'collection', blankMode: false } });
  await extension.setStorage('sync', { echo_ntp_wallpaper_favorites: ['2026-09-23'] });
  const page = await extension.openExtensionPage('ntp/ntp.html');
  await expect(page.locator('#wallpaperBg img')).toBeVisible();
  await page.locator('#wpSettingsBtn').click();
  await expect(page.locator('#playModeRandomBtn')).toHaveClass(/active/);
  await expect(page.locator('#playModeSelector')).toHaveClass(/visible/);
  await page.locator('#playModeFixedBtn').click();
  await expect(page.locator('#lockedStatusCard')).toHaveClass(/visible/);
  await expect(page.locator('#playModeFixedBtn')).toHaveClass(/active/);
  await expect.poll(() => page.evaluate(() => wallpaperState.settings.pinnedDate)).toBe('2026-09-23');
  await page.locator('#lockedStatusUnlock').click();
  await expect(page.locator('#playModeRandomBtn')).toHaveClass(/active/);
  await expect(page.locator('#playModeSelector')).toHaveClass(/visible/);
  await expect.poll(() => page.evaluate(() => wallpaperState.settings.pinnedDate)).toBeNull();
});
