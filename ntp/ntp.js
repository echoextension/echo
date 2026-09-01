/**
 * ECHO NTP (New Tab Page) Script
 * 支持鼠标手势、精细缩放（CSS transform）、F2/F3 切换标签
 * 热搜榜单展示、Bing壁纸、自绘收藏栏
 *
 * 注：由于浏览器 API 限制，NTP 页面无法使用 chrome.tabs.setZoom
 * 因此使用 CSS transform 实现本页精细缩放
 */

// ============================================
// Storage Keys
// ============================================
const WALLPAPER_KEY = 'echo_ntp_wallpaper_v2';
const WALLPAPER_FAVORITES_KEY = 'echo_ntp_wallpaper_favorites';
const WALLPAPER_FAVORITES_META_KEY = `${WALLPAPER_FAVORITES_KEY}_meta`;
const TRENDING_KEY = 'echo_ntp_trending';
const TRENDING_CACHE_KEY = 'echo_ntp_trending_cache';
const TRENDING_CATEGORY_KEY = 'echo_ntp_trending_category';
const BLANK_MODE_CACHE_KEY = 'echo_ntp_blank_mode';
const MESSAGE_ACTIONS = EchoMessages.ACTIONS;
const wallpaperRepository = EchoNtpWallpaperRepository.create(chrome, localStorage, {
  settings: WALLPAPER_KEY,
  favorites: WALLPAPER_FAVORITES_KEY,
  blankMode: BLANK_MODE_CACHE_KEY,
  viewHistory: 'echo_ntp_view_history'
});
const trendingController = EchoNtpTrendingController.create({
  chrome,
  document,
  window,
  actions: MESSAGE_ACTIONS,
  storageKeys: {
    enabled: TRENDING_KEY,
    cache: TRENDING_CACHE_KEY,
    category: TRENDING_CATEGORY_KEY
  },
  focusSearch: () => blankModeController.focusSearch()
});
const searchController = EchoNtpSearchController.create({
  chrome,
  document,
  actions: MESSAGE_ACTIONS
});
const notificationView = EchoNtpNotificationView.create({ document, window });

// ============================================
// 壁纸图片缓存 (IndexedDB)
// ============================================
const wallpaperCache = EchoNtpWallpaperCache.create(indexedDB);

const wallpaperImageProcessor = EchoNtpWallpaperImageProcessor.create({ document, Image, URL });
const wallpaperTheme = EchoNtpWallpaperTheme.create({ document, window });

// ============================================
// Bing 壁纸功能 - 带本地缓存
// ============================================

let wallpaperState = EchoNtpWallpaperState.create({
  blankMode: window.__ECHO_NTP_BLANK_MODE__ === true
});
let wallpaperRenderer = null;
let wallpaperPageController = null;
const wallpaperStatusView = EchoNtpWallpaperStatusView.create({
  state: wallpaperState,
  document,
  domain: EchoNtpWallpaperDomain
});
const lowPolyAdapter = EchoNtpLowPolyAdapter.create({ document, window });
const wallpaperDataSource = EchoNtpWallpaperDataSource.create({
  fetch,
  localStorage,
  runtimeGetUrl: path => chrome.runtime.getURL(path),
  state: wallpaperState,
  getLatestBingWallpaper: () => EchoNtpWallpaperDomain.getLatestBingWallpaper(wallpaperState.history),
  onDailyWallpaper: wallpaper => displayWallpaper(wallpaper)
});
const customWallpaperController = EchoNtpCustomWallpaperController.create({
  state: wallpaperState,
  domain: EchoNtpWallpaperDomain,
  cache: wallpaperCache,
  imageProcessor: wallpaperImageProcessor,
  saveFavorites,
  saveSettings: saveWallpaperSettings,
  display: displayWallpaper,
  select: selectWallpaper,
  showToast: (message, anchor) => notificationView.showToast(message, anchor),
  refreshStatus: () => wallpaperStatusView.refresh()
});

