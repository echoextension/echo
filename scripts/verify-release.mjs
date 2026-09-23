import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from '@playwright/test';

import { EXTENSION_FILES } from './extension-files.mjs';
import { inspectArchive, verifyArchiveContents } from './package-extension.mjs';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(SCRIPT_PATH), '..');

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function extractArchive(entries, destination) {
  for (const [relativePath, content] of Object.entries(entries)) {
    const outputPath = path.resolve(destination, relativePath);
    if (!outputPath.startsWith(`${path.resolve(destination)}${path.sep}`)) {
      throw new Error(`发布包包含路径穿越：${relativePath}`);
    }
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, content);
  }
}

async function waitForWorker(context) {
  const existing = context.serviceWorkers().find(worker => worker.url().endsWith('/background.js'));
  return existing || context.waitForEvent('serviceworker', {
    predicate: worker => worker.url().endsWith('/background.js'),
    timeout: 15_000
  });
}

export function validateReleaseManifest(metadata, expected) {
  const expectedKeys = ['archive', 'fileCount', 'files', 'schemaVersion', 'sha256', 'version'].sort();
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)
      || JSON.stringify(Object.keys(metadata).sort()) !== JSON.stringify(expectedKeys)) {
    throw new Error('发布清单 schema 无效');
  }
  if (metadata.schemaVersion !== 1) throw new Error('发布清单 schemaVersion 无效');
  if (metadata.version !== expected.version) throw new Error('发布清单版本不一致');
  if (metadata.archive !== expected.archive) throw new Error('发布清单归档名不一致');
  if (metadata.sha256 !== expected.sha256) throw new Error('发布清单 SHA-256 不一致');
  if (!Array.isArray(metadata.files)
      || JSON.stringify(metadata.files) !== JSON.stringify(expected.files)) {
    throw new Error('发布清单文件表不一致');
  }
  if (metadata.fileCount !== expected.files.length) throw new Error('发布清单文件数不一致');
}

export async function verifyRelease(options = {}) {
  const manifest = JSON.parse(await readFile(path.join(ROOT, 'manifest.json'), 'utf8'));
  const archivePath = path.resolve(options.archivePath
    || path.join(ROOT, 'dist', `echo-edge-extension-v${manifest.version}.zip`));
  const archive = await readFile(archivePath);
  const digest = sha256(archive);
  const sidecar = await readFile(`${archivePath}.sha256`, 'utf8');
  const expectedSidecar = `${digest}  ${path.basename(archivePath)}\n`;
  if (sidecar !== expectedSidecar) throw new Error('发布包 SHA-256 sidecar 与实际内容不一致');

  await verifyArchiveContents(archive, ROOT, EXTENSION_FILES);
  const entries = inspectArchive(archive);
  const files = Object.keys(entries).sort();
  const metadata = JSON.parse(await readFile(`${archivePath}.manifest.json`, 'utf8'));
  validateReleaseManifest(metadata, {
    archive: path.basename(archivePath),
    files,
    sha256: digest,
    version: manifest.version
  });
  const extractedDir = await mkdtemp(path.join(os.tmpdir(), 'echo-release-'));
  const profileDir = await mkdtemp(path.join(os.tmpdir(), 'echo-release-profile-'));
  let context;
  try {
    await extractArchive(entries, extractedDir);
    context = await chromium.launchPersistentContext(profileDir, {
      channel: 'chromium',
      headless: true,
      args: [
        `--disable-extensions-except=${extractedDir}`,
        `--load-extension=${extractedDir}`
      ]
    });
    const worker = await waitForWorker(context);
    const loadedVersion = await worker.evaluate(() => chrome.runtime.getManifest().version);
    if (loadedVersion !== manifest.version) {
      throw new Error(`发布包加载版本不一致：${loadedVersion} !== ${manifest.version}`);
    }
    const extensionId = new URL(worker.url()).hostname;
    const page = context.pages()[0] || await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options/options.html`);
    if (await page.title() !== 'ECHO 易可 - 设置') throw new Error('发布包 Options 页面未正常加载');
  } finally {
    await context?.close();
    await Promise.all([
      rm(extractedDir, { force: true, recursive: true }),
      rm(profileDir, { force: true, recursive: true })
    ]);
  }

  return Object.freeze({ archivePath, files: files.length, sha256: digest });
}

async function main() {
  const result = await verifyRelease({ archivePath: process.argv[2] });
  console.log('ECHO 发布包验证通过');
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT_PATH) {
  main().catch(error => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}
