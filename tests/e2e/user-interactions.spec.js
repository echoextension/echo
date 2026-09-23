import { expect, test } from './fixtures/extension.js';

async function waitForContent(extension, page) {
  await expect.poll(async () => {
    const tab = (await extension.queryTabs()).find(item => item.url === page.url());
    if (!tab) return false;
    // Content-script globals live in the isolated world, not the page world.
    const results = await extension.serviceWorker.evaluate(async tabId => {
      return chrome.scripting.executeScript({
        target: { tabId }, world: 'ISOLATED',
        func: () => typeof window.echoToggleSearchBox === 'function'
      });
    }, tab.id);
    return results[0]?.result === true;
  }).toBe(true);
}

async function openFixture(extension, fixtureServer) {
  await extension.setStorage('sync', { floatingSearchBoxTrending: false });
  const page = extension.anchorPage;
  await page.goto(fixtureServer.url('/fixture/interactions'));
  await page.bringToFront();
  // Wait for real content-script registration without invoking its handlers.
  await waitForContent(extension, page);
  return page;
}

async function dragLink(page) {
  await page.locator('#fixture-link').dragTo(page.locator('#fixture-drop-zone'));
}

test('search shortcut supports dismissal, reload and a single adjacent result tab', async ({ extension, fixtureServer }) => {
  await extension.context.route('https://www.bing.com/search?**', route => route.fulfill({
    contentType: 'text/html', body: '<h1>Search destination</h1>'
  }));
  const page = await openFixture(extension, fixtureServer);
  const search = page.frameLocator('#echo-search-box-host');
  const wrapper = search.locator('.search-wrapper');
  const input = search.locator('.search-input');
  await page.keyboard.press('Control+b');
  await expect(input).toBeFocused();
  await input.fill('discard me');
  await input.press('Escape');
  await expect(wrapper).not.toHaveClass(/show/);
  await page.keyboard.press('Control+b');
  await expect(input).toHaveValue('');
  await input.press('Control+b');
  await expect(wrapper).not.toHaveClass(/show/);
  await page.reload();
  await waitForContent(extension, page);
  await page.keyboard.press('Control+b');
  await expect(input).toBeFocused();
  const query = 'ECHO 空格 & symbols';
  await input.fill(query);
  const resultPromise = extension.context.waitForEvent('page');
  await input.press('Enter');
  const result = await resultPromise;
  await expect(result).toHaveURL(`https://www.bing.com/search?q=${encodeURIComponent(query)}`);
  await expect(result.getByRole('heading')).toHaveText('Search destination');
  await expect(wrapper).not.toHaveClass(/show/);
  await expect.poll(async () => {
    const tabs = await extension.queryTabs();
    const source = tabs.find(tab => tab.url === page.url());
    const matches = tabs.filter(tab => tab.url === result.url());
    return { count: matches.length, active: matches[0]?.active, offset: matches[0]?.index - source?.index };
  }).toEqual({ count: 1, active: true, offset: 1 });
});

for (const selector of ['#fixture-input', '#fixture-textarea', '#fixture-editor']) {
  test(`search shortcut leaves editable focus intact: ${selector}`, async ({ extension, fixtureServer }) => {
    const page = await openFixture(extension, fixtureServer);
    // Prove the shortcut is enabled first, so absence alone cannot pass.
    await page.keyboard.press('Control+b');
    const search = page.frameLocator('#echo-search-box-host');
    await expect(search.locator('.search-input')).toBeFocused();
    await page.keyboard.press('Escape');
    const editor = page.locator(selector);
    await editor.fill('keep this text');
    await editor.press('Control+b');
    await expect(editor).toBeFocused();
    await expect(search.locator('.search-wrapper')).not.toHaveClass(/show/);
    if (selector === '#fixture-editor') await expect(editor).toHaveText('keep this text');
    else await expect(editor).toHaveValue('keep this text');
  });
}

test('real link drag loads a local target in an adjacent background tab', async ({ extension, fixtureServer }) => {
  await extension.setStorage('sync', { superDrag: true, superDragActivate: false });
  const page = await openFixture(extension, fixtureServer);
  const targetUrl = fixtureServer.url('/fixture/target');
  const resultPromise = extension.context.waitForEvent('page');
  await dragLink(page);
  const result = await resultPromise;
  await expect(result).toHaveURL(targetUrl);
  await expect(result.locator('#fixture-ready')).toHaveText('target');
  await expect.poll(async () => {
    const tabs = await extension.queryTabs();
    const source = tabs.find(tab => tab.url === page.url());
    const targets = tabs.filter(tab => tab.url === targetUrl);
    return { count: targets.length, sourceActive: source?.active, targetActive: targets[0]?.active, offset: targets[0]?.index - source?.index };
  }).toEqual({ count: 1, sourceActive: true, targetActive: false, offset: 1 });
});

test('options change persists and propagates to an already open content page', async ({ extension, fixtureServer }) => {
  const page = await openFixture(extension, fixtureServer);
  const options = await extension.openExtensionPage('options/options.html');
  const toggle = options.locator('#superDrag');
  await expect(toggle).toBeChecked();
  // Custom switches hide the native input; use the visible label.
  await options.locator('label').filter({ has: toggle }).click();
  await expect(toggle).not.toBeChecked();
  await expect.poll(async () => (await extension.getStorage('sync', ['superDrag'])).superDrag).toBe(false);
  await options.reload();
  await expect(toggle).not.toBeChecked();
  await page.bringToFront();
  await dragLink(page);
  // Bounded negative observation: a disabled drag must not open a tab.
  await page.waitForTimeout(500);
  expect((await extension.queryTabs()).filter(tab => tab.url === fixtureServer.url('/fixture/target'))).toHaveLength(0);
  await options.bringToFront();
  await options.locator('label').filter({ has: toggle }).click();
  await expect.poll(async () => (await extension.getStorage('sync', ['superDrag'])).superDrag).toBe(true);
  await page.bringToFront();
  const resultPromise = extension.context.waitForEvent('page');
  await dragLink(page);
  await expect(await resultPromise).toHaveURL(fixtureServer.url('/fixture/target'));
});
