/**
 * ECHO 快捷键增强模块
 * 
 * 独立模块，可在扩展页面和普通网页中使用
 * - Ctrl + 滚轮：5% 精细缩放（175% 以上 25% 步进）
 * - F2/F3：切换到上一个/下一个标签页
 */

(function() {
  'use strict';

  // 避免重复初始化
  if (window.__echoKeyboardEnhanceInitialized) return;
  window.__echoKeyboardEnhanceInitialized = true;

  // ============================================
  // 精细缩放：Ctrl + 滚轮 5% 步进
  // ============================================

  async function getCurrentZoom() {
    return new Promise(resolve => {
      chrome.runtime.sendMessage({ action: 'getZoom' }, (response) => {
        resolve(response?.zoom || 1);
      });
    });
  }

  async function setZoom(zoomFactor) {
    return new Promise(resolve => {
      chrome.runtime.sendMessage({ action: 'setZoom', zoom: zoomFactor }, resolve);
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
    if (!isCtrlOrCmd) return;
    
    e.preventDefault();
    e.stopPropagation();
    
    const currentZoom = await getCurrentZoom();
    const currentZoomRounded = Math.round(currentZoom * 100);
    const isZoomingIn = e.deltaY < 0;
    
    let newZoom;
    
    // 大比例加速步进：175% 以上 25% 步进
    if (isZoomingIn) {
      if (currentZoomRounded >= 175) {
        newZoom = currentZoom + 0.25;
        newZoom = Math.round(newZoom * 4) / 4;
      } else {
        newZoom = currentZoom + 0.05;
        newZoom = Math.round(newZoom * 20) / 20;
      }
    } else {
      if (currentZoomRounded > 175) {
        newZoom = currentZoom - 0.25;
        newZoom = Math.round(newZoom * 4) / 4;
        if (newZoom < 1.75) newZoom = 1.75;
      } else {
        newZoom = currentZoom - 0.05;
        newZoom = Math.round(newZoom * 20) / 20;
      }
    }
    
    // 限制范围 25% - 500%
    newZoom = Math.max(0.25, Math.min(5.0, newZoom));
    
    await setZoom(newZoom);
    showZoomIndicator(Math.round(newZoom * 100));
  }, { passive: false, capture: true });

  // ============================================
  // F2/F3 切换标签
  // ============================================
  
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'F2' && e.key !== 'F3') return;
    
    // 不在输入框中触发
    const activeEl = document.activeElement;
    const isInInput = activeEl && (
      activeEl.tagName === 'INPUT' ||
      activeEl.tagName === 'TEXTAREA' ||
      activeEl.isContentEditable
    );
    
    if (isInInput) return;
    
    // 阻止默认行为（F3 是浏览器查找）
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    
    const direction = e.key === 'F2' ? 'left' : 'right';
    chrome.runtime.sendMessage({ action: 'switchTab', direction, source: 'keyboard' });
    return false;
  }, true);  // 捕获阶段
})();
