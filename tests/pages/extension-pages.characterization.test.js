// @vitest-environment node

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createFakeChrome } from '../helpers/fake-chrome.js';
import {
  createScriptDom,
  executeExtensionWindowScript,
  executeWindowScript,
  flushAsyncWork
} from '../helpers/script-harness.js';

let dom;

afterEach(() => {
  dom?.window.close();
  dom = null;
});

describe('options page', () => {
  it('loads current settings and persists a changed feature switch', async () => {
    const chrome = createFakeChrome({
      storage: { sync: { mouseGesture: true, fineZoom: true } },
      commands: [
        { name: 'boss-key', shortcut: 'Ctrl+Q' },
        { name: 'toggle-mute', shortcut: 'Alt+M' }
      ]
    });
    dom = await createScriptDom({
      chrome,
      htmlPath: 'options/options.html',
      url: 'https://extension.test/options/options.html'
    });
    dom.window.confirm = () => true;
    await executeExtensionWindowScript(dom, 'options/options.js');
    dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
    await flushAsyncWork(20);

    const checkbox = dom.window.document.getElementById('mouseGesture');
    expect(checkbox.checked).toBe(true);
    checkbox.checked = false;
    checkbox.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    await flushAsyncWork();

    await expect(chrome.storage.sync.get('mouseGesture')).resolves.toEqual({ mouseGesture: false });
    expect(dom.window.document.getElementById('boss-key-shortcut').textContent).toBe('Ctrl+Q');
  });

  it('merges backup favorites, excludes custom entries and restores settings', async () => {
    const chrome = createFakeChrome({
      storage: {
        sync: {
          mouseGesture: true,
          echo_ntp_wallpaper_favorites: ['2026-08-31']
        }
      }
    });
    dom = await createScriptDom({
      chrome,
      htmlPath: 'options/options.html',
      url: 'https://extension.test/options/options.html'
    });
    await executeExtensionWindowScript(dom, 'options/options.js');
    dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
    await flushAsyncWork(20);
    const backup = {
      version: '1.2.0',
      exportDate: '2026-08-30',
      favorites: ['2026-09-01', 'custom:private'],
      wallpaperSettings: { mode: 'off', quality: '1080p' },
      extensionSettings: { mouseGesture: false }
    };
    const input = { files: [{ text: async () => JSON.stringify(backup) }], value: 'selected' };

    await dom.window.handleImportBackup({ target: input });

    await expect(chrome.storage.sync.get(['mouseGesture', 'echo_ntp_wallpaper_favorites'])).resolves.toEqual({
      mouseGesture: false,
      echo_ntp_wallpaper_favorites: ['2026-08-31', '2026-09-01']
    });
    await expect(chrome.storage.local.get('echo_ntp_wallpaper_v2')).resolves.toEqual({
      echo_ntp_wallpaper_v2: { mode: 'off', quality: '1080p' }
    });
    expect(input.value).toBe('');
  });

  it('rejects an invalid known setting without partially restoring other backup data', async () => {
    const chrome = createFakeChrome({
      storage: {
        sync: {
          mouseGesture: true,
          echo_ntp_wallpaper_favorites: ['2026-08-31']
        }
      }
    });
    dom = await createScriptDom({
      chrome,
      htmlPath: 'options/options.html',
      url: 'https://extension.test/options/options.html'
    });
    await executeExtensionWindowScript(dom, 'options/options.js');
    dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
    await flushAsyncWork(20);
    const backup = {
      version: '1.3.3',
      exportDate: '2026-09-01',
      favorites: ['2026-09-01'],
      wallpaperSettings: { mode: 'off' },
      extensionSettings: { mouseGesture: 'not-a-boolean' }
    };

    await dom.window.handleImportBackup({
      target: { files: [{ text: async () => JSON.stringify(backup) }], value: 'selected' }
    });

    await expect(chrome.storage.sync.get(['mouseGesture', 'echo_ntp_wallpaper_favorites'])).resolves.toEqual({
      mouseGesture: true,
      echo_ntp_wallpaper_favorites: ['2026-08-31']
    });
    await expect(chrome.storage.local.get('echo_ntp_wallpaper_v2')).resolves.toEqual({
      echo_ntp_wallpaper_v2: undefined
    });
    expect(dom.window.document.querySelector('.backup-toast').textContent).toContain('导入失败');
  });
});

describe('first-run experience', () => {
  it('persists its completion marker', async () => {
    const chrome = createFakeChrome();
    dom = await createScriptDom({
      chrome,
      htmlPath: 'fre/fre-step4.html',
      url: 'https://extension.test/fre/fre-step4.html'
    });
    await executeWindowScript(dom, 'fre/fre.js');

    await dom.window.markFRECompleted();

    await expect(chrome.storage.local.get('freCompleted')).resolves.toEqual({ freCompleted: true });
  });
});

describe('documentation viewer', () => {
  it('renders packaged Markdown through the local viewer', async () => {
    const chrome = createFakeChrome();
    const fetch = vi.fn(async () => new Response(
      '# Fixture Title\n\nA **safe** [link](https://example.test).',
      { status: 200, headers: { 'Content-Type': 'text/markdown' } }
    ));
    dom = await createScriptDom({
      chrome,
      htmlPath: 'docs-viewer.html',
      url: 'https://extension.test/docs-viewer.html?file=README.md',
      fetch
    });
    await executeWindowScript(dom, 'docs-viewer.js');
    await flushAsyncWork(8);

    expect(dom.window.document.querySelector('#content h1').textContent).toBe('Fixture Title');
    expect(dom.window.document.querySelector('#content strong').textContent).toBe('safe');
    expect(dom.window.document.querySelector('#content a').href).toBe('https://example.test/');
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('rejects parent-directory traversal without fetching', async () => {
    const chrome = createFakeChrome();
    const fetch = vi.fn();
    dom = await createScriptDom({
      chrome,
      htmlPath: 'docs-viewer.html',
      url: 'https://extension.test/docs-viewer.html?file=../secret.md',
      fetch
    });
    await executeWindowScript(dom, 'docs-viewer.js');

    expect(dom.window.document.getElementById('content').textContent).toContain('无效的文件路径');
    expect(fetch).not.toHaveBeenCalled();
  });
});