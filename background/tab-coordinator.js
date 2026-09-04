(function(root) {
  'use strict';

  function create(chromeApi, options) {
    const settingsSchema = options.settingsSchema;
    const getSetting = options.getSetting;
    const messages = options.messages;
    const onTabRemoved = options.onTabRemoved || (() => Promise.resolve());

    let isRightMouseDown = false;
    const insertStateByWindow = new Map();
    const extensionCreatedTabs = new Set();
    const pendingExtensionCreations = new Set();
    const creationQueueByWindow = new Map();
    const tabsCacheByWindow = new Map();
    const pendingActivationChecks = new Map();
    const removalTransactions = new Map();

    function getInsertState(windowId) {
      if (!insertStateByWindow.has(windowId)) {
        insertStateByWindow.set(windowId, {
          baseTabId: null,
          baseTabIndex: -1,
          insertCount: 0
        });
      }
      return insertStateByWindow.get(windowId);
    }

    function getEffectiveTabUrl(tab) {
      return tab.pendingUrl && tab.pendingUrl !== 'about:blank'
        ? tab.pendingUrl
        : (tab.url || '');
    }

    function consumeExtensionCreation(tab) {
      if (extensionCreatedTabs.delete(tab.id)) return true;
      const tabUrl = getEffectiveTabUrl(tab);
      for (const token of pendingExtensionCreations) {
        if (token.url !== tabUrl || (token.windowId !== null && token.windowId !== tab.windowId)) continue;
        token.consumed = true;
        pendingExtensionCreations.delete(token);
        return true;
      }
      return false;
    }

    async function createExtensionTab(createOptions) {
      const token = {
        consumed: false,
        url: createOptions.url || 'about:blank',
        windowId: createOptions.windowId ?? null
      };
      pendingExtensionCreations.add(token);
      try {
        const created = await chromeApi.tabs.create(createOptions);
        if (!token.consumed) {
          pendingExtensionCreations.delete(token);
          extensionCreatedTabs.add(created.id);
        }
        return created;
      } catch (error) {
        pendingExtensionCreations.delete(token);
        throw error;
      }
    }

    async function updateBaseTab(tabId, windowId) {
      try {
        const tab = await chromeApi.tabs.get(tabId);
        const state = getInsertState(windowId);
        if (state.baseTabId === tabId) state.baseTabIndex = tab.index;
      } catch {}
    }

    async function calculateNewTabIndex(windowId, activeTab = null) {
      const settings = await chromeApi.storage.sync.get(settingsSchema.getDefaults([
        'newTabPosition',
        'newTabOrder'
      ]));
      if (settings.newTabPosition === 'atEnd') return undefined;

      const state = getInsertState(windowId);
      if (activeTab && state.baseTabId !== activeTab.id) {
        state.baseTabId = activeTab.id;
        state.baseTabIndex = activeTab.index;
        state.insertCount = 0;
      } else if (activeTab) {
        state.baseTabIndex = activeTab.index;
      }
      if (state.baseTabIndex < 0 && state.baseTabId) {
        try {
          state.baseTabIndex = (await chromeApi.tabs.get(state.baseTabId)).index;
        } catch {}
      }
      if (state.baseTabId === null || state.baseTabIndex < 0) {
        try {
          const [activeTab] = await chromeApi.tabs.query({ windowId, active: true });
          if (activeTab) {
            state.baseTabId = activeTab.id;
            state.baseTabIndex = activeTab.index;
            state.insertCount = 0;
          }
        } catch {
          return undefined;
        }
      }

      const targetIndex = settings.newTabOrder === 'newest'
        ? state.baseTabIndex + 1
        : state.baseTabIndex + 1 + state.insertCount;
      state.insertCount += 1;
      return targetIndex;
    }

    function isNtpUrl(value) {
      if (!value) return false;
      const url = value.split('?')[0];
      return url.startsWith('edge://newtab')
        || url.startsWith('chrome://newtab')
        || url.includes('/ntp/ntp.html')
        || (url.startsWith('chrome-extension://') && !url.includes(chromeApi.runtime.id));
    }

    async function handleNewTabCreated(tab, snapshotBaseTabId) {
      const settings = await chromeApi.storage.sync.get(settingsSchema.getDefaults([
        'newTabPosition',
        'newTabOrder',
        'applyToPlusButton'
      ]));
      if (settings.newTabPosition === 'atEnd') return;

      let effectiveUrl = tab.url;
      if ((!effectiveUrl || effectiveUrl === 'about:blank') && tab.pendingUrl) effectiveUrl = tab.pendingUrl;
      if (isNtpUrl(effectiveUrl) && !settings.applyToPlusButton) return;

      const windowId = tab.windowId;
      let state = getInsertState(windowId);
      let effectiveBaseTabId = tab.openerTabId || snapshotBaseTabId || state.baseTabId;
      if (effectiveBaseTabId === tab.id) {
        effectiveBaseTabId = snapshotBaseTabId && snapshotBaseTabId !== tab.id
          ? snapshotBaseTabId
          : null;
      }

      if (effectiveBaseTabId) {
        try {
          const baseTabIndex = (await chromeApi.tabs.get(effectiveBaseTabId)).index;
          if (effectiveBaseTabId !== state.baseTabId) {
            state = { baseTabId: effectiveBaseTabId, baseTabIndex, insertCount: 0 };
          } else {
            state.baseTabIndex = baseTabIndex;
          }
        } catch {}
      }

      if (state.baseTabIndex < 0 || state.baseTabId === null) {
        try {
          const [activeTab] = await chromeApi.tabs.query({ windowId, active: true });
          if (!activeTab || activeTab.id === tab.id) return;
          state.baseTabId = activeTab.id;
          state.baseTabIndex = activeTab.index;
          state.insertCount = 0;
        } catch {
          return;
        }
      }

      if (extensionCreatedTabs.has(tab.id)) {
        extensionCreatedTabs.delete(tab.id);
        return;
      }

      const targetIndex = settings.newTabOrder === 'newest'
        ? state.baseTabIndex + 1
        : state.baseTabIndex + 1 + state.insertCount;
      if (targetIndex >= 0 && targetIndex !== tab.index) {
        try { await chromeApi.tabs.move(tab.id, { index: targetIndex }); } catch {}
      }
      const globalState = getInsertState(windowId);
      if (globalState.baseTabId === state.baseTabId) globalState.insertCount += 1;
    }

    function queueCreatedTab(tab, snapshotBaseTabId) {
      const previous = creationQueueByWindow.get(tab.windowId) || Promise.resolve();
      const next = previous.then(() => handleNewTabCreated(tab, snapshotBaseTabId));
      creationQueueByWindow.set(tab.windowId, next.catch(() => {}));
    }

    async function initWindowCache(windowId) {
      try {
        const tabs = (await chromeApi.tabs.query({ windowId })).sort((left, right) => left.index - right.index);
        const activeTab = tabs.find(tab => tab.active);
        tabsCacheByWindow.set(windowId, {
          tabs: tabs.map(tab => tab.id),
          activeTabId: activeTab?.id ?? null,
          lastActiveTabId: null
        });
      } catch (error) {
        console.error('Init window cache error:', error);
      }
    }

    async function initAllWindowsCache() {
      try {
        const windows = await chromeApi.windows.getAll();
        await Promise.all(windows.map(windowInfo => initWindowCache(windowInfo.id)));
      } catch (error) {
        console.error('Init all windows cache error:', error);
      }
    }

    function handleTabCreated(tab) {
      const createdByExtension = consumeExtensionCreation(tab);
      if (!createdByExtension
          && !tab.pendingUrl?.startsWith('chrome-extension://')
          && !tab.url?.startsWith('chrome-extension://')) {
        const snapshotBaseTabId = getInsertState(tab.windowId).baseTabId;
        queueCreatedTab(tab, snapshotBaseTabId);
      }

      const cache = tabsCacheByWindow.get(tab.windowId);
      if (cache) cache.tabs.splice(tab.index, 0, tab.id);
      else void initWindowCache(tab.windowId);
    }

    function classifyActivation(tabId, windowId, cache) {
      const previousTabId = cache.activeTabId;
      cache.activeTabId = tabId;
      cache.lastActiveTabId = null;
      if (previousTabId === null) return;

      const token = {};
      const promise = (async () => {
        await new Promise(resolve => setTimeout(resolve, 0));
        let previousTabStillExists = true;
        try { await chromeApi.tabs.get(previousTabId); } catch { previousTabStillExists = false; }
        const pending = pendingActivationChecks.get(windowId);
        if (pending?.token !== token || cache.activeTabId !== tabId) return;
        cache.lastActiveTabId = previousTabStillExists ? null : previousTabId;
      })().finally(() => {
        if (pendingActivationChecks.get(windowId)?.token === token) {
          pendingActivationChecks.delete(windowId);
        }
      });
      pendingActivationChecks.set(windowId, { token, promise });
    }

    function handleTabActivated({ tabId, windowId }) {
      if (removalTransactions.has(windowId)) return;

      const insertState = getInsertState(windowId);
      insertState.baseTabId = tabId;
      insertState.baseTabIndex = -1;
      insertState.insertCount = 0;
      void updateBaseTab(tabId, windowId);

      const cache = tabsCacheByWindow.get(windowId);
      if (!cache) return;
      if (cache.activeTabId !== tabId) classifyActivation(tabId, windowId, cache);
      else cache.activeTabId = tabId;
    }

    async function handleTabMoved(tabId, { windowId, fromIndex, toIndex }) {
      const insertState = getInsertState(windowId);
      if (insertState.baseTabId === tabId) {
        insertState.baseTabIndex = toIndex;
        insertState.insertCount = 0;
      } else if (insertState.baseTabIndex >= 0) {
        if (fromIndex < toIndex && insertState.baseTabIndex > fromIndex
            && insertState.baseTabIndex <= toIndex) {
          insertState.baseTabIndex -= 1;
        } else if (fromIndex > toIndex && insertState.baseTabIndex >= toIndex
            && insertState.baseTabIndex < fromIndex) {
          insertState.baseTabIndex += 1;
        }
      }

      const cache = tabsCacheByWindow.get(windowId);
      if (!cache) return;
      if (cache.tabs[fromIndex] !== tabId) {
        await initWindowCache(windowId);
        return;
      }
      cache.tabs.splice(fromIndex, 1);
      cache.tabs.splice(toIndex, 0, tabId);
    }

    function handleTabDetached(tabId, { oldWindowId }) {
      const cache = tabsCacheByWindow.get(oldWindowId);
      if (!cache) return;
      const index = cache.tabs.indexOf(tabId);
      if (index !== -1) cache.tabs.splice(index, 1);
      if (cache.activeTabId === tabId) cache.activeTabId = null;
    }

    async function handleTabAttached(tabId, { newWindowId, newPosition }) {
      const cache = tabsCacheByWindow.get(newWindowId);
      if (cache) cache.tabs.splice(newPosition, 0, tabId);
      else await initWindowCache(newWindowId);
    }

    function releaseRemoval(windowId, token, delay) {
      setTimeout(() => {
        if (removalTransactions.get(windowId) === token) removalTransactions.delete(windowId);
      }, delay);
    }

    async function handleTabRemoved(tabId, removeInfo) {
      const { windowId, isWindowClosing } = removeInfo;
      try {
        await onTabRemoved(tabId);
      } catch (error) {
        console.warn('[ECHO] Failed to clear removed tab state:', error);
      }
      if (isWindowClosing) {
        tabsCacheByWindow.delete(windowId);
        insertStateByWindow.delete(windowId);
        creationQueueByWindow.delete(windowId);
        return;
      }

      const removalToken = {};
      removalTransactions.set(windowId, removalToken);
      const release = delay => releaseRemoval(windowId, removalToken, delay);
      const cache = tabsCacheByWindow.get(windowId);
      if (!cache) {
        release(100);
        return;
      }

      const pendingActivation = pendingActivationChecks.get(windowId);
      if (pendingActivation) await pendingActivation.promise;

      const closedIndex = cache.tabs.indexOf(tabId);
      const wasActive = cache.activeTabId === tabId || cache.lastActiveTabId === tabId;
      if (closedIndex === -1) {
        void initWindowCache(windowId);
        release(100);
        return;
      }
      cache.tabs.splice(closedIndex, 1);

      const insertState = insertStateByWindow.get(windowId);
      if (insertState) {
        if (closedIndex < insertState.baseTabIndex) insertState.baseTabIndex -= 1;
        else if (closedIndex > insertState.baseTabIndex
            && closedIndex <= insertState.baseTabIndex + insertState.insertCount) {
          insertState.insertCount = Math.max(0, insertState.insertCount - 1);
        }
        if (tabId === insertState.baseTabId) {
          insertState.baseTabId = null;
          insertState.baseTabIndex = -1;
          insertState.insertCount = 0;
        }
      }

      if (await getSetting('closeTabActivate') === 'right') {
        try {
          const [activeTab] = await chromeApi.tabs.query({ windowId, active: true });
          if (activeTab) cache.activeTabId = activeTab.id;
        } catch {}
        release(100);
        return;
      }
      if (!wasActive || !cache.tabs.length) {
        release(100);
        return;
      }
      if (closedIndex >= cache.tabs.length) {
        cache.activeTabId = cache.tabs.at(-1);
        release(100);
        return;
      }
      if (closedIndex === 0) {
        cache.activeTabId = cache.tabs[0];
        release(100);
        return;
      }

      const leftTabId = cache.tabs[closedIndex - 1];
      try {
        await chromeApi.tabs.update(leftTabId, { active: true });
        cache.activeTabId = leftTabId;
      } catch (error) {
        console.error('Activate left tab error:', error);
      } finally {
        release(50);
      }
    }

    function handleWindowRemoved(windowId) {
      tabsCacheByWindow.delete(windowId);
      insertStateByWindow.delete(windowId);
      creationQueueByWindow.delete(windowId);
      pendingActivationChecks.delete(windowId);
      removalTransactions.delete(windowId);
      for (const token of pendingExtensionCreations) {
        if (token.windowId === windowId) pendingExtensionCreations.delete(token);
      }
    }

    function isInjectablePage(url) {
      return Boolean(url?.startsWith('http://') || url?.startsWith('https://'));
    }

    function isSwitchableTab(url, pendingUrl) {
      const extensionId = chromeApi.runtime.id;
      if (pendingUrl?.startsWith(`chrome-extension://${extensionId}/`)
          || pendingUrl?.startsWith(`extension://${extensionId}/`)) return true;
      if (!url) return false;
      if (url.startsWith('http://') || url.startsWith('https://')) return true;
      if (url.startsWith(`chrome-extension://${extensionId}/`)
          || url.startsWith(`extension://${extensionId}/`)) return true;
      return url === 'edge://newtab/' || url === 'chrome://newtab/';
    }

    async function handleSwitchTab(direction, source = 'keyboard') {
      if (source === 'keyboard' && !await getSetting('tabSwitchKey')) return;
      try {
        const [currentTab] = await chromeApi.tabs.query({ active: true, currentWindow: true });
        if (!currentTab) return;
        const tabs = await chromeApi.tabs.query({ currentWindow: true });
        const currentIndex = tabs.findIndex(tab => tab.id === currentTab.id);
        let targetIndex = currentIndex;
        let attempts = 0;
        do {
          targetIndex = direction === 'left'
            ? (targetIndex > 0 ? targetIndex - 1 : tabs.length - 1)
            : (targetIndex < tabs.length - 1 ? targetIndex + 1 : 0);
          attempts += 1;
          const target = tabs[targetIndex];
          if (isSwitchableTab(target.url || '', target.pendingUrl || '') || attempts >= tabs.length) break;
        } while (targetIndex !== currentIndex);

        if (targetIndex === currentIndex) return;
        const target = tabs[targetIndex];
        await chromeApi.tabs.update(target.id, { active: true });
        if (source === 'mouseGesture' && isRightMouseDown
            && isInjectablePage(target.url || target.pendingUrl || '')) {
          setTimeout(() => {
            chromeApi.tabs.sendMessage(target.id, {
              action: messages.ACTIONS.SYNC_MOUSE_GESTURE_STATE,
              isRightMouseDown: true
            }).catch(() => {});
          }, 50);
        }
      } catch (error) {
        console.error('Switch tab error:', error);
      }
    }

    async function handleOpenInNewTab(url, active, forceAdjacentPosition = false) {
      try {
        const shouldBeActive = active !== undefined
          ? active
          : await getSetting('superDragActivate');
        const [activeTab] = await chromeApi.tabs.query({ active: true, currentWindow: true });
        if (!activeTab) {
          await createExtensionTab({ url, active: shouldBeActive });
          return;
        }
        const createOptions = { url, active: shouldBeActive };
        if (forceAdjacentPosition) {
          createOptions.index = activeTab.index + 1;
          createOptions.openerTabId = activeTab.id;
        } else {
          const index = await calculateNewTabIndex(activeTab.windowId, activeTab);
          if (index !== undefined) createOptions.index = index;
        }
        await createExtensionTab(createOptions);
      } catch (error) {
        console.error('Open in new tab error:', error);
      }
    }

    async function handleSearchInNewTab(text, forceAdjacentPosition = false) {
      const url = `https://www.bing.com/search?q=${encodeURIComponent(text)}`;
      const active = await getSetting('superDragActivate');
      await handleOpenInNewTab(url, active, forceAdjacentPosition);
    }

    function setMouseGestureState(value) {
      isRightMouseDown = Boolean(value);
    }

    function register() {
      chromeApi.tabs.onCreated.addListener(handleTabCreated);
      chromeApi.tabs.onActivated.addListener(handleTabActivated);
      chromeApi.tabs.onMoved.addListener(handleTabMoved);
      chromeApi.tabs.onDetached.addListener(handleTabDetached);
      chromeApi.tabs.onAttached.addListener(handleTabAttached);
      chromeApi.tabs.onRemoved.addListener(handleTabRemoved);
      chromeApi.windows.onCreated.addListener(windowInfo => initWindowCache(windowInfo.id));
      chromeApi.windows.onRemoved.addListener(handleWindowRemoved);
      void initAllWindowsCache();
    }

    return Object.freeze({
      calculateNewTabIndex,
      handleNewTabCreated,
      handleOpenInNewTab,
      handleSearchInNewTab,
      handleSwitchTab,
      initAllWindowsCache,
      initWindowCache,
      isInjectablePage,
      isSwitchableTab,
      register,
      setMouseGestureState
    });
  }

  root.EchoBackgroundTabCoordinator = Object.freeze({ create });
})(globalThis);
