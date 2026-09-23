import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium, expect, test as base } from '@playwright/test';

import { startLocalFixtureServer } from './local-server.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

async function waitForExtensionWorker(context) {
  const existing = context.serviceWorkers().find(worker => worker.url().includes('background.js'));
  return existing || context.waitForEvent('serviceworker', {
    predicate: worker => worker.url().includes('background.js')
  });
}

async function normalizeInitialPages(context) {
  const pages = context.pages();
  const anchorPage = pages[0] || await context.newPage();
  await anchorPage.goto('about:blank');
  for (const page of context.pages()) {
    if (page !== anchorPage) await page.close();
  }
  return anchorPage;
}

export const test = base.extend({
  fixtureServer: [async ({}, use) => {
    const server = await startLocalFixtureServer();
    await use(server);
    await server.close();
  }, { scope: 'worker' }],

  extension: async ({}, use) => {
    const userDataDir = await mkdtemp(path.join(os.tmpdir(), 'echo-playwright-'));
    let context;
    try {
      context = await chromium.launchPersistentContext(userDataDir, {
        acceptDownloads: false,
        channel: 'chromium',
        headless: true,
        args: [
          `--disable-extensions-except=${ROOT}`,
          `--load-extension=${ROOT}`
        ]
      });
      const serviceWorker = await waitForExtensionWorker(context);
      const extensionId = new URL(serviceWorker.url()).hostname;
      const extensionUrl = relativePath => `chrome-extension://${extensionId}/${relativePath}`;

      await expect.poll(async () => serviceWorker.evaluate(async () => {
        const values = await chrome.storage.sync.get(['mouseGesture', 'tabSwitchKey']);
        return values.mouseGesture === true && values.tabSwitchKey === true;
      }), {
        message: '等待扩展安装设置初始化',
        timeout: 15_000
      }).toBe(true);

      await expect.poll(async () => serviceWorker.evaluate(async () => {
        const tabs = await chrome.tabs.query({});
        return tabs.some(tab => tab.url?.includes('/fre/fre-step1.html'));
      }), {
        message: '等待首次运行页面创建',
        timeout: 15_000
      }).toBe(true);

      const anchorPage = await normalizeInitialPages(context);
      const controlPage = await context.newPage();
      await controlPage.goto(extensionUrl('docs-viewer.html'));
      await anchorPage.bringToFront();

      await use(Object.freeze({
        anchorPage,
        controlPage,
        context,
        extensionId,
        extensionUrl,
        serviceWorker,
        async getStorage(area, keys) {
          return serviceWorker.evaluate(
            ({ area, keys }) => chrome.storage[area].get(keys),
            { area, keys }
          );
        },
        async openExtensionPage(relativePath) {
          const page = await context.newPage();
          await page.goto(extensionUrl(relativePath));
          return page;
        },
        async queryTabs() {
          return serviceWorker.evaluate(async () => {
            const tabs = await chrome.tabs.query({ currentWindow: true });
            return tabs.map(tab => ({
              active: tab.active,
              id: tab.id,
              index: tab.index,
              pendingUrl: tab.pendingUrl,
              url: tab.url
            }));
          });
        },
        async sendMessage(message) {
          return controlPage.evaluate(message => chrome.runtime.sendMessage(message), message);
        },
        async setStorage(area, values) {
          await serviceWorker.evaluate(
            ({ area, values }) => chrome.storage[area].set(values),
            { area, values }
          );
        }
      }));
    } finally {
      await context?.close();
      await rm(userDataDir, { force: true, recursive: true });
    }
  }
});

export { expect };
