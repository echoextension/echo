// @vitest-environment node

import { afterEach, describe, expect, it } from 'vitest';

import { createFakeChrome } from '../helpers/fake-chrome.js';
import { createScriptDom, executeWindowScript } from '../helpers/script-harness.js';

let dom;

afterEach(() => {
  dom?.window.close();
  dom = null;
});

describe('wallpaper image processor', () => {
  it('keeps small images unchanged and scales oversized images proportionally', async () => {
    dom = await createScriptDom({ chrome: createFakeChrome() });
    await executeWindowScript(dom, 'ntp/modules/wallpaper-image-processor.js');
    const processor = dom.window.EchoNtpWallpaperImageProcessor.create({
      document: dom.window.document,
      Image: dom.window.Image,
      URL: dom.window.URL
    });

    expect(processor.fitDisplaySize(1920, 1080)).toEqual({ width: 1920, height: 1080 });
    expect(processor.fitDisplaySize(7680, 4320)).toEqual({ width: 3840, height: 2160 });
    expect(processor.fitDisplaySize(5000, 1000)).toEqual({ width: 3840, height: 768 });
  });
});