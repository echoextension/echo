import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

import {
  EXTENSION_FILES,
  isAllowedExtensionFile,
  isForbiddenPackageFile,
  normalizePackagePath
} from './extension-files.mjs';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const DEFAULT_ROOT = path.resolve(path.dirname(SCRIPT_PATH), '..');

async function pathExists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJson(filePath, errors, label) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    errors.push(`${label} 不是有效 JSON：${error.message}`);
    return null;
  }
}

async function walkFiles(directory) {
  const result = [];
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === 'coverage'
        || entry.name === 'tests' || entry.name === 'crawler' || entry.name === 'playwright-report'
        || entry.name === 'external-playwright-report' || entry.name === 'test-results'
        || entry.name === 'dist') continue;
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await walkFiles(absolutePath));
    else result.push(absolutePath);
  }
  return result;
}

function addManifestPath(target, value) {
  if (typeof value === 'string' && value && !value.includes('*')) target.add(normalizePackagePath(value));
}

function collectManifestPaths(manifest) {
  const paths = new Set();
  addManifestPath(paths, manifest.background?.service_worker);
  addManifestPath(paths, manifest.options_page);
  addManifestPath(paths, manifest.action?.default_popup);
  Object.values(manifest.chrome_url_overrides || {}).forEach((value) => addManifestPath(paths, value));
  Object.values(manifest.icons || {}).forEach((value) => addManifestPath(paths, value));
  Object.values(manifest.action?.default_icon || {}).forEach((value) => addManifestPath(paths, value));
  for (const entry of manifest.content_scripts || []) {
    (entry.js || []).forEach((value) => addManifestPath(paths, value));
    (entry.css || []).forEach((value) => addManifestPath(paths, value));
  }
  for (const entry of manifest.web_accessible_resources || []) {
    (entry.resources || []).forEach((value) => addManifestPath(paths, value));
  }
  return paths;
}

function collectMessageKeys(value, result = new Set()) {
  if (typeof value === 'string') {
    for (const match of value.matchAll(/__MSG_([A-Za-z0-9_]+)__/g)) result.add(match[1]);
    return result;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectMessageKeys(item, result));
    return result;
  }
  if (value && typeof value === 'object') {
    Object.values(value).forEach((item) => collectMessageKeys(item, result));
  }
  return result;
}

function isExternalReference(reference) {
  return /^(?:[a-z]+:|\/\/|#)/i.test(reference);
}

function stripReferenceSuffix(reference) {
  return reference.split('#', 1)[0].split('?', 1)[0];
}

async function validateHtmlReferences(rootDir, allFiles, errors, stats) {
  const htmlFiles = allFiles.filter((filePath) => filePath.endsWith('.html'));
  const attributePattern = /\b(?:src|href)\s*=\s*["']([^"']+)["']/gi;
  for (const htmlPath of htmlFiles) {
    const source = await readFile(htmlPath, 'utf8');
    for (const match of source.matchAll(attributePattern)) {
      const rawReference = match[1].trim();
      if (!rawReference || isExternalReference(rawReference)) continue;
      const reference = decodeURIComponent(stripReferenceSuffix(rawReference));
      if (!reference) continue;
      const absoluteReference = reference.startsWith('/')
        ? path.resolve(rootDir, `.${reference}`)
        : path.resolve(path.dirname(htmlPath), reference);
      const relativeReference = path.relative(rootDir, absoluteReference);
      if (relativeReference.startsWith('..') || path.isAbsolute(relativeReference)) {
        errors.push(`${normalizePackagePath(path.relative(rootDir, htmlPath))} 引用了仓库外路径：${rawReference}`);
      } else if (!await pathExists(absoluteReference)) {
        errors.push(`${normalizePackagePath(path.relative(rootDir, htmlPath))} 缺少本地资源：${rawReference}`);
      }
      stats.htmlReferences += 1;
    }
  }
  stats.htmlFiles = htmlFiles.length;
}

function isValidDateString(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().startsWith(value);
}

function normalizeStringList(value) {
  return Array.isArray(value)
    ? [...new Set(value.filter(item => typeof item === 'string'))].sort()
    : [];
}

function validatePermissionList(value, label, errors) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || !item)) {
    errors.push(`${label} 必须是非空字符串数组`);
    return [];
  }
  if (new Set(value).size !== value.length) errors.push(`${label} 包含重复项`);
  return normalizeStringList(value);
}

