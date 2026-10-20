// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFakeChrome } from '../helpers/fake-chrome.js';
import { createScriptDom, executeWindowScript } from '../helpers/script-harness.js';

let dom;
async function setup(storage = {}) {
  const chrome = createFakeChrome({ storage });
  dom = await createScriptDom({ chrome });
  await executeWindowScript(dom, 'core/settings.js');
  await executeWindowScript(dom, 'options/modules/backup-controller.js');
  let exported;
  dom.window.HTMLAnchorElement.prototype.click = vi.fn();
  const controller = dom.window.EchoOptionsBackupController.create({
    chrome, document: dom.window.document, settingsSchema: dom.window.EchoSettings,
    Blob, URL: { createObjectURL(blob) { exported = blob; return 'blob:test'; }, revokeObjectURL() {} },
    requestAnimationFrame() {}, setTimeout() { return 1; }
  });
  return { chrome, controller, getExport: async () => JSON.parse(await exported.text()) };
}
afterEach(() => { dom?.window.close(); dom = null; });

describe('backup output and NTP appearance compatibility', () => {
  it('exports the public settings and favorites without private data from any storage area', async () => {
    const privateData = { accounts: { PRIVATE_MARKER: { records: ['PRIVATE_BLOCKED_USER'] } } };
    const { controller, getExport } = await setup({
      sync: { mouseGesture: true, echo_ntp_wallpaper_favorites: ['2026-10-19', 'custom:private'],
        echoZhihuBlocklistV1: privateData, unknownKey: 'PRIVATE_UNKNOWN', zhihuBlocklistFilter: true },
      local: { echoZhihuBlocklistV1: privateData, zhihuBlocklistAuthorized: true,
        echo_ntp_wallpaper_v2: { mode: 'daily', quality: '4k', showBrand: false } },
      session: { 'echoBiliFeedHistory:1': privateData }
    });
    await controller.handleExportBackup();
    const exported = await getExport();
    expect(exported.extensionSettings).toEqual({ mouseGesture: true });
    expect(exported.favorites).toEqual(['2026-10-19']);
    expect(exported.wallpaperSettings).toEqual({ mode: 'daily', quality: '4k', showBrand: false });
    expect(JSON.stringify(exported)).not.toContain('PRIVATE_');
    expect(exported).toMatchObject({ backupType: 'echo-extension-backup', schemaVersion: 1 });
  });

  it.each([false, true, undefined])('restores showBrand=%s and its first-paint preference from a backup', async value => {
    const { chrome, controller } = await setup();
    dom.window.localStorage.setItem('echo_ntp_show_brand', 'false');
    const wallpaperSettings = { mode: 'daily', ...(value === undefined ? {} : { showBrand: value }) };
    await controller.handleImportBackup({ target: { files: [{ text: async () => JSON.stringify({
      version: '1.4.6', exportDate: '2026-10-20', wallpaperSettings
    }) }], value: 'chosen' } });
    expect((await chrome.storage.local.get('echo_ntp_wallpaper_v2')).echo_ntp_wallpaper_v2).toEqual(wallpaperSettings);
    expect(dom.window.localStorage.getItem('echo_ntp_show_brand')).toBe(String(value !== false));
  });

  it('rejects an invalid brand preference before writing or changing the first-paint mirror', async () => {
    const { chrome, controller } = await setup();
    dom.window.localStorage.setItem('echo_ntp_show_brand', 'false');
    await controller.handleImportBackup({ target: { files: [{ text: async () => JSON.stringify({
      version: '1.4.6', exportDate: '2026-10-20', wallpaperSettings: { mode: 'off', showBrand: 'false' }
    }) }], value: 'chosen' } });
    expect((await chrome.storage.local.get('echo_ntp_wallpaper_v2')).echo_ntp_wallpaper_v2).toBeUndefined();
    expect(dom.window.localStorage.getItem('echo_ntp_show_brand')).toBe('false');
  });
});
