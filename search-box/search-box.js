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
  let trendingData = null;
  let trendingScrollInterval = null;
  let currentTrendingIndex = 0;
  let lastFetchTime = 0;
  const CACHE_DURATION = 10 * 60 * 1000; // 缓存 10 分钟

  function getSearchWrapperVisible() {
    return !!(searchWrapper && searchWrapper.classList.contains('show'));
  }

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

    // 创建热搜推荐面板（搜索框右侧延伸）

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

    // 根据内容实时计算并设置 iframe 外壳的安全尺寸
    const updateIframeSize = () => {
      if (!host || !searchWrapper) return;
      const rect = searchWrapper.getBoundingClientRect();
      let w = rect.width + FRAME_PAD * 2;
      let h = rect.height + FRAME_PAD * 2;

      host.style.width = Math.ceil(w) + 'px';
      host.style.height = Math.ceil(h) + 'px';
    };

    const ro = new ResizeObserver(() => updateIframeSize());
    ro.observe(searchWrapper);

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

    // margin-bottom 补偿：抵消 iframe 内部 FRAME_PAD 的视觉偏移，需随缩放同步补偿
    if (settings.floatingSearchBoxFollowZoom || zoomLevel === 1) {
      host.style.marginBottom = `-${FRAME_PAD}px`;
    } else {
      host.style.marginBottom = `-${FRAME_PAD * inverseScale}px`;
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

})();
