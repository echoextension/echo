// @vitest-environment node

import { afterEach, describe, expect, it } from 'vitest';

import { createFakeChrome } from '../helpers/fake-chrome.js';
import { createScriptDom, executeWindowScript } from '../helpers/script-harness.js';

let dom;

async function loadModule() {
  dom = await createScriptDom({ chrome: createFakeChrome(), url: 'https://extension.test/' });
  await executeWindowScript(dom, 'ntp/modules/wallpaper-data-source.js');
  return dom.window.EchoNtpWallpaperDataSource;
}

afterEach(() => {
  dom?.window.close();
  dom = null;
});

describe('wallpaper data source', () => {
  it('normalizes Bing metadata without retaining the OHR URL prefix', async () => {
    const module = await loadModule();
    expect(module.normalizeBingResponse({
      images: [{
        urlbase: '/th?id=OHR.Fixture_ZH-CN123',
        enddate: '20260901',
        copyright: 'Fixture place (© Fixture Author)'
      }]
    })).toEqual([{
      id: 'Fixture_ZH-CN123',
      date: '2026-09-01',
      desc: 'Fixture place',
      copyright: '(© Fixture Author)'
    }]);
  });

  it('gives later sources precedence by date and sorts descending', async () => {
    const module = await loadModule();
    expect(module.mergeByDate(
      [{ id: 'packaged', date: '2026-08-31' }],
      [{ id: 'remote', date: '2026-09-01' }],
      [{ id: 'bing', date: '2026-08-31' }]
    )).toEqual([
      { id: 'remote', date: '2026-09-01' },
      { id: 'bing', date: '2026-08-31' }
    ]);
  });
});