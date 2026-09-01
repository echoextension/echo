import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';
import { zipSync } from 'fflate';

import {
  createReleaseArchive,
  inspectArchive,
  verifyArchiveContents
} from '../../scripts/package-extension.mjs';
import { validateReleaseManifest } from '../../scripts/verify-release.mjs';

const temporaryDirectories = [];

async function createFixture() {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'echo-release-test-'));
  temporaryDirectories.push(rootDir);
  await mkdir(path.join(rootDir, 'nested'), { recursive: true });
  await writeFile(path.join(rootDir, 'manifest.json'), JSON.stringify({ version: '9.8.7' }));
  await writeFile(path.join(rootDir, 'alpha.txt'), 'alpha\n');
  await writeFile(path.join(rootDir, 'nested/beta.bin'), Buffer.from([0, 1, 2, 255]));
  return rootDir;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, {
    force: true,
    recursive: true
  })));
});

describe('release package', () => {
  it('creates byte-identical archives with an exact allowlist and SHA-256 metadata', async () => {
    const rootDir = await createFixture();
    const files = ['nested/beta.bin', 'manifest.json', 'alpha.txt'];
    const first = await createReleaseArchive({
      archiveName: 'first.zip',
      files,
      outputDir: path.join(rootDir, 'dist-a'),
      rootDir,
      validate: false
    });
    const second = await createReleaseArchive({
      archiveName: 'second.zip',
      files,
      outputDir: path.join(rootDir, 'dist-b'),
      rootDir,
      validate: false
    });

    expect(first.archiveBuffer.equals(second.archiveBuffer)).toBe(true);
    expect(first.hash).toBe(second.hash);
    expect(first.hash).toBe('f84dd784a31f7c33bb47a920786ff13860b1dc3dc8c0afb36fbc424ddb854bfc');
    expect(first.metadata.files).toEqual([...files].sort());
    expect(first.metadata.fileCount).toBe(3);
    expect(await readFile(first.hashPath, 'utf8')).toBe(`${first.hash}  first.zip\n`);

    const entries = inspectArchive(first.archiveBuffer);
    expect(Object.keys(entries).sort()).toEqual([...files].sort());
    expect(entries['alpha.txt'].toString()).toBe('alpha\n');
    await expect(verifyArchiveContents(first.archiveBuffer, rootDir, files)).resolves.toMatchObject({
      files: [...files].sort()
    });
  });

  it('rejects traversal paths before reading release files', async () => {
    const rootDir = await createFixture();

    await expect(createReleaseArchive({
      files: ['../outside.txt'],
      outputDir: path.join(rootDir, 'dist'),
      rootDir,
      validate: false
    })).rejects.toThrow('发布路径不安全');
  });

  it('rejects non-canonical aliases in the raw ZIP central directory', () => {
    const archive = zipSync({
      'manifest.json': new Uint8Array([1]),
      './manifest.json': new Uint8Array([2])
    });

    expect(() => inspectArchive(archive)).toThrow('发布路径不安全');
  });

  it('does not allow a custom archive name to escape the output directory', async () => {
    const rootDir = await createFixture();

    await expect(createReleaseArchive({
      archiveName: '../escape.zip',
      files: ['manifest.json'],
      outputDir: path.join(rootDir, 'dist'),
      rootDir,
      validate: false
    })).rejects.toThrow('发布包文件名无效');
  });

  it('rejects stale or tampered release manifests', () => {
    const expected = {
      archive: 'echo.zip',
      files: ['a.txt'],
      sha256: 'abc123',
      version: '1.4.0'
    };
    const valid = {
      schemaVersion: 1,
      version: '1.4.0',
      archive: 'echo.zip',
      sha256: 'abc123',
      fileCount: 1,
      files: ['a.txt']
    };

    expect(() => validateReleaseManifest(valid, expected)).not.toThrow();
    expect(() => validateReleaseManifest({ ...valid, sha256: 'tampered' }, expected))
      .toThrow('发布清单 SHA-256 不一致');
    expect(() => validateReleaseManifest({ ...valid, files: ['other.txt'] }, expected))
      .toThrow('发布清单文件表不一致');
  });
});
