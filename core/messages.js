(function(root) {
  'use strict';

  const ACTIONS = Object.freeze({
    LOAD_BILI_FEED_HISTORY: 'loadBiliFeedHistory',
    SAVE_BILI_FEED_HISTORY: 'saveBiliFeedHistory',
    CLEAR_BILI_FEED_HISTORY: 'clearBiliFeedHistory',
    MOUSE_GESTURE_START: 'mouseGestureStart',
    MOUSE_GESTURE_END: 'mouseGestureEnd',
    SYNC_MOUSE_GESTURE_STATE: 'syncMouseGestureState',
    SWITCH_TAB: 'switchTab',
    OPEN_IN_NEW_TAB: 'openInNewTab',
    SEARCH_IN_NEW_TAB: 'searchInNewTab',
    GET_ZOOM: 'getZoom',
    SET_ZOOM: 'setZoom',
    QUICK_SAVE_IMAGE: 'quickSaveImage',
    FETCH_IMAGE_AS_DATA_URL: 'fetchImageAsDataUrl',
    PROXY_FETCH: 'proxyFetch',
    BING_SUGGEST: 'bingSuggest'
  });

  const PORTS = Object.freeze({
    ZHIHU_OPTIONS: 'echo-zhihu-blocklist-sync',
    ZHIHU_WORKER: 'echo-zhihu-blocklist-worker'
  });

  const actionValues = new Set(Object.values(ACTIONS));

  function isString(value, maxLength = Infinity) {
    return typeof value === 'string' && value.length > 0 && value.length <= maxLength;
  }

  function isOptionalBoolean(value) {
    return value === undefined || typeof value === 'boolean';
  }

  function isAllowedProxyUrl(value) {
    try {
      const url = new URL(value);
      if (url.protocol !== 'https:') return false;
      return (url.hostname === 'top.baidu.com' && url.pathname === '/api/board')
        || (url.hostname === 'www.toutiao.com' && url.pathname === '/hot-event/hot-board/');
    } catch {
      return false;
    }
  }

  function isAllowedNavigationUrl(value) {
    try {
      const url = new URL(value);
      if (url.protocol === 'http:' || url.protocol === 'https:') return true;
      if (url.protocol === 'chrome-extension:' || url.protocol === 'extension:') {
        return !root.chrome?.runtime?.id || url.hostname === root.chrome.runtime.id;
      }
      return false;
    } catch {
      return false;
    }
  }

  function validate(message) {
    if (!message || typeof message !== 'object' || Array.isArray(message)) {
      return { ok: false, error: '消息必须是对象' };
    }
    if (!actionValues.has(message.action)) {
      return { ok: false, error: `未知消息 action：${String(message.action)}` };
    }
    switch (message.action) {
      case ACTIONS.SAVE_BILI_FEED_HISTORY:
        return message.state?.schemaVersion === 3
          && Array.isArray(message.state?.batches)
          && message.state.batches.length <= 10
          && message.state.batches.every(batch => typeof batch?.identity === 'string' && Array.isArray(batch?.cards))
          ? { ok: true }
          : { ok: false, error: 'B站推荐历史状态无效' };
      case ACTIONS.SWITCH_TAB:
        return ['left', 'right'].includes(message.direction)
          && (message.source === undefined
            || ['keyboard', 'mouseGesture', 'demo'].includes(message.source))
          ? { ok: true }
          : { ok: false, error: '标签切换方向无效' };
      case ACTIONS.OPEN_IN_NEW_TAB:
        return isString(message.url, 16384)
          && isAllowedNavigationUrl(message.url)
          && isOptionalBoolean(message.active)
          ? { ok: true }
          : { ok: false, error: '新标签 URL 或 active 参数无效' };
      case ACTIONS.SEARCH_IN_NEW_TAB:
        return isString(message.text, 1000)
          ? { ok: true }
          : { ok: false, error: '搜索文本无效' };
      case ACTIONS.SET_ZOOM:
        return Number.isFinite(message.zoom) && message.zoom >= 0.25 && message.zoom <= 5
          ? { ok: true }
          : { ok: false, error: '缩放比例无效' };
      case ACTIONS.QUICK_SAVE_IMAGE:
        return isString(message.dataUrl) && message.dataUrl.startsWith('data:image/')
          ? { ok: true }
          : { ok: false, error: '图片数据无效' };
      case ACTIONS.FETCH_IMAGE_AS_DATA_URL:
        return isString(message.imageUrl, 16384) && isString(message.pageUrl, 16384)
          ? { ok: true }
          : { ok: false, error: '图片 URL 或来源页无效' };
      case ACTIONS.PROXY_FETCH:
        return isString(message.url, 16384)
          && isAllowedProxyUrl(message.url)
          && (!message.options?.method || message.options.method === 'GET')
          ? { ok: true }
          : { ok: false, error: '代理请求目标或方法无效' };
      case ACTIONS.BING_SUGGEST:
        return typeof message.query === 'string' && message.query.length <= 500
          ? { ok: true }
          : { ok: false, error: '搜索建议文本无效' };
      default:
        return { ok: true };
    }
  }

  root.EchoMessages = Object.freeze({
    ACTIONS,
    PORTS,
    isAllowedNavigationUrl,
    isAllowedProxyUrl,
    validate
  });
})(globalThis);