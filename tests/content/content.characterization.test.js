// @vitest-environment node

import { afterEach, describe, expect, it } from 'vitest';

import { createFakeChrome } from '../helpers/fake-chrome.js';
import { createScriptDom, executeExtensionWindowScript, flushAsyncWork } from '../helpers/script-harness.js';

let dom;

function installMessageResponder(chrome, actions) {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    actions.push(message);
    if (message.action === 'getZoom') sendResponse({ zoom: 1 });
    else if (message.action === 'setZoom') sendResponse({ success: true });
    else sendResponse({ ok: true });
    return false;
  });
}

async function loadContent(sync = {}) {
  const chrome = createFakeChrome({
    storage: {
      sync: {
        mouseGesture: true,
        fineZoom: true,
        fineZoomLargeStep: true,
        superDrag: true,
        tabSwitchKey: true,
        quickSaveImage: true,
        ...sync
      }
    }
  });
  const actions = [];
  installMessageResponder(chrome, actions);
  dom = await createScriptDom({ chrome, html: '<!doctype html><html><body><input id="field"><p id="text">text</p></body></html>' });
  await executeExtensionWindowScript(dom, 'content.js');
  await flushAsyncWork();
  return { chrome, actions, window: dom.window };
}

function dataTransfer(types, values) {
  return {
    types,
    dropEffect: 'none',
    getData(type) { return values[type] || ''; }
  };
}

function dragEvent(window, type, { x, y, transfer, target }) {
  const event = new window.MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y
  });
  Object.defineProperty(event, 'dataTransfer', { value: transfer });
  (target || window.document.body).dispatchEvent(event);
  return event;
}

afterEach(() => {
  dom?.window.close();
  dom = null;
});

describe('content script settings and keyboard behavior', () => {
  it('uses a 5% zoom step below 175%', async () => {
    const { actions, window } = await loadContent();

    const event = new window.WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
      deltaY: -100
    });
    window.document.dispatchEvent(event);
    await flushAsyncWork();

    expect(event.defaultPrevented).toBe(true);
    expect(actions).toContainEqual({ action: 'setZoom', zoom: 1.05 });
  });

  it('does not intercept zoom when fineZoom is disabled', async () => {
    const { actions, window } = await loadContent({ fineZoom: false });

    const event = new window.WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
      deltaY: -100
    });
    window.document.dispatchEvent(event);
    await flushAsyncWork();

    expect(event.defaultPrevented).toBe(false);
    expect(actions.some(({ action }) => action === 'setZoom')).toBe(false);
  });

  it('keeps F3 native inside inputs and switches tabs outside inputs', async () => {
    const { actions, window } = await loadContent();
    const input = window.document.getElementById('field');
    input.focus();
    input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'F3', bubbles: true, cancelable: true }));
    expect(actions.some(({ action }) => action === 'switchTab')).toBe(false);

    input.blur();
    window.document.body.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'F3', bubbles: true, cancelable: true }));
    expect(actions).toContainEqual({ action: 'switchTab', direction: 'right', source: 'keyboard' });
  });
});

describe('content script super drag', () => {
  it('opens a dragged link in an adjacent tab', async () => {
    const { actions, window } = await loadContent();
    const transfer = dataTransfer(['text/uri-list'], {
      URL: 'https://target.example/path',
      'text/uri-list': 'https://target.example/path'
    });

    dragEvent(window, 'dragstart', { x: 0, y: 0, transfer });
    const drop = dragEvent(window, 'drop', { x: 100, y: 0, transfer });

    expect(drop.defaultPrevented).toBe(true);
    expect(actions).toContainEqual({
      action: 'openInNewTab',
      url: 'https://target.example/path',
      forceAdjacentPosition: true
    });
  });

  it('does not trigger for a short drag or a drop into an input', async () => {
    const { actions, window } = await loadContent();
    const transfer = dataTransfer(['text/plain'], { 'text/plain': 'search words' });

    dragEvent(window, 'dragstart', { x: 0, y: 0, transfer });
    dragEvent(window, 'drop', { x: 10, y: 10, transfer });
    dragEvent(window, 'dragstart', { x: 0, y: 0, transfer });
    dragEvent(window, 'drop', {
      x: 100,
      y: 0,
      transfer,
      target: window.document.getElementById('field')
    });

    expect(actions.some(({ action }) => action === 'searchInNewTab')).toBe(false);
  });
});