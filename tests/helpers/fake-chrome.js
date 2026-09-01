import { FakeChromeEvent, createPortPair } from './fake-event.js';

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function withOptionalCallback(promise, callback) {
  if (typeof callback !== 'function') return promise;
  promise.then((value) => callback(value));
  return undefined;
}

function wildcardToRegExp(pattern) {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replaceAll('*', '.*');
  return new RegExp(`^${escaped}$`);
}

function matchesQuery(tab, query, currentWindowId) {
  return Object.entries(query || {}).every(([key, expected]) => {
    if (key === 'currentWindow') return !expected || tab.windowId === currentWindowId;
    if (key === 'url') {
      const patterns = Array.isArray(expected) ? expected : [expected];
      return patterns.some((pattern) => wildcardToRegExp(pattern).test(tab.url || ''));
    }
    if (key === 'active' || key === 'audible' || key === 'windowId') return tab[key] === expected;
    return true;
  });
}

function createStorageArea(areaName, storageState, onChanged, failures) {
  function getResult(keys) {
    const source = storageState[areaName];
    if (keys === null || keys === undefined) return clone(source);
    if (typeof keys === 'string') return { [keys]: clone(source[keys]) };
    if (Array.isArray(keys)) {
      return Object.fromEntries(keys.map((key) => [key, clone(source[key])]));
    }
    if (typeof keys === 'object') {
      return Object.fromEntries(Object.entries(keys).map(([key, fallback]) => [
        key,
        Object.prototype.hasOwnProperty.call(source, key) ? clone(source[key]) : clone(fallback)
      ]));
    }
    return {};
  }

  return {
    get(keys, callback) {
      return withOptionalCallback(Promise.resolve(getResult(keys)), callback);
    },
    set(items, callback) {
      const promise = Promise.resolve().then(() => {
        const failure = failures[areaName].shift();
        if (failure) throw failure;
        const changes = {};
        for (const [key, value] of Object.entries(items || {})) {
          const oldValue = clone(storageState[areaName][key]);
          const newValue = clone(value);
          storageState[areaName][key] = newValue;
          if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) changes[key] = { oldValue, newValue };
        }
        if (Object.keys(changes).length) onChanged.emit(changes, areaName);
      });
      return withOptionalCallback(promise, callback);
    },
    remove(keys, callback) {
      const promise = Promise.resolve().then(() => {
        const changes = {};
        for (const key of Array.isArray(keys) ? keys : [keys]) {
          if (!Object.prototype.hasOwnProperty.call(storageState[areaName], key)) continue;
          changes[key] = { oldValue: clone(storageState[areaName][key]), newValue: undefined };
          delete storageState[areaName][key];
        }
        if (Object.keys(changes).length) onChanged.emit(changes, areaName);
      });
      return withOptionalCallback(promise, callback);
    },
    clear(callback) {
      const promise = Promise.resolve().then(() => {
        const changes = Object.fromEntries(Object.entries(storageState[areaName]).map(([key, value]) => [
          key,
          { oldValue: clone(value), newValue: undefined }
        ]));
        storageState[areaName] = {};
        if (Object.keys(changes).length) onChanged.emit(changes, areaName);
      });
      return withOptionalCallback(promise, callback);
    }
  };
}

function normalizeSeedTabs(tabs) {
  const byWindow = new Map();
  for (const source of tabs) {
    const windowId = source.windowId ?? 1;
    if (!byWindow.has(windowId)) byWindow.set(windowId, []);
    byWindow.get(windowId).push({ ...source, windowId });
  }
  const result = [];
  for (const windowTabs of byWindow.values()) {
    windowTabs.sort((left, right) => (left.index ?? 0) - (right.index ?? 0));
    windowTabs.forEach((tab, index) => result.push({
      id: tab.id,
      windowId: tab.windowId,
      index,
      active: Boolean(tab.active),
      audible: Boolean(tab.audible),
      mutedInfo: clone(tab.mutedInfo || { muted: false }),
      url: tab.url || 'about:blank',
      pendingUrl: tab.pendingUrl,
      openerTabId: tab.openerTabId,
      zoomFactor: tab.zoomFactor || 1
    }));
  }
  return result;
}

