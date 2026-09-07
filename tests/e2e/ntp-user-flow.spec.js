import { expect, test } from './fixtures/extension.js';

test('blank mode can be enabled, persisted and reversed through visible settings', async ({ extension }) => {
  await extension.context.route('https://**/*', route => route.abort('internetdisconnected'));
  await extension.setStorage('local', {
    echo_ntp_trending: false,
    echo_ntp_wallpaper_v2: { mode: 'off', blankMode: false }
  });
  const page = await extension.openExtensionPage('ntp/ntp.html');
  const toggle = page.locator('#blankModeSwitch');
  const label = page.locator('label').filter({ has: toggle });
  await expect(page.locator('#searchInput')).toBeVisible();
  await page.locator('#wpSettingsBtn').click();
  await expect(page.locator('#settingsPanel')).toBeVisible();
  await label.click();
  await expect(toggle).toBeChecked();
  await expect(page.locator('#searchInput')).toBeHidden();
  await expect(page.locator('#blankModeNotice')).toBeVisible();
  await expect.poll(async () => (await extension.getStorage('local', ['echo_ntp_wallpaper_v2'])).echo_ntp_wallpaper_v2.blankMode).toBe(true);
  await page.reload();
  await expect(page.locator('#searchInput')).toBeHidden();
  await page.locator('#wpSettingsBtn').click();
  await expect(toggle).toBeChecked();
  await label.click();
  await expect(toggle).not.toBeChecked();
  await expect(page.locator('#searchInput')).toBeVisible();
  await expect.poll(async () => (await extension.getStorage('local', ['echo_ntp_wallpaper_v2'])).echo_ntp_wallpaper_v2.blankMode).toBe(false);
  await page.reload();
  await expect(page.locator('#searchInput')).toBeVisible();
});
