(function(root) {
  'use strict';

  function create(chromeApi, dependencies) {
    const messages = dependencies.messages;
    const actions = messages.ACTIONS;
    const handlers = new Map();

    async function getTargetTabId(sender) {
      if (sender?.tab?.id) return sender.tab.id;
      const [activeTab] = await chromeApi.tabs.query({ active: true, currentWindow: true });
      return activeTab?.id;
    }

    function isFreDemoSender(sender) {
      try {
        const url = new URL(sender?.url || '');
        return ['chrome-extension:', 'extension:'].includes(url.protocol)
          && url.hostname === chromeApi.runtime.id
          && /^\/fre\/fre-step[1-4]\.html$/.test(url.pathname);
      } catch {
        return false;
      }
    }

    handlers.set(actions.LOAD_BILI_FEED_HISTORY, (_message, sender) =>
      dependencies.biliSession.load(sender));
    handlers.set(actions.SAVE_BILI_FEED_HISTORY, (message, sender) =>
      dependencies.biliSession.save(sender, message.state));
    handlers.set(actions.CLEAR_BILI_FEED_HISTORY, (_message, sender) =>
      dependencies.biliSession.clear(sender));
    handlers.set(actions.MOUSE_GESTURE_START, () => {
      dependencies.tabs.setMouseGestureState(true);
      return { ok: true };
    });
    handlers.set(actions.MOUSE_GESTURE_END, () => {
      dependencies.tabs.setMouseGestureState(false);
      return { ok: true };
    });
    handlers.set(actions.SWITCH_TAB, (message, sender) => {
      const source = message.source || 'mouseGesture';
      if (source === 'demo' && !isFreDemoSender(sender)) {
        return { ok: false, error: 'FRE demo 来源无效' };
      }
      return dependencies.tabs.handleSwitchTab(message.direction, source);
    });
    handlers.set(actions.OPEN_IN_NEW_TAB, message =>
      dependencies.tabs.handleOpenInNewTab(message.url, message.active, message.forceAdjacentPosition));
    handlers.set(actions.SEARCH_IN_NEW_TAB, message =>
      dependencies.tabs.handleSearchInNewTab(message.text, message.forceAdjacentPosition));
    handlers.set(actions.GET_ZOOM, async (_message, sender) => {
      const tabId = await getTargetTabId(sender);
      if (!tabId) return { zoom: 1 };
      try {
        const zoom = await chromeApi.tabs.getZoom(tabId);
        return { zoom };
      } catch {
        return { zoom: 1 };
      }
    });
    handlers.set(actions.SET_ZOOM, async (message, sender) => {
      const tabId = await getTargetTabId(sender);
      if (!tabId) return { success: false };
      try {
        await chromeApi.tabs.setZoom(tabId, message.zoom);
        return { success: true };
      } catch {
        return { success: false };
      }
    });
    handlers.set(actions.QUICK_SAVE_IMAGE, message =>
      dependencies.images.quickSaveImage(message.dataUrl, message.originalUrl));
    handlers.set(actions.FETCH_IMAGE_AS_DATA_URL, message =>
      dependencies.images.fetchImageAsDataUrl(message.imageUrl, message.pageUrl));
    handlers.set(actions.PROXY_FETCH, message => dependencies.network.proxyJson(message.url));
    handlers.set(actions.BING_SUGGEST, message => dependencies.network.bingSuggest(message.query));

    function handleMessage(message, sender, sendResponse) {
      const validation = messages.validate(message);
      if (!validation.ok) {
        sendResponse({ ok: false, success: false, error: validation.error });
        return false;
      }
      const handler = handlers.get(message.action);
      if (!handler) {
        sendResponse({ ok: false, success: false, error: `未注册消息 action：${message.action}` });
        return false;
      }
      Promise.resolve()
        .then(() => handler(message, sender))
        .then(result => sendResponse(result))
        .catch(error => sendResponse({ ok: false, success: false, error: error.message }));
      return true;
    }

    function register() {
      chromeApi.runtime.onMessage.addListener(handleMessage);
    }

    return Object.freeze({ handleMessage, handlers, isFreDemoSender, register });
  }

  root.EchoBackgroundMessageRouter = Object.freeze({ create });
})(globalThis);