export function createFakeChrome(options = {}) {
  const onStorageChanged = new FakeChromeEvent();
  const storageState = {
    sync: clone(options.storage?.sync || {}),
    local: clone(options.storage?.local || {}),
    session: clone(options.storage?.session || {})
  };
  const storageFailures = { sync: [], local: [], session: [] };
  const records = {
    tabMessages: [],
    tabConnections: [],
    downloads: [],
    scriptInjections: [],
    openedOptionsPages: 0
  };
  const tabEvents = {
    onActivated: new FakeChromeEvent(),
    onAttached: new FakeChromeEvent(),
    onCreated: new FakeChromeEvent(),
    onDetached: new FakeChromeEvent(),
    onMoved: new FakeChromeEvent(),
    onRemoved: new FakeChromeEvent()
  };
  const windowEvents = { onCreated: new FakeChromeEvent(), onRemoved: new FakeChromeEvent() };
  const runtimeEvents = {
    onConnect: new FakeChromeEvent(),
    onInstalled: new FakeChromeEvent(),
    onMessage: new FakeChromeEvent()
  };
  const commandEvent = new FakeChromeEvent();
  const actionClickEvent = new FakeChromeEvent();
  const dnrRules = new Map();
  const tabsById = new Map(normalizeSeedTabs(options.tabs || []).map((tab) => [tab.id, tab]));
  const windowsById = new Map();
  const currentWindowId = options.currentWindowId ?? 1;
  let nextTabId = Math.max(0, ...tabsById.keys()) + 1;
  let nextWindowId = Math.max(
    0,
    ...[...tabsById.values()].map((tab) => tab.windowId),
    ...(options.windows || []).map((windowInfo) => windowInfo.id)
  ) + 1;
  let nextDownloadId = 1;
  let runtimeSender = options.runtimeSender || {};

  function ensureWindow(windowId) {
    if (!windowsById.has(windowId)) windowsById.set(windowId, { id: windowId, state: 'normal', focused: false });
    return windowsById.get(windowId);
  }

  [...tabsById.values()].forEach((tab) => ensureWindow(tab.windowId));
  for (const windowInfo of options.windows || []) {
    windowsById.set(windowInfo.id, {
      id: windowInfo.id,
      state: windowInfo.state || 'normal',
      focused: Boolean(windowInfo.focused),
      type: windowInfo.type || 'normal'
    });
  }
  if (!windowsById.size) ensureWindow(currentWindowId);

  function sortedWindowTabs(windowId) {
    return [...tabsById.values()].filter((tab) => tab.windowId === windowId).sort((a, b) => a.index - b.index);
  }

  function reindexWindow(windowId) {
    sortedWindowTabs(windowId).forEach((tab, index) => { tab.index = index; });
  }

  function activateTab(tabId) {
    const tab = tabsById.get(tabId);
    if (!tab) throw new Error(`No tab with id: ${tabId}`);
    for (const candidate of tabsById.values()) {
      if (candidate.windowId === tab.windowId) candidate.active = candidate.id === tabId;
    }
    tabEvents.onActivated.emit({ tabId, windowId: tab.windowId });
  }

  const chrome = {
    runtime: {
      id: options.extensionId || 'echo-test-extension-id',
      lastError: undefined,
      ...runtimeEvents,
      getManifest: () => clone(options.manifest || { version: '1.3.3' }),
      getURL: (relativePath) => `chrome-extension://${options.extensionId || 'echo-test-extension-id'}/${relativePath}`,
      openOptionsPage: async () => { records.openedOptionsPages += 1; },
      sendMessage(message, callback) {
        const promise = new Promise((resolve, reject) => {
          let settled = false;
          let asynchronous = false;
          const sendResponse = (response) => {
            if (settled) return;
            settled = true;
            resolve(clone(response));
          };
          try {
            const results = runtimeEvents.onMessage.emit(clone(message), clone(runtimeSender), sendResponse);
            asynchronous = results.some((result) => result === true);
            const returnedPromise = results.find((result) => result && typeof result.then === 'function');
            if (returnedPromise) {
              asynchronous = true;
              returnedPromise.then(sendResponse, reject);
            }
            if (!asynchronous && !settled) sendResponse(undefined);
          } catch (error) {
            reject(error);
          }
        });
        return withOptionalCallback(promise, callback);
      },
      connect(connectInfo = {}) {
        const [clientPort, serverPort] = createPortPair(connectInfo.name || '', clone(runtimeSender));
        runtimeEvents.onConnect.emit(serverPort);
        return clientPort;
      }
    },
    storage: {
      onChanged: onStorageChanged,
      sync: createStorageArea('sync', storageState, onStorageChanged, storageFailures),
      local: createStorageArea('local', storageState, onStorageChanged, storageFailures),
      session: createStorageArea('session', storageState, onStorageChanged, storageFailures)
    },
    tabs: {
      ...tabEvents,
      query(queryInfo = {}, callback) {
        const result = sortedWindowTabs(queryInfo.windowId ?? currentWindowId)
          .concat(queryInfo.windowId === undefined && !queryInfo.currentWindow
            ? [...tabsById.values()].filter((tab) => tab.windowId !== currentWindowId).sort((a, b) => a.windowId - b.windowId || a.index - b.index)
            : [])
          .filter((tab) => matchesQuery(tab, queryInfo, currentWindowId))
          .map(clone);
        return withOptionalCallback(Promise.resolve(result), callback);
      },
      get(tabId, callback) {
        const promise = tabsById.has(tabId)
          ? Promise.resolve(clone(tabsById.get(tabId)))
          : Promise.reject(new Error(`No tab with id: ${tabId}`));
        return withOptionalCallback(promise, callback);
      },
      create(createProperties = {}, callback) {
        const promise = Promise.resolve().then(() => {
          const windowId = createProperties.windowId ?? currentWindowId;
          ensureWindow(windowId);
          const windowTabs = sortedWindowTabs(windowId);
          const index = Math.max(0, Math.min(createProperties.index ?? windowTabs.length, windowTabs.length));
          windowTabs.filter((tab) => tab.index >= index).forEach((tab) => { tab.index += 1; });
          const tab = {
            id: nextTabId++,
            windowId,
            index,
            active: createProperties.active !== false,
            audible: false,
            mutedInfo: { muted: false },
            url: createProperties.url || 'about:blank',
            pendingUrl: createProperties.pendingUrl,
            openerTabId: createProperties.openerTabId,
            zoomFactor: 1
          };
          tabsById.set(tab.id, tab);
          if (tab.active) {
            for (const candidate of tabsById.values()) {
              if (candidate.windowId === windowId && candidate.id !== tab.id) candidate.active = false;
            }
          }
          tabEvents.onCreated.emit(clone(tab));
          if (tab.active) tabEvents.onActivated.emit({ tabId: tab.id, windowId });
          return clone(tab);
        });
        return withOptionalCallback(promise, callback);
      },
      update(tabId, updateProperties, callback) {
        const promise = Promise.resolve().then(() => {
          const tab = tabsById.get(tabId);
          if (!tab) throw new Error(`No tab with id: ${tabId}`);
          if (typeof updateProperties.url === 'string') tab.url = updateProperties.url;
          if (typeof updateProperties.muted === 'boolean') tab.mutedInfo = { muted: updateProperties.muted };
          if (updateProperties.active && !tab.active) activateTab(tabId);
          return clone(tab);
        });
        return withOptionalCallback(promise, callback);
      },
      move(tabId, moveProperties, callback) {
        const promise = Promise.resolve().then(() => {
          const tab = tabsById.get(tabId);
          if (!tab) throw new Error(`No tab with id: ${tabId}`);
          const fromIndex = tab.index;
          const windowTabs = sortedWindowTabs(tab.windowId).filter((candidate) => candidate.id !== tabId);
          const toIndex = Math.max(0, Math.min(moveProperties.index, windowTabs.length));
          windowTabs.splice(toIndex, 0, tab);
          windowTabs.forEach((candidate, index) => { candidate.index = index; });
          tabEvents.onMoved.emit(tabId, { windowId: tab.windowId, fromIndex, toIndex });
          return clone(tab);
        });
        return withOptionalCallback(promise, callback);
      },
      remove(tabIds, callback) {
        const promise = Promise.resolve().then(async () => {
          for (const tabId of Array.isArray(tabIds) ? tabIds : [tabIds]) {
            const tab = tabsById.get(tabId);
            if (!tab) continue;
            const windowTabsBefore = sortedWindowTabs(tab.windowId);
            const wasActive = tab.active;
            const removedIndex = tab.index;
            tabsById.delete(tabId);
            reindexWindow(tab.windowId);
            const remaining = sortedWindowTabs(tab.windowId);
            const replacement = wasActive ? remaining[Math.min(removedIndex, remaining.length - 1)] : null;
            if (replacement && options.removalEventOrder === 'activated-first') activateTab(replacement.id);
            await tabEvents.onRemoved.emitAsync(tabId, { windowId: tab.windowId, isWindowClosing: false });
            if (replacement && options.removalEventOrder !== 'activated-first') activateTab(replacement.id);
            if (!remaining.length && windowTabsBefore.length) windowsById.delete(tab.windowId);
          }
        });
        return withOptionalCallback(promise, callback);
      },
      getZoom(tabId, callback) {
        const zoom = tabsById.get(tabId)?.zoomFactor ?? 1;
        return withOptionalCallback(Promise.resolve(zoom), callback);
      },
      setZoom(tabId, zoomFactor, callback) {
        const promise = Promise.resolve().then(() => {
          const tab = tabsById.get(tabId);
          if (!tab) throw new Error(`No tab with id: ${tabId}`);
          tab.zoomFactor = zoomFactor;
        });
        return withOptionalCallback(promise, callback);
      },
      sendMessage(tabId, message) {
        records.tabMessages.push({ tabId, message: clone(message) });
        return Promise.resolve();
      },
      connect(tabId, connectInfo = {}) {
        const [backgroundPort, contentPort] = createPortPair(connectInfo.name || '', { tab: clone(tabsById.get(tabId)) });
        records.tabConnections.push({ tabId, backgroundPort, contentPort });
        return backgroundPort;
      }
    },
    windows: {
      ...windowEvents,
      getAll(getInfoOrCallback, maybeCallback) {
        const callback = typeof getInfoOrCallback === 'function' ? getInfoOrCallback : maybeCallback;
        const populate = typeof getInfoOrCallback === 'object' && getInfoOrCallback.populate;
        const result = [...windowsById.values()].map((windowInfo) => ({
          ...clone(windowInfo),
          ...(populate ? { tabs: sortedWindowTabs(windowInfo.id).map(clone) } : {})
        }));
        return withOptionalCallback(Promise.resolve(result), callback);
      },
      create(createData = {}, callback) {
        const promise = Promise.resolve().then(async () => {
          const windowInfo = {
            id: nextWindowId++,
            state: createData.state || 'normal',
            focused: createData.focused !== false,
            type: createData.type || 'normal'
          };
          windowsById.set(windowInfo.id, windowInfo);
          if (createData.url) {
            const tab = await chrome.tabs.create({ windowId: windowInfo.id, url: createData.url, active: true });
            windowInfo.tabs = [tab];
          }
          windowEvents.onCreated.emit(clone(windowInfo));
          return clone(windowInfo);
        });
        return withOptionalCallback(promise, callback);
      },
      update(windowId, updateInfo, callback) {
        const promise = Promise.resolve().then(() => {
          const windowInfo = windowsById.get(windowId);
          if (!windowInfo) throw new Error(`No window with id: ${windowId}`);
          Object.assign(windowInfo, clone(updateInfo));
          return clone(windowInfo);
        });
        return withOptionalCallback(promise, callback);
      },
      remove(windowId, callback) {
        const promise = Promise.resolve().then(() => {
          if (!windowsById.has(windowId)) return;
          windowsById.delete(windowId);
          for (const tab of sortedWindowTabs(windowId)) tabsById.delete(tab.id);
          windowEvents.onRemoved.emit(windowId);
        });
        return withOptionalCallback(promise, callback);
      }
    },
    downloads: {
      onChanged: new FakeChromeEvent(),
      download(options, callback) {
        const promise = Promise.resolve().then(() => {
          const id = nextDownloadId++;
          records.downloads.push({ id, options: clone(options), state: 'in_progress' });
          return id;
        });
        return withOptionalCallback(promise, callback);
      }
    },
    declarativeNetRequest: {
      async updateDynamicRules({ removeRuleIds = [], addRules = [] }) {
        removeRuleIds.forEach((id) => dnrRules.delete(id));
        for (const rule of addRules) {
          if (dnrRules.has(rule.id)) throw new Error(`Rule with id ${rule.id} already exists`);
          dnrRules.set(rule.id, clone(rule));
        }
      },
      async getDynamicRules() {
        return [...dnrRules.values()].map(clone);
      }
    },
    scripting: {
      async executeScript(injection) {
        records.scriptInjections.push(clone(injection));
        return [];
      }
    },
    commands: {
      onCommand: commandEvent,
      getAll: async () => clone(options.commands || [])
    },
    action: {
      onClicked: actionClickEvent
    }
  };

  chrome.__testing = {
    records,
    storageState,
    dnrRules,
    tabsById,
    windowsById,
    failNextStorageSet(areaName, error = new Error('QUOTA_BYTES quota exceeded')) {
      storageFailures[areaName].push(error);
    },
    setRuntimeSender(sender) {
      runtimeSender = clone(sender);
    },
    activateTab,
    snapshotTabs(windowId = currentWindowId) {
      return sortedWindowTabs(windowId).map(clone);
    }
  };

  return chrome;
}