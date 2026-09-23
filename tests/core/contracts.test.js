// @vitest-environment node

import { afterEach, describe, expect, it } from 'vitest';

import { createFakeChrome } from '../helpers/fake-chrome.js';
import { createScriptDom, executeWindowScript } from '../helpers/script-harness.js';

let dom;

async function loadCore() {
  dom = await createScriptDom({ chrome: createFakeChrome() });
  await executeWindowScript(dom, 'core/settings.js');
  await executeWindowScript(dom, 'core/messages.js');
  return dom.window;
}

afterEach(() => {
  dom?.window.close();
  dom = null;
});

describe('EchoSettings', () => {
  it('owns defaults that previously drifted between background and options', async () => {
    const { EchoSettings } = await loadCore();
    const defaults = EchoSettings.getAreaDefaults('sync');

    expect(defaults).toMatchObject({
      fineZoomLargeStep: true,
      floatingSearchBoxFollowZoom: false,
      biliFeedHistory: true,
      closeTabActivate: 'left'
    });
    expect(EchoSettings.getDefinition('zhihuBlocklistFilter').area).toBe('local');
  });

  it('clones object defaults and rejects invalid enum or type values', async () => {
    const { EchoSettings } = await loadCore();
    const first = EchoSettings.getDefault('biliToolPosition');
    first.top = '10px';

    expect(EchoSettings.getDefault('biliToolPosition').top).toBe('50%');
    expect(EchoSettings.isValid('closeTabActivate', 'left')).toBe(true);
    expect(EchoSettings.isValid('closeTabActivate', 'middle')).toBe(false);
    expect(EchoSettings.isValid('mouseGesture', 'yes')).toBe(false);
  });

  it('sanitizes known settings without admitting unknown keys', async () => {
    const { EchoSettings } = await loadCore();
    const result = EchoSettings.sanitize('sync', {
      mouseGesture: false,
      closeTabActivate: 'invalid',
      unknownSetting: true
    });

    expect(result.sanitized).toEqual({ mouseGesture: false });
    expect(result.rejected).toEqual({ closeTabActivate: 'invalid' });
  });
});

describe('EchoMessages', () => {
  it('rejects unknown actions and invalid high-capability parameters', async () => {
    const { EchoMessages } = await loadCore();

    expect(EchoMessages.validate({ action: 'unknown' })).toMatchObject({ ok: false });
    expect(EchoMessages.validate({ action: EchoMessages.ACTIONS.SET_ZOOM, zoom: 99 })).toMatchObject({ ok: false });
    expect(EchoMessages.validate({ action: EchoMessages.ACTIONS.SWITCH_TAB, direction: 'up' })).toMatchObject({ ok: false });
    expect(EchoMessages.validate({
      action: EchoMessages.ACTIONS.SWITCH_TAB,
      direction: 'right',
      source: 'forged'
    })).toMatchObject({ ok: false });
    expect(EchoMessages.validate({
      action: EchoMessages.ACTIONS.PROXY_FETCH,
      url: 'https://untrusted.example/data'
    })).toMatchObject({ ok: false });
    expect(EchoMessages.validate({
      action: EchoMessages.ACTIONS.QUICK_SAVE_IMAGE,
      dataUrl: 'https://example.test/image.png'
    })).toMatchObject({ ok: false });
  });

  it('accepts valid messages for every active capability family', async () => {
    const { EchoMessages } = await loadCore();
    const { ACTIONS } = EchoMessages;
    const messages = [
      { action: ACTIONS.LOAD_BILI_FEED_HISTORY },
      { action: ACTIONS.SAVE_BILI_FEED_HISTORY, state: { schemaVersion: 3, batches: [] } },
      { action: ACTIONS.CLEAR_BILI_FEED_HISTORY },
      { action: ACTIONS.MOUSE_GESTURE_START },
      { action: ACTIONS.MOUSE_GESTURE_END },
      { action: ACTIONS.SWITCH_TAB, direction: 'left' },
      { action: ACTIONS.OPEN_IN_NEW_TAB, url: 'https://example.test/' },
      { action: ACTIONS.SEARCH_IN_NEW_TAB, text: 'query' },
      { action: ACTIONS.GET_ZOOM },
      { action: ACTIONS.SET_ZOOM, zoom: 1.25 },
      { action: ACTIONS.QUICK_SAVE_IMAGE, dataUrl: 'data:image/png;base64,AA==' },
      {
        action: ACTIONS.FETCH_IMAGE_AS_DATA_URL,
        imageUrl: 'https://example.test/image.png',
        pageUrl: 'https://example.test/'
      },
      { action: ACTIONS.PROXY_FETCH, url: 'https://top.baidu.com/api/board' },
      { action: ACTIONS.BING_SUGGEST, query: 'query' }
    ];

    expect(messages.every((message) => EchoMessages.validate(message).ok)).toBe(true);
  });
});