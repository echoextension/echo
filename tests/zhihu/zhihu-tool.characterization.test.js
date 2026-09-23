// @vitest-environment node

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createFakeChrome } from '../helpers/fake-chrome.js';
import {
  createScriptDom,
  executeExtensionWindowScript,
  flushAsyncWork,
  readFixture,
  responseJson
} from '../helpers/script-harness.js';

let dom;

function validSnapshot(records = [{ id: 'blocked-id', urlToken: 'blocked-token' }]) {
  return {
    schemaVersion: 1,
    activeAccountId: 'viewer-id',
    accounts: {
      'viewer-id': {
        accountId: 'viewer-id',
        syncedAt: 1_800_000_000_000,
        total: records.length,
        records
      }
    }
  };
}

async function loadZhihu({ enabled = true, url = 'https://www.zhihu.com/', fetch } = {}) {
  const chrome = createFakeChrome({
    storage: {
      local: {
        zhihuBlocklistFilter: enabled,
        echoZhihuBlocklistV1: validSnapshot()
      }
    }
  });
  dom = await createScriptDom({
    chrome,
    html: await readFixture('zhihu/content.html'),
    url,
    fetch: fetch || vi.fn(async (requestUrl) => {
      if (String(requestUrl).includes('/api/v4/me')) return responseJson({ id: 'viewer-id' });
      throw new Error(`Unexpected request: ${requestUrl}`);
    })
  });
  await executeExtensionWindowScript(dom, 'zhihu-tool/zhihu-tool.js');
  await flushAsyncWork(8);
  return { chrome, window: dom.window };
}

afterEach(() => {
  dom?.window.close();
  dom = null;
});

describe('Zhihu content filtering', () => {
  it('hides matched cards and comments while failing open for allowed or ambiguous authors', async () => {
    const { window } = await loadZhihu();
    const { document } = window;

    expect(document.getElementById('blocked-card').style.display).toBe('none');
    expect(document.getElementById('blocked-comment').style.display).toBe('none');
    expect(document.getElementById('allowed-card').style.display).not.toBe('none');
    expect(document.getElementById('allowed-comment').style.display).not.toBe('none');
    expect(document.getElementById('ambiguous-comment').style.display).not.toBe('none');
    expect(document.querySelectorAll('.echo-zhihu-blocked-placeholder')).toHaveLength(2);
  });

  it('restores hidden content and removes placeholders when disabled', async () => {
    const { chrome, window } = await loadZhihu();

    await chrome.storage.local.set({ zhihuBlocklistFilter: false });
    await flushAsyncWork();

    expect(window.document.getElementById('blocked-card').style.display).toBe('');
    expect(window.document.getElementById('blocked-comment').style.display).toBe('');
    expect(window.document.querySelectorAll('.echo-zhihu-blocked-placeholder')).toHaveLength(0);
  });

  it('does not filter the search results route', async () => {
    const { window } = await loadZhihu({ url: 'https://www.zhihu.com/search?q=fixture' });

    expect(window.document.getElementById('blocked-card').style.display).toBe('');
    expect(window.document.querySelectorAll('.echo-zhihu-blocked-placeholder')).toHaveLength(0);
  });
});

