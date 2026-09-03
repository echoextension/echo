import { expect, test } from '@playwright/test';

function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

test('Bing wallpaper API retains its public image schema', async ({ request }) => {
  const response = await request.get(
    'https://cn.bing.com/HPImageArchive.aspx?format=js&idx=0&n=8&mkt=zh-CN',
    { timeout: 30_000 }
  );
  expect(response.ok()).toBe(true);
  const body = await response.json();
  expect(Array.isArray(body.images)).toBe(true);
  expect(body.images.length).toBeGreaterThan(0);
  for (const image of body.images) {
    expect(typeof image.urlbase).toBe('string');
    expect(image.urlbase).toContain('/th?id=OHR.');
    expect(image.enddate).toMatch(/^\d{8}$/);
  }
});

test('remote wallpaper history retains the packaged wallpaper schema', async ({ request }) => {
  const response = await request.get('https://www.echoextension.com/wallpaper-data.json', {
    timeout: 30_000
  });
  expect(response.ok()).toBe(true);
  const body = await response.json();
  expect(Array.isArray(body)).toBe(true);
  expect(body.length).toBeGreaterThan(100);
  for (const wallpaper of body) {
    expect(typeof wallpaper.id).toBe('string');
    expect(validDate(wallpaper.date)).toBe(true);
    expect(typeof wallpaper.desc).toBe('string');
    expect(typeof wallpaper.copyright).toBe('string');
  }
});

test('Baidu realtime board retains the data path consumed by NTP', async ({ request }) => {
  const response = await request.get('https://top.baidu.com/api/board?platform=wise&tab=realtime', {
    headers: { Accept: 'application/json' },
    timeout: 30_000
  });
  expect(response.ok()).toBe(true);
  const body = await response.json();
  expect(body?.success).toBe(true);
  const items = body?.data?.cards?.[0]?.content?.[0]?.content;
  expect(Array.isArray(items)).toBe(true);
  expect(items.length).toBeGreaterThanOrEqual(20);
  expect(items.some(item => typeof (item.word || item.title) === 'string')).toBe(true);
});

test('Toutiao hot board remains a JSON list', async ({ request }) => {
  const response = await request.get('https://www.toutiao.com/hot-event/hot-board/?origin=toutiao_pc', {
    headers: { Accept: 'application/json' },
    timeout: 30_000
  });
  expect(response.ok()).toBe(true);
  const body = await response.json();
  expect(Array.isArray(body?.data)).toBe(true);
  expect(body.data.length).toBeGreaterThan(0);
  expect(body.data.some(item => typeof item.Title === 'string')).toBe(true);
});
