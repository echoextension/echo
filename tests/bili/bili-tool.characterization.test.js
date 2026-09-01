// @vitest-environment node

import { afterEach, describe, expect, it } from 'vitest';

import { createFakeChrome } from '../helpers/fake-chrome.js';
import { createScriptDom, executeExtensionWindowScript, flushAsyncWork } from '../helpers/script-harness.js';

let dom;

async function loadBiliTool(enabled = true) {
  const chrome = createFakeChrome({ storage: { sync: { biliTool: enabled } } });
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.action === 'getZoom') sendResponse({ zoom: 1 });
    else sendResponse({ ok: true });
    return false;
  });
  dom = await createScriptDom({
    chrome,
    html: '<!doctype html><html><head><title>Video</title></head><body><div class="bpx-player-video-wrap"><video></video></div></body></html>',
    url: 'https://www.bilibili.com/video/BV1fixture'
  });
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

  it('clears playback changes and hides the host when disabled', async () => {
    const { chrome, window } = await loadBiliTool();
    const video = window.document.querySelector('video');
    video.playbackRate = 3;

    await chrome.storage.sync.set({ biliTool: false });
    await flushAsyncWork();

    expect(video.playbackRate).toBe(1);
    expect(window.document.querySelector('echo-bili-tool').style.display).toBe('none');
  });

  it('does not create the tool when disabled before injection', async () => {
    const { window } = await loadBiliTool(false);

    expect(window.document.querySelector('echo-bili-tool')).toBeNull();
  });
});