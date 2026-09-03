import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  EXTENSION_FILES,
  isAllowedExtensionFile,
  isForbiddenPackageFile
} from '../../scripts/extension-files.mjs';
import {
  validateExtension,
  validateHtmlReferences
} from '../../scripts/validate-extension.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

describe('extension repository contracts', () => {
  it('passes all static extension checks', async () => {
    const result = await validateExtension(ROOT);
    expect(result.errors).toEqual([]);
    expect(result.stats.allowlistedFiles).toBeGreaterThan(30);
    expect(result.stats.wallpapers).toBeGreaterThan(100);
    expect(result.stats.scripts).toBeGreaterThan(10);
  });

  it('keeps the production package allowlist explicit and unique', () => {
    expect(new Set(EXTENSION_FILES).size).toBe(EXTENSION_FILES.length);
    expect(EXTENSION_FILES.every(isAllowedExtensionFile)).toBe(true);
    expect(EXTENSION_FILES.some(isForbiddenPackageFile)).toBe(false);
  });

  it('rejects a packaged HTML reference that exists but is absent from the allowlist', async () => {
    const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), 'echo-html-contract-'));
    try {
      const optionsDirectory = path.join(fixtureRoot, 'options');
      await mkdir(optionsDirectory, { recursive: true });
      const htmlPath = path.join(optionsDirectory, 'options.html');
      const scriptPath = path.join(optionsDirectory, 'not-packaged.js');
      await writeFile(htmlPath, '<script src="not-packaged.js"></script>');
      await writeFile(scriptPath, 'void 0;');
      const errors = [];
      const stats = {};

      await validateHtmlReferences(fixtureRoot, [htmlPath, scriptPath], errors, stats);

      expect(errors).toEqual([
        'options/options.html 引用了未进入发布包的资源：not-packaged.js'
      ]);
    } finally {
      await rm(fixtureRoot, { force: true, recursive: true });
    }
  });

  it('excludes development probes and test infrastructure from the extension package', () => {
    for (const pathPrefix of ['crawler/', 'tests/', 'scripts/', '.github/', 'node_modules/']) {
      expect(EXTENSION_FILES.some((filePath) => filePath.startsWith(pathPrefix))).toBe(false);
    }
  });

  it('loads explicit FRE demo input mode on every first-run page', async () => {
    for (const page of ['fre-step1.html', 'fre-step2.html', 'fre-step3.html', 'fre-step4.html']) {
      const html = await readFile(path.join(ROOT, 'fre', page), 'utf8');
      const demoIndex = html.indexOf('src="input-demo.js"');
      const contextIndex = html.indexOf('src="../common/input-context.js"');
      expect(demoIndex, `${page} missing input-demo.js`).toBeGreaterThan(-1);
      expect(contextIndex, `${page} missing input-context.js`).toBeGreaterThan(demoIndex);
      expect(html).toContain('src="../common/mouse-gesture.js"');
      expect(html).toContain('src="../common/super-drag.js"');
      expect(html).toContain('src="../common/keyboard-enhance.js"');
    }
  });

  it('loads extracted controllers and assets before their owning scripts', async () => {
    const expectBefore = (source, dependency, owner, label) => {
      expect(source.indexOf(dependency), `${label} missing ${dependency}`).toBeGreaterThan(-1);
      expect(source.indexOf(owner), `${label} missing ${owner}`).toBeGreaterThan(-1);
      expect(source.indexOf(dependency), label).toBeLessThan(source.indexOf(owner));
    };
    const manifest = JSON.parse(await readFile(path.join(ROOT, 'manifest.json'), 'utf8'));
    const commonScripts = manifest.content_scripts[0].js;
    expectBefore(
      commonScripts,
      'search-box/trending-controller.js',
      'search-box/search-box.js',
      'manifest common content scripts'
    );
    const biliScripts = manifest.content_scripts[1].js;
    expectBefore(biliScripts, 'bili-tool/svg-assets.js', 'bili-tool/bili-tool.js', 'manifest Bilibili scripts');
    expectBefore(biliScripts, 'bili-tool/styles.js', 'bili-tool/bili-tool.js', 'manifest Bilibili scripts');

    const searchPages = [
      'docs-viewer.html',
      'fre/fre-step1.html',
      'fre/fre-step2.html',
      'fre/fre-step3.html',
      'fre/fre-step4.html',
      'ntp/ntp.html',
      'options/options.html'
    ];
    for (const page of searchPages) {
      const html = await readFile(path.join(ROOT, page), 'utf8');
      expectBefore(html, 'search-box/trending-controller.js', 'search-box/search-box.js', page);
    }

    const optionsHtml = await readFile(path.join(ROOT, 'options/options.html'), 'utf8');
    for (const modulePath of ['modules/backup-controller.js', 'modules/zhihu-sync-controller.js']) {
      expectBefore(optionsHtml, modulePath, 'options.js', 'options/options.html');
    }
  });
});