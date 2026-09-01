import { expect, test } from './fixtures/extension.js';

async function activeTabUrl(extension) {
  return (await extension.queryTabs()).find(tab => tab.active)?.url;
}

async function tabForUrl(extension, url) {
  return (await extension.queryTabs()).find(tab => tab.url === url);
}

test('injects the content script and carries an F3 command to the background worker', async ({
  extension,
  fixtureServer
}, testInfo) => {
  const firstUrl = fixtureServer.url('/fixture/content-first', `${testInfo.testId}-first`);
  const secondUrl = fixtureServer.url('/fixture/content-second', `${testInfo.testId}-second`);
  await extension.anchorPage.goto(firstUrl);
  const secondPage = await extension.context.newPage();
  await secondPage.goto(secondUrl);

  await expect.poll(() => tabForUrl(extension, firstUrl)).not.toBeUndefined();
  const firstTab = await tabForUrl(extension, firstUrl);
  let response = null;
  await expect.poll(async () => {
    try {
      response = await extension.serviceWorker.evaluate(
        ({ tabId }) => chrome.tabs.sendMessage(tabId, {
          action: 'syncMouseGestureState',
          isRightMouseDown: true
        }),
        { tabId: firstTab.id }
      );
      return response?.ok;
    } catch {
      return false;
    }
  }, { message: '等待内容脚本消息接收器就绪' }).toBe(true);
  expect(response).toEqual({ ok: true });

  await extension.anchorPage.bringToFront();
  await expect.poll(() => activeTabUrl(extension)).toBe(firstUrl);
  await extension.anchorPage.keyboard.press('F3');
  await expect.poll(() => activeTabUrl(extension)).toBe(secondUrl);
});

test('creates ordered adjacent tabs, tracks a move, and activates the left tab on close', async ({
  extension,
  fixtureServer
}, testInfo) => {
  const baseUrl = fixtureServer.url('/fixture/tab-base', `${testInfo.testId}-base`);
  const firstUrl = fixtureServer.url('/fixture/tab-first', `${testInfo.testId}-first`);
  const secondUrl = fixtureServer.url('/fixture/tab-second', `${testInfo.testId}-second`);
  const thirdUrl = fixtureServer.url('/fixture/tab-third', `${testInfo.testId}-third`);
  await extension.setStorage('sync', {
    closeTabActivate: 'left',
    newTabOrder: 'ordered',
    newTabPosition: 'afterCurrent',
    superDragActivate: false
  });
  await extension.anchorPage.goto(baseUrl);
  await extension.anchorPage.bringToFront();
  await expect.poll(() => activeTabUrl(extension)).toBe(baseUrl);

  for (const url of [firstUrl, secondUrl, thirdUrl]) {
    await extension.sendMessage({ action: 'openInNewTab', url, active: false });
  }

  await expect.poll(async () => {
    const tabs = await extension.queryTabs();
    return [firstUrl, secondUrl, thirdUrl].every(url => tabs.some(tab => tab.url === url));
  }).toBe(true);
  let tabs = await extension.queryTabs();
  const base = tabs.find(tab => tab.url === baseUrl);
  const orderedUrls = tabs
    .filter(tab => [baseUrl, firstUrl, secondUrl, thirdUrl].includes(tab.url))
    .sort((left, right) => left.index - right.index)
    .map(tab => tab.url);
  expect(orderedUrls, JSON.stringify(tabs, null, 2)).toEqual([
    baseUrl,
    firstUrl,
    secondUrl,
    thirdUrl
  ]);
  expect(tabs.find(tab => tab.url === firstUrl)?.index, JSON.stringify(tabs, null, 2))
    .toBe(base.index + 1);

  const third = tabs.find(tab => tab.url === thirdUrl);
  await extension.serviceWorker.evaluate(
    ({ id, index }) => chrome.tabs.move(id, { index }),
    { id: third.id, index: base.index + 1 }
  );
  await expect.poll(async () => (await tabForUrl(extension, thirdUrl))?.index).toBe(base.index + 1);

  await extension.serviceWorker.evaluate(id => chrome.tabs.update(id, { active: true }), third.id);
  await expect.poll(() => activeTabUrl(extension)).toBe(thirdUrl);
  await extension.serviceWorker.evaluate(id => chrome.tabs.remove(id), third.id);
  await expect.poll(() => activeTabUrl(extension)).toBe(baseUrl);
});
