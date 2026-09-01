// @vitest-environment node

import { afterEach, describe, expect, it } from 'vitest';

import { createFakeChrome } from '../helpers/fake-chrome.js';
import { createScriptDom, executeWindowScript } from '../helpers/script-harness.js';

let dom;

afterEach(() => {
  dom?.window.close();
  dom = null;
});

describe('NTP zoom controller', () => {
  it('loads, applies, clamps and persists CSS zoom', async () => {
    const chrome = createFakeChrome({ storage: { local: { echo_ntp_zoom: 1.25 } } });
    dom = await createScriptDom({
      chrome,
      html: '<!doctype html><html><body><main class="container"></main></body></html>'
    });
    await executeWindowScript(dom, 'ntp/modules/zoom-controller.js');
    const controller = dom.window.EchoNtpZoomController.create({ chrome, document: dom.window.document });

    await controller.load();
    expect(controller.get()).toBe(1.25);
    expect(dom.window.document.querySelector('.container').style.transform).toBe('scale(1.25)');
    expect(controller.set(10)).toBe(5);
    await Promise.resolve();
    await expect(chrome.storage.local.get('echo_ntp_zoom')).resolves.toEqual({ echo_ntp_zoom: 5 });
  });
});