const wallpaperCommandController = EchoNtpWallpaperCommandController.create({
  state: wallpaperState,
  domain: EchoNtpWallpaperDomain,
  display: displayWallpaper,
  saveSettings: saveWallpaperSettings,
  saveFavorites,
  removeCustomWallpaper: date => customWallpaperController.remove(date),
  refresh: () => wallpaperStatusView.refresh()
});
const blankModeController = EchoNtpBlankModeController.create({
  state: wallpaperState,
  document,
  lowPoly: lowPolyAdapter,
  setBookmarkBarHeight: setBookmarkBarHeightVar,
  ensureWallpaper: () => wallpaperPageController?.ensureRendered(),
  saveSettings: saveWallpaperSettings
});
const wallpaperCollectionController = EchoNtpWallpaperCollectionController.create({
  state: wallpaperState,
  document,
  URL,
  domain: EchoNtpWallpaperDomain,
  cache: wallpaperCache,
  commands: wallpaperCommandController,
  display: displayWallpaper,
  view: wallpaperStatusView,
  loadHistory: () => {
    wallpaperState.viewHistory = wallpaperRepository.loadViewHistory();
  },
  uploadCustomWallpaper: file => customWallpaperController.upload(file),
  openBackup: () => {
    const url = chrome.runtime.getURL('options/options.html#backupSection');
    chrome.tabs.create({ url });
  }
});
const wallpaperSettingsController = EchoNtpWallpaperSettingsController.create({
  state: wallpaperState,
  document,
  commands: wallpaperCommandController,
  view: wallpaperStatusView,
  blankMode: blankModeController,
  saveSettings: saveWallpaperSettings,
  showToast: (message, anchor) => notificationView.showToast(message, anchor),
  openCollection: () => wallpaperCollectionController.show()
});

/**
 * 根据模式选择壁纸
 *
 * 优先级模型（严格三态）：
 * 1. 锁定模式：pinnedDate 有值时，始终显示锁定的壁纸（最高优先级）
 * 2. 轮播收藏模式：mode === 'collection' 且 pinnedDate 为空
 * 3. 每日模式：mode === 'daily' 且 pinnedDate 为空
 *
 * 注意：pinnedDate 是锁定的唯一判断条件，不再依赖 collectionPlayMode
 */
function selectWallpaper() {
  return EchoNtpWallpaperDomain.selectWallpaper(wallpaperState);
}

/**
 * 显示壁纸
 */
async function displayWallpaper(wp) {
  return wallpaperRenderer.display(wp);
}

/**
 * 壁纸信息卡片自动隐藏功能
 *
 * 逻辑：壁纸变化时展示，未变化时不展示
 * - 开关关闭：卡片始终展开
 * - 开关开启 + 壁纸变了：展开卡片几秒后隐藏，记录当前壁纸ID
 * - 开关开启 + 壁纸没变：直接隐藏（无动画）
 */
