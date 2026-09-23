// @vitest-environment node

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createFakeChrome } from '../helpers/fake-chrome.js';
import { createPortPair } from '../helpers/fake-event.js';
import {
  createScriptDom,
  executeExtensionWindowScript,
  executeWindowScript,
  flushAsyncWork
} from '../helpers/script-harness.js';

let dom;

async function executeOptionsScript(targetDom) {
  await executeWindowScript(targetDom, 'options/modules/backup-controller.js');
  await executeWindowScript(targetDom, 'options/modules/zhihu-sync-controller.js');
  await executeExtensionWindowScript(targetDom, 'options/options.js');
}

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
    await executeOptionsScript(dom);
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

  it('updates a visible feature switch when sync storage changes externally', async () => {
    const chrome = createFakeChrome({ storage: { sync: { mouseGesture: true } } });
    dom = await createScriptDom({
      chrome,
      htmlPath: 'options/options.html',
      url: 'https://extension.test/options/options.html'
    });
    await executeOptionsScript(dom);
    dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
    await flushAsyncWork(20);

    await chrome.storage.sync.set({ mouseGesture: false });
    await flushAsyncWork();

    expect(dom.window.document.getElementById('mouseGesture').checked).toBe(false);
  });

  it('restores the schema default when a visible setting is removed externally', async () => {
    const chrome = createFakeChrome({ storage: { sync: { mouseGesture: false } } });
    dom = await createScriptDom({
      chrome,
      htmlPath: 'options/options.html',
      url: 'https://extension.test/options/options.html'
    });
    await executeOptionsScript(dom);
    dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
    await flushAsyncWork(20);

    await chrome.storage.sync.remove('mouseGesture');
    await flushAsyncWork();

    expect(dom.window.document.getElementById('mouseGesture').checked).toBe(true);
  });

  it('restores a feature switch when sync persistence fails', async () => {
    const chrome = createFakeChrome({ storage: { sync: { mouseGesture: true } } });
    dom = await createScriptDom({
      chrome,
      htmlPath: 'options/options.html',
      url: 'https://extension.test/options/options.html'
    });
    await executeOptionsScript(dom);
    dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
    await flushAsyncWork(20);
    const checkbox = dom.window.document.getElementById('mouseGesture');
    chrome.__testing.failNextStorageSet('sync', new Error('storage unavailable'));

    checkbox.checked = false;
    checkbox.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    await flushAsyncWork(8);

    expect(checkbox.checked).toBe(true);
    await expect(chrome.storage.sync.get('mouseGesture')).resolves.toEqual({ mouseGesture: true });
  });

  it('reconnects the Zhihu options port on the next command after disconnect', async () => {
    const chrome = createFakeChrome({
      storage: { local: { zhihuBlocklistAuthorized: true } }
    });
    const connections = [];
    chrome.runtime.connect = ({ name } = {}) => {
      const [clientPort, serverPort] = createPortPair(name);
      connections.push({ clientPort, serverPort });
      chrome.runtime.onConnect.emit(serverPort);
      return clientPort;
    };
    dom = await createScriptDom({
      chrome,
      htmlPath: 'options/options.html',
      url: 'https://extension.test/options/options.html'
    });
    await executeOptionsScript(dom);
    dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
    await flushAsyncWork(20);
    expect(connections).toHaveLength(1);

    connections[0].serverPort.disconnect();
    dom.window.document.getElementById('zhihuBlocklistSync').click();
    await flushAsyncWork();

    expect(connections).toHaveLength(2);
    expect(connections[1].clientPort.sentMessages).toContainEqual({
      action: 'start',
      mode: 'first'
    });
  });

  it('clears a stale working state when the Zhihu options port disconnects', async () => {
    const chrome = createFakeChrome({ storage: { local: { zhihuBlocklistAuthorized: true } } });
    const connections = [];
    chrome.runtime.connect = ({ name } = {}) => {
      const [clientPort, serverPort] = createPortPair(name);
      connections.push({ clientPort, serverPort });
      chrome.runtime.onConnect.emit(serverPort);
      return clientPort;
    };
    dom = await createScriptDom({
      chrome,
      htmlPath: 'options/options.html',
      url: 'https://extension.test/options/options.html'
    });
    await executeOptionsScript(dom);
    dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
    await flushAsyncWork(20);
    connections[0].serverPort.postMessage({
      type: 'state',
      state: { phase: 'syncing', current: 1, total: 2 }
    });
    await flushAsyncWork();
    expect(dom.window.document.getElementById('zhihuBlocklistSync').textContent).toBe('取消同步');

    connections[0].serverPort.disconnect();
    await flushAsyncWork(8);

    expect(dom.window.document.getElementById('zhihuBlocklistSync').textContent).toBe('同步知乎黑名单');
    expect(dom.window.document.getElementById('zhihuBlocklistFilter').disabled).toBe(false);
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
    await executeOptionsScript(dom);
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
    await executeOptionsScript(dom);
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

  it('restores the visible default when backup rollback removes a newly written setting', async () => {
    const chrome = createFakeChrome();
    dom = await createScriptDom({
      chrome,
      htmlPath: 'options/options.html',
      url: 'https://extension.test/options/options.html'
    });
    await executeOptionsScript(dom);
    dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
    await flushAsyncWork(20);
    chrome.__testing.failNextStorageSet('local', new Error('storage unavailable'));
    const backup = {
      version: '1.4.0',
      exportDate: '2026-09-03',
      wallpaperSettings: { mode: 'off' },
      extensionSettings: { mouseGesture: false }
    };

    await dom.window.handleImportBackup({
      target: { files: [{ text: async () => JSON.stringify(backup) }], value: 'selected' }
    });

    await expect(chrome.storage.sync.get('mouseGesture')).resolves.toEqual({
      mouseGesture: undefined
    });
    expect(dom.window.document.getElementById('mouseGesture').checked).toBe(true);
    expect(dom.window.document.querySelector('.backup-toast').textContent).toContain('导入失败');
  });

  it('does not overwrite a setting changed while backup rollback is pending', async () => {
    const chrome = createFakeChrome({
      storage: { sync: { biliToolPosition: { topRatio: 0.1 } } }
    });
    dom = await createScriptDom({
      chrome,
      htmlPath: 'options/options.html',
      url: 'https://extension.test/options/options.html'
    });
    await executeOptionsScript(dom);
    dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
    await flushAsyncWork(20);
    const originalLocalSet = chrome.storage.local.set.bind(chrome.storage.local);
    let rejectWallpaperWrite;
    let signalWallpaperWrite;
    const wallpaperWriteStarted = new Promise(resolve => { signalWallpaperWrite = resolve; });
    chrome.storage.local.set = items => {
      if (!items.echo_ntp_wallpaper_v2) return originalLocalSet(items);
      signalWallpaperWrite();
      return new Promise((_, reject) => { rejectWallpaperWrite = reject; });
    };
    const backup = {
      version: '1.4.0',
      exportDate: '2026-09-03',
      wallpaperSettings: { mode: 'off' },
      extensionSettings: { biliToolPosition: { topRatio: 0.2 } }
    };

    const importing = dom.window.handleImportBackup({
      target: { files: [{ text: async () => JSON.stringify(backup) }], value: 'selected' }
    });
    await wallpaperWriteStarted;
    await chrome.storage.sync.set({ biliToolPosition: { topRatio: 0.3 } });
    rejectWallpaperWrite(new Error('storage unavailable'));
    await importing;

    await expect(chrome.storage.sync.get('biliToolPosition')).resolves.toEqual({
      biliToolPosition: { topRatio: 0.3 }
    });
  });

  it('renders invalid backup metadata as text instead of HTML', async () => {
    const chrome = createFakeChrome();
    dom = await createScriptDom({
      chrome,
      htmlPath: 'options/options.html',
      url: 'https://extension.test/options/options.html'
    });
    await executeOptionsScript(dom);
    dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
    await flushAsyncWork(20);
    const backup = {
      version: '1.4.0',
      exportDate: '2026-09-03',
      schemaVersion: '<img id="backup-injection">'
    };

    await dom.window.handleImportBackup({
      target: { files: [{ text: async () => JSON.stringify(backup) }], value: 'selected' }
    });

    expect(dom.window.document.getElementById('backup-injection')).toBeNull();
    expect(dom.window.document.querySelector('.backup-toast').textContent)
      .toContain('<img id="backup-injection">');
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