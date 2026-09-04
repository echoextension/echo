import { expect, test } from './fixtures/extension.js';

test('loads the unpacked extension worker and primary extension pages', async ({ extension }) => {
  const { anchorPage, context, extensionId, extensionUrl, serviceWorker } = extension;
  const pageErrors = [];
  context.on('page', page => page.on('pageerror', error => pageErrors.push(error.message)));
  anchorPage.on('pageerror', error => pageErrors.push(error.message));

  await context.route('https://cn.bing.com/**', route => route.abort('internetdisconnected'));
  await context.route('https://www.echoextension.com/**', route => route.abort('internetdisconnected'));
  await extension.setStorage('local', {
    echo_ntp_trending: false,
    echo_ntp_wallpaper_v2: { mode: 'off', blankMode: false }
  });

  expect(serviceWorker.url()).toBe(extensionUrl('background.js'));
  expect(extensionId).toMatch(/^[a-p]{32}$/);

  await anchorPage.goto(extensionUrl('ntp/ntp.html'));
  await expect(anchorPage).toHaveTitle('ECHO 易可 - 新标签页');
  await expect(anchorPage.locator('#searchInput')).toBeVisible();

  const optionsPage = await extension.openExtensionPage('options/options.html');
  await expect(optionsPage).toHaveTitle('ECHO 易可 - 设置');
  await expect(optionsPage.locator('#superDrag')).toBeChecked();

  const frePage = await extension.openExtensionPage('fre/fre-step1.html');
  await expect(frePage).toHaveTitle('欢迎使用 ECHO 易可');
  await expect(frePage.locator('#startBtn')).toBeVisible();

  const docsPage = await extension.openExtensionPage('docs-viewer.html?file=PRIVACY_POLICY.md');
  await expect(docsPage.locator('#content.md-body h1').first()).toBeVisible();
  await expect(docsPage).toHaveTitle(/ECHO - .+/);

  expect(pageErrors).toEqual([]);
});

test('keeps NTP suggestions complete in a short viewport with manual zoom', async ({ extension }) => {
  const { anchorPage, context, extensionUrl } = extension;
  const suggestions = Array.from({ length: 8 }, (_, index) => `suggestion ${index + 1}`);

  await anchorPage.setViewportSize({ width: 1400, height: 768 });
  await context.route('https://api.bing.com/osjson.aspx?**', route => {
    route.fulfill({ json: ['query', suggestions] });
  });
  await extension.setStorage('local', {
    echo_ntp_trending: false,
    echo_ntp_zoom: 0.75,
    echo_ntp_wallpaper_v2: { mode: 'off', blankMode: false }
  });

  await anchorPage.goto(extensionUrl('ntp/ntp.html'));
  await anchorPage.locator('#searchInput').fill('query');
  await expect(anchorPage.locator('.search-suggest-item')).toHaveCount(8);

  const layout = await anchorPage.evaluate(() => {
    const lastSuggestion = document.querySelector('.search-suggest-item:last-child');
    const suggestionList = document.querySelector('.search-suggest');
    return {
      documentScrollHeight: document.documentElement.scrollHeight,
      lastBottom: lastSuggestion.getBoundingClientRect().bottom,
      listBottom: suggestionList.getBoundingClientRect().bottom,
      viewportHeight: window.visualViewport?.height || window.innerHeight
    };
  });

  expect(layout.documentScrollHeight).toBeLessThanOrEqual(layout.viewportHeight);
  expect(layout.listBottom).toBeLessThanOrEqual(layout.viewportHeight - 8);
  expect(layout.lastBottom).toBeLessThanOrEqual(layout.viewportHeight - 8);
});

test('keeps the NTP settings panel inside a short viewport', async ({ extension }) => {
  const { anchorPage, extensionUrl } = extension;

  await anchorPage.setViewportSize({ width: 1400, height: 768 });
  await extension.setStorage('local', {
    echo_ntp_trending: false,
    echo_ntp_wallpaper_v2: { mode: 'off', blankMode: false }
  });
  await anchorPage.goto(extensionUrl('ntp/ntp.html'));
  await anchorPage.evaluate(() => {
    document.getElementById('settingsPanel').classList.add('visible');
    document.getElementById('wallpaperSubSettings').classList.remove('hidden');
  });

  const panel = anchorPage.locator('#settingsPanel');
  const body = anchorPage.locator('.settings-body');
  await expect(panel).toBeVisible();
  const layout = await anchorPage.evaluate(() => {
    const panelElement = document.getElementById('settingsPanel');
    const bodyElement = panelElement.querySelector('.settings-body');
    const viewportHeight = window.visualViewport?.height || window.innerHeight;
    return {
      bodyClientHeight: bodyElement.clientHeight,
      bodyScrollHeight: bodyElement.scrollHeight,
      pageOverflowY: getComputedStyle(document.body).overflowY,
      panelBottom: panelElement.getBoundingClientRect().bottom,
      viewportHeight
    };
  });

  expect(layout.pageOverflowY).toBe('hidden');
  expect(layout.panelBottom).toBeLessThanOrEqual(layout.viewportHeight - 8);
  expect(layout.bodyScrollHeight).toBeGreaterThan(layout.bodyClientHeight);
  await body.evaluate(element => { element.scrollTop = element.scrollHeight; });
  await expect(anchorPage.locator('#echoSettingsBtn')).toBeInViewport();
});

test('keeps FRE keyboard demonstrations enabled when user input settings are disabled', async ({
  extension,
  fixtureServer
}, testInfo) => {
  const token = encodeURIComponent(testInfo.testId);
  await extension.setStorage('sync', {
    fineZoom: false,
    fineZoomLargeStep: false,
    mouseGesture: false,
    superDrag: false,
    tabSwitchKey: false
  });
  await extension.controlPage.close();

  await extension.anchorPage.goto(fixtureServer.url('/fixture/fre-target', token));
  const frePage = await extension.openExtensionPage('fre/fre-step1.html');
  await frePage.bringToFront();
  await expect.poll(async () => {
    const active = (await extension.queryTabs()).find(tab => tab.active);
    return active?.url;
  }).toBe(frePage.url());

  await frePage.keyboard.press('F2');

  await expect.poll(async () => {
    const active = (await extension.queryTabs()).find(tab => tab.active);
    return active?.url;
  }).toBe(extension.anchorPage.url());
});
