// @vitest-environment node

import { afterEach, describe, expect, it } from 'vitest';

import { createFakeChrome } from '../helpers/fake-chrome.js';
import {
  createScriptDom,
  executeExtensionWindowScript,
  executeWindowScript,
  flushAsyncWork
} from '../helpers/script-harness.js';

let dom;

async function loadCommonModule(relativePath) {
  const chrome = createFakeChrome();
  const messages = [];
  let currentZoom = 1;
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    messages.push(message);
    if (message.action === 'getZoom') sendResponse({ zoom: currentZoom });
    else {
      if (message.action === 'setZoom') currentZoom = message.zoom;
      sendResponse({ success: true });
    }
    return false;
  });
  dom = await createScriptDom({
    chrome,
    html: '<!doctype html><html><body><input id="field"><p>Content</p></body></html>'
  });
  await executeExtensionWindowScript(dom, relativePath);
  return { messages, window: dom.window };
}

afterEach(() => {
  dom?.window.close();
  dom = null;
});

describe('shared keyboard and mouse modules', () => {
  it('registers keyboard enhancement only once and sends one F2 action', async () => {
    const { messages, window } = await loadCommonModule('common/keyboard-enhance.js');
    await executeWindowScript(dom, 'common/keyboard-enhance.js');

    window.document.body.dispatchEvent(new window.KeyboardEvent('keydown', {
      key: 'F2',
      bubbles: true,
      cancelable: true
    }));

    expect(messages.filter(({ action }) => action === 'switchTab')).toEqual([
      { action: 'switchTab', direction: 'left', source: 'keyboard' }
    ]);
  });

  it('serializes rapid shared zoom events so both steps are applied', async () => {
    const { messages, window } = await loadCommonModule('common/keyboard-enhance.js');
    const createWheel = () => new window.WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
      deltaY: -100
    });

    window.document.dispatchEvent(createWheel());
    window.document.dispatchEvent(createWheel());
    await flushAsyncWork(8);

    expect(messages.filter(message => message.action === 'setZoom').map(message => message.zoom))
      .toEqual([1.05, 1.1]);
  });

  it('sends a right-tab action for a right-button wheel gesture', async () => {
    const { messages, window } = await loadCommonModule('common/mouse-gesture.js');

    window.document.dispatchEvent(new window.MouseEvent('mousedown', { button: 2, bubbles: true }));
    const wheel = new window.WheelEvent('wheel', {
      buttons: 2,
      deltaY: 100,
      bubbles: true,
      cancelable: true
    });
    window.document.dispatchEvent(wheel);

    expect(wheel.defaultPrevented).toBe(true);
    expect(messages).toContainEqual({ action: 'switchTab', direction: 'right', source: 'mouseGesture' });
  });

  it('sends gesture end when the switch is disabled after mouse down', async () => {
    const chrome = createFakeChrome({ storage: { sync: { mouseGesture: true } } });
    const messages = [];
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      messages.push(message);
      sendResponse({ ok: true });
      return false;
    });
    dom = await createScriptDom({ chrome });
    await executeExtensionWindowScript(dom, 'common/mouse-gesture.js');
    dom.window.document.dispatchEvent(new dom.window.MouseEvent('mousedown', { button: 2, bubbles: true }));
    await chrome.storage.sync.set({ mouseGesture: false });
    await flushAsyncWork();
    dom.window.document.dispatchEvent(new dom.window.MouseEvent('mouseup', { button: 2, bubbles: true }));

    expect(messages.map(message => message.action)).toEqual(['mouseGestureStart', 'mouseGestureEnd']);
  });

  it('opens a dragged URL through the shared super-drag module', async () => {
    const { messages, window } = await loadCommonModule('common/super-drag.js');
    const transfer = {
      types: ['text/uri-list'],
      dropEffect: 'none',
      getData(type) { return type === 'URL' || type === 'text/uri-list' ? 'https://drag.example/' : ''; }
    };
    const start = new window.MouseEvent('dragstart', { bubbles: true, clientX: 0, clientY: 0 });
    Object.defineProperty(start, 'dataTransfer', { value: transfer });
    window.document.body.dispatchEvent(start);
    const drop = new window.MouseEvent('drop', {
      bubbles: true,
      cancelable: true,
      clientX: 100,
      clientY: 0
    });
    Object.defineProperty(drop, 'dataTransfer', { value: transfer });
    window.document.body.dispatchEvent(drop);

    expect(messages).toContainEqual({
      action: 'openInNewTab',
      url: 'https://drag.example/',
      forceAdjacentPosition: true
    });
  });

  it('does not trigger disabled capabilities outside FRE demo mode', async () => {
    const chrome = createFakeChrome({
      storage: { sync: { mouseGesture: false, fineZoom: false, tabSwitchKey: false, superDrag: false } }
    });
    const messages = [];
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      messages.push(message);
      sendResponse({ zoom: 1 });
      return false;
    });
    dom = await createScriptDom({ chrome });
    await executeExtensionWindowScript(dom, 'common/keyboard-enhance.js');
    await executeExtensionWindowScript(dom, 'common/mouse-gesture.js');
    await executeExtensionWindowScript(dom, 'common/super-drag.js');

    dom.window.document.body.dispatchEvent(new dom.window.KeyboardEvent('keydown', {
      key: 'F3', bubbles: true, cancelable: true
    }));
    dom.window.document.dispatchEvent(new dom.window.WheelEvent('wheel', {
      ctrlKey: true, deltaY: -100, bubbles: true, cancelable: true
    }));

    expect(messages).toEqual([]);
  });

  it('keeps FRE keyboard demonstration active when the stored switch is off', async () => {
    const chrome = createFakeChrome({ storage: { sync: { tabSwitchKey: false } } });
    const messages = [];
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      messages.push(message);
      sendResponse({ ok: true });
      return false;
    });
    dom = await createScriptDom({ chrome });
    await executeWindowScript(dom, 'core/settings.js');
    await executeWindowScript(dom, 'core/messages.js');
    await executeWindowScript(dom, 'core/input-policy.js');
    await executeWindowScript(dom, 'fre/input-demo.js');
    await executeWindowScript(dom, 'common/input-context.js');
    await executeWindowScript(dom, 'common/keyboard-enhance.js');

    dom.window.document.body.dispatchEvent(new dom.window.KeyboardEvent('keydown', {
      key: 'F3', bubbles: true, cancelable: true
    }));

    expect(messages).toContainEqual({ action: 'switchTab', direction: 'right', source: 'demo' });
  });
});

