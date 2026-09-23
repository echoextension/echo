import { readFile } from 'node:fs/promises';
import { expect, test } from './fixtures/extension.js';
import { PIXEL_PNG } from './fixtures/local-server.js';

// Only the external site is doubled. Injection, worker and storage remain real.
async function installFeedSite(context) {
  const source = await readFile(new URL('../fixtures/bili/feed.html', import.meta.url), 'utf8');
  const script = '<script>(' + (() => {
    let batch = 0;
    const template = document.querySelector('.recommended-container_floor-aside').innerHTML;
    document.querySelector('.roll-btn').addEventListener('click', () => {
      batch += 1;
      document.querySelector('.recommended-container_floor-aside').innerHTML =
        template.replaceAll('Fixture A', 'Batch ' + batch)
          .replaceAll('BV1fixtureA', 'BV1batch' + batch);
    });
  }).toString() + ')();</script>';
  const style = '<style>.feed-card{width:400px;min-height:200px}.bili-video-card__wrap{min-height:180px}img{width:160px;height:90px}</style>';
  await context.route('https://www.bilibili.com/**', route => route.fulfill({
    contentType: 'text/html; charset=utf-8', body: source.replace('</head>', style + '</head>').replace('</body>', script + '</body>')
  }));
  await context.route('https://i.example/**', route => route.fulfill({ contentType: 'image/png', body: PIXEL_PNG }));
}

test('injected feed history restores content across back, forward and reload and isolates tabs', async ({ extension }) => {
  await installFeedSite(extension.context);
  await extension.setStorage('sync', { biliFeedHistory: true });
  const page = extension.anchorPage;
  await page.goto('https://www.bilibili.com/');
  const nav = page.locator('.echo-bili-feed-navigation');
  const previous = page.getByRole('button', { name: '上一批推荐' });
  const next = page.getByRole('button', { name: '下一批推荐' });
  const history = page.locator('.echo-bili-feed-overlay');
  await expect(nav).toHaveAttribute('data-initial-state', 'complete');
  await expect(nav).toHaveAttribute('data-batch-count', '1');
  await expect(previous).toBeDisabled();
  await page.getByRole('button', { name: '换一换', exact: true }).click();
  await expect(nav).toHaveAttribute('data-batch-count', '2');
  await expect(page.locator('.feed-card').first()).toContainText('Batch 1');
  await previous.click();
  await expect(history.getByRole('heading', { name: 'Fixture A', exact: true })).toBeVisible();
  await expect(history).toContainText('Author A');
  await expect(history).toContainText('03:21');
  await expect(history).toContainText('1万');
  await expect(history.locator('a').first()).toHaveAttribute('href', 'https://www.bilibili.com/video/BV1fixtureA');
  await expect(previous).toBeDisabled();
  await next.click();
  await expect(history).toHaveCount(0);
  await expect(next).toBeDisabled();
  await expect(page.locator('.feed-card').first()).toContainText('Batch 1');
  const tab = (await extension.queryTabs()).find(item => item.url === page.url());
  const sessionKey = 'echoBiliFeedHistory:' + tab.id;
  // The UI updates before its debounced session save. Wait for durability
  // before testing reload, rather than accidentally testing an interrupted save.
  await expect.poll(async () => {
    const saved = (await extension.getStorage('session', [sessionKey]))[sessionKey];
    return { count: saved?.batches.length, index: saved?.currentIndex };
  }).toEqual({ count: 2, index: 1 });
  // Reload supplies the initial page again; history must survive page memory.
  await page.reload();
  await expect(nav).toHaveAttribute('data-initial-state', 'complete');
  await expect(nav).toHaveAttribute('data-batch-count', '3');
  await previous.click();
  await expect(history.getByRole('heading', { name: 'Batch 1', exact: true })).toBeVisible();
  await previous.click();
  await expect(history.getByRole('heading', { name: 'Fixture A', exact: true })).toBeVisible();
  const other = await extension.context.newPage();
  await other.goto('https://www.bilibili.com/');
  await expect(other.locator('.echo-bili-feed-navigation')).toHaveAttribute('data-initial-state', 'complete');
  await expect(other.locator('.echo-bili-feed-navigation')).toHaveAttribute('data-batch-count', '1');
  await expect(other.getByRole('button', { name: '上一批推荐' })).toBeDisabled();
});