function latestChangelogVersion(source) {
  return source.match(/^##\s+(\d+\.\d+\.\d+(?:\.\d+)?)\s+-/m)?.[1] || null;
}

async function validateReleaseMetadata(rootDir, manifest, errors, stats) {
  const packageJson = await readJson(path.join(rootDir, 'package.json'), errors, 'package.json');
  if (packageJson && manifest.version !== packageJson.version) {
    errors.push('package.json version 必须与 manifest.json 一致');
  }

  const changelog = await readFile(path.join(rootDir, 'CHANGELOG.md'), 'utf8');
  const changelogVersion = latestChangelogVersion(changelog);
  if (changelogVersion !== manifest.version) {
    errors.push(`CHANGELOG 最新版本 ${changelogVersion || '(缺失)'} 与 Manifest ${manifest.version} 不一致`);
  }

  const baseline = await readJson(
    path.join(rootDir, 'scripts/manifest-permissions-baseline.json'),
    errors,
    'scripts/manifest-permissions-baseline.json'
  );
  if (baseline) {
    const fields = [
      ['permissions', 'permissions'],
      ['host_permissions', 'hostPermissions'],
      ['optional_permissions', 'optionalPermissions'],
      ['optional_host_permissions', 'optionalHostPermissions']
    ];
    const actual = {};
    for (const [manifestKey, baselineKey] of fields) {
      const actualValues = validatePermissionList(manifest[manifestKey], `Manifest ${manifestKey}`, errors);
      const expectedValues = validatePermissionList(baseline[baselineKey], `权限基线 ${baselineKey}`, errors);
      actual[manifestKey] = actualValues;
      if (JSON.stringify(actualValues) !== JSON.stringify(expectedValues)) {
        errors.push(`Manifest ${manifestKey} 与审核基线不一致：${actualValues.join(', ')}`);
      }
    }
    stats.permissions = actual.permissions.length;
    stats.hostPermissions = actual.host_permissions.length;
  }
  stats.releaseVersion = manifest.version;
}

async function validateLocales(rootDir, manifest, errors, stats) {
  const localesDir = path.join(rootDir, '_locales');
  const localeNames = (await readdir(localesDir, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const localeMessages = new Map();
  for (const localeName of localeNames) {
    const messages = await readJson(
      path.join(localesDir, localeName, 'messages.json'),
      errors,
      `_locales/${localeName}/messages.json`
    );
    if (!messages) continue;
    localeMessages.set(localeName, messages);
    for (const [key, entry] of Object.entries(messages)) {
      if (!entry || typeof entry.message !== 'string' || !entry.message) {
        errors.push(`Locale ${localeName} 的 ${key} 缺少非空 message`);
      }
    }
  }

  const baselineName = manifest.default_locale;
  const baseline = localeMessages.get(baselineName);
  if (!baseline) {
    errors.push(`default_locale ${baselineName} 不存在`);
    return;
  }
  const baselineKeys = Object.keys(baseline).sort();
  for (const [localeName, messages] of localeMessages) {
    const keys = Object.keys(messages).sort();
    if (keys.join('\n') !== baselineKeys.join('\n')) {
      errors.push(`Locale ${localeName} 的 key 与 ${baselineName} 不一致`);
    }
  }
  for (const key of collectMessageKeys(manifest)) {
    for (const [localeName, messages] of localeMessages) {
      if (!messages[key]) errors.push(`Manifest 使用的消息 ${key} 未在 ${localeName} 中定义`);
    }
  }
  stats.locales = localeNames.length;
  stats.localeKeys = baselineKeys.length;
}

async function validateWallpaperData(rootDir, errors, stats) {
  const relativePath = 'website/wallpaper-data.json';
  const wallpapers = await readJson(path.join(rootDir, relativePath), errors, relativePath);
  if (!Array.isArray(wallpapers) || wallpapers.length === 0) {
    errors.push(`${relativePath} 必须是非空数组`);
    return;
  }
  const ids = new Set();
  const dates = new Set();
  let previousDate = null;
  wallpapers.forEach((wallpaper, index) => {
    const label = `${relativePath}[${index}]`;
    if (!wallpaper || typeof wallpaper !== 'object' || Array.isArray(wallpaper)) {
      errors.push(`${label} 必须是对象`);
      return;
    }
    for (const key of ['id', 'date', 'desc', 'copyright']) {
      if (typeof wallpaper[key] !== 'string') errors.push(`${label}.${key} 必须是字符串`);
    }
    if (typeof wallpaper.id === 'string') {
      if (!wallpaper.id) errors.push(`${label}.id 不能为空`);
      if (ids.has(wallpaper.id)) errors.push(`${label}.id 重复：${wallpaper.id}`);
      ids.add(wallpaper.id);
    }
    if (typeof wallpaper.date === 'string') {
      if (!isValidDateString(wallpaper.date)) errors.push(`${label}.date 无效：${wallpaper.date}`);
      if (dates.has(wallpaper.date)) errors.push(`${label}.date 重复：${wallpaper.date}`);
      if (previousDate && wallpaper.date > previousDate) {
        errors.push(`${label}.date 未按降序排列：${wallpaper.date} > ${previousDate}`);
      }
      previousDate = wallpaper.date;
      dates.add(wallpaper.date);
    }
  });
  stats.wallpapers = wallpapers.length;
}

async function validateJavaScript(rootDir, errors, stats) {
  const scripts = EXTENSION_FILES.filter((filePath) => filePath.endsWith('.js'));
  for (const relativePath of scripts) {
    try {
      const source = await readFile(path.join(rootDir, relativePath), 'utf8');
      new vm.Script(source, { filename: relativePath });
    } catch (error) {
      errors.push(`${relativePath} 语法解析失败：${error.message}`);
    }
  }
  stats.scripts = scripts.length;
}

export async function validateExtension(rootDir = DEFAULT_ROOT) {
  const errors = [];
  const stats = {
    allowlistedFiles: EXTENSION_FILES.length,
    htmlFiles: 0,
    htmlReferences: 0,
    locales: 0,
    localeKeys: 0,
    wallpapers: 0,
    scripts: 0,
    permissions: 0,
    hostPermissions: 0,
    releaseVersion: null
  };
  const normalizedRoot = path.resolve(rootDir);

  const duplicates = EXTENSION_FILES.filter((filePath, index) => EXTENSION_FILES.indexOf(filePath) !== index);
  if (duplicates.length) errors.push(`发布 allowlist 存在重复项：${[...new Set(duplicates)].join(', ')}`);
  for (const relativePath of EXTENSION_FILES) {
    if (isForbiddenPackageFile(relativePath)) errors.push(`发布 allowlist 包含禁止路径：${relativePath}`);
    if (!await pathExists(path.join(normalizedRoot, relativePath))) errors.push(`发布 allowlist 文件不存在：${relativePath}`);
  }

  const manifest = await readJson(path.join(normalizedRoot, 'manifest.json'), errors, 'manifest.json');
  if (!manifest) return { errors, stats };
  if (manifest.manifest_version !== 3) errors.push('manifest_version 必须为 3');
  if (!/^\d+\.\d+\.\d+(?:\.\d+)?$/.test(manifest.version || '')) errors.push('Manifest version 格式无效');
  await validateReleaseMetadata(normalizedRoot, manifest, errors, stats);

  const manifestPaths = collectManifestPaths(manifest);
  for (const relativePath of manifestPaths) {
    if (!await pathExists(path.join(normalizedRoot, relativePath))) errors.push(`Manifest 文件不存在：${relativePath}`);
    if (!isAllowedExtensionFile(relativePath)) errors.push(`Manifest 文件未进入发布 allowlist：${relativePath}`);
  }

  const allFiles = await walkFiles(normalizedRoot);
  await validateHtmlReferences(normalizedRoot, allFiles, errors, stats);
  await validateLocales(normalizedRoot, manifest, errors, stats);
  await validateWallpaperData(normalizedRoot, errors, stats);
  await validateJavaScript(normalizedRoot, errors, stats);

  const optionsHtml = await readFile(path.join(normalizedRoot, 'options/options.html'), 'utf8');
  const versionBadge = optionsHtml.match(/class=["']version-badge["'][^>]*>\s*v([^<\s]+)/i)?.[1];
  if (versionBadge !== manifest.version) {
    errors.push(`Options 版本徽标 ${versionBadge || '(缺失)'} 与 Manifest ${manifest.version} 不一致`);
  }

  const websiteHtml = await readFile(path.join(normalizedRoot, 'website/index.html'), 'utf8');
  const websiteSchemaVersion = websiteHtml.match(/"softwareVersion"\s*:\s*"([^"]+)"/)?.[1];
  if (websiteSchemaVersion !== manifest.version) {
    errors.push(`官网 softwareVersion ${websiteSchemaVersion || '(缺失)'} 与 Manifest ${manifest.version} 不一致`);
  }
  const websiteCtaVersions = [...websiteHtml.matchAll(/class=["']cta-ver["'][^>]*>\s*v([^<\s]+)/gi)]
    .map(match => match[1]);
  if (!websiteCtaVersions.length || websiteCtaVersions.some(version => version !== manifest.version)) {
    errors.push(`官网安装入口版本与 Manifest ${manifest.version} 不一致`);
  }

  return { errors, stats };
}

async function main() {
  const { errors, stats } = await validateExtension(DEFAULT_ROOT);
  if (errors.length) {
    console.error(`ECHO 静态校验失败（${errors.length} 项）：`);
    errors.forEach((error) => console.error(`- ${error}`));
    process.exitCode = 1;
    return;
  }
  console.log('ECHO 静态校验通过');
  console.log(JSON.stringify(stats, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT_PATH) {
  await main();
}