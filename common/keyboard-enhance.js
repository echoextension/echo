/**
 * ECHO 快捷键增强模块
 * 
 * 独立模块，可在扩展页面和普通网页中使用
 * - Ctrl + 滚轮：5% 精细缩放（175% 以上 25% 步进）
 * - F2/F3：切换到上一个/下一个标签页
 */

(function() {
  'use strict';

  const MESSAGE_ACTIONS = EchoMessages.ACTIONS;
  const inputContext = EchoInputContext;
  const inputPolicy = EchoInputPolicy;

  // 避免重复初始化
  if (window.__echoKeyboardEnhanceInitialized) return;
  window.__echoKeyboardEnhanceInitialized = true;

  // ============================================
  // 精细缩放：Ctrl + 滚轮 5% 步进
  // ============================================

  async function getCurrentZoom() {
    return new Promise(resolve => {
      chrome.runtime.sendMessage({ action: MESSAGE_ACTIONS.GET_ZOOM }, (response) => {
        resolve(response?.zoom || 1);
      });
    });
  }

  async function setZoom(zoomFactor) {
    return new Promise(resolve => {
      chrome.runtime.sendMessage({ action: MESSAGE_ACTIONS.SET_ZOOM, zoom: zoomFactor }, resolve);
    });
  }

  // 缩放指示器
  let zoomIndicator = null;
  let zoomTimeout = null;

  function showZoomIndicator(zoom) {
    if (!zoomIndicator) {
      zoomIndicator = document.createElement('div');
      zoomIndicator.id = 'echo-zoom-indicator';
      zoomIndicator.style.cssText = `
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: rgba(0, 0, 0, 0.8);
        color: white;
        padding: 16px 32px;
        border-radius: 8px;
        font-size: 24px;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        z-index: 2147483647;
        pointer-events: none;
        transition: opacity 0.2s;
      `;
      document.body.appendChild(zoomIndicator);
    }

    zoomIndicator.textContent = Math.round(zoom) + '%';
    zoomIndicator.style.opacity = '1';

    if (zoomTimeout) {
      clearTimeout(zoomTimeout);
    }

    zoomTimeout = setTimeout(() => {
      if (zoomIndicator) {
        zoomIndicator.style.opacity = '0';
      }
    }, 1000);
  }

  // Ctrl + 滚轮 (Windows) / Cmd + 滚轮 (Mac) 精细缩放
  document.addEventListener('wheel', async (e) => {
    const isCtrlOrCmd = e.ctrlKey || e.metaKey;
    if (!isCtrlOrCmd || !inputContext.isEnabled('fineZoom')) return;
    
    e.preventDefault();
    e.stopPropagation();
    
    const currentZoom = await getCurrentZoom();
    const newZoom = inputPolicy.nextZoom(
      currentZoom,
      e.deltaY < 0 ? 'in' : 'out',
      inputContext.isEnabled('fineZoomLargeStep')
    );
    
    await setZoom(newZoom);
    showZoomIndicator(Math.round(newZoom * 100));
  }, { passive: false, capture: true });

  // ============================================
  // F2/F3 切换标签
  // ============================================
  
  document.addEventListener('keydown', (e) => {
    if (!inputContext.isEnabled('tabSwitchKey') || (e.key !== 'F2' && e.key !== 'F3')) return;
    
    // 不在输入框中触发
    if (inputPolicy.isEditable(document.activeElement)) return;
    
    // 阻止默认行为（F3 是浏览器查找）
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    
    const direction = e.key === 'F2' ? 'left' : 'right';
    const source = inputContext.mode === 'demo' ? 'demo' : 'keyboard';
    chrome.runtime.sendMessage({ action: MESSAGE_ACTIONS.SWITCH_TAB, direction, source });
    return false;
  }, true);  // 捕获阶段
})();