const autoHideController = EchoNtpWallpaperInfoController.create({
  state: wallpaperState,
  document,
  window,
  saveSettings: saveWallpaperSettings,
  openSearch: url => {
    if (chrome?.tabs?.create) chrome.tabs.create({ url, active: false });
    else window.open(url, '_blank');
  }
});
wallpaperRenderer = EchoNtpWallpaperRenderer.create({
  state: wallpaperState,
  document,
  Image: document.defaultView.Image,
  URL,
  fetch,
  domain: EchoNtpWallpaperDomain,
  cache: wallpaperCache,
  custom: customWallpaperController,
  theme: wallpaperTheme,
  infoController: autoHideController,
  addToHistory: date => wallpaperRepository.addViewHistory(wallpaperState, date),
  updateInfo: wallpaper => autoHideController.update(wallpaper),
  updateStatus: () => wallpaperStatusView.updateActions(),
  updateStatusText: () => wallpaperStatusView.updateSummary()
});
wallpaperPageController = EchoNtpWallpaperPageController.create({
  state: wallpaperState,
  document,
  domain: EchoNtpWallpaperDomain,
  repository: wallpaperRepository,
  loadState: loadWallpaperSettings,
  saveSettings: saveWallpaperSettings,
  dataSource: wallpaperDataSource,
  custom: customWallpaperController,
  renderer: wallpaperRenderer,
  commands: wallpaperCommandController,
  statusView: wallpaperStatusView,
  collection: wallpaperCollectionController,
  settings: wallpaperSettingsController,
  info: autoHideController,
  blankMode: blankModeController,
  lowPoly: lowPolyAdapter,
  notifications: notificationView,
  cleanCache: () => wallpaperCache.cleanExpired(),
  schedule: setTimeout,
  openOptions: () => {
    if (chrome.runtime?.openOptionsPage) chrome.runtime.openOptionsPage();
    else alert('演示模式：将打开 ECHO 插件设置页');
  }
});
const wallpaperSyncController = EchoNtpWallpaperSyncController.create({
  chrome,
  favoritesKey: WALLPAPER_FAVORITES_KEY,
  favoritesMetaKey: WALLPAPER_FAVORITES_META_KEY,
  commands: wallpaperCommandController,
  collection: wallpaperCollectionController,
  resolveAvailableFavorites: async favorites => {
    const available = favorites.filter(date => !EchoNtpWallpaperDomain.isCustomDate(date));
    for (const date of favorites.filter(EchoNtpWallpaperDomain.isCustomDate)) {
      if (await wallpaperCache.get(date)) available.push(date);
    }
    return available;
  },
  getLocalFallbackTimestamp: async () => {
    const value = (await chrome.storage.local.get(WALLPAPER_FAVORITES_KEY))[WALLPAPER_FAVORITES_KEY];
    return Number.isFinite(value?.updatedAt) ? value.updatedAt : 0;
  }
});

/**
 * 加载壁纸设置
 */
async function loadWallpaperSettings() {
  try {
    await wallpaperRepository.load(wallpaperState);
  } catch (error) {
    console.error('[ECHO NTP] 加载壁纸设置失败:', error);
    throw error;
  }
}

/**
 * 保存壁纸设置
 */
async function saveWallpaperSettings() {
  try {
    await wallpaperRepository.saveSettings(wallpaperState.settings);
  } catch (error) {
    console.error('[ECHO NTP] 保存壁纸设置失败:', error);
    throw error;
  }
}

/**
 * 保存收藏（使用 sync 存储实现跨设备同步）
 */
async function saveFavorites() {
  try {
    const result = await wallpaperRepository.saveFavorites(wallpaperState.favorites);
    wallpaperState.favorites = result.favorites;
  } catch (error) {
    console.error('[ECHO NTP] 保存收藏失败:', error);
    throw error;
  }
}

const ntpZoomController = EchoNtpZoomController.create({ chrome, document });
const ntpInputAdapter = EchoNtpInputAdapter.create({
  document,
  chrome,
  context: EchoInputContext,
  policy: EchoInputPolicy,
  actions: MESSAGE_ACTIONS,
  zoom: ntpZoomController
});
ntpInputAdapter.init();

// ============================================
// 初始化
// ============================================

const ntpStartup = EchoNtpStartup.create({
  initTrending: () => trendingController.init(),
  loadZoom: () => ntpZoomController.load(),
  initSearch: () => searchController.init(),
  focusSearch: () => blankModeController.focusSearch(),
  setBookmarkBarHeight: setBookmarkBarHeightVar,
  initWallpaper: () => wallpaperPageController.init()
});
ntpStartup.register(document);

/**
 * 已移除的自绘书签栏不再占用页面高度。
 */
function setBookmarkBarHeightVar(height) {
  // 如果当前已经是这个高度，就不重新设置，减少 DOM 操作
  const current = document.documentElement.style.getPropertyValue('--bookmark-bar-height');
  if (current === height + 'px') return;
  
  document.documentElement.style.setProperty('--bookmark-bar-height', height + 'px');
}

wallpaperSyncController.register();
lowPolyAdapter.register(() => blankModeController.isEnabled());
