/**
 * ECHO 超级拖拽模块
 * 
 * 独立模块，可在扩展页面和普通网页中使用
 * 拖拽文字进行搜索，拖拽链接在新标签页打开
 */

(function() {
  'use strict';

  const MESSAGE_ACTIONS = EchoMessages.ACTIONS;
  const inputContext = EchoInputContext;
  const inputPolicy = EchoInputPolicy;

  // 避免重复初始化
  if (window.__echoSuperDragInitialized) return;
  window.__echoSuperDragInitialized = true;

  // 记录拖拽起始位置
  let dragStartPos = { x: 0, y: 0 };
  let isDraggingForSuperDrag = false;

  // dragstart: 记录起始位置
  document.addEventListener('dragstart', (e) => {
    if (!inputContext.isEnabled('superDrag')) return;
    dragStartPos = { x: e.clientX, y: e.clientY };
    isDraggingForSuperDrag = true;
  }, false);

  // dragover: 允许在页面任意位置释放
  document.addEventListener('dragover', (e) => {
    if (!inputContext.isEnabled('superDrag') || !isDraggingForSuperDrag) return;
    
    // 不在输入框上触发
    if (inputPolicy.isEditable(e.target)) return;
    
    // 检查是否有可用的拖拽数据
    const types = e.dataTransfer.types;
    if (types.includes('text/uri-list') || types.includes('text/plain')) {
      e.dataTransfer.dropEffect = 'copy';
      e.preventDefault();
    }
  }, false);

  // drop: 执行操作
  document.addEventListener('drop', (e) => {
    if (!inputContext.isEnabled('superDrag') || !isDraggingForSuperDrag) return;
    
    // 不在输入框上触发
    if (inputPolicy.isEditable(e.target)) return;
    
    const types = e.dataTransfer.types;
    
    // 计算拖拽距离
    const distance = inputPolicy.dragDistance(dragStartPos, { x: e.clientX, y: e.clientY });
    
    // 最小拖拽距离
    if (distance < 30) {
      isDraggingForSuperDrag = false;
      return;
    }
    
    const intent = inputPolicy.classifyDrop(e.dataTransfer);
    if (intent) {
      e.preventDefault();
      chrome.runtime.sendMessage(intent.type === 'url'
        ? { action: MESSAGE_ACTIONS.OPEN_IN_NEW_TAB, url: intent.value, forceAdjacentPosition: true }
        : { action: MESSAGE_ACTIONS.SEARCH_IN_NEW_TAB, text: intent.value, forceAdjacentPosition: true });
    }
    
    isDraggingForSuperDrag = false;
  }, false);

  // dragend: 清理状态
  document.addEventListener('dragend', () => {
    isDraggingForSuperDrag = false;
  }, false);
})();
