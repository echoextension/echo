import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { unzipSync, zipSync } from 'fflate';

import { EXTENSION_FILES, normalizePackagePath } from './extension-files.mjs';
import { validateExtension } from './validate-extension.mjs';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const DEFAULT_ROOT = path.resolve(path.dirname(SCRIPT_PATH), '..');
const ZIP_DATE = new Date(1980, 0, 1, 0, 0, 0);
const ZIP_ATTRIBUTES = Object.freeze({
  attrs: 0o644 << 16,
  mtime: ZIP_DATE,
  os: 3
});

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function assertSafeArchivePath(filePath) {
  const normalized = normalizePackagePath(filePath);
  const segments = normalized.split('/');
  if (!normalized || normalized !== filePath || normalized.startsWith('/') || normalized.includes('\\')
      || segments.some(segment => !segment || segment === '.' || segment === '..')) {
    throw new Error(`发布路径不安全：${filePath}`);
  }
  return normalized;
}

function readCentralDirectoryNames(archiveBuffer) {
  const buffer = Buffer.from(archiveBuffer);
  const minimumEocdSize = 22;
  const searchStart = Math.max(0, buffer.length - 0xffff - minimumEocdSize);
  let eocdOffset = -1;
  for (let offset = buffer.length - minimumEocdSize; offset >= searchStart; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) {
      eocdOffset = offset;
      break;
    }
  }
  if (eocdOffset === -1) throw new Error('发布包缺少 ZIP 中央目录');
  const entryCount = buffer.readUInt16LE(eocdOffset + 10);
  const centralOffset = buffer.readUInt32LE(eocdOffset + 16);
  if (entryCount === 0xffff || centralOffset === 0xffffffff) {
    throw new Error('发布包不支持 ZIP64 条目');
  }

  const names = [];
  let offset = centralOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error(`发布包中央目录条目损坏：${index}`);
    }
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const nameStart = offset + 46;
    const nameEnd = nameStart + nameLength;
    if (nameEnd > buffer.length) throw new Error(`发布包文件名损坏：${index}`);
    names.push(buffer.toString('utf8', nameStart, nameEnd));
    offset = nameEnd + extraLength + commentLength;
  }
  return names;
}

async function readReleaseEntries(rootDir, files) {
  const entries = {};
  for (const relativePath of [...files].map(assertSafeArchivePath).sort()) {
    entries[relativePath] = [new Uint8Array(await readFile(path.join(rootDir, relativePath))), ZIP_ATTRIBUTES];
  }
  return entries;
}

export function inspectArchive(archiveBuffer) {
  const rawNames = readCentralDirectoryNames(archiveBuffer);
  const rawNameSet = new Set();
  const normalizedNameSet = new Set();
  for (const rawName of rawNames) {
    if (rawNameSet.has(rawName)) throw new Error(`发布包包含重复条目：${rawName}`);
    rawNameSet.add(rawName);
    const normalized = assertSafeArchivePath(rawName);
    if (normalizedNameSet.has(normalized)) throw new Error(`发布包包含路径别名：${rawName}`);
    normalizedNameSet.add(normalized);
  }
  const entries = unzipSync(new Uint8Array(archiveBuffer));
  if (Object.keys(entries).length !== rawNames.length) throw new Error('发布包解压条目数量与中央目录不一致');
  return Object.fromEntries(Object.entries(entries).map(([filePath, bytes]) => [filePath, Buffer.from(bytes)]));
}

export async function verifyArchiveContents(archiveBuffer, rootDir, files = EXTENSION_FILES) {
  const expectedFiles = [...files].map(assertSafeArchivePath).sort();
  const entries = inspectArchive(archiveBuffer);
  const actualFiles = Object.keys(entries).sort();
  if (JSON.stringify(actualFiles) !== JSON.stringify(expectedFiles)) {
    throw new Error(`发布包文件不一致\n预期：${expectedFiles.join(', ')}\n实际：${actualFiles.join(', ')}`);
  }
  for (const relativePath of expectedFiles) {
    const source = await readFile(path.join(rootDir, relativePath));
    if (!entries[relativePath].equals(source)) {
      throw new Error(`发布包内容与工作树不一致：${relativePath}`);
    }
  }
  return { entries, files: actualFiles };
}

export async function createReleaseArchive(options = {}) {
  const rootDir = path.resolve(options.rootDir || DEFAULT_ROOT);
  const outputDir = path.resolve(options.outputDir || path.join(rootDir, 'dist'));
  const files = options.files || EXTENSION_FILES;

  if (options.validate !== false) {
    const validation = await validateExtension(rootDir);
    if (validation.errors.length) {
      throw new Error(`发布前静态校验失败：\n- ${validation.errors.join('\n- ')}`);
    }
  }

  const manifest = JSON.parse(await readFile(path.join(rootDir, 'manifest.json'), 'utf8'));
  const archiveName = options.archiveName || `echo-edge-extension-v${manifest.version}.zip`;
  if (archiveName !== path.basename(archiveName) || !archiveName.toLowerCase().endsWith('.zip')) {
    throw new Error(`发布包文件名无效：${archiveName}`);
  }
  const archivePath = path.resolve(outputDir, archiveName);
  if (!archivePath.startsWith(`${outputDir}${path.sep}`)) throw new Error(`发布包路径超出输出目录：${archiveName}`);
  const hashPath = `${archivePath}.sha256`;
  const metadataPath = `${archivePath}.manifest.json`;

  const entries = await readReleaseEntries(rootDir, files);
  const archiveBuffer = Buffer.from(zipSync(entries, {
    attrs: ZIP_ATTRIBUTES.attrs,
    level: 9,
    mtime: ZIP_DATE,
    os: ZIP_ATTRIBUTES.os
  }));
  await verifyArchiveContents(archiveBuffer, rootDir, files);

  const digest = sha256(archiveBuffer);
  const metadata = {
    schemaVersion: 1,
    version: manifest.version,
    archive: archiveName,
    sha256: digest,
    fileCount: Object.keys(entries).length,
    files: Object.keys(entries).sort()
  };

  await mkdir(outputDir, { recursive: true });
  if (options.cleanOutput !== false) await rm(archivePath, { force: true });
  await writeFile(archivePath, archiveBuffer);
  await writeFile(hashPath, `${digest}  ${archiveName}\n`, 'utf8');
  await writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');

  return Object.freeze({
    archiveBuffer,
    archivePath,
    hash: digest,
    hashPath,
    metadata,
    metadataPath
  });
}

async function main() {
  const result = await createReleaseArchive();
  console.log('ECHO 发布包已生成');
  console.log(JSON.stringify({
    archive: result.archivePath,
    files: result.metadata.fileCount,
    sha256: result.hash
  }, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT_PATH) {
  main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
