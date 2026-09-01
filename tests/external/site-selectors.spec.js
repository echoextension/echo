import { expect, test } from '@playwright/test';

test('Bilibili public homepage still exposes feed card structures', async ({ page }) => {
  await page.goto('https://www.bilibili.com/', {
    timeout: 45_000,
    waitUntil: 'domcontentloaded'
  });
  await expect.poll(() => page.locator('.feed-card').count(), {
    message: 'Bilibili .feed-card selector did not match the public homepage',
    timeout: 30_000
  }).toBeGreaterThan(0);
  await expect(page.locator('.feed-card .bili-video-card__wrap').first()).toBeAttached();
});

test('Zhihu public hot page still exposes a supported content container', async ({ page }) => {
  await page.goto('https://www.zhihu.com/hot', {
    timeout: 45_000,
    waitUntil: 'domcontentloaded'
  });
  const supported = page.locator('.TopstoryItem,.List-item,.HotItem');
  await expect.poll(() => supported.count(), {
    message: 'Zhihu supported content selectors did not match the public hot page',
    timeout: 30_000
  }).toBeGreaterThan(0);
});
