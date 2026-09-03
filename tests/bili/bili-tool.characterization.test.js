// @vitest-environment node

import { afterEach, describe, expect, it } from 'vitest';

import { createFakeChrome } from '../helpers/fake-chrome.js';
import { createScriptDom, executeExtensionWindowScript, flushAsyncWork } from '../helpers/script-harness.js';

let dom;

async function loadBiliTool(enabled = true, body = '<div class="bpx-player-video-wrap"><video></video></div>') {
  const chrome = createFakeChrome({ storage: { sync: { biliTool: enabled } } });
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.action === 'getZoom') sendResponse({ zoom: 1 });
    else sendResponse({ ok: true });
    return false;
  });
  dom = await createScriptDom({
    chrome,
    html: `<!doctype html><html><head><title>Video</title></head><body>${body}</body></html>`,
    url: 'https://www.bilibili.com/video/BV1fixture'
  });
  const attachShadow = dom.window.Element.prototype.attachShadow;
  dom.window.Element.prototype.attachShadow = function(init) {
    return attachShadow.call(this, { ...init, mode: 'open' });
  };
  await executeExtensionWindowScript(dom, 'bili-tool/svg-assets.js');
  await executeExtensionWindowScript(dom, 'bili-tool/styles.js');
  await executeExtensionWindowScript(dom, 'bili-tool/bili-tool.js');
  dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
  await flushAsyncWork(8);
  return { chrome, window: dom.window };
}

afterEach(() => {
  dom?.window.close();
  dom = null;
});

describe('Bilibili video tool', () => {
  it('creates exactly one isolated tool host on a video page', async () => {
    const { window } = await loadBiliTool();

    expect(window.document.querySelectorAll('echo-bili-tool')).toHaveLength(1);
    window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
    await flushAsyncWork();
    expect(window.document.querySelectorAll('echo-bili-tool')).toHaveLength(1);
  });

  it('keeps the established capsule and panel style contract', async () => {
    const { window } = await loadBiliTool();
    const style = window.document.querySelector('echo-bili-tool').shadowRoot.querySelector('style');

    expect(style.textContent).toContain('.capsule-rail');
    expect(style.textContent).toContain('background: #df497f');
    expect(style.textContent).toContain('@media (prefers-color-scheme: dark)');
    expect(style.textContent).toContain('.offset-stepper');
  });

  it('clears playback changes and hides the host when disabled', async () => {
    const { chrome, window } = await loadBiliTool();
    const video = window.document.querySelector('video');
    video.playbackRate = 3;

    await chrome.storage.sync.set({ biliTool: false });
    await flushAsyncWork();

    expect(video.playbackRate).toBe(1);
    expect(window.document.querySelector('echo-bili-tool').style.display).toBe('none');
  });

  it('shows an existing tool host when re-enabled on the same video page', async () => {
    const { chrome, window } = await loadBiliTool();
    const host = window.document.querySelector('echo-bili-tool');

    await chrome.storage.sync.set({ biliTool: false });
    await flushAsyncWork();
    await chrome.storage.sync.set({ biliTool: true });
    await flushAsyncWork(8);

    expect(host.style.display).toBe('');
    expect(window.document.querySelectorAll('echo-bili-tool')).toHaveLength(1);
  });

  it('does not create the tool when disabled before injection', async () => {
    const { window } = await loadBiliTool(false);

    expect(window.document.querySelector('echo-bili-tool')).toBeNull();
  });

  it('creates the tool when enabled after an initially disabled injection', async () => {
    const { chrome, window } = await loadBiliTool(false);

    await chrome.storage.sync.set({ biliTool: true });
    await flushAsyncWork(8);

    expect(window.document.querySelectorAll('echo-bili-tool')).toHaveLength(1);
  });

  it('waits for a player when enabled from an initially disabled non-video page', async () => {
    const { chrome, window } = await loadBiliTool(false, '<main>Homepage</main>');

    await chrome.storage.sync.set({ biliTool: true });
    window.history.pushState({}, '', '/video/BV1late');
    const player = window.document.createElement('div');
    player.className = 'bpx-player-video-wrap';
    player.appendChild(window.document.createElement('video'));
    window.document.body.appendChild(player);
    await flushAsyncWork(8);

    expect(window.document.querySelectorAll('echo-bili-tool')).toHaveLength(1);
  });

  it('does not create a late tool after being disabled while waiting for a player', async () => {
    const { chrome, window } = await loadBiliTool(true, '<main>Homepage</main>');

    await chrome.storage.sync.set({ biliTool: false });
    const player = window.document.createElement('div');
    player.className = 'bpx-player-video-wrap';
    window.document.body.appendChild(player);
    await flushAsyncWork(8);

    expect(window.document.querySelector('echo-bili-tool')).toBeNull();
  });

  it('shows an existing hidden host when a replacement player arrives', async () => {
    const { chrome, window } = await loadBiliTool();
    const host = window.document.querySelector('echo-bili-tool');
    await chrome.storage.sync.set({ biliTool: false });
    window.document.querySelector('.bpx-player-video-wrap').remove();
    await chrome.storage.sync.set({ biliTool: true });
    const player = window.document.createElement('div');
    player.className = 'bpx-player-video-wrap';
    player.appendChild(window.document.createElement('video'));
    window.document.body.appendChild(player);
    await flushAsyncWork(8);

    expect(host.style.display).toBe('');
    expect(window.document.querySelectorAll('echo-bili-tool')).toHaveLength(1);
  });
});