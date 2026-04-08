/**
 * ECHO B站视频画面工具
 * 独立模块，在 bilibili.com 视频页显示画面调整工具
 * 功能：颜色反转、通道交换、旋转、镜像、扩展倍速
 */

(async function() {
  'use strict';

  if (window !== window.top) return;
  if (window.__ECHO_BILI_TOOL_ACTIVE__) return;
  window.__ECHO_BILI_TOOL_ACTIVE__ = true;

  // ============ 设置 ============
  const DEFAULT_SETTINGS = {
    biliTool: true,
    biliToolPosition: { left: '0px', top: '50%' }
  };

  // 兼容旧 key 迁移
  const oldVal = await chrome.storage.sync.get('floatingSearchBoxBiliTool');
  if (oldVal.floatingSearchBoxBiliTool !== undefined) {
    await chrome.storage.sync.set({ biliTool: oldVal.floatingSearchBoxBiliTool });
    await chrome.storage.sync.remove('floatingSearchBoxBiliTool');
  }

  let settings = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  if (!settings.biliTool) return;

  // ============ 状态变量 ============
  let invertActive = false;
  let activeChannels = new Set();
  let rotateAngle = 0;
  let rotateFillMode = false;
  let mirrorActive = false;
  let invertStyleElement = null;
  let invertSvgElement = null;
  let rotateStyleElement = null;
  let isExpanded = false;
  let isDragging = false;

  // 通道交换定义
  const CHANNEL_SWAPS = [
    { id: 1, label: '红↔绿', title: '红↔绿 通道交换', rows: [0, 1], colors: ['#FF0000', '#00CC00'] },
    { id: 2, label: '绿↔蓝', title: '绿↔蓝 通道交换', rows: [1, 2], colors: ['#00CC00', '#4488FF'] },
    { id: 3, label: '蓝↔红', title: '蓝↔红 通道交换', rows: [2, 0], colors: ['#4488FF', '#FF0000'] },
  ];

  // ============ 页面检测 ============
  function isBilibiliVideoPage() {
    return window.location.hostname.includes('bilibili.com') &&
      !!document.querySelector('.bpx-player-video-wrap');
  }

  // ============ 颜色/滤镜功能 ============

  function updateWrapOverflow() {
    const wrap = document.querySelector('.bpx-player-video-wrap');
    if (!wrap) return;
    const hasAnyEffect = invertActive || activeChannels.size > 0 || rotateAngle !== 0 || mirrorActive;
    wrap.style.overflow = hasAnyEffect ? 'hidden' : '';
  }

  function ensureInvertSvgFilters() {
    if (invertSvgElement) return;
    invertSvgElement = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    invertSvgElement.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    invertSvgElement.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
    invertSvgElement.id = 'echo-invert-svg-filters';
    const filter = document.createElementNS('http://www.w3.org/2000/svg', 'filter');
    filter.setAttribute('id', 'echo-filter-channel');
    const matrix = document.createElementNS('http://www.w3.org/2000/svg', 'feColorMatrix');
    matrix.setAttribute('type', 'matrix');
    matrix.setAttribute('values', '1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 1 0');
    filter.appendChild(matrix);
    invertSvgElement.appendChild(filter);
    document.body.appendChild(invertSvgElement);
  }

  function computeChannelMatrix() {
    const rows = [
      [1, 0, 0, 0, 0],
      [0, 1, 0, 0, 0],
      [0, 0, 1, 0, 0],
      [0, 0, 0, 1, 0],
    ];
    for (const swap of CHANNEL_SWAPS) {
      if (!activeChannels.has(swap.id)) continue;
      const [a, b] = swap.rows;
      const temp = rows[a];
      rows[a] = rows[b];
      rows[b] = temp;
    }
    return rows.map(r => r.join(' ')).join('  ');
  }

  function applyInvertFilter() {
    if (invertStyleElement) {
      invertStyleElement.remove();
      invertStyleElement = null;
    }
    if (!invertActive && activeChannels.size === 0) {
      updateWrapOverflow();
      updatePanelState();
      updateIndicator();
      return;
    }
    const filters = [];
    if (invertActive) {
      filters.push('invert(1) hue-rotate(180deg)');
    }
    if (activeChannels.size > 0) {
      ensureInvertSvgFilters();
      const matrixEl = invertSvgElement.querySelector('feColorMatrix');
      if (matrixEl) matrixEl.setAttribute('values', computeChannelMatrix());
      filters.push('url(#echo-filter-channel)');
    }
    invertStyleElement = document.createElement('style');
    invertStyleElement.id = 'echo-video-invert-style';
    invertStyleElement.textContent = `
      .bpx-player-video-wrap video,
      #bilibili-player video {
        filter: ${filters.join(' ')} !important;
      }
    `;
    document.head.appendChild(invertStyleElement);
    updateWrapOverflow();
    updatePanelState();
    updateIndicator();
  }

  function toggleInvert() {
    invertActive = !invertActive;
    applyInvertFilter();
  }

  function toggleChannelSwap(swapId) {
    if (activeChannels.has(swapId)) {
      activeChannels.delete(swapId);
    } else {
      activeChannels.add(swapId);
    }
    applyInvertFilter();
  }

  // ============ 旋转/镜像功能 ============

  function applyRotateTransform() {
    if (rotateStyleElement) {
      rotateStyleElement.remove();
      rotateStyleElement = null;
    }
    if (rotateAngle === 0 && !mirrorActive) {
      updatePanelState();
      updateIndicator();
      return;
    }
    const isRotated90 = (rotateAngle === 90 || rotateAngle === 270);
    let scaleCSS = '';
    if (isRotated90) {
      const container = document.querySelector('.bpx-player-video-area') || document.querySelector('.bpx-player-video-wrap');
      const video = document.querySelector('.bpx-player-video-wrap video');
      if (container && video) {
        const cw = container.clientWidth;
        const ch = container.clientHeight;
        const scaleX = cw / ch;
        const scaleY = ch / cw;
        const scale = rotateFillMode ? Math.max(scaleX, scaleY) : Math.min(scaleX, scaleY);
        scaleCSS = ` scale(${scale.toFixed(4)})`;
      } else {
        const defaultScale = rotateFillMode ? 1.78 : 0.5625;
        scaleCSS = ` scale(${defaultScale})`;
      }
    }
    const transforms = [];
    if (mirrorActive) transforms.push('scaleX(-1)');
    if (rotateAngle !== 0) transforms.push(`rotate(${rotateAngle}deg)`);
    if (scaleCSS) transforms.push(scaleCSS.trim());
    rotateStyleElement = document.createElement('style');
    rotateStyleElement.id = 'echo-video-rotate-style';
    rotateStyleElement.textContent = `
      .bpx-player-video-wrap video {
        transform: ${transforms.join(' ')} !important;
      }
    `;
    document.head.appendChild(rotateStyleElement);
    updateWrapOverflow();
    updatePanelState();
    updateIndicator();
  }

  function rotateVideo() {
    rotateAngle = (rotateAngle + 90) % 360;
    applyRotateTransform();
  }

  function toggleMirror() {
    mirrorActive = !mirrorActive;
    applyRotateTransform();
  }

  function toggleRotateFitMode() {
    rotateFillMode = !rotateFillMode;
    applyRotateTransform();
  }

  function clearRotate() {
    rotateAngle = 0;
    rotateFillMode = false;
    mirrorActive = false;
    if (rotateStyleElement) {
      rotateStyleElement.remove();
      rotateStyleElement = null;
    }
    updateWrapOverflow();
  }

  // ============ 倍速功能 ============
  function setSpeed(rate) {
    const video = document.querySelector('bwp-video, video');
    if (!video) return;
    video.playbackRate = (video.playbackRate === rate) ? 1.0 : rate;
  }

  // ============ 样式 ============
  function getStyles() {
    return `
      :host {
        all: initial;
        position: fixed !important;
        left: 0 !important;
        top: 50% !important;
        transform: translateY(-50%);
        z-index: 2147483647 !important;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
        pointer-events: auto;
      }

      .bili-tool-container {
        display: flex;
        align-items: center;
        gap: 0;
      }

      .capsule {
        width: 28px;
        min-height: 80px;
        background: rgba(255,255,255,0.92);
        backdrop-filter: blur(12px);
        border-radius: 0 14px 14px 0;
        border: 0.5px solid rgba(0,0,0,0.1);
        box-shadow: 2px 2px 12px rgba(0,0,0,0.15);
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 4px;
        padding: 8px 2px;
        cursor: pointer;
        transition: all 0.2s ease;
        user-select: none;
        writing-mode: vertical-rl;
        font-size: 11px;
        color: #666;
      }

      .capsule:hover {
        width: 32px;
        background: rgba(255,255,255,0.98);
        box-shadow: 2px 2px 16px rgba(0,0,0,0.2);
        color: #333;
      }

      .capsule svg {
        width: 16px;
        height: 16px;
        flex-shrink: 0;
      }

      .capsule-text {
        writing-mode: vertical-rl;
        font-size: 11px;
        font-weight: 500;
        letter-spacing: 2px;
      }

      .panel {
        display: none;
        flex-direction: column;
        gap: 6px;
        padding: 10px;
        background: rgba(255,255,255,0.95);
        backdrop-filter: blur(16px);
        border-radius: 0 12px 12px 0;
        box-shadow: 4px 4px 24px rgba(0,0,0,0.2);
        min-width: 200px;
        animation: slideRight 0.2s ease-out;
      }

      .panel.show { display: flex; }

      @keyframes slideRight {
        from { opacity: 0; transform: translateX(-10px); }
        to { opacity: 1; transform: translateX(0); }
      }

      .btn-group {
        display: flex;
        align-items: center;
        background: rgba(0,0,0,0.04);
        border-radius: 8px;
        overflow: hidden;
      }

      .btn-group-label {
        font-size: 10px;
        color: #999;
        padding: 0 8px;
        white-space: nowrap;
      }

      .tool-btn {
        height: 28px;
        border: none;
        background: transparent;
        cursor: pointer;
        color: #444;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 3px;
        padding: 0 8px;
        font-size: 11px;
        font-family: inherit;
        white-space: nowrap;
        transition: background 0.15s, color 0.15s;
      }

      .tool-btn:hover { background: rgba(0,0,0,0.06); color: #222; }
      .tool-btn.active { color: #fff; background: #0078d4; }
      .tool-btn.active:hover { background: #106ebe; }
      .tool-btn.disabled { opacity: 0.4; cursor: default; pointer-events: none; }

      .btn-sep {
        width: 1px;
        height: 14px;
        background: rgba(0,0,0,0.1);
        flex-shrink: 0;
      }

      @media (prefers-color-scheme: dark) {
        .capsule {
          background: rgba(40,40,40,0.88);
          border-color: rgba(255,255,255,0.1);
          color: #aaa;
        }
        .capsule:hover { background: rgba(50,50,50,0.95); color: #eee; }
        .panel {
          background: rgba(30,30,30,0.95);
          box-shadow: 4px 4px 24px rgba(0,0,0,0.4);
        }
        .btn-group { background: rgba(255,255,255,0.06); }
        .tool-btn { color: #ccc; }
        .tool-btn:hover { background: rgba(255,255,255,0.08); color: #fff; }
        .tool-btn.active { background: #3b82f6; }
        .btn-sep { background: rgba(255,255,255,0.1); }
      }
    `;
  }

  // ============ Shadow DOM + 胶囊 UI ============
  let shadowHost = null;
  let shadowPanel = null;
  let shadowRef = null;

  function showCapsule() {
    if (shadowHost) shadowHost.style.display = '';
  }

  function hideCapsule() {
    if (shadowHost) shadowHost.style.display = 'none';
  }

  function clearAllEffects() {
    invertActive = false;
    activeChannels.clear();
    if (invertStyleElement) { invertStyleElement.remove(); invertStyleElement = null; }
    if (invertSvgElement) { invertSvgElement.remove(); invertSvgElement = null; }
    clearRotate();
    const video = document.querySelector('bwp-video, video');
    if (video && video.playbackRate !== 1.0) video.playbackRate = 1.0;
    updateWrapOverflow();
    removeIndicator();
  }

  // 状态指示器（主文档上，非 Shadow DOM）
  let indicatorEl = null;

  function updateIndicator() {
    const hasColor = invertActive || activeChannels.size > 0;
    const hasRotate = rotateAngle !== 0;
    const hasMirror = mirrorActive;
    const video = document.querySelector('bwp-video, video');
    const hasSpeed = video && video.playbackRate !== 1.0;
    if (hasColor || hasRotate || hasMirror || hasSpeed) {
      const parts = [];
      if (hasColor) parts.push('颜色已调整');
      if (hasRotate) parts.push(`已旋转${rotateAngle}°`);
      if (hasMirror) parts.push('已镜像');
      if (hasSpeed) parts.push(`${video.playbackRate}×倍速`);
      showIndicator(parts.join(' / '));
    } else {
      removeIndicator();
    }
  }

  function showIndicator(text) {
    if (indicatorEl) {
      indicatorEl.textContent = text + ' \u00b7 点击重置';
      return;
    }
    indicatorEl = document.createElement('div');
    indicatorEl.id = 'echo-bili-indicator';
    indicatorEl.style.cssText = `
      position: fixed; top: 16px; right: 16px; z-index: 2147483646;
      background: rgba(0,0,0,0.75); color: #fff; font-size: 12px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      padding: 6px 14px; border-radius: 16px; cursor: pointer;
      user-select: none; backdrop-filter: blur(8px);
      transition: opacity 0.3s; opacity: 0;
    `;
    indicatorEl.textContent = text + ' \u00b7 点击重置';
    indicatorEl.addEventListener('click', () => { clearAllEffects(); if (shadowRef) shadowRef.updateBtnStates(); });
    document.body.appendChild(indicatorEl);
    requestAnimationFrame(() => { if (indicatorEl) indicatorEl.style.opacity = '1'; });
  }

  function removeIndicator() {
    if (!indicatorEl) return;
    indicatorEl.style.opacity = '0';
    const el = indicatorEl;
    indicatorEl = null;
    setTimeout(() => el.remove(), 300);
  }

  function updatePanelState() {
    if (shadowRef && shadowRef.updateBtnStates) shadowRef.updateBtnStates();
  }

  function createCapsuleUI() {
    if (document.querySelector('echo-bili-tool')) return;

    const host = document.createElement('echo-bili-tool');
    shadowHost = host;
    const shadow = host.attachShadow({ mode: 'closed' });

    const style = document.createElement('style');
    style.textContent = getStyles();
    shadow.appendChild(style);

    const container = document.createElement('div');
    container.className = 'bili-tool-container';

    // 胶囊
    const capsule = document.createElement('div');
    capsule.className = 'capsule';
    capsule.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="2" y="3" width="20" height="14" rx="2"/>
        <path d="M8 21h8"/><path d="M12 17v4"/>
      </svg>
      <span class="capsule-text">画面</span>
    `;

    // 展开面板
    const panel = document.createElement('div');
    panel.className = 'panel';
    shadowPanel = panel;

    // 颜色组
    const colorGroup = document.createElement('div');
    colorGroup.className = 'btn-group';
    const invertBtn = createToolBtn('反转', 'invert', () => { toggleInvert(); updateBtnStates(); });
    colorGroup.appendChild(invertBtn);
    CHANNEL_SWAPS.forEach(swap => {
      colorGroup.appendChild(createSep());
      const btn = createToolBtn(swap.label, 'channel-' + swap.id, () => { toggleChannelSwap(swap.id); updateBtnStates(); });
      colorGroup.appendChild(btn);
    });
    panel.appendChild(colorGroup);

    // 变换组
    const transformGroup = document.createElement('div');
    transformGroup.className = 'btn-group';
    transformGroup.appendChild(createToolBtn('旋转', 'rotate', () => { rotateVideo(); updateBtnStates(); }));
    transformGroup.appendChild(createSep());
    transformGroup.appendChild(createToolBtn('镜像', 'mirror', () => { toggleMirror(); updateBtnStates(); }));
    transformGroup.appendChild(createSep());
    const fitBtn = createToolBtn('适应', 'fit', () => { toggleRotateFitMode(); updateBtnStates(); });
    fitBtn.classList.add('disabled');
    transformGroup.appendChild(fitBtn);
    panel.appendChild(transformGroup);

    // 倍速组
    const speedGroup = document.createElement('div');
    speedGroup.className = 'btn-group';
    speedGroup.appendChild(createToolBtn('0.25×', 'slow', () => { setSpeed(0.25); updateBtnStates(); }));
    speedGroup.appendChild(createSep());
    speedGroup.appendChild(createToolBtn('3×', 'fast', () => { setSpeed(3.0); updateBtnStates(); }));
    panel.appendChild(speedGroup);

    container.appendChild(capsule);
    container.appendChild(panel);
    shadow.appendChild(container);
    document.body.appendChild(host);

    // 胶囊点击展开/收起
    capsule.addEventListener('click', (e) => {
      if (isDragging) return;
      isExpanded = !isExpanded;
      panel.classList.toggle('show', isExpanded);
    });

    // 点击外部收起
    document.addEventListener('click', (e) => {
      if (!host.contains(e.target) && isExpanded) {
        isExpanded = false;
        panel.classList.remove('show');
      }
    });

    // 拖拽
    initDrag(host, capsule);

    // 恢复位置
    if (settings.biliToolPosition && settings.biliToolPosition.top) {
      host.style.top = settings.biliToolPosition.top;
      host.style.transform = 'none';
    }

    // 监听倍速变化
    const video = document.querySelector('bwp-video, video');
    if (video) {
      video.addEventListener('ratechange', () => updateBtnStates());
    }

    function updateBtnStates() {
      const btns = shadow.querySelectorAll('.tool-btn');
      btns.forEach(btn => {
        const action = btn.dataset.action;
        if (action === 'invert') btn.classList.toggle('active', invertActive);
        if (action?.startsWith('channel-')) {
          const id = parseInt(action.split('-')[1]);
          btn.classList.toggle('active', activeChannels.has(id));
        }
        if (action === 'rotate') btn.classList.toggle('active', rotateAngle !== 0);
        if (action === 'mirror') btn.classList.toggle('active', mirrorActive);
        if (action === 'fit') {
          const is90 = (rotateAngle === 90 || rotateAngle === 270);
          btn.classList.toggle('disabled', !is90);
          btn.classList.toggle('active', rotateFillMode);
          btn.textContent = rotateFillMode ? '填充' : '适应';
        }
        if (action === 'slow') {
          const v = document.querySelector('bwp-video, video');
          btn.classList.toggle('active', v && v.playbackRate === 0.25);
        }
        if (action === 'fast') {
          const v = document.querySelector('bwp-video, video');
          btn.classList.toggle('active', v && v.playbackRate === 3.0);
        }
      });
      updateIndicator();
    }

    shadowRef = { updateBtnStates };
  }

  function createToolBtn(text, action, onClick) {
    const btn = document.createElement('button');
    btn.className = 'tool-btn';
    btn.dataset.action = action;
    btn.textContent = text;
    btn.addEventListener('click', onClick);
    return btn;
  }

  function createSep() {
    const sep = document.createElement('div');
    sep.className = 'btn-sep';
    return sep;
  }

  // ============ 拖拽 ============
  function initDrag(host, capsule) {
    let startY, startTop;

    capsule.addEventListener('mousedown', (e) => {
      startY = e.clientY;
      startTop = parseInt(host.style.top) || window.innerHeight / 2;
      isDragging = false;

      const onMove = (e2) => {
        const delta = e2.clientY - startY;
        if (Math.abs(delta) > 3) isDragging = true;
        const newTop = Math.max(50, Math.min(window.innerHeight - 100, startTop + delta));
        host.style.top = newTop + 'px';
        host.style.transform = 'none';
      };

      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        if (isDragging) {
          chrome.storage.sync.set({ biliToolPosition: { top: host.style.top } });
          setTimeout(() => { isDragging = false; }, 50);
        }
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  // ============ SPA 路由监听 ============
  let routeListenerActive = false;
  function initRouteListener() {
    if (routeListenerActive) return;
    routeListenerActive = true;

    let lastUrl = location.href;

    // 拦截 pushState / replaceState
    const origPushState = history.pushState;
    history.pushState = function(...args) {
      origPushState.apply(this, args);
      onRouteChange();
    };
    const origReplaceState = history.replaceState;
    history.replaceState = function(...args) {
      origReplaceState.apply(this, args);
      onRouteChange();
    };
    window.addEventListener('popstate', onRouteChange);

    function onRouteChange() {
      if (location.href === lastUrl) return;
      lastUrl = location.href;
      // 离开视频页时清除效果
      clearAllEffects();
      // 延迟检测新页面是否有播放器（SPA 动态加载）
      setTimeout(() => {
        if (isBilibiliVideoPage()) {
          if (!shadowHost) createCapsuleUI();
          else showCapsule();
        } else {
          hideCapsule();
        }
      }, 1500);
    }
  }

  // ============ 初始化 ============
  function init() {
    if (!isBilibiliVideoPage()) {
      // 等待 SPA 加载
      initRouteListener();
      return;
    }
    createCapsuleUI();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
