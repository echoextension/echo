/**
 * ECHO 悬浮搜索框模块
 * 
 * Ctrl+B 呼出搜索框，固定在页面底部中间
 * 输入内容后回车进行 Bing 搜索
 * 支持 Google Trends 热搜榜展示
 */

(async function() {
  'use strict';

  // 搜索框只应运行在顶层页面；在 iframe 中运行会导致快捷键、焦点和路由监听重复绑定。
  if (window !== window.top) {
    return;
  }

  // 固定定位常量（以 100% 缩放时的 CSS 像素计）
  // 注意：当开启“反向缩放补偿”(即不跟随页面缩放)时，需要同时对 bottom 偏移做反向补偿，
  // 否则 bottom: 32px 会在页面放大时变成更大的物理像素距离，导致视觉位置上移。
  const BOTTOM_OFFSET_PX = 32;

  // 默认设置
  const DEFAULT_SETTINGS = {
    floatingSearchBox: true,        // 主开关，默认开启
    floatingSearchBoxAlwaysShow: false,  // 子选项：默认常驻显示，默认关闭
    floatingSearchBoxTrending: false,    // 子选项：显示热搜榜，默认关闭
    floatingSearchBoxFollowZoom: false   // 子选项：跟随页面缩放，默认关闭（即默认反向补偿）
  };

  // 加载设置
  let settings = await chrome.storage.sync.get(DEFAULT_SETTINGS);

  // 检测是否是扩展自有页面（NTP、Options、FRE 等）
  const isExtensionPage = window.location.protocol === 'chrome-extension:';

  // 如果功能未启用，直接返回
  if (!settings.floatingSearchBox) {
    return;
  }

  // 在 bing.com 域名下不显示（已经在 Bing，无需再用搜索框）
  // 扩展页面跳过此检查（hostname 为扩展 ID，不是 bing.com）
  if (!isExtensionPage && window.location.hostname.includes('bing.com')) {
    return;
  }

  if (isExtensionPage) {
  }

  // 监听设置变化
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'sync') {
      if (changes.floatingSearchBox) {
        settings.floatingSearchBox = changes.floatingSearchBox.newValue;
      }
      if (changes.floatingSearchBoxAlwaysShow) {
        settings.floatingSearchBoxAlwaysShow = changes.floatingSearchBoxAlwaysShow.newValue;
      }
      if (changes.floatingSearchBoxTrending) {
        settings.floatingSearchBoxTrending = changes.floatingSearchBoxTrending.newValue;
        // 动态更新热搜榜显示状态
        updateTrendingVisibility();
      }
      if (changes.floatingSearchBoxFollowZoom) {
        settings.floatingSearchBoxFollowZoom = changes.floatingSearchBoxFollowZoom.newValue;
        // 动态更新缩放补偿状态
        if (settings.floatingSearchBoxFollowZoom) {
          // 关闭补偿，重置为原始大小
          if (zoomCheckInterval) {
            clearInterval(zoomCheckInterval);
            zoomCheckInterval = null;
          }
          applyZoomCompensation(1);
        } else {
          // 开启补偿
          initZoomCompensation();
        }
      }
    }
  });

  // ============================================
  // 样式定义
  // ============================================

  const getStyles = () => `
    body {
      color-scheme: light dark;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif !important;
    }

    /* 主容器：包含工具按钮和搜索框 */
    .search-wrapper {
      display: none;
      flex-direction: column;
      align-items: center;
      gap: 0;
      animation: slideUp 0.2s ease-out;
    }

    .search-wrapper.show {
      display: flex;
    }

    /* 搜索行：包含搜索框和热搜推荐 */
    .search-row {
      display: flex;
      align-items: center;
      gap: 0;
    }

    .search-container {
      display: flex;
      background: #ffffff;
      border-radius: 24px;
      border: none;
      padding: 8px 16px;
      align-items: center;
      gap: 12px;
      min-width: 480px;
      max-width: 640px;
      position: relative;
      box-shadow: 0 12px 64px rgba(0, 0, 0, 0.3), 0 4px 16px rgba(0, 0, 0, 0.25);
    }

    /* 彩虹边框 - 使用 border-image 方式 */
    .search-container::before {
      content: '';
      position: absolute;
      inset: 0;
      border-radius: 24px;
      padding: 2px; /* 边框宽度 */
      background: conic-gradient(
        from var(--spectrum-angle, 0deg),
        #f472b6, #c084fc, #818cf8, #38bdf8, #34d399, #fbbf24, #f472b6
      );
      -webkit-mask: 
        linear-gradient(#fff 0 0) content-box, 
        linear-gradient(#fff 0 0);
      -webkit-mask-composite: xor;
      mask-composite: exclude;
      pointer-events: none;
      animation: spectrumRotateAngle 4s linear infinite;
    }

    /* 外发光效果 - 微妙的光晕 */
    .search-glow {
      position: absolute;
      inset: -1px;
      border-radius: 27px;
      padding: 3px;
      background: conic-gradient(
        from var(--spectrum-angle, 0deg),
        rgba(244, 114, 182, 0.4),
        rgba(192, 132, 252, 0.4),
        rgba(129, 140, 248, 0.4),
        rgba(56, 189, 248, 0.4),
        rgba(52, 211, 153, 0.4),
        rgba(251, 191, 36, 0.4),
        rgba(244, 114, 182, 0.4)
      );
      -webkit-mask: 
        linear-gradient(#fff 0 0) content-box, 
        linear-gradient(#fff 0 0);
      -webkit-mask-composite: xor;
      mask-composite: exclude;
      filter: blur(6px);
      opacity: 0.8;
      z-index: -1;
      pointer-events: none;
      animation: spectrumRotateAngle 4s linear infinite;
    }

    @keyframes spectrumRotateAngle {
      /* 由 JS 控制 --spectrum-angle 变量 */
    }

    @keyframes slideUp {
      from {
        opacity: 0;
        transform: translateY(20px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }

    .search-icon {
      width: 20px;
      height: 20px;
      color: #0078d4;
      flex-shrink: 0;
      position: relative;
      z-index: 1;
    }

    .search-input {
      flex: 1;
      border: none;
      outline: none;
      font-size: 16px;
      padding: 8px 0;
      background: transparent;
      color: #333;
      min-width: 0;
      position: relative;
      z-index: 1;
    }

    .search-input::placeholder {
      color: #999;
    }

    .search-hint {
      font-size: 12px;
      color: #999;
      white-space: nowrap;
      flex-shrink: 0;
      position: relative;
      z-index: 1;
    }

    .search-hint kbd {
      background: #f0f0f0;
      border: 1px solid #ddd;
      border-radius: 4px;
      padding: 2px 6px;
      font-family: inherit;
      font-size: 11px;
    }

    .close-btn {
      position: relative;
      z-index: 1;
      width: 24px;
      height: 24px;
      border: none;
      background: transparent;
      cursor: pointer;
      color: #999;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 50%;
      flex-shrink: 0;
      transition: background 0.15s, color 0.15s;
    }

    .close-btn:hover {
      background: #f0f0f0;
      color: #666;
    }

    /* B站视频工具条（搜索框上方） */
    .invert-toolbar {
      display: none;
      align-items: center;
      gap: 8px;
      margin-bottom: 16px;
    }

    .invert-toolbar.show {
      display: flex;
    }

    /* 胶囊按钮组（标签胶囊 + 功能胶囊共用） */
    .toolbar-capsule {
      display: flex;
      align-items: center;
      background: rgba(255, 255, 255, 0.88);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      border-radius: 14px;
      border: 0.5px solid rgba(0, 0, 0, 0.1);
      box-shadow: 0 2px 12px rgba(0, 0, 0, 0.15);
      overflow: hidden;
      height: 28px;
    }

    .toolbar-capsule.capsule-overflow {
      overflow: visible;
    }

    /* 标签胶囊内的文字 */
    .toolbar-capsule .capsule-label {
      display: flex;
      align-items: center;
      gap: 5px;
      padding: 0 6px 0 12px;
      font-size: 11px;
      color: #00AEEC;
      font-weight: 500;
      white-space: nowrap;
      user-select: none;
    }

    .toolbar-capsule .capsule-label svg {
      flex-shrink: 0;
    }

    /* ⓘ 帮助按钮 */
    .invert-help-btn {
      width: 16px;
      height: 16px;
      border: none;
      background: transparent;
      cursor: pointer;
      color: #00AEEC;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      transition: color 0.15s, opacity 0.15s;
      position: relative;
      padding: 0;
      margin-right: 10px;
      opacity: 0.6;
    }

    .invert-help-btn:hover {
      opacity: 1;
    }

    .invert-help-tooltip {
      display: none;
      position: absolute;
      bottom: calc(100% + 8px);
      left: -10px;
      width: 280px;
      background: rgba(255, 255, 255, 0.95);
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      border-radius: 12px;
      padding: 14px 16px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.18);
      font-size: 12px;
      font-style: normal;
      font-weight: 400;
      line-height: 1.6;
      color: #444;
      text-align: left;
      z-index: 10;
    }

    .invert-help-btn:hover .invert-help-tooltip {
      display: block;
    }

    .invert-help-tooltip strong {
      display: block;
      font-size: 13px;
      color: #222;
      margin-bottom: 6px;
    }

    .invert-help-tooltip p {
      margin: 0 0 8px 0;
      color: #666;
    }

    .invert-help-tooltip ul {
      margin: 0;
      padding-left: 16px;
    }

    .invert-help-tooltip li {
      margin-bottom: 2px;
    }

    .invert-help-tooltip li b {
      color: #333;
    }

    /* 胶囊内功能按钮 */
    .toolbar-capsule .capsule-btn {
      height: 28px;
      border: none;
      background: transparent;
      cursor: pointer;
      color: #444;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 4px;
      padding: 0 10px;
      font-size: 12px;
      font-family: inherit;
      white-space: nowrap;
      transition: background 0.15s, color 0.15s;
      position: relative;
    }

    .toolbar-capsule .capsule-btn:first-child {
      padding-left: 12px;
    }

    .toolbar-capsule .capsule-btn:last-child {
      padding-right: 12px;
    }

    .toolbar-capsule .capsule-btn:hover {
      background: rgba(0, 0, 0, 0.06);
      color: #222;
    }

    .toolbar-capsule .capsule-btn.active {
      color: #fff;
      background: #0078d4;
    }

    .toolbar-capsule .capsule-btn.active:hover {
      background: #106ebe;
    }

    .toolbar-capsule .capsule-btn.disabled {
      opacity: 0.4;
      cursor: default;
      pointer-events: none;
    }

    .toolbar-capsule .capsule-sep {
      width: 1px;
      height: 14px;
      background: rgba(0, 0, 0, 0.1);
      flex-shrink: 0;
    }

    /* ============================================
     * 热搜推荐 - 右侧延伸面板样式
     * ============================================ */

    .trending-panel {
      display: none;
      align-items: center;
      height: 44px;
      margin-left: -14px;
      padding: 0 20px 0 28px;
      background: rgba(255, 255, 255, 0.85);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      border-radius: 0 22px 22px 0;
      box-shadow: 4px 4px 24px rgba(0, 0, 0, 0.3);
      position: relative;
      z-index: 1;
      overflow: visible;
    }

    /* 悬浮提示小箭头：容器上方 ▲ 和下方 ▼ */
    .trending-panel::before,
    .trending-panel::after {
      content: '';
      position: absolute;
      left: 50%;
      transform: translateX(-50%);
      width: 0;
      height: 0;
      opacity: 0;
      transition: opacity 0.2s ease;
      pointer-events: none;
      z-index: 100;
    }
    .trending-panel::before {
      bottom: calc(100% + 4px);
      border-left: 4px solid transparent;
      border-right: 4px solid transparent;
      border-bottom: 4px solid rgba(255, 255, 255, 1);
    }
    .trending-panel::after {
      top: calc(100% + 4px);
      border-left: 4px solid transparent;
      border-right: 4px solid transparent;
      border-top: 4px solid rgba(255, 255, 255, 1);
    }
    .trending-panel.hint-arrows::before,
    .trending-panel.hint-arrows::after {
      opacity: 1;
    }

    .search-container {
      z-index: 2;
    }

    .trending-panel.show {
      display: flex;
    }

    .trending-label {
      font-size: 12px;
      color: #888;
      white-space: nowrap;
      margin-right: 10px;
      font-weight: 500;
      line-height: 44px;
    }

    .trending-label-icon {
      margin-right: 4px;
    }

    /* 热词滚动容器 */
    .trending-scroll-wrapper {
      position: relative;
      width: 260px;
      height: 18px;
      overflow: hidden;
      flex-shrink: 0;
      cursor: pointer;
      top: -1px;
    }

    .trending-scroll-track {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
    }

    .trending-word {
      display: flex;
      align-items: center;
      box-sizing: border-box;
      height: 18px;
      font-size: 14px;
      color: #000 !important;
      cursor: pointer !important;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      text-decoration: none !important;
      pointer-events: auto !important;
      padding: 0 4px;
    }

    .trending-word:hover,
    .trending-word.hovered {
      color: #1E5CA5 !important;
      cursor: pointer !important;
    }

    /* 相邻行：始终隐藏（仅用于数据预渲染） */
    .trending-word.adjacent {
      visibility: hidden;
    }

    /* 深色模式支持 */
    @media (prefers-color-scheme: dark) {
      .search-container {
        background: #1e1e1e;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5), 0 2px 8px rgba(0, 0, 0, 0.3);
      }

      .search-input {
        color: #e0e0e0;
      }

      .search-input::placeholder {
        color: #888;
      }

      .search-hint {
        color: #888;
      }

      .search-hint kbd {
        background: #404040;
        border-color: #555;
        color: #ccc;
      }

      .close-btn:hover {
        background: #404040;
        color: #ccc;
      }

      .toolbar-capsule {
        background: rgba(40, 40, 40, 0.88);
        border-color: rgba(255, 255, 255, 0.1);
        box-shadow: 0 2px 12px rgba(0, 0, 0, 0.35);
      }

      .toolbar-capsule .capsule-label {
        color: #5bcefa;
      }

      .invert-help-btn {
        color: #5bcefa;
      }

      .invert-help-btn:hover {
        opacity: 1;
      }

      .invert-help-tooltip {
        background: rgba(30, 30, 30, 0.95);
        color: #ccc;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
      }

      .invert-help-tooltip strong {
        color: #eee;
      }

      .invert-help-tooltip p {
        color: #aaa;
      }

      .invert-help-tooltip li b {
        color: #ddd;
      }

      .toolbar-capsule .capsule-btn {
        color: #ccc;
      }

      .toolbar-capsule .capsule-btn:hover {
        background: rgba(255, 255, 255, 0.08);
        color: #fff;
      }

      .toolbar-capsule .capsule-btn.active {
        color: #fff;
        background: #3b82f6;
      }

      .toolbar-capsule .capsule-btn.active:hover {
        background: #2563eb;
      }

      .toolbar-capsule .capsule-sep {
        background: rgba(255, 255, 255, 0.1);
      }

      /* 深色模式：热搜推荐面板 */
      .trending-panel {
        background: rgba(40, 40, 40, 0.8);
        box-shadow: 4px 4px 24px rgba(0, 0, 0, 0.3);
      }

      .trending-label {
        color: #888;
      }

      .trending-word {
        color: #e0e0e0 !important;
      }

      /* 深色模式：hover 状态使用亮蓝色 */
      .trending-word:hover,
      .trending-word.hovered {
        color: #60a5fa !important;
      }

      /* 深色模式：箭头提示颜色跟随容器 */
      .trending-panel::before {
        border-bottom-color: rgba(40, 40, 40, 1);
      }
      .trending-panel::after {
        border-top-color: rgba(40, 40, 40, 1);
      }
    }
  `;

  // ============================================
  // 创建搜索框 DOM
  // ============================================

  let host = null;
  let shadowRoot = null;
  let searchWrapper = null;
  let searchContainer = null;
  let searchInput = null;
  let trendingPanel = null;
  let invertToolbar = null;
  let trendingData = null;
  let trendingScrollInterval = null;
  let currentTrendingIndex = 0;
  let lastFetchTime = 0;
  const CACHE_DURATION = 10 * 60 * 1000; // 缓存 10 分钟

  // B站视频颜色反转状态
  let invertActive = false;              // 主反转开关
  let activeChannels = new Set();        // 激活的通道交换 id 集合
  let invertStyleElement = null;
  let invertSvgElement = null;
  let invertIndicator = null;

  // 视频旋转状态
  let rotateAngle = 0;                  // 0, 90, 180, 270
  let rotateFillMode = false;           // false=适应(保留黑边), true=填充(裁切)
  let mirrorActive = false;             // 水平镜像
  let rotateStyleElement = null;

  function getSearchWrapperVisible() {
    return !!(searchWrapper && searchWrapper.classList.contains('show'));
  }

  function describeNode(node) {
    if (!node) return 'null';
    if (node === window) return 'window';
    if (node === document) return 'document';
    if (node === document.body) return 'body';
    if (node === document.documentElement) return 'html';
    if (node.nodeType !== Node.ELEMENT_NODE) return String(node.nodeName || node);

    const element = node;
    const tag = element.tagName?.toLowerCase?.() || 'unknown';
    const id = element.id ? `#${element.id}` : '';
    const className = typeof element.className === 'string'
      ? element.className.trim().split(/\s+/).filter(Boolean).slice(0, 3).join('.')
      : '';
    const classes = className ? `.${className}` : '';
    const role = element.getAttribute?.('role');
    const name = element.getAttribute?.('name');
    const type = element.getAttribute?.('type');
    const href = element.getAttribute?.('href');
    let text = '';
    if (typeof element.textContent === 'string') {
      text = element.textContent.trim().replace(/\s+/g, ' ').slice(0, 30);
    }

    const attrs = [role ? `role=${role}` : '', name ? `name=${name}` : '', type ? `type=${type}` : '', href ? `href=${href.slice(0, 60)}` : '', text ? `text=${text}` : '']
      .filter(Boolean)
      .join(' ');

    return `${tag}${id}${classes}${attrs ? ` [${attrs}]` : ''}`;
  }

  function getUrlVideoId(urlString = location.href) {
    try {
      const url = new URL(urlString, location.href);
      const match = url.pathname.match(/\/video\/([^\/]+)/);
      return match ? match[1] : null;
    } catch {
      return null;
    }
  }

  // 通道交换 SVG 滤镜定义
  // 通道交换定义：循环排列 R→G→B→R
  // rows 表示交换哪两行（0=R, 1=G, 2=B）
  const CHANNEL_SWAPS = [
    { id: 1, label: '红\u2194绿', title: '红\u2194绿 通道交换', rows: [0, 1] },
    { id: 2, label: '绿\u2194蓝', title: '绿\u2194蓝 通道交换', rows: [1, 2] },
    { id: 3, label: '蓝\u2194红', title: '蓝\u2194红 通道交换', rows: [2, 0] },
  ];

    const FRAME_PAD = 40; // 预留阴影空间

  function createSearchBox() {
    if (host) return;

    // 创建 iframe 宿主以实现沙盒隔离并解决 SPA 路由冲突
    host = document.createElement('iframe');
    host.id = 'echo-search-box-host';
    host.src = 'about:blank';
    host.setAttribute('frameborder', '0');
    host.setAttribute('scrolling', 'no');
    host.setAttribute('tabindex', '-1'); 
    host.title = 'ECHO Search Box';

    // 默认 bottom（100% 缩放时）
    host.style.setProperty('--echo-bottom', `${BOTTOM_OFFSET_PX}px`);

    // iframe 的样式配置
    host.style.cssText = `
      all: initial;
      position: fixed !important;
      bottom: var(--echo-bottom, ${BOTTOM_OFFSET_PX}px) !important;
      left: 50% !important;
      z-index: 2147483647 !important;
      border: none !important;
      background: transparent !important;
      transform: translateX(-50%);
      transform-origin: center bottom;
      margin-bottom: -${FRAME_PAD}px !important; /* 抵消内部 padding 的视觉偏移 */
      width: 0px;
      height: 0px;
      color-scheme: light dark;
      /* iframe 本身允许响应鼠标事件，我们通过控制其精确包裹内容来避免遮挡底层页面 */
    `;

    // 必须先行挂载，才能访问 contentDocument
    document.body.appendChild(host);

    const iframeDoc = host.contentDocument;

    // 保证 html 父级能充满整个扩高后的 iframe，并将内容推到底部
    iframeDoc.documentElement.style.cssText = `
      height: 100%;
      margin: 0;
    `;
    
    // 初始化 iframe 内部的 body 作为新的 "shadowRoot"
    iframeDoc.body.style.cssText = `
      margin: 0;
      padding: ${FRAME_PAD}px;
      display: flex;
      justify-content: center;
      align-items: flex-end; /* 配合 100% 高度将内容紧贴框体底部 */
      background: transparent;
      overflow: hidden;
      outline: none;
      height: 100%;
      box-sizing: border-box;
    `;

    // 同步宿主的属性，以便后续代码直接使用 shadowRoot
    shadowRoot = iframeDoc.body;
    
    // 绑定 iframe 内的键盘事件（因为焦点在 iframe 内，主文档的 keydown 不会触发）
    iframeDoc.addEventListener('keydown', handleGlobalKeydown, true);

    // 添加样式
    const style = iframeDoc.createElement('style');
    // :host 替换为 body
    style.textContent = getStyles().replace(/:host\b/g, 'body');
    shadowRoot.appendChild(style);

    // 创建外层包装器
    searchWrapper = iframeDoc.createElement('div');
    searchWrapper.className = 'search-wrapper';

    // 创建搜索行包装器（搜索框 + 热搜面板）
    const searchRow = iframeDoc.createElement('div');
    searchRow.className = 'search-row';

    // 创建搜索容器
    searchContainer = iframeDoc.createElement('div');
    searchContainer.className = 'search-container';
    
    // 根据模式显示不同的提示文字
    const hintText = settings.floatingSearchBoxAlwaysShow 
      ? '<kbd>Enter</kbd> 搜索 · <kbd>Ctrl+B</kbd> 开关'
      : '<kbd>Enter</kbd> 搜索 · <kbd>Ctrl+B</kbd> 关闭';
    
    searchContainer.innerHTML = `
      <div class="search-glow"></div>
      <svg class="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="11" cy="11" r="8"/>
        <path d="M21 21l-4.35-4.35"/>
      </svg>
      <input type="text" class="search-input" placeholder="搜索 Bing...">
      <span class="search-hint">${hintText}</span>
      <button class="close-btn" title="关闭">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M18 6L6 18M6 6l12 12"/>
        </svg>
      </button>
    `;
    searchRow.appendChild(searchContainer);

    // 获取输入框引用
    searchInput = searchContainer.querySelector('.search-input');

    // 创建B站视频工具条（搜索框上方，B站视频页专用）
    invertToolbar = document.createElement('div');
    invertToolbar.className = 'invert-toolbar';

    // ---- 标签胶囊：📺 B站助手 ⓘ ----
    const labelCapsule = document.createElement('div');
    labelCapsule.className = 'toolbar-capsule capsule-overflow';

    const labelSpan = document.createElement('span');
    labelSpan.className = 'capsule-label';
    labelSpan.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <rect x="2" y="5" width="20" height="14" rx="3"/>
        <path d="M8 2L10 5"/>
        <path d="M16 2L14 5"/>
      </svg>
      <span>B站助手</span>
    `;
    labelCapsule.appendChild(labelSpan);

    const helpBtn = document.createElement('button');
    helpBtn.className = 'invert-help-btn';
    helpBtn.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="11" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="7" r="1.5"/><rect x="10.5" y="10.5" width="3" height="8" rx="1"/></svg>
      <div class="invert-help-tooltip">
        <strong>Bilibili 视频优化工具</strong>
        <p>部分视频经过颜色处理（如反色、通道交换）以通过审核，使用这些按钮还原画面色彩，或者旋转及镜像获得更好的观看体验。</p>
        <ul>
          <li><b>颜色反转</b>：还原全通道反色处理</li>
          <li><b>红\u2194绿 / 绿\u2194蓝 / 蓝\u2194红</b>：还原对应通道交换</li>
          <li><b>旋转</b>：顺时针旋转视频，每次 90\u00b0</li>
          <li><b>镜像</b>：水平翻转视频</li>
          <li><b>适应/填充</b>：旋转 90\u00b0/270\u00b0 时的显示模式，适应保留黑边，填充裁切填满</li>
        </ul>
        <p>各按钮可自由组合使用，关闭搜索框不影响状态。</p>
      </div>
    `;
    labelCapsule.appendChild(helpBtn);
    invertToolbar.appendChild(labelCapsule);

    // ---- 颜色胶囊：颜色反转 | 红↔绿 | 绿↔蓝 | 蓝↔红 ----
    const colorCapsule = document.createElement('div');
    colorCapsule.className = 'toolbar-capsule';

    const mainBtn = document.createElement('button');
    mainBtn.className = 'capsule-btn';
    mainBtn.title = '全通道反转';
    mainBtn.dataset.action = 'invert';
    mainBtn.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" style="flex-shrink:0">
        <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/>
        <path d="M12 3a9 9 0 0 1 0 18V3z" fill="currentColor"/>
      </svg>
      <span>颜色反转</span>
    `;
    colorCapsule.appendChild(mainBtn);

    CHANNEL_SWAPS.forEach(swap => {
      const sep = document.createElement('div');
      sep.className = 'capsule-sep';
      colorCapsule.appendChild(sep);

      const btn = document.createElement('button');
      btn.className = 'capsule-btn';
      btn.title = swap.title;
      btn.dataset.action = 'channel';
      btn.dataset.channelId = swap.id;
      btn.textContent = swap.label;
      colorCapsule.appendChild(btn);
    });
    invertToolbar.appendChild(colorCapsule);

    // ---- 变换胶囊：旋转 | 镜像 | 适应 ----
    const transformCapsule = document.createElement('div');
    transformCapsule.className = 'toolbar-capsule';

    const rotateCW = document.createElement('button');
    rotateCW.className = 'capsule-btn';
    rotateCW.title = '顺时针旋转 90°';
    rotateCW.dataset.action = 'rotate';
    rotateCW.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 4v6h-6"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
      <span>旋转</span>
    `;
    transformCapsule.appendChild(rotateCW);

    const sepMirror = document.createElement('div');
    sepMirror.className = 'capsule-sep';
    transformCapsule.appendChild(sepMirror);

    const mirrorBtn = document.createElement('button');
    mirrorBtn.className = 'capsule-btn';
    mirrorBtn.title = '水平镜像';
    mirrorBtn.dataset.action = 'mirror';
    mirrorBtn.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v18"/><path d="M8 7H4l4 5-4 5h4"/><path d="M16 7h4l-4 5 4 5h-4"/></svg>
      <span>镜像</span>
    `;
    transformCapsule.appendChild(mirrorBtn);

    const sepFit = document.createElement('div');
    sepFit.className = 'capsule-sep';
    transformCapsule.appendChild(sepFit);

    const fitBtn = document.createElement('button');
    fitBtn.className = 'capsule-btn disabled';
    fitBtn.title = '旋转 90\u00b0/270\u00b0 时可切换适应/填充';
    fitBtn.dataset.action = 'rotate-fit';
    fitBtn.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/><path d="M15 3v18"/></svg>
      <span>适应</span>
    `;
    transformCapsule.appendChild(fitBtn);
    invertToolbar.appendChild(transformCapsule);

    // 插入到 searchRow 前面（搜索框上方）
    searchWrapper.appendChild(invertToolbar);

    // 创建热搜推荐面板（搜索框右侧延伸）
    trendingPanel = document.createElement('div');
    trendingPanel.className = 'trending-panel';
    trendingPanel.innerHTML = `
      <span class="trending-label"><span class="trending-label-icon">🔥</span>热搜</span>
      <div class="trending-scroll-wrapper">
        <div class="trending-scroll-track">
          <!-- 热词会动态填充 -->
        </div>
      </div>
    `;
    searchRow.appendChild(trendingPanel);

    searchWrapper.appendChild(searchRow);
            shadowRoot.appendChild(searchWrapper);

    let isHelpTooltipHovered = false;

    // 根据内容实时计算并设置 iframe 外壳的安全尺寸
    const updateIframeSize = () => {
      if (!host || !searchWrapper) return;
      const rect = searchWrapper.getBoundingClientRect();
      let w = rect.width + FRAME_PAD * 2;
      let h = rect.height + FRAME_PAD * 2;

      // 如果帮助面板悬浮，为其追加高度。
      // 因为 iframe 内部实现了 100% 高度 + flex-end 底端对齐，
      // 增加 iframe 外层高度只会往上方拉伸屏幕空间以容纳绝对定位的内容，
      // 里面的搜索框 UI 将因为底端对齐而保持视觉位置纹丝不动！
      if (isHelpTooltipHovered) {
        h += 240;
      }

      host.style.width = Math.ceil(w) + 'px';
      host.style.height = Math.ceil(h) + 'px';
    };

    const ro = new ResizeObserver(() => updateIframeSize());
    ro.observe(searchWrapper);

    // 基于鼠标事件更新悬浮状态，重新计算 iframe 尺寸
    searchWrapper.addEventListener('mouseover', (e) => {
      if (e.target.closest('.invert-help-btn')) {
        if (!isHelpTooltipHovered) {
          isHelpTooltipHovered = true;
          updateIframeSize();
        }
      }
    });

    searchWrapper.addEventListener('mouseout', (e) => {
      const related = e.relatedTarget;
      // 鼠标必须移动到 help-btn 以及其内部 tooltip 层之外才算离开
      if (!related || !related.closest('.invert-help-btn')) {
        if (isHelpTooltipHovered) {
          isHelpTooltipHovered = false;
          updateIframeSize();
        }
      }
    });

    // 绑定事件
    bindEvents();

    // 启动光谱旋转动画
    startSpectrumAnimation();

    // 初始化缩放补偿（如果需要）
    initZoomCompensation();
  }

  // ============================================
  // 缩放补偿逻辑
  // ============================================
  
  let currentZoom = 1;
  let zoomCheckInterval = null;

  /**
   * 立即刷新一次当前缩放并应用补偿。
   * 目的：解决“首次 Ctrl+B 呼出时（页面已缩放）光环动画未按反向补偿缩放”的竞态。
   */
  async function refreshZoomOnce() {
    // 跟随页面缩放时不需要补偿
    if (settings.floatingSearchBoxFollowZoom) return;

    try {
      const response = await chrome.runtime.sendMessage({ action: 'getZoom' });
      if (response && typeof response.zoom === 'number') {
        currentZoom = response.zoom;
        applyZoomCompensation(currentZoom);
      }
    } catch (e) {
      // 忽略错误（可能是扩展页面/初始化时机问题）
    }
  }
  
  /**
   * 初始化缩放补偿
   * 如果 floatingSearchBoxFollowZoom 为 false（默认），则启用反向缩放补偿
   */
  function initZoomCompensation() {
    // 如果跟随页面缩放，不需要补偿
    if (settings.floatingSearchBoxFollowZoom) {
      return;
    }
    
    // 获取当前缩放并应用补偿
    checkAndApplyZoom();
    
    // 定期检查缩放变化（每 500ms）
    zoomCheckInterval = setInterval(checkAndApplyZoom, 500);
  }
  
  /**
   * 检查并应用缩放补偿
   */
  async function checkAndApplyZoom() {
    // 如果设置改为跟随缩放，停止补偿
    if (settings.floatingSearchBoxFollowZoom) {
      if (zoomCheckInterval) {
        clearInterval(zoomCheckInterval);
        zoomCheckInterval = null;
      }
      // 重置缩放
      applyZoomCompensation(1);
      return;
    }
    
    try {
      const response = await chrome.runtime.sendMessage({ action: 'getZoom' });
      if (response && response.zoom && Math.abs(response.zoom - currentZoom) > 0.001) {
        currentZoom = response.zoom;
        applyZoomCompensation(currentZoom);
      }
    } catch (e) {
      // 忽略错误（可能是扩展页面）
    }
  }
  
  /**
   * 应用缩放补偿
   * @param {number} zoomLevel - 当前页面缩放级别
   */
  function applyZoomCompensation(zoomLevel) {
    if (!host) return;
    
    // 计算反向缩放比例
    const inverseScale = 1 / zoomLevel;

    // 位置补偿：确保“物理像素”意义上的 bottom 距离恒定
    // 物理像素距离 ≈ bottom(CSS px) * zoomLevel
    // 期望恒定为 BOTTOM_OFFSET_PX，因此 bottom(CSS px) = BOTTOM_OFFSET_PX / zoomLevel
    if (settings.floatingSearchBoxFollowZoom || zoomLevel === 1) {
      host.style.setProperty('--echo-bottom', `${BOTTOM_OFFSET_PX}px`);
    } else {
      host.style.setProperty('--echo-bottom', `${BOTTOM_OFFSET_PX * inverseScale}px`);
    }
    
    // 应用到 host 元素
    // translateX(-50%) 用于居中，scale 用于缩放补偿
    // 使用 transform-origin: center bottom 保持底部中心定位
    if (settings.floatingSearchBoxFollowZoom || zoomLevel === 1) {
      // 跟随页面缩放或缩放为100%时，只保留居中
      host.style.transform = 'translateX(-50%)';
    } else {
      // 应用反向缩放补偿
      host.style.transform = `translateX(-50%) scale(${inverseScale})`;
    }
    host.style.transformOrigin = 'center bottom';
  }

  // 光谱旋转动画（使用 JS 实现最佳兼容性）
  let spectrumAnimationId = null;
  function startSpectrumAnimation() {
    let angle = 0;
    const animate = () => {
      angle = (angle + 3) % 360;
      if (searchContainer) {
        searchContainer.style.setProperty('--spectrum-angle', angle + 'deg');
        // 同步更新 glow 元素
        const glow = searchContainer.querySelector('.search-glow');
        if (glow) {
          glow.style.setProperty('--spectrum-angle', angle + 'deg');
        }
      }
      spectrumAnimationId = requestAnimationFrame(animate);
    };
    animate();
  }

  // ============================================
  // 热搜推荐功能
  // ============================================

  /**
   * 更新热搜面板显示状态
   */
  function updateTrendingVisibility() {
    if (!trendingPanel) return;
    
    if (settings.floatingSearchBoxTrending && searchWrapper?.classList.contains('show')) {
      trendingPanel.classList.add('show');
      // 如果没有数据或缓存过期，获取数据
      if (!trendingData || Date.now() - lastFetchTime > CACHE_DURATION) {
        fetchTrendingData();
      } else {
        // 有缓存数据，直接启动滚动
        startTrendingScroll();
      }
    } else {
      trendingPanel.classList.remove('show');
      stopTrendingScroll();
    }
  }

  /**
   * 获取热搜数据 - 使用头条官方API
   */
  async function fetchTrendingData(forceRefresh = false) {
    if (!trendingPanel) return;

    // 检查缓存
    if (!forceRefresh && trendingData && Date.now() - lastFetchTime < CACHE_DURATION) {
      startTrendingScroll();
      return;
    }

    // 从头条获取热搜
    const trends = await fetchToutiaoTrends();
    
    if (trends && trends.length > 0) {
      trendingData = trends;
      lastFetchTime = Date.now();
    } else {
      console.warn('[ECHO] 热搜获取失败，使用兜底数据');
      trendingData = [{ title: '热搜加载失败，请稍后重试' }];
      lastFetchTime = Date.now();
    }
    
    startTrendingScroll();
  }

  /**
   * 从头条官方API获取热搜
   */
  async function fetchToutiaoTrends() {
    const api = 'https://www.toutiao.com/hot-event/hot-board/?origin=toutiao_pc';
    
    try {
      const result = await chrome.runtime.sendMessage({
        action: 'proxyFetch',
        url: api,
        options: {
          method: 'GET',
          headers: { 
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          }
        }
      });
      
      if (!result || !result.success) {
        console.warn('[ECHO] 头条API请求失败:', result?.error);
        return null;
      }
      
      const data = result.data;
      
      // 头条返回格式: { data: [{ Title, HotValue, ClusterIdStr }, ...] }
      if (data && Array.isArray(data.data) && data.data.length > 0) {
        return data.data.slice(0, 20).map(item => ({
          title: item.Title || ''
        })).filter(item => item.title);
      }
      
      return null;
    } catch (error) {
      console.error('[ECHO] fetchToutiaoTrends 异常:', error);
      return null;
    }
  }

  /**
   * 获取循环索引（真正的无缝环形）
   */
  function getLoopIndex(index, length) {
    return ((index % length) + length) % length;
  }

  // 每行高度常量
  const ITEM_HEIGHT = 18;

  /**
   * 渲染当前可见的热词
   * 只渲染3条：-1, 0, +1
   */
  function renderVisibleWords() {
    if (!trendingPanel || !trendingData || trendingData.length === 0) return;
    
    const scrollTrack = trendingPanel.querySelector('.trending-scroll-track');
    if (!scrollTrack) return;
    
    const len = trendingData.length;
    
    // 只渲染3条：-1, 0, +1
    const items = [];
    for (let i = -1; i <= 1; i++) {
      const dataIndex = getLoopIndex(currentTrendingIndex + i, len);
      const item = trendingData[dataIndex];
      const isActive = (i === 0);
      const isAdjacent = (i !== 0);
      let classes = 'trending-word';
      if (isActive) classes += ' active';
      if (isAdjacent) classes += ' adjacent';
      
      items.push(`
        <a class="${classes}" 
           data-offset="${i}" 
           data-query="${escapeHtml(item.title)}" 
           title="${escapeHtml(item.title)}">${escapeHtml(item.title)}</a>
      `);
    }
    
    scrollTrack.innerHTML = items.join('');
    
    // 绑定点击事件（只有 active 响应）
    scrollTrack.querySelectorAll('.trending-word.active').forEach(word => {
      word.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const query = word.dataset.query;
        if (query) {
          const searchUrl = `https://www.bing.com/search?q=${encodeURIComponent(query)}`;
          chrome.runtime.sendMessage({ 
            action: 'openInNewTab', 
            url: searchUrl, 
            active: true,
            forceAdjacentPosition: true
          });
        }
      });
    });
    
    // 轨道位置-18px，让第2条（offset=0）显示在容器中
    scrollTrack.style.transform = 'translateY(-18px)';
  }

  // 热搜状态
  let trendingPaused = false;
  let scrollWrapper = null;
  let isScrollAnimating = false;

  /**
   * 滚动到下一条/上一条（无跳动）
   */
  function scrollByDelta(delta) {
    if (isScrollAnimating || !trendingData) return;
    
    const scrollTrack = trendingPanel?.querySelector('.trending-scroll-track');
    if (!scrollTrack) return;
    
    isScrollAnimating = true;
    
    // 1. 先更新索引
    currentTrendingIndex = getLoopIndex(currentTrendingIndex + delta, trendingData.length);
    
    // 2. 重新渲染数据（不带transition）
    scrollTrack.style.transition = 'none';
    renderVisibleWords();  // 这里会自动保持expanded状态
    
    // 3. 设置起始偏移（从反方向快速设置）
    const startOffset = 18 - (delta * ITEM_HEIGHT);
    scrollTrack.style.transform = `translateY(-${startOffset}px)`;
    
    // 4. 强制reflow后加动画回到中心
    scrollTrack.offsetHeight;
    scrollTrack.style.transition = 'transform 0.3s ease-out';
    scrollTrack.style.transform = 'translateY(-18px)';
    
    // 5. 滚动期间给active元素添加hovered类（因为鼠标在上面）
    if (trendingPaused) {
      const activeWord = scrollTrack.querySelector('.trending-word.active');
      if (activeWord) {
        activeWord.classList.add('hovered');
      }
    }
    
    setTimeout(() => {
      isScrollAnimating = false;
    }, 300);
  }



  /**
   * 启动热词滚动
   */
  function startTrendingScroll() {
    stopTrendingScroll();
    
    if (!trendingData || trendingData.length <= 1) return;
    
    scrollWrapper = trendingPanel?.querySelector('.trending-scroll-wrapper');
    if (!scrollWrapper) return;
    
    currentTrendingIndex = 0;
    trendingPaused = false;
    
    renderVisibleWords();
    
    // 每 7 秒自动滚动
    trendingScrollInterval = setInterval(() => {
      if (trendingPaused || isScrollAnimating) return;
      scrollByDelta(1);
    }, 7000);
    
    // 鼠标事件 - 绑定到整个 trendingPanel 容器
    trendingPanel.addEventListener('mouseenter', handleTrendingMouseEnter);
    trendingPanel.addEventListener('mouseleave', handleTrendingMouseLeave);
    trendingPanel.addEventListener('wheel', handleTrendingWheel, { passive: false });
  }

  function handleTrendingMouseEnter() {
    trendingPaused = true;
    if (trendingPanel) trendingPanel.classList.add('hint-arrows');
  }

  function handleTrendingMouseLeave() {
    trendingPaused = false;
    if (trendingPanel) {
      trendingPanel.classList.remove('hint-arrows');
      // 清除残留的 hovered 类，恢复正常文字颜色
      trendingPanel.querySelectorAll('.trending-word.hovered').forEach(el => {
        el.classList.remove('hovered');
      });
    }
  }

  function handleTrendingWheel(e) {
    e.preventDefault();
    e.stopPropagation();
    
    if (!trendingData || isScrollAnimating) return;
    
    if (e.deltaY > 0) {
      scrollByDelta(1);
    } else if (e.deltaY < 0) {
      scrollByDelta(-1);
    }
  }

  /**
   * 停止热词滚动
   */
  function stopTrendingScroll() {
    if (trendingScrollInterval) {
      clearInterval(trendingScrollInterval);
      trendingScrollInterval = null;
    }
    
    if (trendingPanel) {
      trendingPanel.removeEventListener('mouseenter', handleTrendingMouseEnter);
      trendingPanel.removeEventListener('mouseleave', handleTrendingMouseLeave);
      trendingPanel.removeEventListener('wheel', handleTrendingWheel);
    }
  }

  /**
   * HTML 转义
   */
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // ============================================
  // B站视频颜色反转功能
  // ============================================

  /**
   * 检测是否在B站视频播放页（存在 bpx 播放器）
   */
  function isBilibiliVideoPage() {
    return window.location.hostname.includes('bilibili.com') &&
      !!document.querySelector('.bpx-player-video-wrap');
  }

  /**
   * 管理 .bpx-player-video-wrap 的 overflow 属性
   * 有任何效果激活时设为 hidden，全部清除时恢复
   */
  function updateWrapOverflow() {
    const wrap = document.querySelector('.bpx-player-video-wrap');
    if (!wrap) return;
    const hasAnyEffect = invertActive || activeChannels.size > 0 || rotateAngle !== 0 || mirrorActive;
    wrap.style.overflow = hasAnyEffect ? 'hidden' : '';
  }

  /**
   * 确保 SVG 滤镜定义已注入 document
   * 使用单一动态 filter，根据当前激活的通道组合计算最终矩阵
   */
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

  /**
   * 根据当前激活的通道交换，计算最终的颜色矩阵
   * 通过交换行实现，与激活顺序无关
   */
  function computeChannelMatrix() {
    // 单位矩阵的行：R, G, B, A（每行 5 个值，最后一个是偏移）
    const rows = [
      [1, 0, 0, 0, 0],  // R
      [0, 1, 0, 0, 0],  // G
      [0, 0, 1, 0, 0],  // B
      [0, 0, 0, 1, 0],  // A
    ];
    // 按固定 id 顺序遍历，消除 Set 插入顺序导致的结果差异
    for (const swap of CHANNEL_SWAPS) {
      if (!activeChannels.has(swap.id)) continue;
      const [a, b] = swap.rows;
      const temp = rows[a];
      rows[a] = rows[b];
      rows[b] = temp;
    }
    return rows.map(r => r.join(' ')).join('  ');
  }

  /**
   * 根据当前状态生成组合 filter 并应用
   */
  function applyInvertFilter() {
    // 移除旧样式
    if (invertStyleElement) {
      invertStyleElement.remove();
      invertStyleElement = null;
    }

    // 无任何颜色效果
    if (!invertActive && activeChannels.size === 0) {
      updateWrapOverflow();
      updateToolbarState();
      updateBiliIndicator();
      return;
    }

    // 构建 filter 值
    const filters = [];
    if (invertActive) {
      filters.push('invert(1) hue-rotate(180deg)');
    }
    if (activeChannels.size > 0) {
      ensureInvertSvgFilters();
      // 更新 SVG filter 的矩阵值
      const matrixEl = invertSvgElement.querySelector('feColorMatrix');
      if (matrixEl) {
        matrixEl.setAttribute('values', computeChannelMatrix());
      }
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
    updateToolbarState();
    updateBiliIndicator();
  }

  /**
   * 切换主反转
   */
  function toggleInvert() {
    invertActive = !invertActive;
    applyInvertFilter();
  }

  /**
   * 切换通道交换（独立开关，可多选）
   */
  function toggleChannelSwap(swapId) {
    if (activeChannels.has(swapId)) {
      activeChannels.delete(swapId);
    } else {
      activeChannels.add(swapId);
    }
    applyInvertFilter();
  }

  /**
   * 关闭所有滤镜和旋转
   */
  function clearAllBiliTools() {
    invertActive = false;
    activeChannels.clear();
    applyInvertFilter();
    clearRotate();
    updateToolbarState();
    removeBiliIndicator();
  }

  // ============================================
  // 视频旋转功能
  // ============================================

  /**
   * 旋转视频（顺时针 +90\u00b0）
   */
  function rotateVideo() {
    rotateAngle = (rotateAngle + 90) % 360;
    applyRotateTransform();
  }

  /**
   * 切换镜像
   */
  function toggleMirror() {
    mirrorActive = !mirrorActive;
    applyRotateTransform();
  }

  /**
   * 切换适应/填充模式
   */
  function toggleRotateFitMode() {
    rotateFillMode = !rotateFillMode;
    applyRotateTransform();
    updateToolbarState();
  }

  /**
   * 应用旋转变换
   */
  function applyRotateTransform() {
    // 移除旧样式
    if (rotateStyleElement) {
      rotateStyleElement.remove();
      rotateStyleElement = null;
    }

    if (rotateAngle === 0 && !mirrorActive) {
      updateToolbarState();
      updateBiliIndicator();
      return;
    }

    // 计算缩放比例：旋转 90°/270° 时宽高互换，需要缩放
    const isRotated90 = (rotateAngle === 90 || rotateAngle === 270);
    let scaleCSS = '';

    if (isRotated90) {
      // 获取播放器容器和视频尺寸
      const container = document.querySelector('.bpx-player-video-area') || document.querySelector('.bpx-player-video-wrap');
      const video = document.querySelector('.bpx-player-video-wrap video');

      if (container && video) {
        const cw = container.clientWidth;
        const ch = container.clientHeight;
        // 旋转后视频的逻辑宽高互换
        // 适应模式：缩放到容器能完全包含（取小值）
        // 填充模式：缩放到填满容器（取大值）
        const scaleX = cw / ch;  // 宽度方向缩放比
        const scaleY = ch / cw;  // 高度方向缩放比

        let scale;
        if (rotateFillMode) {
          scale = Math.max(scaleX, scaleY);
        } else {
          scale = Math.min(scaleX, scaleY);
        }
        scaleCSS = ` scale(${scale.toFixed(4)})`;
      } else {
        // 找不到容器，用安全的默认值
        const defaultScale = rotateFillMode ? 1.78 : 0.5625; // 16:9 假设
        scaleCSS = ` scale(${defaultScale})`;
      }
    }

    // 构建 transform（从右往左执行：先 scale 适配 → 再 rotate → 最后 mirror）
    const transforms = [];
    if (mirrorActive) {
      transforms.push('scaleX(-1)');
    }
    if (rotateAngle !== 0) {
      transforms.push(`rotate(${rotateAngle}deg)`);
    }
    if (scaleCSS) {
      transforms.push(scaleCSS.trim());
    }

    rotateStyleElement = document.createElement('style');
    rotateStyleElement.id = 'echo-video-rotate-style';
    rotateStyleElement.textContent = `
      .bpx-player-video-wrap video {
        transform: ${transforms.join(' ')} !important;
      }
    `;
    document.head.appendChild(rotateStyleElement);
    updateWrapOverflow();

    updateToolbarState();
    updateBiliIndicator();
  }

  /**
   * 重置旋转
   */
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

  /**
   * 更新工具条按钮激活状态
   */
  function updateToolbarState() {
    if (!invertToolbar) return;
    // 颜色反转主按钮
    const mainBtn = invertToolbar.querySelector('[data-action="invert"]');
    if (mainBtn) {
      mainBtn.classList.toggle('active', invertActive);
    }
    // 通道按钮
    invertToolbar.querySelectorAll('[data-action="channel"]').forEach(btn => {
      const id = parseInt(btn.dataset.channelId);
      btn.classList.toggle('active', activeChannels.has(id));
    });
    // 旋转按钮高亮（旋转角度非0时）
    const rotateBtn = invertToolbar.querySelector('[data-action="rotate"]');
    if (rotateBtn) {
      rotateBtn.classList.toggle('active', rotateAngle !== 0);
    }
    // 镜像按钮高亮
    const mirrorBtn = invertToolbar.querySelector('[data-action="mirror"]');
    if (mirrorBtn) {
      mirrorBtn.classList.toggle('active', mirrorActive);
    }
    // 适应/填充按钮
    const fitBtn = invertToolbar.querySelector('[data-action="rotate-fit"]');
    if (fitBtn) {
      const isRotated90 = (rotateAngle === 90 || rotateAngle === 270);
      const fitLabel = fitBtn.querySelector('span');
      if (fitLabel) fitLabel.textContent = rotateFillMode ? '填充' : '适应';
      fitBtn.classList.toggle('active', rotateFillMode && isRotated90);
      fitBtn.classList.toggle('disabled', !isRotated90);
    }
  }

  /**
   * 更新工具条可见性（仅B站视频页显示）
   */
  function updateInvertToolbarVisibility() {
    if (!invertToolbar) return;
    if (isBilibiliVideoPage()) {
      invertToolbar.classList.add('show');
    } else {
      invertToolbar.classList.remove('show');
    }
    updateToolbarState();
  }

  /**
   * 更新B站工具指示器（综合颜色+旋转状态）
   */
  function updateBiliIndicator() {
    const hasColorEffect = invertActive || activeChannels.size > 0;
    const hasRotate = rotateAngle !== 0;
    const hasMirror = mirrorActive;
    if (hasColorEffect || hasRotate || hasMirror) {
      const parts = [];
      if (hasColorEffect) parts.push('颜色已调整');
      if (hasRotate) {
        parts.push(`已旋转${rotateAngle}\u00b0`);
      }
      if (hasMirror) parts.push('已镜像');
      showBiliIndicator(parts.join(' / '));
    } else {
      removeBiliIndicator();
    }
  }

  /**
   * 显示B站工具指示器（document.body 上，搜索框外）
   */
  function showBiliIndicator(text) {
    if (invertIndicator) {
      // 已存在，更新文案
      invertIndicator.textContent = text + ' \u00b7 点击重置';
      return;
    }

    invertIndicator = document.createElement('div');
    invertIndicator.id = 'echo-invert-indicator';
    invertIndicator.style.cssText = `
      position: fixed;
      top: 16px;
      right: 16px;
      z-index: 2147483646;
      background: rgba(0, 0, 0, 0.75);
      color: #fff;
      font-size: 12px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      padding: 6px 14px;
      border-radius: 16px;
      cursor: pointer;
      user-select: none;
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      transition: opacity 0.3s;
      opacity: 0;
    `;
    invertIndicator.textContent = text + ' \u00b7 点击重置';
    invertIndicator.title = '点击重置所有视频工具';
    invertIndicator.addEventListener('click', (e) => {
      e.stopPropagation();
      clearAllBiliTools();
    });

    document.body.appendChild(invertIndicator);
    // 淡入
    requestAnimationFrame(() => {
      if (invertIndicator) invertIndicator.style.opacity = '1';
    });
  }

  /**
   * 移除B站工具指示器
   */
  function removeBiliIndicator() {
    if (!invertIndicator) return;
    invertIndicator.style.opacity = '0';
    const el = invertIndicator;
    invertIndicator = null;
    setTimeout(() => el.remove(), 300);
  }

  function bindEvents() {
    const isAlwaysShowMode = settings.floatingSearchBoxAlwaysShow;

    // 输入框回车搜索
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const query = searchInput.value.trim();
        if (query) {
          performSearch(query);
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        // 常驻模式：Esc 无效；快捷键模式：Esc 关闭
        if (!isAlwaysShowMode) {
          hideSearchBox();
        }
      }
    });

    // 阻止事件冒泡到页面
    searchContainer.addEventListener('keydown', (e) => {
      e.stopPropagation();
    });

    searchContainer.addEventListener('keyup', (e) => {
      e.stopPropagation();
    });

    // 关闭按钮：常驻模式隐藏按钮，快捷键模式显示
    const closeBtn = searchContainer.querySelector('.close-btn');
    if (isAlwaysShowMode) {
      closeBtn.style.display = 'none';
    } else {
      closeBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        hideSearchBox('close-button', e);
      });
    }

    // B站视频工具条
    if (invertToolbar) {
      invertToolbar.addEventListener('click', (e) => {
        const btn = e.target.closest('.capsule-btn');
        if (!btn) return;
        e.preventDefault();
        e.stopPropagation();
        const action = btn.dataset.action;
        if (action === 'invert') {
          toggleInvert();
        } else if (action === 'channel') {
          toggleChannelSwap(parseInt(btn.dataset.channelId));
        } else if (action === 'rotate') {
          rotateVideo();
        } else if (action === 'mirror') {
          toggleMirror();
        } else if (action === 'rotate-fit') {
          toggleRotateFitMode();
        }
      });
    }

    // 点击搜索框外部不再自动关闭，避免额外介入页面点击路径。

    // 阻止搜索框内的点击事件冒泡
    searchContainer.addEventListener('click', (e) => {
      e.stopPropagation();
    });
  }

  // ============================================
  // 显示/隐藏搜索框
  // ============================================

  /**
   * 播放聚焦动画 - 椭圆光环脉冲扩散效果
   * 注意：动画元素直接添加到 document.body（Shadow DOM 外部），才能覆盖全屏
   */
  function playFocusBurstAnimation() {
    // 搜索框尺寸（根据 trending 设置动态调整宽度）
    // 带 trending 时约 710px，不带时约 420px
    const boxWidth = settings.floatingSearchBoxTrending ? 710 : 420;
    const boxHeight = 48;  // 搜索框高度（padding 8px*2 + 内容 + 边框约 48px）
    
    // 搜索框定位：bottom: 32px，水平居中
    // 发光环也用相同的定位方式，确保完全对齐
    const bottomOffset = BOTTOM_OFFSET_PX;  // 与搜索框的 bottom 值一致
    
    // 计算缩放补偿
    // 如果不跟随页面缩放，需要对光环也应用反向缩放
    const needsCompensation = !settings.floatingSearchBoxFollowZoom && currentZoom !== 1;
    const inverseScale = needsCompensation ? (1 / currentZoom) : 1;
    
    // 补偿后的尺寸和位置
    const compensatedWidth = boxWidth * inverseScale;
    const compensatedHeight = boxHeight * inverseScale;
    const compensatedBottom = bottomOffset * inverseScale;
    const compensatedBorderRadius = 24 * inverseScale;
    
    // 创建动画容器（直接在 document.body 上，不在 Shadow DOM 内）
    const burst = document.createElement('div');
    burst.id = 'echo-focus-burst';
    burst.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      pointer-events: none;
      z-index: 2147483646;
    `;
    
    // 创建 CSS 样式
    // 直接用 position: fixed 定位光环，与搜索框定位方式一致
    // 注意：使用 !important 覆盖页面可能存在的 prefers-reduced-motion 规则
    const style = document.createElement('style');
    style.textContent = `
      @keyframes echoRingPulse {
        0% {
          opacity: 0.35;
          transform: translateX(-50%) scale(1);
          filter: blur(2px);
        }
        100% {
          opacity: 0;
          transform: translateX(-50%) scale(1.5);
          filter: blur(8px);
        }
      }
      #echo-focus-burst .pulse-ring {
        position: fixed !important;
        left: 50% !important;
        bottom: ${compensatedBottom}px !important;
        width: ${compensatedWidth}px;
        height: ${compensatedHeight}px;
        border-radius: ${compensatedBorderRadius}px;
        animation: echoRingPulse 0.4s ease-out forwards !important;
        animation-duration: 0.4s !important;
        opacity: 0;
      }
    `;
    burst.appendChild(style);
    
    // 创建多层椭圆光环
    const ringColors = [
      { color: '#38bdf8', delay: 0 },      // 蓝色
      { color: '#c084fc', delay: 0.1 },   // 紫色
      { color: '#f472b6', delay: 0.2 },   // 粉色
    ];
    
    ringColors.forEach(({ color, delay }) => {
      const ring = document.createElement('div');
      ring.className = 'pulse-ring';
      ring.style.cssText = `
        border: 1px solid ${color};
        box-shadow: 0 0 12px ${color};
        animation-delay: ${delay}s !important;
      `;
      burst.appendChild(ring);
    });
    
    document.body.appendChild(burst);
    
    // 动画结束后移除
    setTimeout(() => {
      burst.remove();
    }, 700);
  }

  /**
   * 显示搜索框
   * @param {boolean} shouldFocus - 是否抢焦点（Ctrl+B 呼出时为 true，常驻初始化为 false）
   * @param {boolean} withBurstAnimation - 是否播放聚焦动画（仅 Ctrl+B 手动触发时为 true）
   */
  async function showSearchBox(shouldFocus = true, withBurstAnimation = false) {
    createSearchBox();
    
    // 记录显示前的状态，用于判断是否需要清空输入框
    const wasAlreadyShown = searchWrapper.classList.contains('show');
    
    // 如果需要播放聚焦动画（动画在 document.body 上，不影响搜索框本身）
    // 在反向补偿模式下，先强制刷新一次 zoom，确保光环与搜索框一致。
    if (withBurstAnimation) {
      await refreshZoomOnce();
      playFocusBurstAnimation();
    }
    
    if (host) {
      host.style.pointerEvents = 'auto'; // 显示时恢复接受鼠标事件
    }

    searchWrapper.classList.add('show');

    // 更新颜色反转工具条可见性（仅在B站视频页显示）
    updateInvertToolbarVisibility();
    
    // 只在搜索框首次显示时清空输入框，避免清空用户正在输入的内容
    if (!wasAlreadyShown) {
      searchInput.value = '';
    }
    
    // 显示热搜推荐
    updateTrendingVisibility();
    
    if (shouldFocus) {
      const focusInput = () => {
        if (host && host.contentDocument && host.contentDocument.activeElement === searchInput) {
          return;
        }
        if (host && host.contentWindow) {
          host.contentWindow.focus();
        }
        if (searchInput) {
          searchInput.focus({ preventScroll: true });
        }
      };
      // 等待 DOM/iframe 渲染完成
      requestAnimationFrame(() => requestAnimationFrame(focusInput));
    }
    // 常驻模式初始化时不抢焦点，让用户正常浏览网页
  }

  function hideSearchBox(reason = 'unknown', triggerEvent = null) {
    if (searchWrapper) {
      searchWrapper.classList.remove('show');
      searchInput.blur();
    }
    if (trendingPanel) {
      trendingPanel.classList.remove('show');
      stopTrendingScroll();
    }
    // 隐藏时彻底禁用 iframe 指针事件，防止遮挡底部页面元素（如播放器控件）
    if (host) {
      host.style.pointerEvents = 'none';
    }
  }

  /**
   * 切换搜索框（Ctrl+B 触发，始终需要焦点，播放聚焦动画）
   */
  function toggleSearchBox() {
    if (searchWrapper && searchWrapper.classList.contains('show')) {
      hideSearchBox('toggle-close');
    } else {
      // 保持 Ctrl+B 后可直接输入，继续验证是否是 closed Shadow DOM + focus 的组合导致页面异常
      showSearchBox(true, true);
    }
  }

  // ============================================
  // 执行搜索
  // ============================================

  function performSearch(query) {
    // 使用 Bing 搜索
    const searchUrl = `https://www.bing.com/search?q=${encodeURIComponent(query)}`;
    
    // 在新标签页打开搜索结果（紧贴当前标签，设置父标签关系）
    chrome.runtime.sendMessage({ 
      action: 'openInNewTab', 
      url: searchUrl, 
      active: true,
      forceAdjacentPosition: true
    });
    
    // 常驻模式：清空输入框但保持显示；快捷键模式：关闭搜索框
    if (settings.floatingSearchBoxAlwaysShow) {
      searchInput.value = '';
    } else {
      hideSearchBox('perform-search');
    }
  }

  // ============================================
  // 监听 Ctrl+B 快捷键
  // ============================================

  function handleGlobalKeydown(e) {
    // 全局 Esc：搜索框可见时关闭（常驻模式除外）
    if (e.key === 'Escape' && !settings.floatingSearchBoxAlwaysShow && getSearchWrapperVisible()) {
      const activeEl = e.target;
      const isInPageEditable = activeEl && activeEl !== document.body && activeEl !== document.documentElement && (
        activeEl.tagName === 'INPUT' ||
        activeEl.tagName === 'TEXTAREA' ||
        activeEl.tagName === 'SELECT' ||
        activeEl.isContentEditable
      ) && activeEl !== searchInput && (!host || activeEl !== host);
      
      if (!isInPageEditable) {
        e.preventDefault();
        e.stopPropagation();
        hideSearchBox('esc-global');
        return;
      }
    }

    // Ctrl+B (Windows) / Cmd+B (Mac)
    const isCtrlOrCmd = e.ctrlKey || e.metaKey;
    if (isCtrlOrCmd && e.key === 'b' && !e.shiftKey && !e.altKey) {
      const activeEl = e.target;
      const isInOurSearchBox = searchInput && (activeEl === searchInput || activeEl === host);
      const isInOtherInput = !isInOurSearchBox && activeEl && (
        activeEl.tagName === 'INPUT' ||
        activeEl.tagName === 'TEXTAREA' ||
        activeEl.isContentEditable
      );

      if (isInOtherInput) {
        return;
      }

      e.preventDefault();
      e.stopPropagation();
      toggleSearchBox();
    }
  }

  document.addEventListener('keydown', handleGlobalKeydown, true);

  // ============================================
  // 暴露全局方法供外部调用（如 FRE 页面点击触发）
  // ============================================
  window.echoToggleSearchBox = toggleSearchBox;

  // ============================================
  // 初始化：根据设置决定是否默认显示
  // ============================================

  function init() {
    if (settings.floatingSearchBoxAlwaysShow) {
      // 常驻模式：页面加载完成后自动显示，但不抢焦点
      showSearchBox(false);
    }
  }

  // 页面加载完成后初始化
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // ============================================
  // SPA 导航监听：视频切换时自动清除工具状态
  // ============================================

  let lastUrl = location.href;
  const titleEl = document.querySelector('title') || document.head;
  new MutationObserver((mutations) => {
    if (location.href !== lastUrl) {
      const previousUrl = lastUrl;
      lastUrl = location.href;
      const hadEffects = invertActive || activeChannels.size > 0 || rotateAngle !== 0 || mirrorActive;
      if (hadEffects) {
        clearAllBiliTools();
      }
    }
  }).observe(titleEl, { childList: true, subtree: true, characterData: true });
})();
