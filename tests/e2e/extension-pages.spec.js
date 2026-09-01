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
