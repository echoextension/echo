/**
 * ECHO Content Script
 * 处理页面内的交互：鼠标手势、超级拖拽、缩放控制
 * 
 * 自绘书签栏模块已拆分到 bookmark-bar/ 目录
 */

(async function() {
  'use strict';

  // ============================================
  // Alt+点击快速保存图片 — 提取为函数，在顶层 frame 和 iframe 中均可调用
  // ============================================
  function setupQuickSaveImage(settings) {
    // 在点击位置查找 IMG 元素（处理某些网站在图片上方覆盖透明 DIV 的情况）
    function findImageAtPoint(e) {
      const target = e.target;
      if (target.tagName === 'IMG') {
        const src = target.src || target.currentSrc;
        if (src) return target;
      }
      if (document.elementsFromPoint) {
        const elements = document.elementsFromPoint(e.clientX, e.clientY);
        for (const el of elements) {
          if (el.tagName === 'IMG') {
            const src = el.src || el.currentSrc;
            if (src) return el;
          }
        }
      }
      let parent = target;
      for (let depth = 0; parent && depth < 5; depth++) {
        const img = parent.querySelector('img[src]');
        if (img && (img.src || img.currentSrc)) return img;
        parent = parent.parentElement;
      }
      return null;
    }

    // 在 pointerdown/mousedown 捕获阶段提前拦截，阻止网页抢先处理 Alt+点击
    function earlyBlockAltClickOnImage(e) {
      if (!settings.quickSaveImage || !e.altKey) return;
      const img = findImageAtPoint(e);
      if (!img) return;
      e.preventDefault();
      e.stopImmediatePropagation();
    }
    window.addEventListener('pointerdown', earlyBlockAltClickOnImage, true);
    window.addEventListener('mousedown', earlyBlockAltClickOnImage, true);

    // 快速保存提示 toast
    let quickSaveToast = null;
    let quickSaveTimeout = null;

    function showQuickSaveToast(message, type = 'success') {
      // 在 iframe 中时，尝试在顶层 frame 显示 toast（跨域时回退到当前 frame）
      const doc = (() => { try { return window.top.document; } catch(e) { return document; } })();
      const body = doc.body;
      if (!body) return;

      if (!quickSaveToast || !quickSaveToast.isConnected) {
        quickSaveToast = doc.createElement('div');
        quickSaveToast.id = 'echo-quick-save-toast';
        quickSaveToast.style.cssText = `
          position: fixed;
          bottom: 80px;
          left: 50%;
          transform: translateX(-50%) translateY(12px);
          display: inline-flex;
          align-items: center;
          gap: 10px;
          background: rgba(24, 24, 28, 0.88);
          backdrop-filter: blur(16px);
          -webkit-backdrop-filter: blur(16px);
          color: rgba(255, 255, 255, 0.95);
          padding: 14px 26px;
          border-radius: 24px;
          font-size: 15px;
          font-weight: 500;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          letter-spacing: 0.2px;
          z-index: 2147483647;
          pointer-events: none;
          opacity: 0;
          transition: opacity 0.25s cubic-bezier(0.4, 0, 0.2, 1), 
                      transform 0.25s cubic-bezier(0.4, 0, 0.2, 1);
          box-shadow: 0 8px 32px rgba(0,0,0,0.28), 
                      0 2px 8px rgba(0,0,0,0.12),
                      inset 0 0.5px 0 rgba(255,255,255,0.12);
          border: 0.5px solid rgba(255,255,255,0.08);
        `;
        body.appendChild(quickSaveToast);
      }

      const icons = {
        success: `<svg width="20" height="20" viewBox="0 0 16 16" fill="none" style="flex-shrink:0"><circle cx="8" cy="8" r="7" stroke="#34d399" stroke-width="1.5" fill="rgba(52,211,153,0.12)"/><path d="M5 8.2l2 2 4-4.4" stroke="#34d399" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>`,
        error: `<svg width="20" height="20" viewBox="0 0 16 16" fill="none" style="flex-shrink:0"><circle cx="8" cy="8" r="7" stroke="#f87171" stroke-width="1.5" fill="rgba(248,113,113,0.12)"/><path d="M5.5 5.5l5 5M10.5 5.5l-5 5" stroke="#f87171" stroke-width="1.5" stroke-linecap="round"/></svg>`,
        warning: `<svg width="20" height="20" viewBox="0 0 16 16" fill="none" style="flex-shrink:0"><circle cx="8" cy="8" r="7" stroke="#fbbf24" stroke-width="1.5" fill="rgba(251,191,36,0.12)"/><path d="M8 5v3.5" stroke="#fbbf24" stroke-width="1.5" stroke-linecap="round"/><circle cx="8" cy="11" r="0.8" fill="#fbbf24"/></svg>`
      };

      quickSaveToast.innerHTML = (icons[type] || icons.success) + `<span>${message}</span>`;
      requestAnimationFrame(() => {
        quickSaveToast.style.opacity = '1';
        quickSaveToast.style.transform = 'translateX(-50%) translateY(0)';
      });

      if (quickSaveTimeout) clearTimeout(quickSaveTimeout);
      quickSaveTimeout = setTimeout(() => {
        if (quickSaveToast) {
          quickSaveToast.style.opacity = '0';
          quickSaveToast.style.transform = 'translateX(-50%) translateY(12px)';
        }
      }, 2000);
    }

    // click 捕获阶段触发保存
    window.addEventListener('click', async (e) => {
      if (!settings.quickSaveImage || !e.altKey) return;
      const imgEl = findImageAtPoint(e);
      if (!imgEl) return;
      let imageUrl = imgEl.src || imgEl.currentSrc;
      if (!imageUrl) return;

      e.preventDefault();
      e.stopImmediatePropagation();

      try {
        let dataUrl = '';
        if (imageUrl.startsWith('data:')) {
          dataUrl = imageUrl;
        } else if (imageUrl.startsWith('blob:')) {
          showQuickSaveToast('暂不支持保存此类型图片', 'warning');
          return;
        } else {
          const fetchResult = await chrome.runtime.sendMessage({
            action: 'fetchImageAsDataUrl',
            imageUrl: imageUrl,
            pageUrl: window.location.href
          });
          if (!fetchResult || fetchResult.error) {
            showQuickSaveToast(fetchResult?.error || '获取图片失败', 'error');
            return;
          }
          dataUrl = fetchResult.dataUrl;
        }

        const response = await chrome.runtime.sendMessage({
          action: 'quickSaveImage',
          dataUrl: dataUrl,
          originalUrl: imageUrl,
          pageUrl: window.location.href,
          pageTitle: document.title
        });

        if (response && response.success) {
          showQuickSaveToast('图片已保存', 'success');
        } else {
          showQuickSaveToast('保存失败: ' + (response?.error || '未知错误'), 'error');
        }
      } catch (error) {
        showQuickSaveToast('保存失败: ' + error.message, 'error');
      }
    }, true);
  }

  // ============================================
  // 默认设置
  // ============================================
  
  const DEFAULT_SETTINGS = {
    mouseGesture: true,
    bossKey: true,
    quickMute: true,
    fineZoom: true,
    fineZoomLargeStep: true,   // 大比例时加速步进
    superDrag: true,
    tabSwitchKey: true,        // F2/F3 切换标签
    customBookmarkBar: false,  // 自绘书签栏，默认关闭
    bookmarkBarPinned: true,   // 书签栏是否固定显示
    sidepanelEnhanced: false,  // 侧边栏收藏夹强化，默认关闭
    quickSaveImage: true,      // Alt+点击快速保存图片，默认开启
    quickSaveImageDateFolder: false, // 按日期创建子文件夹
    bookmarkBarDensity: 'default', // 书签栏密度
    searchEngine: 'https://www.bing.com/search?q='
  };

  // 加载设置
  let settings = await chrome.storage.sync.get(DEFAULT_SETTINGS);

  // 立即尝试应用布局修复 (不需要等待 DOMContentLoaded)
  // 这可以避免页面加载完成后的布局跳动
  if (window.EchoBookmarkBar && window.EchoBookmarkBar.initLayout) {
    window.EchoBookmarkBar.initLayout(settings);
  }

  // 监听设置变化
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'sync') return;
    for (const key in changes) {
      if (key in settings) {
        settings[key] = changes[key].newValue;
      }
    }
  });

  // ============================================
  // iframe 环境检测：在 iframe 中只运行 Alt+click 保存功能
  // Bing 图片详情页等网站会在大图上方覆盖全屏 iframe，
  // 顶层 frame 的事件监听器无法收到 iframe 内的点击事件，
  // 因此 content.js 需要在 iframe 中也运行 Alt+click 保存逻辑
  // ============================================
  if (window !== window.top) {
    setupQuickSaveImage(settings);
    return; // iframe 中不执行下方的手势/拖拽/快捷键等功能
  }

  // ============================================
  // 鼠标手势：右键 + 滚轮切换标签
  // 优化：移除不必要的延迟，使用更可靠的状态管理
  // ============================================
  
  let isRightMouseDown = false;  // 跨标签同步的右键状态
  let lastSyncTime = 0;          // 上次同步状态的时间戳
  let preventContextMenu = false;
  let lastWheelTime = 0;
  let wheelCount = 0;            // 滚轮触发次数，用于判断是否应该阻止右键菜单

  // 右键按下：更新本地状态 + 通知 background
  document.addEventListener('mousedown', (e) => {
    if (e.button === 2) {
      isRightMouseDown = true;
      wheelCount = 0;  // 重置滚轮计数
      chrome.runtime.sendMessage({ action: 'mouseGestureStart' });
      preventContextMenu = false;
    }
  });

  // 右键松开：更新本地状态 + 通知 background
  document.addEventListener('mouseup', (e) => {
    if (e.button === 2) {
      isRightMouseDown = false;
      chrome.runtime.sendMessage({ action: 'mouseGestureEnd' });
      // 如果触发过滚轮手势，延迟重置 preventContextMenu
      // 这样可以确保 contextmenu 事件被正确拦截
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

  // 监听来自 background 的消息（用于跨标签同步右键状态 + 书签更新）
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'syncMouseGestureState') {
      isRightMouseDown = message.isRightMouseDown;
      // 修复：如果同步的是"右键按着"状态，同时设置阻止菜单标记
      if (message.isRightMouseDown) {
        preventContextMenu = true;
      }
      lastSyncTime = Date.now();
      sendResponse({ ok: true });
      return false;
    }
    
    // 书签栏相关消息转发给 bookmark-bar 模块
    if (message.action === 'bookmarkBarUpdated' || message.action === 'bookmarkFolderUpdated') {
      if (window.EchoBookmarkBar && window.EchoBookmarkBar.handleMessage) {
        window.EchoBookmarkBar.handleMessage(message, settings);
      }
      sendResponse({ ok: true });
      return false;
    }
    
    return false;
  });

  // ============================================
  // 精细缩放：Ctrl + 滚轮 5% 步进（使用浏览器原生缩放API）
  // 超过 175% 后放大步进变为 25%（可选）
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
      chrome.runtime.sendMessage({ action: 'setZoom', zoom: zoomFactor }, () => {
        // 通知收藏栏模块缩放已变化
        if (window.EchoBookmarkBar && window.EchoBookmarkBar.onZoomChanged) {
          window.EchoBookmarkBar.onZoomChanged(zoomFactor);
        }
        resolve();
      });
    });
  }

  document.addEventListener('wheel', async (e) => {
    // 精细缩放：Ctrl + 滚轮 (Windows) / Cmd + 滚轮 (Mac)（优先级最高）
    const isCtrlOrCmd = e.ctrlKey || e.metaKey;
    if (isCtrlOrCmd && settings.fineZoom) {
      e.preventDefault();
      e.stopPropagation();
      
      const currentZoom = await getCurrentZoom();
      const currentZoomRounded = Math.round(currentZoom * 100); // 转为整数百分比便于比较
      const isZoomingIn = e.deltaY < 0; // 放大
      
      let newZoom;
      
      // 大比例加速步进逻辑：165-170-175-200-225-250...
      if (settings.fineZoomLargeStep) {
        if (isZoomingIn) {
          // 放大：175% -> 200%，之后 25% 步进
          if (currentZoomRounded >= 175) {
            newZoom = currentZoom + 0.25;
            newZoom = Math.round(newZoom * 4) / 4;  // 对齐到 25%
          } else {
            newZoom = currentZoom + 0.05;
            newZoom = Math.round(newZoom * 20) / 20;  // 对齐到 5%
          }
        } else {
          // 缩小：200% -> 175%，之后 5% 步进
          if (currentZoomRounded > 175) {
            newZoom = currentZoom - 0.25;
            newZoom = Math.round(newZoom * 4) / 4;  // 对齐到 25%
            // 确保不会跳过 175%，最低到 175%
            if (newZoom < 1.75) newZoom = 1.75;
          } else {
            newZoom = currentZoom - 0.05;
            newZoom = Math.round(newZoom * 20) / 20;  // 对齐到 5%
          }
        }
      } else {
        // 未开启加速，统一 5% 步进
        if (isZoomingIn) {
          newZoom = currentZoom + 0.05;
        } else {
          newZoom = currentZoom - 0.05;
        }
        newZoom = Math.round(newZoom * 20) / 20;
      }
      
      // 限制范围 25% - 500%
      newZoom = Math.max(0.25, Math.min(5.0, newZoom));
      
      await setZoom(newZoom);
      showZoomIndicator(Math.round(newZoom * 100));
      return;
    }

    // 鼠标手势：右键 + 滚轮（不能同时按 Ctrl/Cmd，那是缩放）
    // 优化：使用 e.buttons 实时检测，移除不必要的同步延迟检查
    // e.buttons & 2：实时检测右键是否被按着（最可靠的方式）
    const isRightButtonPressed = (e.buttons & 2) !== 0;
    
    if (isRightButtonPressed && !isCtrlOrCmd && settings.mouseGesture) {
      // 立即阻止默认滚动行为
      e.preventDefault();
      e.stopPropagation();
      preventContextMenu = true;
      wheelCount++;  // 增加滚轮计数
      
      // 优化节流：降低到 50ms，提高响应速度
      const currentTime = Date.now();
      if (currentTime - lastWheelTime < 50) return;
      lastWheelTime = currentTime;

      // 异步切换标签（标记来源为鼠标手势）
      const direction = e.deltaY > 0 ? 'right' : 'left';
      chrome.runtime.sendMessage({ action: 'switchTab', direction, source: 'mouseGesture' });
    }
  }, { passive: false, capture: true });

  // ============================================
  // 超级拖拽 - 利用浏览器原生拖拽事件
  // ============================================
  
  // 记录拖拽起始位置
  let dragStartPos = { x: 0, y: 0 };
  let isDraggingForSuperDrag = false;

  // 判断是否是输入框（不应该在输入框上触发搜索）
  const isTextInput = (element) => element.matches(
    'input[type="email"], input[type="number"], input[type="password"], input[type="search"], ' +
    'input[type="tel"], input[type="text"], input[type="url"], input:not([type]), textarea, ' +
    '[contenteditable="true"], [contenteditable=""]'
  );

  // dragstart: 记录起始位置
  document.addEventListener('dragstart', (e) => {
    if (!settings.superDrag) return;
    
    dragStartPos = { x: e.clientX, y: e.clientY };
    isDraggingForSuperDrag = true;
  }, false);

  // dragover: 允许在页面任意位置释放
  document.addEventListener('dragover', (e) => {
    if (!settings.superDrag || !isDraggingForSuperDrag) return;
    
    // 不在输入框上触发
    if (isTextInput(e.target)) return;
    
    // 检查是否有可用的拖拽数据
    const types = e.dataTransfer.types;
    if (types.includes('text/uri-list') || types.includes('text/plain')) {
      e.dataTransfer.dropEffect = 'copy';
      e.preventDefault();
    }
  }, false);

  // drop: 执行操作
  document.addEventListener('drop', (e) => {
    if (!settings.superDrag || !isDraggingForSuperDrag) return;
    
    // 不在输入框上触发
    if (isTextInput(e.target)) return;
    
    const types = e.dataTransfer.types;
    
    // 计算拖拽距离
    const distance = Math.sqrt(
      Math.pow(e.clientX - dragStartPos.x, 2) + 
      Math.pow(e.clientY - dragStartPos.y, 2)
    );
    
    // 最小拖拽距离
    if (distance < 30) {
      isDraggingForSuperDrag = false;
      return;
    }
    
    // 处理链接拖拽
    if (types.includes('text/uri-list')) {
      const url = e.dataTransfer.getData('URL') || e.dataTransfer.getData('text/uri-list');
      if (url && !url.startsWith('javascript:')) {
        e.preventDefault();
        chrome.runtime.sendMessage({ action: 'openInNewTab', url: url, forceAdjacentPosition: true });
        isDraggingForSuperDrag = false;
        return;
      }
    }
    
    // 处理文字拖拽
    if (types.includes('text/plain')) {
      const text = e.dataTransfer.getData('text/plain')?.trim();
      if (text && text.length > 0 && text.length < 1000) {
        e.preventDefault();
        
        // 检查是否是网址
        if (isValidUrl(text)) {
          chrome.runtime.sendMessage({
            action: 'openInNewTab',
            url: ensureProtocol(text),
            forceAdjacentPosition: true
          });
        } else {
          // 搜索文字（固定使用 Bing）
          chrome.runtime.sendMessage({
            action: 'searchInNewTab',
            text: text,
            forceAdjacentPosition: true
          });
        }
      }
    }
    
    isDraggingForSuperDrag = false;
  }, false);

  // dragend: 清理状态
  document.addEventListener('dragend', () => {
    isDraggingForSuperDrag = false;
  }, false);

  // ============================================
  // 工具函数
  // ============================================

  function isValidUrl(text) {
    const urlPatterns = [
      /^https?:\/\//i,
      /^www\./i,
      /^[a-zA-Z0-9][-a-zA-Z0-9]*\.[a-zA-Z]{2,}/
    ];
    return urlPatterns.some(pattern => pattern.test(text));
  }

  function ensureProtocol(url) {
    if (!/^https?:\/\//i.test(url)) {
      return 'https://' + url;
    }
    return url;
  }

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

  // ============================================
  // F2/F3 切换标签
  // ============================================
  
  document.addEventListener('keydown', (e) => {
    // F2/F3 切换标签（不在输入框中触发）
    if (settings.tabSwitchKey && (e.key === 'F2' || e.key === 'F3')) {
      // 不在输入框中触发
      const activeEl = document.activeElement;
      const isInInput = activeEl && (
        activeEl.tagName === 'INPUT' ||
        activeEl.tagName === 'TEXTAREA' ||
        activeEl.isContentEditable
      );
      
      if (!isInInput) {
        // 必须同时使用 preventDefault 和 stopImmediatePropagation 来阻止 F3 的查找功能
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        const direction = e.key === 'F2' ? 'left' : 'right';
        chrome.runtime.sendMessage({ action: 'switchTab', direction, source: 'keyboard' });
        return false;
      }
    }
  }, true);  // 捕获阶段

  // ============================================
  // Alt+点击快速保存图片（顶层 frame 调用）
  // ============================================
  setupQuickSaveImage(settings);

  // ============================================
  // 初始化自绘书签栏（如果启用）
  // ============================================
  
  function initCustomBookmarkBar() {
    if (window.EchoBookmarkBar && window.EchoBookmarkBar.init) {
      window.EchoBookmarkBar.init(settings);
    }
  }

  // 启动书签栏（如果启用）
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initCustomBookmarkBar);
  } else {
    initCustomBookmarkBar();
  }
})();
