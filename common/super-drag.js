/**
 * ECHO 超级拖拽模块
 * 
 * 独立模块，可在扩展页面和普通网页中使用
 * 拖拽文字进行搜索，拖拽链接在新标签页打开
 */

(function() {
  'use strict';

  // 避免重复初始化
  if (window.__echoSuperDragInitialized) return;
  window.__echoSuperDragInitialized = true;

  // 记录拖拽起始位置
  let dragStartPos = { x: 0, y: 0 };
  let isDraggingForSuperDrag = false;

  // 判断是否是输入框（不应该在输入框上触发搜索）
  const isTextInput = (element) => element.matches(
    'input[type="email"], input[type="number"], input[type="password"], input[type="search"], ' +
    'input[type="tel"], input[type="text"], input[type="url"], input:not([type]), textarea, ' +
    '[contenteditable="true"], [contenteditable=""]'
  );

  // 判断是否是有效的 URL
  function isValidUrl(text) {
    const urlPatterns = [
      /^https?:\/\//i,
      /^www\./i,
      /^[a-zA-Z0-9][-a-zA-Z0-9]*\.[a-zA-Z]{2,}/
    ];
    return urlPatterns.some(pattern => pattern.test(text));
  }

  // 确保 URL 有协议前缀
  function ensureProtocol(url) {
    if (!/^https?:\/\//i.test(url)) {
      return 'https://' + url;
    }
    return url;
  }

  // dragstart: 记录起始位置
  document.addEventListener('dragstart', (e) => {
    dragStartPos = { x: e.clientX, y: e.clientY };
    isDraggingForSuperDrag = true;
  }, false);

  // dragover: 允许在页面任意位置释放
  document.addEventListener('dragover', (e) => {
    if (!isDraggingForSuperDrag) return;
    
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
    if (!isDraggingForSuperDrag) return;
    
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
})();
