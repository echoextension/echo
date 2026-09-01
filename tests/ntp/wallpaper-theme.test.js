// @vitest-environment node

import { afterEach, describe, expect, it } from 'vitest';

import { createFakeChrome } from '../helpers/fake-chrome.js';
import { createScriptDom, executeWindowScript } from '../helpers/script-harness.js';

let dom;

afterEach(() => {
  dom?.window.close();
  dom = null;
});

describe('wallpaper theme', () => {
  it('calculates perceptual brightness with green weighted highest', async () => {
    dom = await createScriptDom({ chrome: createFakeChrome() });
    await executeWindowScript(dom, 'ntp/modules/wallpaper-theme.js');
    const { brightness } = dom.window.EchoNtpWallpaperTheme;

    expect(brightness(0, 255, 0)).toBeGreaterThan(brightness(255, 0, 0));
    expect(brightness(255, 0, 0)).toBeGreaterThan(brightness(0, 0, 255));
  });
});