describe('Zhihu blocklist synchronization', () => {
  it('commits a complete account snapshot and reports completion', async () => {
    const fetch = vi.fn(async (requestUrl) => {
      const url = String(requestUrl);
      if (url.includes('/api/v4/me')) return responseJson({ id: 'viewer-id' });
      if (url.includes('/api/v3/settings/blocked_users')) {
        return responseJson({
          data: [{ id: 'new-blocked-id', url_token: 'new-blocked-token' }],
          paging: { is_end: true, totals: 1 }
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    const { chrome } = await loadZhihu({ enabled: false, fetch });
    const clientPort = chrome.runtime.connect({ name: 'echo-zhihu-blocklist-worker' });
    const messages = [];
    clientPort.onMessage.addListener((message) => messages.push(message));

    clientPort.postMessage({ action: 'start', taskId: 'test-task' });
    await flushAsyncWork(12);

    const stored = await chrome.storage.local.get('echoZhihuBlocklistV1');
    expect(stored.echoZhihuBlocklistV1.accounts['viewer-id']).toMatchObject({
      accountId: 'viewer-id',
      total: 1,
      records: [{ id: 'new-blocked-id', urlToken: 'new-blocked-token' }]
    });
    expect(messages.some((message) => message.type === 'complete' && message.total === 1)).toBe(true);
  });

  it('completes consistently when cancellation arrives after final persistence begins', async () => {
    const fetch = vi.fn(async (requestUrl) => {
      const url = String(requestUrl);
      if (url.includes('/api/v4/me')) return responseJson({ id: 'viewer-id' });
      if (url.includes('/api/v3/settings/blocked_users')) {
        return responseJson({
          data: [{ id: 'new-blocked-id', url_token: 'new-blocked-token' }],
          paging: { is_end: true, totals: 1 }
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    const { chrome } = await loadZhihu({ enabled: false, fetch });
    const previous = validSnapshot([{ id: 'old-blocked-id', urlToken: 'old-blocked-token' }]);
    await chrome.storage.local.set({ echoZhihuBlocklistV1: previous });
    const originalSet = chrome.storage.local.set.bind(chrome.storage.local);
    let releaseCommit;
    const commitStarted = new Promise(resolve => {
      chrome.storage.local.set = async items => {
        if (!items.echoZhihuBlocklistV1
            || items.echoZhihuBlocklistV1.accounts['viewer-id']?.records[0]?.id !== 'new-blocked-id') {
          return originalSet(items);
        }
        resolve();
        await new Promise(release => { releaseCommit = release; });
        return originalSet(items);
      };
    });
    const clientPort = chrome.runtime.connect({ name: 'echo-zhihu-blocklist-worker' });
    const messages = [];
    clientPort.onMessage.addListener(message => messages.push(message));

    clientPort.postMessage({ action: 'start', taskId: 'test-task' });
    await commitStarted;
    clientPort.postMessage({ action: 'cancel' });
    releaseCommit();
    await flushAsyncWork(12);

    const stored = await chrome.storage.local.get('echoZhihuBlocklistV1');
    expect(stored.echoZhihuBlocklistV1.accounts['viewer-id'].records).toEqual([
      { id: 'new-blocked-id', urlToken: 'new-blocked-token' }
    ]);
    expect(messages.some(message => message.type === 'cancelled')).toBe(false);
    expect(messages.some(message => message.type === 'complete')).toBe(true);
  });

  it('keeps the previous snapshot when cancelled before final persistence begins', async () => {
    let releasePage;
    const pendingPage = new Promise(resolve => { releasePage = resolve; });
    const fetch = vi.fn(async (requestUrl) => {
      const url = String(requestUrl);
      if (url.includes('/api/v4/me')) return responseJson({ id: 'viewer-id' });
      if (url.includes('/api/v3/settings/blocked_users')) return pendingPage;
      throw new Error(`Unexpected request: ${url}`);
    });
    const { chrome } = await loadZhihu({ enabled: false, fetch });
    const previous = validSnapshot([{ id: 'old-blocked-id', urlToken: 'old-blocked-token' }]);
    await chrome.storage.local.set({ echoZhihuBlocklistV1: previous });
    const clientPort = chrome.runtime.connect({ name: 'echo-zhihu-blocklist-worker' });
    const messages = [];
    clientPort.onMessage.addListener(message => messages.push(message));

    clientPort.postMessage({ action: 'start', taskId: 'test-task' });
    await flushAsyncWork(8);
    clientPort.postMessage({ action: 'cancel' });
    releasePage(responseJson({
      data: [{ id: 'new-blocked-id', url_token: 'new-blocked-token' }],
      paging: { is_end: true, totals: 1 }
    }));
    await flushAsyncWork(12);

    await expect(chrome.storage.local.get('echoZhihuBlocklistV1')).resolves.toEqual({
      echoZhihuBlocklistV1: previous
    });
    expect(messages.some(message => message.type === 'cancelled')).toBe(true);
    expect(messages.some(message => message.type === 'complete')).toBe(false);
  });
});