(function(root) {
  'use strict';

  function create(options) {
    const documentApi = options.document;
    const chromeApi = options.chrome;
    const context = options.context;
    const policy = options.policy;
    const actions = options.actions;
    const zoom = options.zoom;
    let initialized = false;
    let preventContextMenu = false;
    let lastWheelTime = 0;
    let wheelCount = 0;
    let gestureStarted = false;
    let dragStart = { x: 0, y: 0 };
    let dragging = false;

    function handleMouseDown(event) {
      if (event.button !== 2 || !context.isEnabled('mouseGesture')) return;
      gestureStarted = true;
      wheelCount = 0;
      preventContextMenu = false;
      chromeApi.runtime.sendMessage({ action: actions.MOUSE_GESTURE_START });
    }

    function handleMouseUp(event) {
      if (event.button !== 2 || !gestureStarted) return;
      gestureStarted = false;
      chromeApi.runtime.sendMessage({ action: actions.MOUSE_GESTURE_END });
      if (wheelCount > 0) {
        setTimeout(() => {
          preventContextMenu = false;
          wheelCount = 0;
        }, 50);
      }
    }

    function handleContextMenu(event) {
      if (!preventContextMenu && wheelCount <= 0) return;
      event.preventDefault();
      event.stopPropagation();
      preventContextMenu = false;
    }

    function handleWheel(event) {
      const control = event.ctrlKey || event.metaKey;
      if (control && context.isEnabled('fineZoom')) {
        event.preventDefault();
        event.stopPropagation();
        zoom.set(policy.nextZoom(
          zoom.get(),
          event.deltaY < 0 ? 'in' : 'out',
          context.isEnabled('fineZoomLargeStep')
        ));
        return;
      }
      if (!context.isEnabled('mouseGesture') || !(event.buttons & 2) || control) return;
      event.preventDefault();
      event.stopPropagation();
      preventContextMenu = true;
      wheelCount += 1;
      const now = Date.now();
      if (now - lastWheelTime < 50) return;
      lastWheelTime = now;
      chromeApi.runtime.sendMessage({
        action: actions.SWITCH_TAB,
        direction: event.deltaY > 0 ? 'right' : 'left',
        source: 'mouseGesture'
      });
    }

    function handleKeyDown(event) {
      if (!context.isEnabled('tabSwitchKey') || !['F2', 'F3'].includes(event.key)) return;
      if (policy.isEditable(documentApi.activeElement)) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      chromeApi.runtime.sendMessage({
        action: actions.SWITCH_TAB,
        direction: event.key === 'F2' ? 'left' : 'right',
        source: 'keyboard'
      });
    }

    function handleDragStart(event) {
      if (!context.isEnabled('superDrag')) return;
      dragStart = { x: event.clientX, y: event.clientY };
      dragging = true;
    }

    function handleDragOver(event) {
      if (!context.isEnabled('superDrag') || !dragging || policy.isEditable(event.target)) return;
      const types = [...(event.dataTransfer?.types || [])];
      if (!types.includes('text/uri-list') && !types.includes('text/plain')) return;
      event.dataTransfer.dropEffect = 'copy';
      event.preventDefault();
    }

    function handleDrop(event) {
      if (!context.isEnabled('superDrag') || !dragging || policy.isEditable(event.target)) return;
      if (policy.dragDistance(dragStart, { x: event.clientX, y: event.clientY }) < 30) {
        dragging = false;
        return;
      }
      const intent = policy.classifyDrop(event.dataTransfer);
      if (intent) {
        event.preventDefault();
        chromeApi.runtime.sendMessage(intent.type === 'url'
          ? { action: actions.OPEN_IN_NEW_TAB, url: intent.value, forceAdjacentPosition: true }
          : { action: actions.SEARCH_IN_NEW_TAB, text: intent.value, forceAdjacentPosition: true });
      }
      dragging = false;
    }

    function init() {
      if (initialized) return;
      initialized = true;
      documentApi.addEventListener('mousedown', handleMouseDown);
      documentApi.addEventListener('mouseup', handleMouseUp);
      documentApi.addEventListener('contextmenu', handleContextMenu, true);
      documentApi.addEventListener('wheel', handleWheel, { passive: false, capture: true });
      documentApi.addEventListener('keydown', handleKeyDown, true);
      documentApi.addEventListener('dragstart', handleDragStart);
      documentApi.addEventListener('dragover', handleDragOver);
      documentApi.addEventListener('drop', handleDrop);
      documentApi.addEventListener('dragend', () => { dragging = false; });
    }

    return Object.freeze({ init });
  }

  root.EchoNtpInputAdapter = Object.freeze({ create });
})(globalThis);
