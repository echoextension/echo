/**
 * ECHO B站视频优化工具
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

  // 监听设置变化（用户在设置页关闭时立即生效）
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'sync' && changes.biliTool) {
      settings.biliTool = changes.biliTool.newValue;
      if (!settings.biliTool) {
        clearAllEffects();
        hideCapsule();
      } else if (isBilibiliVideoPage()) {
        if (!shadowHost) createCapsuleUI();
        else showCapsule();
        bindVideoRateChange();
      }
    }
  });

  // ============ SVG 资产 ============

  // ====== 1. 颜色段图标：双矩形交替填充动画 ======
  const SVG_COLOR = `
<svg width="20" height="20" viewBox="0 0 24 24" fill="none">
  <rect x="1" y="3" width="10" height="18" rx="2" stroke="#f30c5f" stroke-width="1.2">
    <animate attributeName="fill" values="#f30c5f;white;#f30c5f" keyTimes="0;0.5;1" dur="4s" repeatCount="indefinite"/>
  </rect>
  <rect x="13" y="3" width="10" height="18" rx="2" stroke="#f30c5f" stroke-width="1.2">
    <animate attributeName="fill" values="white;#f30c5f;white" keyTimes="0;0.5;1" dur="4s" repeatCount="indefinite"/>
  </rect>
</svg>`;

  // ====== 2. 旋转段图标：文档框旋转动画 ======
  const SVG_ROTATE = `
<svg width="20" height="20" viewBox="0 0 24 24" fill="white" stroke="#f30c5f" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
  <g>
    <animateTransform attributeName="transform" type="rotate" values="0 12 12;0 12 12;90 12 12;90 12 12;0 12 12" keyTimes="0;0.35;0.5;0.85;1" dur="3s" repeatCount="indefinite"/>
    <rect x="4" y="5" width="16" height="14" rx="2"/>
    <path d="M9 9l6 0"/>
    <path d="M9 13l3 0"/>
  </g>
</svg>`;

  // ====== 3. 倍速段图标：双三角闪烁动画 ======
  const SVG_SPEED = `
<svg width="20" height="20" viewBox="0 0 24 24" fill="#f30c5f" stroke="none">
  <polygon points="4,3 14,12 4,21">
    <animate attributeName="opacity" values="1;0.3;1" dur="3s" repeatCount="indefinite"/>
  </polygon>
  <polygon points="13,6 20,12 13,18">
    <animate attributeName="opacity" values="0.3;1;0.3" dur="3s" repeatCount="indefinite"/>
  </polygon>
</svg>`;

  // ====== 4. 重置段图标：B站小电视眨眼 ======
  const SVG_RESET = `
<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#f30c5f" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
  <rect x="2" y="5" width="20" height="14" rx="3" fill="white"/>
  <path d="M8 2L10 5"/><path d="M16 2L14 5"/>
  <ellipse cx="9" cy="11" rx="1.5" ry="1.5" fill="#f30c5f" stroke="none">
    <animate attributeName="ry" values="1.5;0.2;1.5" keyTimes="0;0.5;1" dur="3s" repeatCount="indefinite"/>
  </ellipse>
  <ellipse cx="15" cy="11" rx="1.5" ry="1.5" fill="#f30c5f" stroke="none">
    <animate attributeName="ry" values="1.5;0.2;1.5" keyTimes="0;0.5;1" dur="3s" repeatCount="indefinite"/>
  </ellipse>
</svg>`;

  // ====== 色板（B站粉色系） ======
  // 主色：#fb7299（B站品牌粉）
  // 胶囊背景（收起态）：rgba(251,114,153,0.12) 或 #2A1520（深色模式）
  // 胶囊背景（hover）：rgba(251,114,153,0.20)
  // 段高亮（有效果激活）：rgba(251,114,153,0.35)
  // 面板背景：rgba(30,20,25,0.95)（深色）/ rgba(255,245,248,0.95)（浅色）
  // 按钮默认：rgba(251,114,153,0.08)
  // 按钮 hover：rgba(251,114,153,0.15)
  // 按钮 active（功能开启）：#fb7299 文字白色
  // 文字主色：#fb7299
  // 文字副色：rgba(251,114,153,0.6)
  // 分割线：rgba(251,114,153,0.15)

  // ============ 状态变量 ============
  let invertActive = false;
  let activeChannels = new Set();
  let rotateAngle = 0;
  let rotateFillMode = false;
  let mirrorActive = false;
  let invertStyleElement = null;
  let invertSvgElement = null;
  let rotateStyleElement = null;
  let isDragging = false;
  let currentVideoEl = null;
  let ratechangeHandler = null;
  let rawVideoEl = null;
  let videoSourceHandler = null;

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
      updateWrapOverflow();
      updatePanelState();
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
        if (cw > 0 && ch > 0) {
          const scaleX = cw / ch;
          const scaleY = ch / cw;
          const scale = rotateFillMode ? Math.max(scaleX, scaleY) : Math.min(scaleX, scaleY);
          scaleCSS = ` scale(${scale.toFixed(4)})`;
        } else {
          const defaultScale = rotateFillMode ? 1.78 : 0.5625;
          scaleCSS = ` scale(${defaultScale})`;
        }
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
      .bpx-player-video-wrap video,
      #bilibili-player video {
        transform: ${transforms.join(' ')} !important;
      }
    `;
    document.head.appendChild(rotateStyleElement);
    updateWrapOverflow();
    updatePanelState();
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
        top: var(--echo-top, 50%) !important;
        transform: translateY(-50%);
        z-index: 2147483647 !important;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
        pointer-events: auto;
      }

      .bili-tool-container {
        display: flex;
        flex-direction: column;
        position: relative;
      }

      /* ---- 胶囊轨道 ---- */
      .capsule-rail {
        display: flex;
        flex-direction: column;
        background: rgba(255, 255, 255, 0.92);
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        border-radius: 0 14px 14px 0;
        border: 0.5px solid rgba(251,114,153,0.35);
        border-left: none;
        box-shadow: 2px 0 12px rgba(0, 0, 0, 0.08), 0 2px 8px rgba(0, 0, 0, 0.04);
        overflow: hidden;
      }

      /* ---- 拖拽手柄 ---- */
      .drag-handle {
        width: 36px;
        height: 12px;
        display: grid;
        grid-template-columns: repeat(3, 3px);
        grid-template-rows: repeat(2, 3px);
        gap: 2px;
        justify-content: center;
        align-content: center;
        padding-right: 4px;
        box-sizing: border-box;
        cursor: grab;
        user-select: none;
        background: rgba(251,114,153,0.03);
        transition: background 0.15s;
      }
      .drag-handle span {
        width: 3px;
        height: 3px;
        border-radius: 50%;
        background: rgba(251,114,153,0.25);
        transition: background 0.15s;
      }
      .drag-handle:hover {
        background: rgba(251,114,153,0.06);
      }
      .drag-handle:hover span {
        background: rgba(251,114,153,0.5);
      }
      .drag-handle:active {
        cursor: grabbing;
      }
      .drag-handle:active span {
        background: rgba(251,114,153,0.7);
      }

      /* ---- 四段胶囊 ---- */
      .capsule-segment {
        width: 36px;
        height: 60px;
        background: rgba(251,114,153,0.08);
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 2px;
        padding-left: 0;
        padding-right: 4px;
        box-sizing: border-box;
        cursor: pointer;
        user-select: none;
        transition: background 0.2s, color 0.2s;
      }

      .capsule-segment:hover {
        background: rgba(251,114,153,0.18);
      }

      .capsule-segment.active {
        background: rgba(251,114,153,0.30);
      }

      .capsule-segment.has-effect {
        background: #df497f;
      }
      .capsule-segment.has-effect .seg-label {
        color: #fff;
      }
      .capsule-segment.has-effect svg {
        filter: brightness(0) invert(1);
      }
      .capsule-segment.has-effect:hover {
        background: #c93d6e;
      }

      .capsule-segment .seg-icon {
        width: 20px;
        height: 20px;
        flex-shrink: 0;
      }

      .capsule-segment .seg-label {
        font-size: 11px;
        color: #f30c5f;
        font-weight: 400;
        letter-spacing: 1px;
        line-height: 1;
      }

      .segment-divider {
        width: 20px;
        height: 1px;
        background: rgba(251,114,153,0.35);
        margin: 0 auto;
      }

      /* ---- 弹出面板 ---- */
      .panel {
        display: none;
        position: absolute;
        left: 39px;
        flex-direction: column;
        gap: 8px;
        padding: 14px;
        background: rgba(255,245,248,0.96);
        border: 0.5px solid rgba(251,114,153,0.35);
        border-left: none;
        border-radius: 0 12px 12px 0;
        backdrop-filter: blur(16px);
        -webkit-backdrop-filter: blur(16px);
        width: fit-content;
        box-shadow: 4px 2px 20px rgba(0,0,0,0.08);
        animation: slideRight 0.15s ease-out;
      }

      .panel-title {
        font-size: 12px;
        font-weight: 600;
        color: #fb7299;
        margin-bottom: 4px;
      }

      .panel.show {
        display: flex;
      }

      @keyframes slideRight {
        from { opacity: 0; transform: translateX(-8px); }
        to { opacity: 1; transform: translateX(0); }
      }

      /* ---- 按钮组 ---- */
      .btn-grid {
        display: flex;
        flex-direction: row;
        flex-wrap: wrap;
        gap: 8px;
      }

      .tool-btn {
        height: 34px;
        padding: 0 14px;
        border: none;
        border-radius: 8px;
        background: rgba(251,114,153,0.15);
        color: #ff3c82;
        font-size: 12px;
        font-family: inherit;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 5px;
        white-space: nowrap;
        transition: background 0.15s, color 0.15s;
      }

      .tool-btn:hover {
        background: rgba(251,114,153,0.25);
      }

      .tool-btn.active {
        background: #df497f;
        color: #fff;
      }

      .tool-btn.active:hover {
        background: #c93d6e;
      }

      .tool-btn.active svg {
        stroke: #fff;
      }
      .tool-btn.active svg path[fill]:not([fill="none"]),
      .tool-btn.active svg circle[fill]:not([fill="none"]) {
        fill: #fff;
      }

      .tool-btn.disabled {
        opacity: 0.3;
        cursor: default;
        pointer-events: none;
      }

      /* ---- 右键菜单 ---- */
      .context-menu {
        display: none;
        position: absolute;
        left: 38px;
        top: 0;
        flex-direction: column;
        background: rgba(255,245,248,0.96);
        border: 0.5px solid rgba(251,114,153,0.35);
        border-radius: 8px;
        backdrop-filter: blur(16px);
        -webkit-backdrop-filter: blur(16px);
        box-shadow: 0 4px 20px rgba(0,0,0,0.12);
        padding: 4px;
        z-index: 10;
        min-width: 110px;
        animation: slideRight 0.12s ease-out;
      }
      .context-menu.show {
        display: flex;
      }
      .context-menu-item {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 7px 12px;
        font-size: 12px;
        color: #f30c5f;
        cursor: pointer;
        border-radius: 6px;
        white-space: nowrap;
        transition: background 0.12s;
        border: none;
        background: none;
        font-family: inherit;
      }
      .context-menu-item:hover {
        background: rgba(251,114,153,0.12);
      }
      .context-menu-item svg {
        width: 14px;
        height: 14px;
        flex-shrink: 0;
      }

      /* ---- 深色模式 ---- */
      @media (prefers-color-scheme: dark) {
        .capsule-rail {
          background: rgba(30, 20, 25, 0.92);
          box-shadow: 2px 0 12px rgba(0, 0, 0, 0.3);
        }
        .drag-handle {
          background: rgba(251,114,153,0.02);
        }
        .drag-handle span {
          background: rgba(251,114,153,0.2);
        }
        .drag-handle:hover {
          background: rgba(251,114,153,0.05);
        }
        .drag-handle:hover span {
          background: rgba(251,114,153,0.4);
        }
        .capsule-segment {
          background: rgba(251,114,153,0.06);
        }
        .capsule-segment:hover {
          background: rgba(251,114,153,0.14);
        }
        .capsule-segment.active {
          background: rgba(251,114,153,0.25);
        }
        .capsule-segment .seg-label {
          color: rgba(251,114,153,0.85);
        }
        .segment-divider {
          background: rgba(251,114,153,0.08);
        }
        .panel {
          background: rgba(30, 20, 25, 0.95);
          border-color: rgba(251,114,153,0.12);
          box-shadow: 0 4px 24px rgba(0, 0, 0, 0.35), 0 1px 4px rgba(0, 0, 0, 0.15);
        }
        .tool-btn {
          background: rgba(251,114,153,0.06);
          color: #e8829e;
        }
        .tool-btn:hover {
          background: rgba(251,114,153,0.12);
        }
        .tool-btn.active {
          background: #fb7299;
          color: #fff;
        }
        .tool-btn.active:hover {
          background: #e5637f;
        }
      }
    `;
  }

  // 缩放补偿相关变量
  let currentZoomLevel = 1;

  // ============ Shadow DOM + 胶囊 UI ============
  let shadowHost = null;
  let shadowRef = null;

  function showCapsule() {
    if (shadowHost) shadowHost.style.display = '';
    if (shadowRef && shadowRef.startZoomCheck) shadowRef.startZoomCheck();
  }

  function hideCapsule() {
    if (shadowHost) shadowHost.style.display = 'none';
    if (shadowRef && shadowRef.stopZoomCheck) shadowRef.stopZoomCheck();
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
    updatePanelState();
    if (shadowRef && shadowRef.closePanel) shadowRef.closePanel();
    if (shadowRef && shadowRef.closeContextMenu) shadowRef.closeContextMenu();
    // 解绑旧 video 的监听器
    if (currentVideoEl && ratechangeHandler) {
      currentVideoEl.removeEventListener('ratechange', ratechangeHandler);
    }
    if (rawVideoEl && ratechangeHandler) {
      rawVideoEl.removeEventListener('ratechange', ratechangeHandler);
    }
    if (rawVideoEl && videoSourceHandler) {
      rawVideoEl.removeEventListener('loadstart', videoSourceHandler);
    }
    currentVideoEl = null;
    ratechangeHandler = null;
    rawVideoEl = null;
    videoSourceHandler = null;
  }

  function updatePanelState() {
    if (shadowRef && shadowRef.updateBtnStates) shadowRef.updateBtnStates();
  }

  /**
   * 绑定/重绑 video 元素的 ratechange 和 loadstart 监听器
   * ratechange: 同步倍速按钮状态
   * loadstart: 检测视频源更换，立即重置所有效果（比 URL 变化更早触发）
   */
  function bindVideoRateChange() {
    const video = document.querySelector('bwp-video, video');
    if (video === currentVideoEl) return;
    // 清理旧监听器
    if (currentVideoEl && ratechangeHandler) {
      currentVideoEl.removeEventListener('ratechange', ratechangeHandler);
    }
    if (rawVideoEl && ratechangeHandler) {
      rawVideoEl.removeEventListener('ratechange', ratechangeHandler);
    }
    if (rawVideoEl && videoSourceHandler) {
      rawVideoEl.removeEventListener('loadstart', videoSourceHandler);
    }
    currentVideoEl = video;
    ratechangeHandler = null;
    rawVideoEl = null;
    videoSourceHandler = null;
    if (!video) return;
    // ratechange 绑到 bwp-video/video（bwp-video 代理了此事件）
    ratechangeHandler = () => updatePanelState();
    video.addEventListener('ratechange', ratechangeHandler);
    // 同时绑到原生 video（B站原生倍速控件可能直接操作原生元素）
    rawVideoEl = document.querySelector('video');
    if (rawVideoEl && rawVideoEl !== video) {
      rawVideoEl.addEventListener('ratechange', ratechangeHandler);
    }
    // loadstart 绑到原生 <video> 元素（bwp-video 不触发媒体加载事件）
    rawVideoEl = document.querySelector('video');
    if (rawVideoEl) {
      videoSourceHandler = () => {
        clearAllEffects();
        bindVideoRateChange();
      };
      rawVideoEl.addEventListener('loadstart', videoSourceHandler);
    }
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

    // ---- 四段胶囊轨道 ----
    const capsuleRail = document.createElement('div');
    capsuleRail.className = 'capsule-rail';

    const segColor = document.createElement('div');
    segColor.className = 'capsule-segment';
    segColor.dataset.segment = 'color';
    segColor.innerHTML = SVG_COLOR + '<span class="seg-label">颜色</span>';

    const segRotate = document.createElement('div');
    segRotate.className = 'capsule-segment';
    segRotate.dataset.segment = 'rotate';
    segRotate.innerHTML = SVG_ROTATE + '<span class="seg-label">旋转</span>';

    const segSpeed = document.createElement('div');
    segSpeed.className = 'capsule-segment';
    segSpeed.dataset.segment = 'speed';
    segSpeed.innerHTML = SVG_SPEED + '<span class="seg-label">变速</span>';

    const segReset = document.createElement('div');
    segReset.className = 'capsule-segment';
    segReset.dataset.segment = 'reset';
    segReset.innerHTML = SVG_RESET + '<span class="seg-label">复位</span>';

    const dragHandle = document.createElement('div');
    dragHandle.className = 'drag-handle';
    dragHandle.innerHTML = '<span></span><span></span><span></span><span></span><span></span><span></span>';
    capsuleRail.appendChild(dragHandle);
    capsuleRail.appendChild(segColor);
    capsuleRail.appendChild(createDivider());
    capsuleRail.appendChild(segRotate);
    capsuleRail.appendChild(createDivider());
    capsuleRail.appendChild(segSpeed);
    capsuleRail.appendChild(createDivider());
    capsuleRail.appendChild(segReset);

    // ---- 颜色面板 ----
    const panelColor = document.createElement('div');
    panelColor.className = 'panel';
    panelColor.style.top = '14px';
    const colorTitle = document.createElement('div');
    colorTitle.className = 'panel-title';
    colorTitle.textContent = '颜色变换';
    panelColor.appendChild(colorTitle);
    const colorGrid = document.createElement('div');
    colorGrid.className = 'btn-grid';
    colorGrid.appendChild(createToolBtn('<svg width="14" height="14" viewBox="0 0 24 24" style="flex-shrink:0"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 3a9 9 0 0 1 0 18V3z" fill="currentColor"/></svg><span>颜色反转</span>', 'invert', () => { toggleInvert(); updateBtnStates(); }));
    CHANNEL_SWAPS.forEach(swap => {
      const svgIcon = `<svg width="14" height="14" viewBox="0 0 24 24" style="flex-shrink:0"><path d="M12 3a9 9 0 0 0 0 18V3z" fill="${swap.colors[0]}"/><path d="M12 3a9 9 0 0 1 0 18V3z" fill="${swap.colors[1]}"/><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.3"/></svg>`;
      colorGrid.appendChild(createToolBtn(svgIcon + '<span>' + swap.label + '</span>', 'channel-' + swap.id, () => { toggleChannelSwap(swap.id); updateBtnStates(); }));
    });
    panelColor.appendChild(colorGrid);

    // ---- 旋转面板 ----
    const panelRotate = document.createElement('div');
    panelRotate.className = 'panel';
    panelRotate.style.top = '75px';
    const rotateTitle = document.createElement('div');
    rotateTitle.className = 'panel-title';
    rotateTitle.textContent = '旋转镜像';
    panelRotate.appendChild(rotateTitle);
    const rotateGrid = document.createElement('div');
    rotateGrid.className = 'btn-grid';
    rotateGrid.appendChild(createToolBtn('<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 4v6h-6"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg><span>旋转</span>', 'rotate', () => { rotateVideo(); updateBtnStates(); }));
    rotateGrid.appendChild(createToolBtn('<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v18"/><path d="M8 7H4l4 5-4 5h4"/><path d="M16 7h4l-4 5 4 5h-4"/></svg><span>镜像</span>', 'mirror', () => { toggleMirror(); updateBtnStates(); }));
    const fitBtn = createToolBtn('<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/><path d="M15 3v18"/></svg><span>适应</span>', 'fit', () => { toggleRotateFitMode(); updateBtnStates(); });
    fitBtn.classList.add('disabled');
    rotateGrid.appendChild(fitBtn);
    panelRotate.appendChild(rotateGrid);

    // ---- 倍速面板 ----
    const panelSpeed = document.createElement('div');
    panelSpeed.className = 'panel';
    panelSpeed.style.top = '136px';
    const speedTitle = document.createElement('div');
    speedTitle.className = 'panel-title';
    speedTitle.textContent = '超级变速';
    panelSpeed.appendChild(speedTitle);
    const speedGrid = document.createElement('div');
    speedGrid.className = 'btn-grid';
    const slowBtn = createToolBtn('<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M9 8v8"/><path d="M15 8v8"/></svg><span>0.25×</span>', 'slow', () => { setSpeed(0.25); updateBtnStates(); });
    slowBtn.style.minWidth = '80px';
    speedGrid.appendChild(slowBtn);
    const fastBtn2 = createToolBtn('<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg><span>3.0×</span>', 'fast', () => { setSpeed(3.0); updateBtnStates(); });
    fastBtn2.style.minWidth = '80px';
    speedGrid.appendChild(fastBtn2);
    panelSpeed.appendChild(speedGrid);

    // ---- 组装 ----
    container.appendChild(capsuleRail);
    container.appendChild(panelColor);
    container.appendChild(panelRotate);
    container.appendChild(panelSpeed);

    // ---- 右键菜单 ----
    const ctxMenu = document.createElement('div');
    ctxMenu.className = 'context-menu';
    const menuSettings = document.createElement('button');
    menuSettings.className = 'context-menu-item';
    menuSettings.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg><span>打开设置</span>';
    menuSettings.addEventListener('click', () => {
      ctxMenu.classList.remove('show');
      const optionsUrl = chrome.runtime.getURL('options/options.html#biliToolCard');
      chrome.runtime.sendMessage({ action: 'openInNewTab', url: optionsUrl, active: true });
    });
    const menuHide = document.createElement('button');
    menuHide.className = 'context-menu-item';
    menuHide.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg><span>暂时隐藏</span>';
    menuHide.addEventListener('click', () => {
      ctxMenu.classList.remove('show');
      clearAllEffects();
      hideCapsule();
    });
    ctxMenu.appendChild(menuSettings);
    ctxMenu.appendChild(menuHide);
    container.appendChild(ctxMenu);

    shadow.appendChild(container);
    document.body.appendChild(host);

    // ---- 展开/收起逻辑 ----
    let currentPanel = null;
    const panels = { color: panelColor, rotate: panelRotate, speed: panelSpeed };
    const segments = { color: segColor, rotate: segRotate, speed: segSpeed };

    function togglePanel(segmentName) {
      if (isDragging) return;
      ctxMenu.classList.remove('show');
      if (currentPanel === segmentName) {
        panels[segmentName].classList.remove('show');
        segments[segmentName].classList.remove('active');
        currentPanel = null;
      } else {
        if (currentPanel) {
          panels[currentPanel].classList.remove('show');
          segments[currentPanel].classList.remove('active');
        }
        panels[segmentName].classList.add('show');
        segments[segmentName].classList.add('active');
        currentPanel = segmentName;
      }
    }

    segColor.addEventListener('click', () => togglePanel('color'));
    segRotate.addEventListener('click', () => togglePanel('rotate'));
    segSpeed.addEventListener('click', () => togglePanel('speed'));
    segReset.addEventListener('click', () => {
      if (isDragging) return;
      clearAllEffects();
      updateBtnStates();
    });

    // 点击外部收起
    document.addEventListener('click', (e) => {
      if (!host.contains(e.target)) {
        if (currentPanel) {
          panels[currentPanel].classList.remove('show');
          segments[currentPanel].classList.remove('active');
          currentPanel = null;
        }
        ctxMenu.classList.remove('show');
      }
    });

    // 右键菜单（拖拽手柄）
    dragHandle.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      // 关闭已打开的面板
      if (currentPanel) {
        panels[currentPanel].classList.remove('show');
        segments[currentPanel].classList.remove('active');
        currentPanel = null;
      }
      ctxMenu.classList.toggle('show');
    });

    // 拖拽（拖整个 rail）
    {
      let startY, dragStartLogicalTop;
      dragHandle.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        startY = e.clientY;
        dragStartLogicalTop = host._logicalTop != null ? host._logicalTop : host.getBoundingClientRect().top * currentZoomLevel;
        isDragging = false;

        const onMove = (e2) => {
          const dy = e2.clientY - startY;
          if (Math.abs(dy) > 3) isDragging = true;
          let newLogicalTop = dragStartLogicalTop + dy * currentZoomLevel;
          const logicalViewH = window.innerHeight * currentZoomLevel;
          newLogicalTop = Math.max(30, Math.min(logicalViewH - 260, newLogicalTop));
          applyLogicalTop(newLogicalTop);
        };

        const onUp = () => {
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
          if (isDragging) {
            const logicalTop = host._logicalTop;
            chrome.storage.sync.set({ biliToolPosition: { top: `${logicalTop}px` } });
            setTimeout(() => { isDragging = false; }, 50);
          }
        };

        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
      });
    }

    // 缩放补偿（参考 related-search.js）

    // 统一的位置 + transform 管理入口
    function applyLogicalTop(logicalTop) {
      host._logicalTop = logicalTop;
      const zoom = currentZoomLevel;
      if (zoom === 1) {
        host.style.setProperty('--echo-top', logicalTop + 'px');
        host.style.transform = 'none';
        host.style.transformOrigin = '';
      } else {
        const scale = 1 / zoom;
        host.style.setProperty('--echo-top', (logicalTop / zoom) + 'px');
        host.style.transform = 'scale(' + scale + ')';
        host.style.transformOrigin = 'left top';
      }
    }

    function checkAndApplyZoom() {
      if (!host) return;
      chrome.runtime.sendMessage({ action: 'getZoom' }, (response) => {
        if (chrome.runtime.lastError) return;
        if (response && response.zoom) {
          const newZoom = response.zoom;
          if (newZoom !== currentZoomLevel) {
            currentZoomLevel = newZoom;
            applyZoomCompensation(newZoom);
          }
        }
      });
    }

    function applyZoomCompensation(zoom) {
      if (!host) return;
      if (host._logicalTop != null) {
        applyLogicalTop(host._logicalTop);
      }
      // 没有保存位置时不做任何事，让 CSS 默认的 top:50% + translateY(-50%) 生效
    }

    // 首次无条件执行补偿
    chrome.runtime.sendMessage({ action: 'getZoom' }, (response) => {
      const zoom = (response && response.zoom) ? response.zoom : 1;
      currentZoomLevel = zoom;
      if (host._logicalTop) {
        applyLogicalTop(host._logicalTop);
      }
      // 没有保存位置时不做任何事，让 CSS 默认的 top:50% + translateY(-50%) 生效
    });
    let localZoomInterval = setInterval(checkAndApplyZoom, 500);

    // 恢复位置
    if (settings.biliToolPosition && settings.biliToolPosition.top) {
      const topStr = settings.biliToolPosition.top;
      if (!topStr.includes('%')) {
        const savedTop = parseInt(topStr);
        if (!isNaN(savedTop)) {
          applyLogicalTop(savedTop);
        }
      }
      // 百分比值（默认 '50%'）不调用 applyLogicalTop，让 CSS 默认的 top:50% + translateY(-50%) 生效
    }

    // 监听倍速变化（绑定到当前 video 元素）
    bindVideoRateChange();

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
          const label = btn.querySelector('span');
          if (label) label.textContent = rotateFillMode ? '填充' : '适应';
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

      // 段 has-effect 状态
      const hasColorEffect = invertActive || activeChannels.size > 0;
      const hasRotateEffect = rotateAngle !== 0 || mirrorActive;
      const v = document.querySelector('bwp-video, video');
      const hasSpeedEffect = v && v.playbackRate !== 1.0;

      segColor.classList.toggle('has-effect', hasColorEffect);
      segRotate.classList.toggle('has-effect', hasRotateEffect);
      segSpeed.classList.toggle('has-effect', !!hasSpeedEffect);
    }

    shadowRef = { updateBtnStates, closePanel: () => {
      if (currentPanel) {
        panels[currentPanel].classList.remove('show');
        segments[currentPanel].classList.remove('active');
        currentPanel = null;
      }
    }, closeContextMenu: () => {
      ctxMenu.classList.remove('show');
    }, startZoomCheck: () => {
      if (!localZoomInterval) {
        localZoomInterval = setInterval(checkAndApplyZoom, 500);
      }
    }, stopZoomCheck: () => {
      if (localZoomInterval) {
        clearInterval(localZoomInterval);
        localZoomInterval = null;
      }
    }};
  }

  function createToolBtn(text, action, onClick) {
    const btn = document.createElement('button');
    btn.className = 'tool-btn';
    btn.dataset.action = action;
    btn.innerHTML = text.includes('<') ? text : '<span>' + text + '</span>';
    btn.addEventListener('click', onClick);
    return btn;
  }

  function createDivider() {
    const div = document.createElement('div');
    div.className = 'segment-divider';
    return div;
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

    // 兆底：监听 title 变化（B站切视频时 title 会变）
    const titleObserver = new MutationObserver(() => {
      if (location.href !== lastUrl) {
        onRouteChange();
      }
    });
    const titleEl = document.querySelector('title');
    if (titleEl) {
      titleObserver.observe(titleEl, { childList: true, characterData: true, subtree: true });
    }

    let routeChangeTimer = null;

    function onRouteChange() {
      if (location.href === lastUrl) return;
      lastUrl = location.href;
      // 取消前一次延迟检测，避免快速导航竞态
      if (routeChangeTimer) clearTimeout(routeChangeTimer);
      // 离开视频页时清除效果
      clearAllEffects();
      // 延迟检测新页面是否有播放器（SPA 动态加载）
      routeChangeTimer = setTimeout(() => {
        routeChangeTimer = null;
        if (isBilibiliVideoPage()) {
          if (!shadowHost) createCapsuleUI();
          else showCapsule();
          bindVideoRateChange();
        } else {
          hideCapsule();
        }
      }, 1500);
    }
  }

  // ============ 初始化 ============
  function init() {
    initRouteListener();
    if (isBilibiliVideoPage()) {
      createCapsuleUI();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
