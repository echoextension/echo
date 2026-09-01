import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { JSDOM, VirtualConsole } from 'jsdom';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

class ResizeObserverStub {
  constructor(callback) {
    this.callback = callback;
    this.observed = new Set();
  }

  observe(element) {
    this.observed.add(element);
  }

  unobserve(element) {
    this.observed.delete(element);
  }

  disconnect() {
    this.observed.clear();
  }
}

function createMatchMediaStub() {
  return (query) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent() { return false; }
  });
}

export async function readFixture(relativePath) {
  return readFile(path.join(ROOT, 'tests/fixtures', relativePath), 'utf8');
}

export async function createScriptDom(options = {}) {
  const html = options.htmlPath
    ? await readFile(path.join(ROOT, options.htmlPath), 'utf8')
    : (options.html || '<!doctype html><html><head></head><body></body></html>');
  const virtualConsole = new VirtualConsole();
  if (options.forwardConsole) virtualConsole.forwardTo(console);
  const dom = new JSDOM(html, {
    url: options.url || 'https://example.test/',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    virtualConsole
  });
  const { window } = dom;
  window.chrome = options.chrome;
  window.fetch = options.fetch || globalThis.fetch;
  window.Response = globalThis.Response;
  window.Request = globalThis.Request;
  window.Headers = globalThis.Headers;
  window.AbortController = globalThis.AbortController;
  window.AbortSignal = globalThis.AbortSignal;
  window.structuredClone = globalThis.structuredClone;
  window.indexedDB = globalThis.indexedDB;
  window.IDBKeyRange = globalThis.IDBKeyRange;
  window.ResizeObserver = options.ResizeObserver || ResizeObserverStub;
  window.matchMedia = options.matchMedia || createMatchMediaStub();
  window.scrollTo = () => {};
  window.HTMLElement.prototype.scrollIntoView ??= () => {};
  window.URL.createObjectURL ??= () => 'blob:echo-test';
  window.URL.revokeObjectURL ??= () => {};

  let nextAnimationFrameId = 1;
  if (options.animationFrames === 'immediate') {
    window.requestAnimationFrame = (callback) => {
      const id = nextAnimationFrameId++;
      queueMicrotask(() => callback(window.performance.now()));
      return id;
    };
  } else {
    window.requestAnimationFrame = () => nextAnimationFrameId++;
  }
  window.cancelAnimationFrame = () => {};

  return dom;
}

export async function executeWindowScript(dom, relativePath, afterSource = '') {
  const absolutePath = path.join(ROOT, relativePath);
  const source = await readFile(absolutePath, 'utf8');
  dom.window.eval(`${source}\n${afterSource}\n//# sourceURL=${pathToFileURL(absolutePath).href}`);
  await flushAsyncWork();
}

export async function executeExtensionWindowScript(dom, relativePath, afterSource = '') {
  if (!dom.window.EchoSettings) await executeWindowScript(dom, 'core/settings.js');
  if (!dom.window.EchoMessages) await executeWindowScript(dom, 'core/messages.js');
  if (!dom.window.EchoInputPolicy) await executeWindowScript(dom, 'core/input-policy.js');
  if (!dom.window.EchoInputContext) await executeWindowScript(dom, 'common/input-context.js');
  await executeWindowScript(dom, relativePath, afterSource);
}

export async function executeWorkerScript(chrome, relativePath = 'background.js', globals = {}) {
  const absolutePath = path.join(ROOT, relativePath);
  const source = await readFile(absolutePath, 'utf8');
  const context = vm.createContext({
    chrome,
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    queueMicrotask,
    URL,
    Blob,
    Response,
    Request,
    Headers,
    AbortController,
    AbortSignal,
    DOMException,
    structuredClone,
    fetch: globalThis.fetch,
    ...globals
  });
  context.importScripts = (...relativePaths) => {
    for (const importedPath of relativePaths) {
      const importedAbsolutePath = path.join(ROOT, importedPath);
      const importedSource = readFileSync(importedAbsolutePath, 'utf8');
      new vm.Script(importedSource, { filename: importedAbsolutePath }).runInContext(context);
    }
  };
  new vm.Script(source, { filename: absolutePath }).runInContext(context);
  await flushAsyncWork();
  return context;
}

export async function flushAsyncWork(turns = 4) {
  for (let index = 0; index < turns; index += 1) {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

export function responseJson(value, init = {}) {
  return new Response(JSON.stringify(value), {
    status: init.status || 200,
    headers: { 'Content-Type': 'application/json', ...(init.headers || {}) }
  });
}