// @vitest-environment node

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createFakeChrome } from '../helpers/fake-chrome.js';
import { createScriptDom, executeWindowScript, flushAsyncWork, responseJson } from '../helpers/script-harness.js';

let dom;

async function loadModules(paths, chrome) {
  dom = await createScriptDom({ chrome });
  await executeWindowScript(dom, 'core/settings.js');
  await executeWindowScript(dom, 'core/messages.js');
  for (const filePath of paths) await executeWindowScript(dom, filePath);
  return dom.window;
}

afterEach(() => {
  dom?.window.close();
  dom = null;
});

describe('background image service', () => {
  it('normalizes the downloaded filename and optional date folder', async () => {
    const chrome = createFakeChrome({
      storage: { sync: { quickSaveImage: true, quickSaveImageDateFolder: false } }
    });
    const window = await loadModules(['background/image-service.js'], chrome);
    const service = window.EchoBackgroundImageService.create(chrome, {
      settingsSchema: window.EchoSettings,
      fetch: vi.fn()
    });

    const result = await service.quickSaveImage(
      'data:image/png;base64,AA==',
      'https://images.example/a%3Ab.jpg?size=large'
    );

    expect(result.success).toBe(true);
    expect(chrome.__testing.records.downloads[0].options).toMatchObject({
      filename: 'ECHO快速保存图片/a_b.png',
      conflictAction: 'uniquify'
    });
  });
});

describe('background network service', () => {
  it('returns structured failure for HTTP errors and limits Bing suggestions', async () => {
    const chrome = createFakeChrome();
    const window = await loadModules(['background/network-service.js'], chrome);
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(responseJson(['query', Array.from({ length: 12 }, (_, index) => `item-${index}`)]));
    const service = window.EchoBackgroundNetworkService.create({ fetch });

    await expect(service.proxyJson('https://top.baidu.com/api/board')).resolves.toEqual({
      success: false,
      error: 'HTTP 503'
    });
    await expect(service.bingSuggest('query')).resolves.toEqual({
      suggestions: Array.from({ length: 8 }, (_, index) => `item-${index}`)
    });
  });
});

describe('background message router demo authorization', () => {
  it('accepts demo tab switching only from the extension FRE pages', async () => {
    const chrome = createFakeChrome();
    const window = await loadModules(['background/message-router.js'], chrome);
    const handleSwitchTab = vi.fn(async () => ({ ok: true }));
    const service = window.EchoBackgroundMessageRouter.create(chrome, {
      messages: window.EchoMessages,
      tabs: { handleSwitchTab, setMouseGestureState() {} },
      images: {},
      network: {},
      biliSession: {}
    });
    service.register();

    chrome.__testing.setRuntimeSender({ url: 'https://example.test/' });
    await expect(chrome.runtime.sendMessage({
      action: 'switchTab', direction: 'right', source: 'demo'
    })).resolves.toEqual({ ok: false, error: 'FRE demo 来源无效' });
    expect(handleSwitchTab).not.toHaveBeenCalled();

    chrome.__testing.setRuntimeSender({
      url: `chrome-extension://${chrome.runtime.id}/fre/fre-step1.html`
    });
    await chrome.runtime.sendMessage({ action: 'switchTab', direction: 'right', source: 'demo' });
    expect(handleSwitchTab).toHaveBeenCalledWith('right', 'demo');
  });
});

describe('Bilibili session service', () => {
  it('injects core contracts before the site module into existing tabs', async () => {
    const biliTab = { id: 7, windowId: 1, index: 0, active: true, url: 'https://www.bilibili.com/' };
    const chrome = createFakeChrome({ tabs: [biliTab], storage: { sync: { biliFeedHistory: true } } });
    const window = await loadModules(['background/bili-session-service.js'], chrome);
    const service = window.EchoBackgroundBiliSessionService.create(chrome, window.EchoSettings);

    await service.ensureInjected();

    expect(chrome.__testing.records.scriptInjections).toEqual([{
      target: { tabId: 7 },
      files: ['core/settings.js', 'core/messages.js', 'bili-feed-history/bili-feed-history.js']
    }]);
  });
});

describe('Zhihu sync service recovery', () => {
  it('closes a stale popup and reports an interrupted task after Worker restart', async () => {
    const chrome = createFakeChrome({
      windows: [{ id: 9, state: 'normal' }],
      storage: {
        session: {
          echoZhihuSyncTaskV1: {
            id: 'stale-task',
            mode: 'manual',
            windowId: 9,
            tabId: 10,
            phase: 'syncing',
            updatedAt: 1
          }
        }
      }
    });
    const window = await loadModules(['background/zhihu-sync-service.js'], chrome);
    const service = window.EchoBackgroundZhihuSyncService.create(chrome, window.EchoMessages.PORTS);

    await service.startupReady;

    expect(chrome.__testing.windowsById.has(9)).toBe(false);
    await expect(chrome.storage.session.get('echoZhihuSyncTaskV1')).resolves.toEqual({
      echoZhihuSyncTaskV1: undefined
    });
    expect(service.getState()).toMatchObject({
      phase: 'failed',
      mode: 'manual',
      message: expect.stringContaining('后台重启')
    });
  });
});