describe('shared Low Poly background', () => {
  it('initializes, pauses, resumes and destroys its canvas', async () => {
    const chrome = createFakeChrome();
    dom = await createScriptDom({ chrome });
    const gradient = { addColorStop() {} };
    dom.window.HTMLCanvasElement.prototype.getContext = () => ({
      clearRect() {},
      createLinearGradient() { return gradient; },
      fillRect() {},
      beginPath() {},
      moveTo() {},
      lineTo() {},
      closePath() {},
      fill() {},
      set fillStyle(_value) {}
    });
    dom.window.LowPolyConfig = { autoInit: false, cellSize: 600 };
    await executeWindowScript(dom, 'common/lowpoly-bg.js');

    dom.window.LowPolyBg.init();
    expect(dom.window.LowPolyBg.isInitialized).toBe(true);
    expect(dom.window.document.getElementById('lowpolyCanvas')).not.toBeNull();
    dom.window.LowPolyBg.pause();
    expect(dom.window.LowPolyBg.isPaused).toBe(true);
    dom.window.LowPolyBg.resume();
    expect(dom.window.LowPolyBg.isPaused).toBe(false);
    dom.window.LowPolyBg.destroy();
    await flushAsyncWork();
    expect(dom.window.LowPolyBg.isInitialized).toBe(false);
    expect(dom.window.document.getElementById('lowpolyCanvas')).toBeNull();
  });
});