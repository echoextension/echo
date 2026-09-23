import { describe, expect, it, vi } from 'vitest';

import { createFakeChrome } from './fake-chrome.js';
import { createPortPair, FakeChromeEvent } from './fake-event.js';

describe('FakeChromeEvent', () => {
  it('adds, emits and removes listeners deterministically', () => {
    const event = new FakeChromeEvent();
    const listener = vi.fn();
    event.addListener(listener);
    event.emit('value');
    event.removeListener(listener);
    event.emit('ignored');
    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith('value');
  });
});

describe('fake chrome storage', () => {
  it('keeps sync, local and session independent and emits changes', async () => {
    const chrome = createFakeChrome();
    const changes = [];
    chrome.storage.onChanged.addListener((change, area) => changes.push({ change, area }));

    await chrome.storage.sync.set({ enabled: true });
    await chrome.storage.local.set({ enabled: false });

    await expect(chrome.storage.sync.get({ enabled: false })).resolves.toEqual({ enabled: true });
    await expect(chrome.storage.local.get('enabled')).resolves.toEqual({ enabled: false });
    await expect(chrome.storage.session.get('enabled')).resolves.toEqual({ enabled: undefined });
    expect(changes.map(({ area }) => area)).toEqual(['sync', 'local']);
  });

  it('can inject a deterministic quota failure', async () => {
    const chrome = createFakeChrome();
    chrome.__testing.failNextStorageSet('sync');
    await expect(chrome.storage.sync.set({ value: 1 })).rejects.toThrow('QUOTA_BYTES');
    await expect(chrome.storage.sync.get('value')).resolves.toEqual({ value: undefined });
  });
});

describe('fake chrome tabs', () => {
  it('supports activated-before-removed event ordering', async () => {
    const chrome = createFakeChrome({
      removalEventOrder: 'activated-first',
      tabs: [
        { id: 1, windowId: 1, index: 0, active: false, url: 'https://one.example/' },
        { id: 2, windowId: 1, index: 1, active: true, url: 'https://two.example/' },
        { id: 3, windowId: 1, index: 2, active: false, url: 'https://three.example/' }
      ]
    });
    const events = [];
    chrome.tabs.onActivated.addListener(({ tabId }) => events.push(`activated:${tabId}`));
    chrome.tabs.onRemoved.addListener((tabId) => events.push(`removed:${tabId}`));

    await chrome.tabs.remove(2);

    expect(events).toEqual(['activated:3', 'removed:2']);
    expect(chrome.__testing.snapshotTabs().map(({ id, active }) => [id, active])).toEqual([
      [1, false],
      [3, true]
    ]);
  });

  it('supports removed-before-activated event ordering', async () => {
    const chrome = createFakeChrome({
      removalEventOrder: 'removed-first',
      tabs: [
        { id: 1, windowId: 1, index: 0, active: true, url: 'https://one.example/' },
        { id: 2, windowId: 1, index: 1, active: false, url: 'https://two.example/' }
      ]
    });
    const events = [];
    chrome.tabs.onActivated.addListener(({ tabId }) => events.push(`activated:${tabId}`));
    chrome.tabs.onRemoved.addListener((tabId) => events.push(`removed:${tabId}`));

    await chrome.tabs.remove(1);

    expect(events).toEqual(['removed:1', 'activated:2']);
  });
});

describe('fake chrome ports and DNR', () => {
  it('delivers messages and disconnects both ends of a port pair', () => {
    const [left, right] = createPortPair('sync');
    const received = vi.fn();
    right.onMessage.addListener(received);
    left.postMessage({ type: 'ping' });
    left.disconnect();
    expect(received).toHaveBeenCalledWith({ type: 'ping' }, right);
    expect(left.disconnected).toBe(true);
    expect(right.disconnected).toBe(true);
  });

  it('tracks dynamic rules and rejects duplicate IDs', async () => {
    const chrome = createFakeChrome();
    const rule = { id: 10, priority: 1, action: { type: 'block' }, condition: {} };
    await chrome.declarativeNetRequest.updateDynamicRules({ addRules: [rule] });
    await expect(chrome.declarativeNetRequest.updateDynamicRules({ addRules: [rule] })).rejects.toThrow('already exists');
    await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: [10] });
    await expect(chrome.declarativeNetRequest.getDynamicRules()).resolves.toEqual([]);
  });
});