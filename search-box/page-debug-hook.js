(function() {
  'use strict';

  if (window.__echoBiliFlowDebugInjected) return;
  window.__echoBiliFlowDebugInjected = true;

  const eventName = 'echo-search-page-debug';
  let mutationObserver = null;
  let mutationObserverStopTimer = null;

  function safePreview(value) {
    if (value == null) return value;
    if (typeof value === 'string') return value.slice(0, 300);
    if (typeof value === 'number' || typeof value === 'boolean') return value;
    try {
      return JSON.stringify(value).slice(0, 300);
    } catch {
      return Object.prototype.toString.call(value);
    }
  }

  function isBiliRelatedUrl(urlString) {
    try {
      const url = new URL(urlString, location.href);
      return /(^|\.)bilibili\.com$|(^|\.)bilivideo\.com$/.test(url.hostname);
    } catch {
      return false;
    }
  }

  function shouldLogBiliRequest(urlString) {
    try {
      const url = new URL(urlString, location.href);
      if (!isBiliRelatedUrl(url.href)) return false;
      const target = (url.hostname + url.pathname + url.search).toLowerCase();
      return /(player|playurl|pbp|comment|reply|loader|view|pagelist|season|video|subtitle|playerview|x\/web-interface)/.test(target);
    } catch {
      return false;
    }
  }

  function emit(type, details) {
    document.dispatchEvent(new CustomEvent(eventName, {
      detail: { type, details: details || {} }
    }));
  }

  function getSnapshot() {
    const h1 = document.querySelector('h1');
    const activeRouterLink = document.querySelector('a.router-link-exact-active, a.router-link-active');
    const video = document.querySelector('video');
    return {
      href: location.href,
      title: document.title,
      readyState: document.readyState,
      visibilityState: document.visibilityState,
      hasFocus: typeof document.hasFocus === 'function' ? document.hasFocus() : null,
      h1Text: h1 ? h1.textContent.trim().replace(/\s+/g, ' ').slice(0, 120) : null,
      activeRouterLink: activeRouterLink ? activeRouterLink.href : null,
      activeRouterLinkText: activeRouterLink ? activeRouterLink.textContent.trim().replace(/\s+/g, ' ').slice(0, 80) : null,
      activeElementTag: document.activeElement ? document.activeElement.tagName : null,
      activeElementText: document.activeElement && typeof document.activeElement.textContent === 'string'
        ? document.activeElement.textContent.trim().replace(/\s+/g, ' ').slice(0, 80)
        : null,
      videoSrc: video ? video.currentSrc : null,
      videoTime: video ? Math.round(video.currentTime * 10) / 10 : null,
      bodyClass: document.body ? String(document.body.className || '').slice(0, 160) : null
    };
  }

  function emitCheckpoint(type, extra) {
    emit(type, Object.assign({}, getSnapshot(), extra || {}));
  }

  function startRouteMutationTrace(reason) {
    if (mutationObserver) {
      mutationObserver.disconnect();
      mutationObserver = null;
    }
    if (mutationObserverStopTimer) {
      clearTimeout(mutationObserverStopTimer);
      mutationObserverStopTimer = null;
    }

    const targets = [document.head, document.body].filter(Boolean);
    mutationObserver = new MutationObserver((mutations) => {
      let addedNodes = 0;
      let removedNodes = 0;
      let attrTargets = [];
      let charDataCount = 0;

      mutations.forEach((mutation) => {
        addedNodes += mutation.addedNodes ? mutation.addedNodes.length : 0;
        removedNodes += mutation.removedNodes ? mutation.removedNodes.length : 0;
        if (mutation.type === 'attributes' && mutation.target) {
          const name = mutation.target.tagName ? mutation.target.tagName.toLowerCase() : mutation.target.nodeName;
          attrTargets.push(`${name}:${mutation.attributeName}`);
        }
        if (mutation.type === 'characterData') {
          charDataCount += 1;
        }
      });

      emitCheckpoint('dom-mutation', {
        reason,
        mutationCount: mutations.length,
        addedNodes,
        removedNodes,
        charDataCount,
        attrTargets: attrTargets.slice(0, 10)
      });
    });

    targets.forEach((target) => {
      mutationObserver.observe(target, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: ['class', 'src', 'href', 'data-state']
      });
    });

    mutationObserverStopTimer = setTimeout(() => {
      if (mutationObserver) {
        mutationObserver.disconnect();
        mutationObserver = null;
      }
      mutationObserverStopTimer = null;
      emitCheckpoint('dom-mutation-stop', { reason });
    }, 2500);
  }

  function scheduleRouteCheckpoints(reason) {
    emitCheckpoint('checkpoint-sync', { reason });
    queueMicrotask(() => {
      emitCheckpoint('checkpoint-microtask', { reason });
    });
    Promise.resolve().then(() => {
      emitCheckpoint('checkpoint-promise', { reason });
    });
    requestAnimationFrame(() => {
      emitCheckpoint('checkpoint-raf', { reason });
    });
    [0, 50, 150, 300, 1000, 2000].forEach((delay) => {
      setTimeout(() => {
        emitCheckpoint('checkpoint-timeout', { reason, delay });
      }, delay);
    });
    startRouteMutationTrace(reason);
  }

  function describeNode(node) {
    if (!node) return null;
    if (node === window) return 'window';
    if (node === document) return 'document';
    if (!node.tagName) return String(node.nodeName || node);
    const tag = node.tagName.toLowerCase();
    const id = node.id ? `#${node.id}` : '';
    const className = typeof node.className === 'string'
      ? node.className.trim().split(/\s+/).filter(Boolean).slice(0, 3).join('.')
      : '';
    const classes = className ? `.${className}` : '';
    const text = typeof node.textContent === 'string'
      ? node.textContent.trim().replace(/\s+/g, ' ').slice(0, 60)
      : '';
    return `${tag}${id}${classes}${text ? ` [text=${text}]` : ''}`;
  }

  function getEventSummary(event, extra = {}) {
    const target = event && event.target;
    const currentTarget = event && event.currentTarget;
    const path = event && typeof event.composedPath === 'function'
      ? event.composedPath().slice(0, 6).map(describeNode)
      : [];
    const closestLink = target && target.closest ? target.closest('a[href]') : null;
    return Object.assign({
      eventType: event ? event.type : null,
      eventPhase: event ? event.eventPhase : null,
      isTrusted: event ? event.isTrusted : null,
      defaultPrevented: event ? event.defaultPrevented : null,
      cancelBubble: event ? event.cancelBubble : null,
      target: describeNode(target),
      currentTarget: describeNode(currentTarget),
      closestLink: closestLink ? closestLink.href : null,
      button: event && typeof event.button === 'number' ? event.button : null,
      buttons: event && typeof event.buttons === 'number' ? event.buttons : null,
      clientX: event && typeof event.clientX === 'number' ? event.clientX : null,
      clientY: event && typeof event.clientY === 'number' ? event.clientY : null,
      key: event && typeof event.key === 'string' ? event.key : null,
      code: event && typeof event.code === 'string' ? event.code : null,
      path
    }, extra);
  }

  function installInteractionTrace() {
    const traceTypes = ['pointerdown', 'mousedown', 'mouseup', 'click'];
    traceTypes.forEach((type) => {
      document.addEventListener(type, (event) => {
        emitCheckpoint(`event-${type}-capture`, getEventSummary(event, {
          listenerPhase: 'capture'
        }));
      }, true);

      document.addEventListener(type, (event) => {
        emitCheckpoint(`event-${type}-bubble`, getEventSummary(event, {
          listenerPhase: 'bubble'
        }));
      }, false);
    });

    const originalPreventDefault = Event.prototype.preventDefault;
    Event.prototype.preventDefault = function(...args) {
      emitCheckpoint('event-preventDefault', getEventSummary(this, {
        args: args.map(safePreview)
      }));
      return originalPreventDefault.apply(this, args);
    };

    const originalStopPropagation = Event.prototype.stopPropagation;
    Event.prototype.stopPropagation = function(...args) {
      emitCheckpoint('event-stopPropagation', getEventSummary(this, {
        args: args.map(safePreview)
      }));
      return originalStopPropagation.apply(this, args);
    };

    const originalStopImmediatePropagation = Event.prototype.stopImmediatePropagation;
    Event.prototype.stopImmediatePropagation = function(...args) {
      emitCheckpoint('event-stopImmediatePropagation', getEventSummary(this, {
        args: args.map(safePreview)
      }));
      return originalStopImmediatePropagation.apply(this, args);
    };
  }

  const originalPushState = history.pushState;
  history.pushState = function(...args) {
    emitCheckpoint('pushState-before', {
      beforeUrl: location.href,
      args: args.map((arg, index) => ({ index, value: safePreview(arg) }))
    });
    const result = originalPushState.apply(this, args);
    emitCheckpoint('pushState-after', {
      afterUrl: location.href,
      args: args.map((arg, index) => ({ index, value: safePreview(arg) }))
    });
    scheduleRouteCheckpoints('pushState');
    return result;
  };

  const originalReplaceState = history.replaceState;
  history.replaceState = function(...args) {
    emitCheckpoint('replaceState-before', {
      beforeUrl: location.href,
      args: args.map((arg, index) => ({ index, value: safePreview(arg) }))
    });
    const result = originalReplaceState.apply(this, args);
    emitCheckpoint('replaceState-after', {
      afterUrl: location.href,
      args: args.map((arg, index) => ({ index, value: safePreview(arg) }))
    });
    scheduleRouteCheckpoints('replaceState');
    return result;
  };

  window.addEventListener('popstate', (event) => {
    emitCheckpoint('popstate', {
      state: safePreview(event.state)
    });
    scheduleRouteCheckpoints('popstate');
  });

  window.addEventListener('hashchange', (event) => {
    emitCheckpoint('hashchange', {
      oldURL: event.oldURL,
      newURL: event.newURL
    });
    scheduleRouteCheckpoints('hashchange');
  });

  window.addEventListener('focus', () => {
    emitCheckpoint('window-focus', {});
  }, true);

  window.addEventListener('blur', () => {
    emitCheckpoint('window-blur', {});
  }, true);

  document.addEventListener('focusin', (event) => {
    emitCheckpoint('focusin', {
      target: describeNode(event.target)
    });
  }, true);

  document.addEventListener('focusout', (event) => {
    emitCheckpoint('focusout', {
      target: describeNode(event.target)
    });
  }, true);

  document.addEventListener('selectionchange', () => {
    const selection = document.getSelection ? document.getSelection() : null;
    emitCheckpoint('selectionchange', {
      selectionType: selection ? selection.type : null,
      selectionText: selection ? String(selection).slice(0, 80) : null
    });
  });

  document.addEventListener('visibilitychange', () => {
    emitCheckpoint('visibilitychange', {
      visibilityState: document.visibilityState
    });
  });

  installInteractionTrace();

  const originalElementFocus = HTMLElement.prototype.focus;
  HTMLElement.prototype.focus = function(...args) {
    emitCheckpoint('element-focus-call', {
      target: describeNode(this),
      args: args.map(safePreview)
    });
    return originalElementFocus.apply(this, args);
  };

  const originalElementBlur = HTMLElement.prototype.blur;
  HTMLElement.prototype.blur = function(...args) {
    emitCheckpoint('element-blur-call', {
      target: describeNode(this),
      args: args.map(safePreview)
    });
    return originalElementBlur.apply(this, args);
  };

  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    this.__echoPageDebug = {
      method,
      url: typeof url === 'string' ? url : String(url),
      startedAt: 0
    };
    return originalOpen.call(this, method, url, ...rest);
  };

  XMLHttpRequest.prototype.send = function(...args) {
    const meta = this.__echoPageDebug;
    if (meta && shouldLogBiliRequest(meta.url)) {
      meta.startedAt = performance.now();
      emitCheckpoint('xhr-send', {
        method: meta.method,
        requestUrl: meta.url
      });
      const report = (phase) => {
        emitCheckpoint('xhr-' + phase, {
          method: meta.method,
          requestUrl: meta.url,
          responseUrl: this.responseURL || null,
          status: this.status,
          readyStateValue: this.readyState,
          durationMs: meta.startedAt ? Math.round(performance.now() - meta.startedAt) : null
        });
      };

      this.addEventListener('loadend', () => {
        if (this.status >= 400 || this.status === 0) report('loadend');
      }, { once: true });
      this.addEventListener('error', () => report('error'), { once: true });
      this.addEventListener('abort', () => report('abort'), { once: true });
      this.addEventListener('timeout', () => report('timeout'), { once: true });
    }

    return originalSend.apply(this, args);
  };

  const originalFetch = window.fetch;
  window.fetch = async function(input, init) {
    const requestUrl = typeof input === 'string' ? input : input && input.url;
    const method = (init && init.method) || (typeof input !== 'string' && input && input.method) || 'GET';
    const shouldLog = requestUrl && shouldLogBiliRequest(requestUrl);
    const startedAt = shouldLog ? performance.now() : 0;

    if (shouldLog) {
      emitCheckpoint('fetch-start', {
        method,
        requestUrl
      });
    }

    try {
      const response = await originalFetch.apply(this, arguments);
      if (shouldLog) {
        emitCheckpoint('fetch-response', {
          method,
          requestUrl,
          responseUrl: response.url,
          status: response.status,
          durationMs: Math.round(performance.now() - startedAt)
        });
      }
      return response;
    } catch (error) {
      if (shouldLog) {
        emitCheckpoint('fetch-error', {
          method,
          requestUrl,
          durationMs: Math.round(performance.now() - startedAt),
          error: safePreview(error && (error.message || error))
        });
      }
      throw error;
    }
  };

  const originalConsoleError = console.error;
  console.error = function(...args) {
    emitCheckpoint('console-error', {
      args: args.map(safePreview)
    });
    return originalConsoleError.apply(this, args);
  };

  window.addEventListener('unhandledrejection', (event) => {
    emitCheckpoint('unhandledrejection', {
      reason: safePreview(event.reason && (event.reason.message || event.reason)),
      stack: safePreview(event.reason && event.reason.stack)
    });
  });

  window.addEventListener('error', (event) => {
    const target = event.target;
    const resourceUrl = target && (target.src || target.href);
    if (resourceUrl || event.message) {
      emitCheckpoint('window-error', {
        message: safePreview(event.message),
        filename: event.filename || resourceUrl || null,
        lineno: event.lineno,
        colno: event.colno,
        error: safePreview(event.error && (event.error.message || event.error)),
        targetTag: target && target.tagName ? target.tagName : null
      });
    }
  }, true);
})();