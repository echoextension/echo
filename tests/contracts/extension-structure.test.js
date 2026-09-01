import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  EXTENSION_FILES,
  isAllowedExtensionFile,
  isForbiddenPackageFile
} from '../../scripts/extension-files.mjs';
import { validateExtension } from '../../scripts/validate-extension.mjs';

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
});