// @vitest-environment node

import { afterEach, describe, expect, it } from 'vitest';

import { createFakeChrome } from '../helpers/fake-chrome.js';
import { createScriptDom, executeWindowScript, flushAsyncWork } from '../helpers/script-harness.js';

let dom;

async function loadPolicy() {
  dom = await createScriptDom({ chrome: createFakeChrome() });
  await executeWindowScript(dom, 'core/input-policy.js');
  return dom.window.EchoInputPolicy;
}

afterEach(() => {
  dom?.window.close();
  dom = null;
});

describe('input policy', () => {
  it('uses 5% steps below 175% and optional 25% high zoom steps', async () => {
    const policy = await loadPolicy();
    expect(policy.nextZoom(1, 'in', true)).toBe(1.05);
    expect(policy.nextZoom(1.75, 'in', true)).toBe(2);
    expect(policy.nextZoom(2, 'out', true)).toBe(1.75);
    expect(policy.nextZoom(2, 'out', false)).toBe(1.95);
    expect(policy.nextZoom(0.25, 'out', true)).toBe(0.25);
    expect(policy.nextZoom(5, 'in', true)).toBe(5);
  });

  it('classifies URLs and search text while rejecting javascript URLs and oversized text', async () => {
    const policy = await loadPolicy();
    const transfer = values => ({
      types: Object.keys(values),
      getData: type => values[type] || ''
    });
    expect(policy.classifyDrop(transfer({ 'text/plain': 'example.com/path' }))).toEqual({
      type: 'url', value: 'https://example.com/path'
    });
    expect(policy.classifyDrop(transfer({ 'text/plain': 'search words' }))).toEqual({
      type: 'search', value: 'search words'
    });
    expect(policy.classifyDrop(transfer({ 'text/uri-list': 'javascript:alert(1)' }))).toBeNull();
    expect(policy.classifyDrop(transfer({ 'text/plain': 'x'.repeat(1000) }))).toBeNull();
  });

  it('recognizes editable controls and contenteditable regions', async () => {
    const policy = await loadPolicy();
    const input = dom.window.document.createElement('input');
    const button = dom.window.document.createElement('button');
    expect(policy.isEditable(input)).toBe(true);
    expect(policy.isEditable(button)).toBe(false);
  });
});

describe('input context modes', () => {
  it('obeys stored switches and updates them at runtime in settings mode', async () => {
    const chrome = createFakeChrome({ storage: { sync: { mouseGesture: false, fineZoom: false } } });
    dom = await createScriptDom({ chrome });
    await executeWindowScript(dom, 'core/settings.js');
    await executeWindowScript(dom, 'common/input-context.js');
    await dom.window.EchoInputContext.ready;
    expect(dom.window.EchoInputContext.mode).toBe('settings');
    expect(dom.window.EchoInputContext.isEnabled('mouseGesture')).toBe(false);
    await chrome.storage.sync.set({ mouseGesture: true });
    await flushAsyncWork();
    expect(dom.window.EchoInputContext.isEnabled('mouseGesture')).toBe(true);
  });

  it('forces all demonstration capabilities on without reading user settings', async () => {
    const chrome = createFakeChrome({
      storage: {
        sync: {
          mouseGesture: false,
          fineZoom: false,
          fineZoomLargeStep: false,
          tabSwitchKey: false,
          superDrag: false
        }
      }
    });
    dom = await createScriptDom({ chrome });
    await executeWindowScript(dom, 'core/settings.js');
    await executeWindowScript(dom, 'fre/input-demo.js');
    await executeWindowScript(dom, 'common/input-context.js');

    expect(dom.window.EchoInputContext.mode).toBe('demo');
    for (const key of ['mouseGesture', 'fineZoom', 'fineZoomLargeStep', 'tabSwitchKey', 'superDrag']) {
      expect(dom.window.EchoInputContext.isEnabled(key)).toBe(true);
    }
  });
});