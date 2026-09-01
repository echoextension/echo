/**
 * ECHO 鼠标手势模块
 * 
 * 独立模块，可在扩展页面和普通网页中使用
 * 右键 + 滚轮切换标签页
 */

(function() {
  'use strict';

  const MESSAGE_ACTIONS = EchoMessages.ACTIONS;
  const inputContext = EchoInputContext;

  // 避免重复初始化
  if (window.__echoMouseGestureInitialized) return;
  window.__echoMouseGestureInitialized = true;

  // ============================================
  // 鼠标手势：右键 + 滚轮切换标签
  // ============================================
  
  let preventContextMenu = false;
  let lastWheelTime = 0;
  let wheelCount = 0;  // 滚轮触发次数，用于判断是否应该阻止右键菜单
  let gestureStarted = false;

  // 右键按下：重置状态 + 通知 background
  document.addEventListener('mousedown', (e) => {
    if (e.button === 2 && inputContext.isEnabled('mouseGesture')) {
      gestureStarted = true;
      wheelCount = 0;  // 重置滚轮计数
      chrome.runtime.sendMessage({ action: MESSAGE_ACTIONS.MOUSE_GESTURE_START });
      preventContextMenu = false;
    }
  });

  // 右键松开：通知 background
  document.addEventListener('mouseup', (e) => {
    if (e.button === 2 && gestureStarted) {
      gestureStarted = false;
      chrome.runtime.sendMessage({ action: MESSAGE_ACTIONS.MOUSE_GESTURE_END });
      // 如果触发过滚轮手势，延迟重置 preventContextMenu
      if (wheelCount > 0) {
        setTimeout(() => {
          preventContextMenu = false;
          wheelCount = 0;
        }, 50);
      }
    }
  });

  // 右键菜单：如果触发了手势则阻止
  document.addEventListener('contextmenu', (e) => {
    if (preventContextMenu || wheelCount > 0) {
      e.preventDefault();
      e.stopPropagation();
      preventContextMenu = false;
    }
  }, true);  // 使用捕获阶段，确保优先处理

  // 滚轮事件：右键 + 滚轮切换标签
  document.addEventListener('wheel', (e) => {
    // 使用 e.buttons 实时检测右键是否被按着
    const isRightButtonPressed = (e.buttons & 2) !== 0;
    
    // 右键 + 滚轮（不能同时按 Ctrl/Cmd，那是缩放）
    const isCtrlOrCmd = e.ctrlKey || e.metaKey;
    if (inputContext.isEnabled('mouseGesture') && isRightButtonPressed && !isCtrlOrCmd) {
      // 立即阻止默认滚动行为
      e.preventDefault();
      e.stopPropagation();
      preventContextMenu = true;
      wheelCount++;
      
      // 节流：50ms
      const currentTime = Date.now();
      if (currentTime - lastWheelTime < 50) return;
      lastWheelTime = currentTime;

      // 切换标签（标记来源为鼠标手势）
      const direction = e.deltaY > 0 ? 'right' : 'left';
      chrome.runtime.sendMessage({ action: MESSAGE_ACTIONS.SWITCH_TAB, direction, source: 'mouseGesture' });
    }
  }, { passive: false, capture: true });
})();
