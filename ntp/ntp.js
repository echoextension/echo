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
const WALLPAPER_HISTORY_KEY = 'echo_ntp_wallpaper_history';
const WALLPAPER_FAVORITES_KEY = 'echo_ntp_wallpaper_favorites';
const TRENDING_KEY = 'echo_ntp_trending';
const TRENDING_CACHE_KEY = 'echo_ntp_trending_cache';
const TRENDING_CATEGORY_KEY = 'echo_ntp_trending_category';
const BLANK_MODE_CACHE_KEY = 'echo_ntp_blank_mode';

// ============================================
// 壁纸图片缓存 (IndexedDB)
// ============================================
const WALLPAPER_CACHE_DB = 'echo_wallpaper_cache';
const WALLPAPER_CACHE_STORE = 'images';

/**
 * 打开/创建 IndexedDB 数据库
 */
function openWallpaperCacheDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(WALLPAPER_CACHE_DB, 1);
    
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(WALLPAPER_CACHE_STORE)) {
        db.createObjectStore(WALLPAPER_CACHE_STORE, { keyPath: 'url' });
      }
    };
  });
}

/**
 * 从缓存获取图片 Blob
 */
async function getCachedWallpaper(url) {
  try {
    const db = await openWallpaperCacheDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(WALLPAPER_CACHE_STORE, 'readonly');
      const store = tx.objectStore(WALLPAPER_CACHE_STORE);
      const request = store.get(url);
      
      request.onsuccess = () => resolve(request.result?.blob || null);
      request.onerror = () => resolve(null);
    });
  } catch (e) {
    console.warn('[ECHO NTP] 缓存读取失败:', e);
    return null;
  }
}

/**
 * 缓存图片 Blob
 */
async function cacheWallpaper(url, blob) {
  try {
    const db = await openWallpaperCacheDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(WALLPAPER_CACHE_STORE, 'readwrite');
      const store = tx.objectStore(WALLPAPER_CACHE_STORE);
      store.put({ url, blob, timestamp: Date.now() });
      
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    });
  } catch (e) {
    console.warn('[ECHO NTP] 缓存写入失败:', e);
    return false;
  }
}

/**
 * 清理过期缓存（保留最近7天的）
 * 使用 cursor 逐条遍历，避免 getAll() 将所有 Blob 一次性加载到内存
 */
async function cleanOldWallpaperCache() {
  try {
    const db = await openWallpaperCacheDB();
    const tx = db.transaction(WALLPAPER_CACHE_STORE, 'readwrite');
    const store = tx.objectStore(WALLPAPER_CACHE_STORE);
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const request = store.openCursor();

    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;

      const item = cursor.value;
      // 跳过自定义壁纸和缩略图，它们不参与自动过期清理
      if (item.url && !item.url.startsWith('custom:') && !item.url.startsWith('custom_thumb:')) {
        if (item.timestamp < weekAgo) {
          cursor.delete();
        }
      }
      cursor.continue();
    };
  } catch (e) {
    // 忽略清理错误
  }
}

// ============================================
// 自定义壁纸上传
// ============================================
const CUSTOM_WALLPAPER_MAX = 10;
const CUSTOM_WALLPAPER_MAX_SIZE = 20 * 1024 * 1024; // 20MB
const CUSTOM_WALLPAPER_ACCEPT = ['image/jpeg', 'image/png', 'image/webp'];
const CUSTOM_WALLPAPER_THUMB_WIDTH = 480;
const CUSTOM_WALLPAPER_THUMB_HEIGHT = 270;
const CUSTOM_WALLPAPER_DISPLAY_MAX_W = 3840;
const CUSTOM_WALLPAPER_DISPLAY_MAX_H = 2160;
const CUSTOM_WALLPAPER_DISPLAY_QUALITY = 0.92;

/**
 * 判断是否为自定义壁纸
 */
function isCustomWallpaper(wp) {
  return wp?.type === 'custom';
}

/**
 * 判断 date 是否为自定义壁纸标识
 */
function isCustomDate(date) {
  return typeof date === 'string' && date.startsWith('custom:');
}

/**
 * 生成缩略图 Blob
 */
function generateThumbnail(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = CUSTOM_WALLPAPER_THUMB_WIDTH;
      canvas.height = CUSTOM_WALLPAPER_THUMB_HEIGHT;
      const ctx = canvas.getContext('2d');

      // 居中裁剪
      const srcRatio = img.naturalWidth / img.naturalHeight;
      const dstRatio = canvas.width / canvas.height;
      let sx = 0, sy = 0, sw = img.naturalWidth, sh = img.naturalHeight;
      if (srcRatio > dstRatio) {
        sw = img.naturalHeight * dstRatio;
        sx = (img.naturalWidth - sw) / 2;
      } else {
        sh = img.naturalWidth / dstRatio;
        sy = (img.naturalHeight - sh) / 2;
      }
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);

      canvas.toBlob(blob => {
        if (blob) resolve(blob);
        else reject(new Error('缩略图生成失败'));
      }, 'image/jpeg', 0.8);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('图片读取失败'));
    };
    img.src = url;
  });
}

/**
 * 生成显示用壁纸 Blob（压缩并限制分辨率，使 IndexedDB 存储体积与 Bing 壁纸一致）
 */
function generateDisplayImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      let w = img.naturalWidth;
      let h = img.naturalHeight;

      // 等比缩放到最大分辨率范围内
      if (w > CUSTOM_WALLPAPER_DISPLAY_MAX_W || h > CUSTOM_WALLPAPER_DISPLAY_MAX_H) {
        const scale = Math.min(CUSTOM_WALLPAPER_DISPLAY_MAX_W / w, CUSTOM_WALLPAPER_DISPLAY_MAX_H / h);
        w = Math.round(w * scale);
        h = Math.round(h * scale);
      }

      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);

      canvas.toBlob(blob => {
        if (blob) resolve(blob);
        else reject(new Error('壁纸压缩失败'));
      }, 'image/jpeg', CUSTOM_WALLPAPER_DISPLAY_QUALITY);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('图片读取失败'));
    };
    img.src = url;
  });
}

/**
 * 后台重压缩过大的自定义壁纸（懒迁移：首次显示旧数据后，优化存储以加速后续加载）
 */
function recompressCustomWallpaper(dateKey, imgElement) {
  let w = imgElement.naturalWidth;
  let h = imgElement.naturalHeight;

  if (w > CUSTOM_WALLPAPER_DISPLAY_MAX_W || h > CUSTOM_WALLPAPER_DISPLAY_MAX_H) {
    const scale = Math.min(CUSTOM_WALLPAPER_DISPLAY_MAX_W / w, CUSTOM_WALLPAPER_DISPLAY_MAX_H / h);
    w = Math.round(w * scale);
    h = Math.round(h * scale);
  }

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(imgElement, 0, 0, w, h);

  canvas.toBlob(async (blob) => {
    if (blob) {
      await cacheWallpaper(dateKey, blob);
    }
  }, 'image/jpeg', CUSTOM_WALLPAPER_DISPLAY_QUALITY);
}

/**
 * 获取当前自定义壁纸数量
 */
function getCustomWallpaperCount() {
  return wallpaperState.favorites.filter(isCustomDate).length;
}

/**
 * 上传自定义壁纸
 * @param {File} file
 * @returns {Object|null} 壁纸对象，或 null（失败）
 */
async function uploadCustomWallpaper(file) {
  // 格式校验
  if (!CUSTOM_WALLPAPER_ACCEPT.includes(file.type)) {
    showToast('仅支持 JPG、PNG、WebP 格式');
    return null;
  }
  // 大小校验
  if (file.size > CUSTOM_WALLPAPER_MAX_SIZE) {
    showToast('图片大小不能超过 20MB');
    return null;
  }
  // 数量校验
  if (getCustomWallpaperCount() >= CUSTOM_WALLPAPER_MAX) {
    showToast(`已达上限（${CUSTOM_WALLPAPER_MAX}/${CUSTOM_WALLPAPER_MAX}），请先删除一些自定义壁纸`);
    return null;
  }

  try {
    const timestamp = Date.now();
    const dateKey = `custom:${timestamp}`;
    const thumbKey = `custom_thumb:${timestamp}`;

    // 生成显示用壁纸（压缩并限制分辨率，使加载速度与 Bing 壁纸一致）
    const originalBlob = await generateDisplayImage(file);
    // 生成缩略图
    const thumbBlob = await generateThumbnail(file);

    // 存入 IndexedDB
    await cacheWallpaper(dateKey, originalBlob);
    await cacheWallpaper(thumbKey, thumbBlob);

    // 构造壁纸对象
    const wp = {
      id: `custom_${timestamp}`,
      date: dateKey,
      type: 'custom',
      desc: ''
    };

    // 加入 history（头部）
    wallpaperState.history.unshift(wp);

    // 加入收藏
    wallpaperState.favorites.push(dateKey);
    await saveFavorites();

    // 锁定并显示
    wallpaperState.settings.pinnedDate = dateKey;
    wallpaperState.isPreview = false;
    await saveWallpaperSettings();
    await displayWallpaper(wp);
    updateWallpaperStatus();
    updateFavoriteCount();
    updateL2SourceSelector();

    return wp;
  } catch (e) {
    console.error('[ECHO NTP] 自定义壁纸上传失败:', e);
    showToast('上传失败，请重试');
    return null;
  }
}

/**
 * 删除自定义壁纸
 */
async function deleteCustomWallpaper(dateKey) {
  if (!isCustomDate(dateKey)) return;

  const timestamp = dateKey.replace('custom:', '');
  const thumbKey = `custom_thumb:${timestamp}`;

  // 从 IndexedDB 删除原图和缩略图
  try {
    const db = await openWallpaperCacheDB();
    const tx = db.transaction(WALLPAPER_CACHE_STORE, 'readwrite');
    const store = tx.objectStore(WALLPAPER_CACHE_STORE);
    store.delete(dateKey);
    store.delete(thumbKey);
  } catch (e) {
    console.warn('[ECHO NTP] 删除自定义壁纸缓存失败:', e);
  }

  // 从 history 中移除
  wallpaperState.history = wallpaperState.history.filter(wp => wp.date !== dateKey);

  // 从收藏移除
  wallpaperState.favorites = wallpaperState.favorites.filter(d => d !== dateKey);
  await saveFavorites();

  // 如果当前锁定的就是这张，清除锁定
  if (wallpaperState.settings.pinnedDate === dateKey) {
    wallpaperState.settings.pinnedDate = null;
    const wp = selectWallpaper();
    if (wp) displayWallpaper(wp);
    await saveWallpaperSettings();
  }

  updateFavoriteCount();
  updateWallpaperStatus();
  updateL2SourceSelector();
}

/**
 * 加载所有自定义壁纸到 history
 * 在初始化时调用，从收藏列表中恢复自定义壁纸对象
 */
function loadCustomWallpapersToHistory() {
  const customDates = wallpaperState.favorites.filter(isCustomDate);
  customDates.forEach(dateKey => {
    // 检查是否已在 history 中
    if (wallpaperState.history.some(wp => wp.date === dateKey)) return;
    const timestamp = dateKey.replace('custom:', '');
    wallpaperState.history.unshift({
      id: `custom_${timestamp}`,
      date: dateKey,
      type: 'custom',
      desc: ''
    });
  });
}

// ============================================
// Bing 壁纸功能 - 带本地缓存
// ============================================

// Bing 壁纸 API（中国可访问）
const BING_API = 'https://cn.bing.com/HPImageArchive.aspx?format=js&idx=0&n=8&mkt=zh-CN';

// 壁纸状态
let wallpaperState = {
  settings: {
    mode: 'daily',           // daily | collection | off
    quality: '4k',           // 4k | 1080p
    pinnedDate: null,        // 锁定的壁纸日期（唯一锁定条件：有值=锁定）
    collectionPlayMode: 'random',  // random | fixed (仅用于 UI 显示，核心逻辑看 pinnedDate)
    lastActiveMode: 'daily',  // 关闭前的模式，用于恢复
    autoHideInfo: true,      // 是否自动隐藏壁纸信息（默认开启）
    minimalMode: false,      // 右上角按钮极简模式（默认关闭）
    blankMode: window.__ECHO_NTP_BLANK_MODE__ === true, // 纯空白新标签页模式（默认关闭）
    infoPositionY: null,     // 信息卡片的Y轴位置（null表示使用默认位置）
    lastShownWallpaperId: null,  // 上次展示 info 时的壁纸 ID（用于判断是否需要重新展示）
    previousMode: null       // 已废弃，保留向后兼容
  },
  current: null,        // 当前显示的壁纸数据
  browseIndex: 0,       // 浏览位置（0=今天）
  favorites: [],        // 收藏的日期列表
  viewHistory: [],      // 浏览历史（最近看过的壁纸日期列表，用于找回）
  history: [],          // 合并的壁纸历史（API + 静态数据）
  lastApiUpdate: null,  // API 最后更新时间
  isPreview: false,     // 是否在预览状态（随机浏览中）
  preloadedImages: new Map(),  // 预加载的图片缓存 { url: Image }
  isWallpaperLoading: false,
  wallpaperRenderRequestId: 0
};

function isBlankModeEnabled() {
  return wallpaperState.settings.blankMode === true;
}

function focusSearchInputIfAvailable() {
  if (isBlankModeEnabled()) return;

  const searchInput = document.getElementById('searchInput');
  const searchForm = document.querySelector('.search-form');
  if (!searchInput || !searchForm) return;

  if (window.getComputedStyle(searchForm).display === 'none') return;
  searchInput.focus();
}

function updateBlankModeSettingsState() {
  const settingsPanel = document.getElementById('settingsPanel');
  const settingsContent = document.getElementById('settingsContent');
  const blankModeNotice = document.getElementById('blankModeNotice');
  const settingsBtn = document.getElementById('wpSettingsBtn');
  const blankModeEnabled = isBlankModeEnabled();

  document.documentElement.classList.toggle('blank-mode', blankModeEnabled);
  document.body.classList.toggle('blank-mode', blankModeEnabled);
  settingsPanel?.classList.toggle('blank-mode-active', blankModeEnabled);

  if (blankModeNotice) {
    blankModeNotice.hidden = !blankModeEnabled;
  }

  if (settingsContent) {
    settingsContent.setAttribute('aria-hidden', blankModeEnabled ? 'true' : 'false');

    settingsContent.querySelectorAll('input, button, select, textarea').forEach((element) => {
      element.disabled = blankModeEnabled;
    });

    settingsContent.querySelectorAll('a').forEach((element) => {
      if (blankModeEnabled) {
        element.setAttribute('tabindex', '-1');
        element.setAttribute('aria-disabled', 'true');
      } else {
        element.removeAttribute('tabindex');
        element.removeAttribute('aria-disabled');
      }
    });
  }

  if (settingsBtn) {
    const label = blankModeEnabled ? '新标签页设置' : '设置';
    settingsBtn.title = label;
    settingsBtn.setAttribute('aria-label', label);
  }

  if (blankModeEnabled && document.activeElement instanceof HTMLElement) {
    const activeElement = document.activeElement;
    if (activeElement.id === 'searchInput' || activeElement.classList.contains('search-input')) {
      activeElement.blur();
    }
  }
}

async function syncBlankModeLayout() {
  if (isBlankModeEnabled()) {
    setBookmarkBarHeightVar(0);
    hideLowPolyBackground();
    return;
  }

  await initBookmarkBar();

  if (document.body.classList.contains('wallpaper-mode')) {
    hideLowPolyBackground();
  } else {
    showLowPolyBackground();
  }
}

async function applyBlankModeState() {
  updateBlankModeSettingsState();
  await syncBlankModeLayout();
}

async function ensureWallpaperRendered() {
  if (isBlankModeEnabled()) return;
  if (wallpaperState.settings.mode === 'off') return;
  if (!document.body.classList.contains('wallpaper-mode')) return;
  if (wallpaperState.isWallpaperLoading) return;

  const wallpaperBg = document.getElementById('wallpaperBg');
  const hasWallpaperImage = !!wallpaperBg?.querySelector('img');

  if (hasWallpaperImage) return;

  const wallpaperToRender = wallpaperState.current || selectWallpaper();
  if (!wallpaperToRender) return;

  await displayWallpaper(wallpaperToRender);
}

function initBlankModeSwitch() {
  const toggle = document.getElementById('blankModeSwitch');
  if (!toggle) return;

  toggle.checked = isBlankModeEnabled();

  toggle.addEventListener('change', async () => {
    wallpaperState.settings.blankMode = toggle.checked;
    await applyBlankModeState();
    await saveWallpaperSettings();

    if (!toggle.checked) {
      await ensureWallpaperRendered();
      focusSearchInputIfAvailable();
    }
  });
}

/**
 * 构建 Bing 壁纸 URL
 * ID 格式示例: "SnowOtters_EN-US0138589680" (不含 _UHD.jpg)
 */
function buildBingUrl(id, quality = '4k') {
  // ID 已经是完整的 OHR 标识符，直接使用
  const baseUrl = `https://cn.bing.com/th?id=OHR.${id}_UHD.jpg`;
  if (quality === '1080p') {
    return `${baseUrl}&pid=hp&w=1920&h=1080&rs=1&c=4`;
  }
  return `${baseUrl}&rf=LaDigue_UHD.jpg&pid=hp&w=3840&h=2160&rs=1&c=4`;
}

/**
 * 从 Bing API 获取最新壁纸
 */
async function fetchBingWallpapers() {
  try {
    const response = await fetch(BING_API);
    const data = await response.json();
    
    if (data && data.images && data.images.length > 0) {
      return data.images.map(img => {
        // 从 urlbase 提取 ID: "/th?id=OHR.BurnsPark_ZH-CN4442772228" -> "BurnsPark_ZH-CN4442772228"
        const id = img.urlbase?.replace('/th?id=OHR.', '') || 'unknown';
        
        // 格式化日期
        const dateStr = img.enddate;
        const formattedDate = `${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}`;
        
        return {
          id: id,
          date: formattedDate,
          desc: img.copyright?.split(' (©')[0] || img.title || '必应每日壁纸',
          copyright: img.copyright?.match(/\(©[^)]+\)/)?.[0] || ''
        };
      });
    }
    return [];
  } catch (error) {
    console.error('[ECHO NTP] Bing API 请求失败:', error);
    return [];
  }
}

/**
 * 合并历史数据（API + 静态数据）
 * 
 * 策略：
 * - daily 模式：如果缓存不包含今天，等待 API（最多 5 秒）
 * - collection 模式：直接使用静态数据，不等待 API
 * - 缓存有效性：基于"是否包含今天"而非固定时间
 */
async function mergeWallpaperHistory() {
  // 获取静态历史数据（立即可用，作为兜底）
  const staticHistory = typeof BING_WALLPAPER_HISTORY !== 'undefined' ? BING_WALLPAPER_HISTORY : [];
  // 今天的日期
  const today = new Date().toISOString().split('T')[0];
  
  // 尝试从 localStorage 获取缓存的 API 数据
  let cachedApiData = [];
  let cacheHasToday = false;
  try {
    const cached = localStorage.getItem('echo_bing_api_cache');
    if (cached) {
      const parsed = JSON.parse(cached);
      cachedApiData = parsed.data || [];
      // 缓存有效性：是否包含今天的壁纸
      cacheHasToday = cachedApiData.some(wp => wp.date === today);
    }
  } catch (e) {}
  
  // 判断是否需要等待 API（只有 daily 模式且缓存不含今天才需要）
  const isDailyMode = wallpaperState.settings.mode === 'daily';
  const needWaitApi = isDailyMode && !cacheHasToday;
  
  if (needWaitApi) {
    try {
      // 等待 API，最多 5 秒
      const apiData = await Promise.race([
        fetchBingWallpapers(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('API timeout')), 5000))
      ]);
      if (apiData && apiData.length > 0) {
        cachedApiData = apiData;
        // 更新缓存
        localStorage.setItem('echo_bing_api_cache', JSON.stringify({
          timestamp: Date.now(),
          data: apiData
        }));
      }
    } catch (e) {
      console.warn('[ECHO NTP] API 请求超时或失败，使用已有数据:', e.message);
    }
  }
  
  // 合并数据（API/缓存优先，静态数据兜底）
  const merged = new Map();
  cachedApiData.forEach(wp => merged.set(wp.date, wp));
  staticHistory.forEach(wp => {
    if (!merged.has(wp.date)) {
      merged.set(wp.date, wp);
    }
  });
  
  // 后台静默更新（非 daily 模式或已有今日数据时，后台刷新以备下次使用）
  if (!needWaitApi) {
    fetchBingWallpapers().then(apiWallpapers => {
      if (apiWallpapers.length > 0) {
        // 缓存到 localStorage
        try {
          localStorage.setItem('echo_bing_api_cache', JSON.stringify({
            timestamp: Date.now(),
            data: apiWallpapers
          }));
        } catch (e) {}
        // 更新内存中的 history
        apiWallpapers.forEach(wp => {
          const idx = wallpaperState.history.findIndex(w => w.date === wp.date);
          if (idx === -1) {
            wallpaperState.history.unshift(wp);
          } else {
            wallpaperState.history[idx] = wp;
          }
        });
        wallpaperState.history.sort((a, b) => b.date.localeCompare(a.date));
        
        // 如果是 daily 模式且未锁定，且当前显示的不是最新壁纸，自动刷新
        // 注意：pinnedDate 有值时表示锁定状态，不应覆盖
        const isLocked = !!wallpaperState.settings.pinnedDate;
        if (wallpaperState.settings.mode === 'daily' && !isLocked) {
          const latestWp = wallpaperState.history[0];
          if (latestWp && wallpaperState.current?.id !== latestWp.id) {
            displayWallpaper(latestWp);
          }
        }
      }
    }).catch(() => {});
  }
  
  // 返回合并后的数据
  const history = Array.from(merged.values()).sort((a, b) => b.date.localeCompare(a.date));
  return history;
}

/**
 * 初始化壁纸功能
 */
async function initWallpaper() {
  const toggle = document.getElementById('wallpaperSwitch');
  const wallpaperBg = document.getElementById('wallpaperBg');
  
  if (!toggle || !wallpaperBg) return;
  
  // 0. 清理过期缓存（延迟执行，避免 readwrite 事务阻塞壁纸显示的 IndexedDB 读取）
  setTimeout(cleanOldWallpaperCache, 5000);
  
  // 1. 加载存储的设置和收藏
  await loadWallpaperSettings();
  
  // 2. 合并壁纸历史
  wallpaperState.history = await mergeWallpaperHistory();
  
  // 2.5 加载自定义壁纸到历史
  await loadCustomWallpapersToHistory();
  
  if (wallpaperState.history.length === 0) {
    console.warn('[ECHO NTP] 没有可用的壁纸数据');
    return;
  }
  
  // 3. 根据模式决定初始壁纸
  if (wallpaperState.settings.mode !== 'off') {
    toggle.checked = true;
    document.body.classList.add('wallpaper-mode');
    document.body.classList.remove('no-wallpaper');
    // 隐藏 Low Poly 背景
    hideLowPolyBackground();
    
    // 选择要显示的壁纸
    const wp = selectWallpaper();
    if (wp) {
      displayWallpaper(wp);
    }
  } else {
    toggle.checked = false;
    document.body.classList.add('no-wallpaper');
    // 显示 Low Poly 背景
    showLowPolyBackground();
  }
  
  // 4. 初始化控件
  initWallpaperControls();
  initWallpaperSettings();
  initWallpaperInfoClick();
  await applyBlankModeState();
  await ensureWallpaperRendered();
  
  // 5. 监听开关
  toggle.addEventListener('change', async () => {
    if (toggle.checked) {
      // 恢复关闭前的模式
      // 核心修正：不再强制重置为 daily 和清除 pinnedDate
      // 直接信任 settings 中的状态（因为 mode 即使是 off，pinnedDate 依然保留了）
      
      // 如果之前的模式是 off (首次启动或异常)，则恢复为 lastActiveMode
      if (wallpaperState.settings.mode === 'off') {
        const restoreMode = wallpaperState.settings.lastActiveMode || 'daily';
        
        // 只有当没有锁定 且 恢复模式为 daily 时，才应用 restoreMode
        // 如果有 pinnedDate，它优先级最高，会自动覆盖 mode 的效果（在 selectWallpaper 中处理）
        // 如果是 collection，也照常设置
        
        // 我们只需要把 mode 设回 lastActiveMode 即可
        // 关键点：绝对不能清空 pinnedDate
        wallpaperState.settings.mode = restoreMode;
      }
      
      wallpaperState.isPreview = false;
      document.body.classList.add('wallpaper-mode');
      document.body.classList.remove('no-wallpaper');
      // 隐藏 Low Poly 背景
      hideLowPolyBackground();
      
      const wp = selectWallpaper();
      if (wp) displayWallpaper(wp);
      
      // 显示子设置
      document.getElementById('wallpaperSubSettings')?.classList.remove('hidden');
    } else {
      // 保存当前模式以便恢复
      if (wallpaperState.settings.mode !== 'off') {
        wallpaperState.settings.lastActiveMode = wallpaperState.settings.mode;
      }
      wallpaperState.settings.mode = 'off';
      document.body.classList.add('no-wallpaper');
      document.body.classList.remove('wallpaper-mode');
      // 显示 Low Poly 背景
      showLowPolyBackground();
      hideWallpaperUI();
      
      // 隐藏子设置
      document.getElementById('wallpaperSubSettings')?.classList.add('hidden');
    }

    if (isBlankModeEnabled()) {
      hideLowPolyBackground();
    }

    updateWallpaperStatus();
    await saveWallpaperSettings();
  });
  
  // 6. 键盘快捷键
  document.addEventListener('keydown', handleWallpaperKeyboard);
}

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
  const { mode, pinnedDate } = wallpaperState.settings;
  const { history, favorites } = wallpaperState;
  
  if (history.length === 0) return null;
  
  // 1. 最高优先级：锁定模式（pinnedDate 有值）
  if (pinnedDate) {
    const pinnedWp = history.find(wp => wp.date === pinnedDate);
    if (pinnedWp) {
      wallpaperState.browseIndex = history.findIndex(wp => wp.date === pinnedDate);
      return pinnedWp;
    }
    // pinnedDate 无效（图片不存在），清除锁定状态
    wallpaperState.settings.pinnedDate = null;
    // 继续往下执行
  }
  
  // 2. 轮播收藏模式
  if (mode === 'collection') {
    if (favorites.length === 0) {
      // 没有收藏，回退到每日模式
      wallpaperState.settings.mode = 'daily';
      wallpaperState.browseIndex = 0;
      return history[0];
    }
    
    // 基于日期的稳定随机
    const today = new Date().toISOString().split('T')[0];
    const seed = today.split('-').join('');
    const index = parseInt(seed) % favorites.length;
    const date = favorites[index];
    const wp = history.find(w => w.date === date);
    if (wp) {
      wallpaperState.browseIndex = history.findIndex(w => w.date === date);
      return wp;
    }
    // 回退到最新收藏
    const latestFav = favorites[favorites.length - 1];
    const latestWpFallback = history.find(w => w.date === latestFav);
    if (latestWpFallback) {
      wallpaperState.browseIndex = history.findIndex(w => w.date === latestFav);
      return latestWpFallback;
    }
  }
  
  // 3. 默认每日模式
  wallpaperState.browseIndex = 0;
  return history[0];
}

/**
 * 显示壁纸
 */
async function displayWallpaper(wp) {
  if (!wp) return;

  const renderRequestId = ++wallpaperState.wallpaperRenderRequestId;
  wallpaperState.isWallpaperLoading = true;
  
  wallpaperState.current = wp;
  
  // 添加到浏览历史（自定义壁纸也记录）
  addToViewHistory(wp.date);
  
  const wallpaperBg = document.getElementById('wallpaperBg');

  // 自定义壁纸：切换 body 标记，控制信息卡片隐藏
  document.body.classList.toggle('custom-wallpaper-active', isCustomWallpaper(wp));

  // ===== 自定义壁纸分支：从 IndexedDB 读取原图 Blob =====
  if (isCustomWallpaper(wp)) {
    try {
      const cachedBlob = await getCachedWallpaper(wp.date);
      if (!cachedBlob) {
        console.warn('[ECHO NTP] 自定义壁纸数据丢失:', wp.date);
        wallpaperState.isWallpaperLoading = false;
        return;
      }
      if (renderRequestId !== wallpaperState.wallpaperRenderRequestId) {
        wallpaperState.isWallpaperLoading = false;
        return;
      }
      const img = document.createElement('img');
      const objectUrl = URL.createObjectURL(cachedBlob);
      img.alt = '自定义壁纸';
      img.onload = () => {
        if (renderRequestId !== wallpaperState.wallpaperRenderRequestId) {
          URL.revokeObjectURL(objectUrl);
          return;
        }
        showWallpaperImage(img, wallpaperBg, true);
        wallpaperState.isWallpaperLoading = false;
        // 如果原始 Blob 过大（未经优化的旧数据），后台重压缩以加速后续加载
        if (cachedBlob.size > 2 * 1024 * 1024) {
          recompressCustomWallpaper(wp.date, img);
        }
        setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
      };
      img.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        wallpaperState.isWallpaperLoading = false;
      };
      img.src = objectUrl;
    } catch (e) {
      console.warn('[ECHO NTP] 自定义壁纸加载失败:', e);
      wallpaperState.isWallpaperLoading = false;
    }
    // 自定义壁纸不显示信息卡片，但仍更新状态按钮
    updateWallpaperStatus();
    updateWallpaperStatusText();
    return;
  }

  // ===== Bing 壁纸分支（原有逻辑）=====
  const quality = wallpaperState.settings.quality;
  const imgUrl = buildBingUrl(wp.id, quality);
  
  // 1. 检查是否有预加载的图片（内存缓存）
  const preloadedImg = wallpaperState.preloadedImages.get(imgUrl);
  
  if (preloadedImg && preloadedImg.complete && preloadedImg.naturalWidth > 0) {
    // 使用预加载的图片，秒切（无动画）
    showWallpaperImage(preloadedImg.cloneNode(), wallpaperBg, true);
    wallpaperState.preloadedImages.delete(imgUrl);
    wallpaperState.isWallpaperLoading = false;
    // 更新 UI
    updateWallpaperInfo(wp);
    updateWallpaperStatus();
    updateWallpaperStatusText();
    autoHideController?.onWallpaperChange();
    preloadRandomWallpapers(5);
    return;
  }
  
  // 2. 检查 IndexedDB 缓存
  const cachedBlob = await getCachedWallpaper(imgUrl);
  if (cachedBlob) {
    const img = document.createElement('img');
    const objectUrl = URL.createObjectURL(cachedBlob);
    img.alt = wp.desc || 'Bing Wallpaper';
    img.onload = () => {
      if (renderRequestId !== wallpaperState.wallpaperRenderRequestId) {
        URL.revokeObjectURL(objectUrl);
        return;
      }
      showWallpaperImage(img, wallpaperBg, true);
      wallpaperState.isWallpaperLoading = false;
      // 释放 Blob URL
      setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    };
    img.onerror = () => {
      if (renderRequestId !== wallpaperState.wallpaperRenderRequestId) {
        URL.revokeObjectURL(objectUrl);
        return;
      }
      wallpaperState.isWallpaperLoading = false;
      URL.revokeObjectURL(objectUrl);
      console.warn('[ECHO NTP] 缓存壁纸加载失败:', imgUrl);
    };
    img.src = objectUrl;
    // 更新 UI
    updateWallpaperInfo(wp);
    updateWallpaperStatus();
    updateWallpaperStatusText();
    autoHideController?.onWallpaperChange();
    preloadRandomWallpapers(5);
    return;
  }
  
  // 3. 从网络加载并缓存
  try {
    const response = await fetch(imgUrl);
    const blob = await response.blob();

    if (renderRequestId !== wallpaperState.wallpaperRenderRequestId) {
      wallpaperState.isWallpaperLoading = false;
      return;
    }
    
    // 缓存到 IndexedDB
    cacheWallpaper(imgUrl, blob);
    
    const img = document.createElement('img');
    const objectUrl = URL.createObjectURL(blob);
    img.alt = wp.desc || 'Bing Wallpaper';
    
    img.onload = () => {
      if (renderRequestId !== wallpaperState.wallpaperRenderRequestId) {
        URL.revokeObjectURL(objectUrl);
        return;
      }
      showWallpaperImage(img, wallpaperBg, true);
      wallpaperState.isWallpaperLoading = false;
      setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    };
    
    img.onerror = () => {
      if (renderRequestId !== wallpaperState.wallpaperRenderRequestId) {
        URL.revokeObjectURL(objectUrl);
        return;
      }
      wallpaperState.isWallpaperLoading = false;
      console.warn('[ECHO NTP] 壁纸加载失败:', imgUrl);
      URL.revokeObjectURL(objectUrl);
      // 尝试下一张
      if (wallpaperState.browseIndex < wallpaperState.history.length - 1) {
        wallpaperState.browseIndex++;
        const nextWp = wallpaperState.history[wallpaperState.browseIndex];
        displayWallpaper(nextWp);
      }
    };

    img.src = objectUrl;
  } catch (e) {
    if (renderRequestId !== wallpaperState.wallpaperRenderRequestId) {
      wallpaperState.isWallpaperLoading = false;
      return;
    }
    wallpaperState.isWallpaperLoading = false;
    console.warn('[ECHO NTP] 壁纸加载失败:', e);
    // 尝试下一张
    if (wallpaperState.browseIndex < wallpaperState.history.length - 1) {
      wallpaperState.browseIndex++;
      const nextWp = wallpaperState.history[wallpaperState.browseIndex];
      displayWallpaper(nextWp);
    }
  }
  
  // 更新 UI
  updateWallpaperInfo(wp);
  updateWallpaperStatus();
  updateWallpaperStatusText();
  
  // 壁纸切换时，重新展开信息卡片
  autoHideController?.onWallpaperChange();
  
  // 预加载下一批壁纸
  preloadRandomWallpapers(5);
}

/**
 * 显示壁纸图片
 * @param {HTMLImageElement} img - 图片元素
 * @param {HTMLElement} container - 容器元素
 * @param {boolean} instant - 是否立即显示（无动画）
 */
function showWallpaperImage(img, container, instant = false) {
  // 强制禁用所有过渡动画，实现瞬开
  img.style.transition = 'none';
  img.style.opacity = '1';
  container.innerHTML = '';
  container.appendChild(img);

  // 计算壁纸亮度，动态调整文字颜色
  calculateAndSetTextColor(img);
  // 提取壁纸主色调，应用到信息卡片
  extractAndApplyWallpaperTheme(img);
}

/**
 * 预加载随机壁纸
 */
function preloadRandomWallpapers(count = 5) {
  const { history, preloadedImages, settings } = wallpaperState;
  if (history.length === 0) return;
  
  const quality = settings.quality;
  const maxCache = 8; // 最多缓存8张
  
  // 清理已使用或失败的缓存
  for (const [url, img] of preloadedImages.entries()) {
    if (img.error) {
      preloadedImages.delete(url);
    }
  }
  
  // 清理过多的缓存（保留最新的）
  if (preloadedImages.size > maxCache) {
    const keys = Array.from(preloadedImages.keys());
    for (let i = 0; i < keys.length - maxCache; i++) {
      preloadedImages.delete(keys[i]);
    }
  }
  
  // 计算需要预加载的数量（保持缓存充足）
  const currentUrl = wallpaperState.current ? buildBingUrl(wallpaperState.current.id, quality) : null;
  const needed = count - preloadedImages.size;
  
  // 预加载随机壁纸
  let attempts = 0;
  while (preloadedImages.size < count && attempts < count * 3) {
    attempts++;
    const randomIndex = Math.floor(Math.random() * history.length);
    const wp = history[randomIndex];
    const imgUrl = buildBingUrl(wp.id, quality);
    
    // 跳过当前壁纸和已缓存的
    if (imgUrl === currentUrl || preloadedImages.has(imgUrl)) continue;
    
    const img = new Image();
    img.onerror = () => { img.error = true; };
    img.src = imgUrl;
    img.wpData = wp; // 存储壁纸数据，方便后续使用
    preloadedImages.set(imgUrl, img);
  }
}

/**
 * 更新壁纸信息显示
 */
function updateWallpaperInfo(wp) {
  const titleEl = document.getElementById('wallpaperTitle');
  const copyrightEl = document.getElementById('wallpaperCopyright');
  const dateEl = document.getElementById('wallpaperDate');
  
  if (!wp) return;
  
  if (titleEl) titleEl.textContent = wp.desc || '';
  if (copyrightEl) copyrightEl.textContent = wp.copyright || '';
  
  // 日期显示逻辑：只有近期壁纸（来自 API 的最近8天）才显示日期
  // 本地历史表的壁纸（几年前的）不显示日期
  if (dateEl) {
    // 使用本地日期构造，避免 UTC vs 本地时区偏差导致当天壁纸日期不显示
    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const [y1, m1, d1] = todayStr.split('-').map(Number);
    const [y2, m2, d2] = (wp.date || '').split('-').map(Number);
    const todayMs = new Date(y1, m1 - 1, d1).getTime();
    const wpMs = new Date(y2, m2 - 1, d2).getTime();
    const daysDiff = Math.round((todayMs - wpMs) / (1000 * 60 * 60 * 24));
    
    // 如果是8天内的壁纸（API 返回的范围），显示日期
    if (daysDiff <= 8 && daysDiff >= 0) {
      dateEl.textContent = wp.date || '';
      dateEl.style.display = '';
    } else {
      // 历史壁纸不显示日期
      dateEl.textContent = '';
      dateEl.style.display = 'none';
    }
  }
}

/**
 * 初始化壁纸信息卡片点击事件
 */
function initWallpaperInfoClick() {
  const infoPanel = document.getElementById('wallpaperInfo');
  const searchLink = document.getElementById('wallpaperSearchLink');
  if (!infoPanel) return;
  
  // 搜索链接点击（阻止冒泡）
  if (searchLink) {
    searchLink.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      searchCurrentWallpaper();
    });
  }
  
  // 整个卡片点击 - 需要排除拖拽操作
  let cardClickStartTime = 0;
  let cardClickStartX = 0;
  
  infoPanel.addEventListener('mousedown', (e) => {
    cardClickStartTime = Date.now();
    cardClickStartX = e.clientX;
  });
  
  infoPanel.addEventListener('click', (e) => {
    // 检查是否在拖拽区域（左侧30px）
    const rect = infoPanel.getBoundingClientRect();
    const isInDragZone = cardClickStartX - rect.left < 30;
    
    // 如果在拖拽区域，或按下时间超过200ms（拖拽），则不触发搜索
    if (isInDragZone || Date.now() - cardClickStartTime > 200) {
      return;
    }
    searchCurrentWallpaper();
  });
  
  // 初始化自动隐藏功能
  initWallpaperInfoAutoHide();
}

/**
 * 壁纸信息卡片自动隐藏功能
 * 
 * 逻辑：壁纸变化时展示，未变化时不展示
 * - 开关关闭：卡片始终展开
 * - 开关开启 + 壁纸变了：展开卡片几秒后隐藏，记录当前壁纸ID
 * - 开关开启 + 壁纸没变：直接隐藏（无动画）
 */
let autoHideController = null;

function initWallpaperInfoAutoHide() {
  const wrapper = document.getElementById('wallpaperInfoWrapper');
  const dot = document.getElementById('wallpaperInfoDot');
  const infoCard = document.getElementById('wallpaperInfo');
  const autoHideSwitch = document.getElementById('autoHideInfoSwitch');
  
  if (!wrapper || !dot || !infoCard) return;
  
  let collapseTimer = null;
  let isExpanded = false;  // 初始为隐藏状态
  let isEnabled = wallpaperState.settings.autoHideInfo || false;
  
  const AUTO_HIDE_DELAY = 5000;
  const LEAVE_DELAY = 3000;
  const MAX_DISTANCE = 500;   // 最大感应距离
  const TRIGGER_DISTANCE = 80; // 触发展开的距离
  
  // ====== 拖动相关状态 ======
  let isDragging = false;
  let dragStartY = 0;
  let dragStartTop = 0;
  
  // 恢复保存的位置
  function restoreSavedPosition() {
    const savedY = wallpaperState.settings.infoPositionY;
    if (savedY !== null && savedY !== undefined) {
      wrapper.style.setProperty('--info-position-y', `${savedY}px`);
      wrapper.classList.add('custom-position');
    }
  }
  
  // 保存位置
  async function savePosition(y) {
    wallpaperState.settings.infoPositionY = y;
    await saveWallpaperSettings();
  }
  
  // 获取当前 top 值
  function getCurrentTop() {
    const rect = wrapper.getBoundingClientRect();
    return rect.top;
  }
  
  // 开始拖动
  function startDrag(e) {
    // 阻止文本选择
    e.preventDefault();
    isDragging = true;
    dragStartY = e.clientY;
    dragStartTop = getCurrentTop();
    wrapper.classList.add('dragging');
    document.body.style.userSelect = 'none';
  }
  
  // 拖动中
  function onDrag(e) {
    if (!isDragging) return;
    
    const deltaY = e.clientY - dragStartY;
    let newTop = dragStartTop + deltaY;
    
    // 获取当前元素实际高度（展开时是卡片高度，收起时是圆点高度）
    const wrapperRect = wrapper.getBoundingClientRect();
    const elementHeight = wrapperRect.height || 60;
    
    // 限制范围：不能超出屏幕，考虑元素实际高度
    const minTop = 10;
    const maxTop = window.innerHeight - elementHeight - 10;
    newTop = Math.max(minTop, Math.min(maxTop, newTop));
    
    wrapper.style.setProperty('--info-position-y', `${newTop}px`);
    wrapper.classList.add('custom-position');
  }
  
  // 结束拖动
  function endDrag() {
    if (!isDragging) return;
    isDragging = false;
    wrapper.classList.remove('dragging');
    document.body.style.userSelect = '';
    
    // 保存位置
    const finalTop = getCurrentTop();
    savePosition(finalTop);
  }
  
  // 绑定拖动事件 - 圆点和卡片都可以拖
  dot.addEventListener('mousedown', startDrag);
  infoCard.addEventListener('mousedown', (e) => {
    // 只有在卡片左侧 30px 区域才能拖动
    const rect = infoCard.getBoundingClientRect();
    if (e.clientX - rect.left < 30) {
      startDrag(e);
    }
  });
  
  // 手柄区域 hover 检测
  infoCard.addEventListener('mousemove', (e) => {
    const rect = infoCard.getBoundingClientRect();
    if (e.clientX - rect.left < 30) {
      infoCard.classList.add('drag-handle-hover');
    } else {
      infoCard.classList.remove('drag-handle-hover');
    }
  });
  
  infoCard.addEventListener('mouseleave', () => {
    infoCard.classList.remove('drag-handle-hover');
  });
  
  document.addEventListener('mousemove', onDrag);
  document.addEventListener('mouseup', endDrag);
  
  // 恢复保存的位置
  restoreSavedPosition();
  
  // 窗口大小变化时检查并调整位置
  window.addEventListener('resize', () => {
    const currentTop = getCurrentTop();
    const wrapperRect = wrapper.getBoundingClientRect();
    const elementHeight = wrapperRect.height || 60;
    
    const minTop = 10;
    const maxTop = window.innerHeight - elementHeight - 10;
    
    // 如果当前位置超出范围，调整到合适位置
    if (currentTop > maxTop) {
      const newTop = Math.max(minTop, maxTop);
      wrapper.style.setProperty('--info-position-y', `${newTop}px`);
      wrapper.classList.add('custom-position');
      savePosition(newTop);
    }
  });
  
  // ====== 原有的自动隐藏逻辑 ======
  
  function getDotCenter() {
    const rect = wrapper.getBoundingClientRect();
    const dotSize = parseFloat(getComputedStyle(dot).getPropertyValue('--dot-size')) || 30;
    return { x: rect.left + dotSize / 2, y: rect.top + dotSize / 2 };
  }
  
  function getDistance(mouseX, mouseY) {
    const center = getDotCenter();
    return Math.sqrt((mouseX - center.x) ** 2 + (mouseY - center.y) ** 2);
  }
  
  // 收起卡片（带动画）
  function collapse() {
    if (!isExpanded || !isEnabled) return;
    isExpanded = false;
    wrapper.classList.remove('expanded');
    wrapper.classList.add('collapsed');
  }
  
  // 直接设置为隐藏状态（无动画）
  function collapseInstant() {
    isExpanded = false;
    wrapper.classList.add('no-transition');
    wrapper.classList.remove('expanded');
    wrapper.classList.add('collapsed');
    void wrapper.offsetHeight;
    wrapper.classList.remove('no-transition');
  }
  
  // 展开卡片
  function expand() {
    isExpanded = true;
    wrapper.classList.remove('collapsed');
    wrapper.classList.add('expanded');
    clearTimeout(collapseTimer);
    // 重置圆点样式
    dot.style.setProperty('--dot-size', '30px');
    dot.style.setProperty('--dot-opacity', '0.25');
    dot.style.setProperty('--dot-glow', '0px');
    
    // 展开后检查卡片是否超出屏幕，如果超出则调整位置
    requestAnimationFrame(() => {
      const cardRect = infoCard.getBoundingClientRect();
      const screenBottom = window.innerHeight - 10;
      
      if (cardRect.bottom > screenBottom) {
        // 卡片超出屏幕底部，向上调整
        const overflow = cardRect.bottom - screenBottom;
        const currentTop = getCurrentTop();
        const newTop = Math.max(10, currentTop - overflow);
        
        wrapper.style.setProperty('--info-position-y', `${newTop}px`);
        wrapper.classList.add('custom-position');
        // 保存调整后的位置
        savePosition(newTop);
      }
    });
  }
  
  // 连续更新圆点大小和透明度
  function updateDotContinuous(distance) {
    if (distance >= MAX_DISTANCE) {
      // 超出范围，恢复默认
      dot.style.setProperty('--dot-size', '30px');
      dot.style.setProperty('--dot-opacity', '0.25');
      dot.style.setProperty('--dot-glow', '0px');
      return;
    }
    
    // 计算 0-1 的比例（距离越近越大）
    const ratio = 1 - (distance / MAX_DISTANCE);
    
    // 大小：30px -> 55px
    const size = 30 + 25 * ratio;
    // 透明度：0.25 -> 0.65
    const opacity = 0.25 + 0.4 * ratio;
    // 光晕：0px -> 15px
    const glow = 15 * ratio;
    
    dot.style.setProperty('--dot-size', `${size}px`);
    dot.style.setProperty('--dot-opacity', opacity.toFixed(2));
    dot.style.setProperty('--dot-glow', `${glow}px`);
  }
  
  function startCollapseTimer(delay = LEAVE_DELAY) {
    if (!isEnabled) return;
    clearTimeout(collapseTimer);
    collapseTimer = setTimeout(collapse, delay);
  }
  
  // 壁纸切换时调用（核心逻辑）
  // 新逻辑：壁纸变了就展示，没变就不展示
  function onWallpaperChange() {
    const currentId = wallpaperState.current?.id;
    const lastShownId = wallpaperState.settings.lastShownWallpaperId;
    
    if (!isEnabled) {
      // 开关关闭，始终展开
      expand();
      return;
    }
    
    // 壁纸是否变化？
    if (currentId && currentId === lastShownId) {
      // 壁纸没变，直接隐藏（无动画）
      clearTimeout(collapseTimer);
      collapseInstant();
    } else {
      // 壁纸变了：展示并记录
      if (currentId) {
        wallpaperState.settings.lastShownWallpaperId = currentId;
        saveWallpaperSettings();
      }
      expand();
      startCollapseTimer(AUTO_HIDE_DELAY);
    }
  }
  
  // 启用自动隐藏
  async function enable() {
    isEnabled = true;
    // 清除上次记录，让当前壁纸重新展示一次
    wallpaperState.settings.lastShownWallpaperId = null;
    await saveWallpaperSettings();
    onWallpaperChange();
  }
  
  // 禁用自动隐藏
  function disable() {
    isEnabled = false;
    clearTimeout(collapseTimer);
    expand();
  }
  
  autoHideController = { onWallpaperChange, enable, disable };
  
  // 初始化开关状态
  if (autoHideSwitch) {
    autoHideSwitch.checked = isEnabled;
    autoHideSwitch.addEventListener('change', async () => {
      wallpaperState.settings.autoHideInfo = autoHideSwitch.checked;
      await saveWallpaperSettings();
      if (autoHideSwitch.checked) {
        await enable();
      } else {
        disable();
      }
    });
  }
  
  // 初始状态：不在这里处理展示逻辑！
  // 展示逻辑完全由 displayWallpaper -> onWallpaperChange() 驱动
  // 如果开关关闭，先设置为展开（等待 onWallpaperChange 调用）
  if (!isEnabled) {
    wrapper.classList.add('expanded');
    isExpanded = true;
  }
  // 如果开关开启，保持默认隐藏状态，等 onWallpaperChange 决定
  
  // 鼠标悬停取消收起
  infoCard.addEventListener('mouseenter', () => {
    if (!isEnabled) return;
    clearTimeout(collapseTimer);
  });
  
  infoCard.addEventListener('mouseleave', () => {
    if (!isEnabled) return;
    startCollapseTimer(LEAVE_DELAY);
  });
  
  // 距离感应 - 连续变化版本
  document.addEventListener('mousemove', (e) => {
    // 拖动时不处理距离感应
    if (isDragging) return;
    if (!document.body.classList.contains('wallpaper-mode')) return;
    if (!isEnabled || isExpanded) return;
    
    const distance = getDistance(e.clientX, e.clientY);
    
    // 连续更新圆点样式
    updateDotContinuous(distance);
    
    // 靠近到触发距离时展开
    if (distance < TRIGGER_DISTANCE) {
      expand();
      startCollapseTimer(LEAVE_DELAY);
    }
  });
  
  // 点击圆点展开（排除拖动）
  let clickStartTime = 0;
  dot.addEventListener('mousedown', () => {
    clickStartTime = Date.now();
  });
  dot.addEventListener('click', () => {
    // 如果按下时间超过200ms，认为是拖动，不触发点击
    if (Date.now() - clickStartTime > 200) return;
    expand();
    startCollapseTimer(LEAVE_DELAY);
  });
  
  // 点击卡片外部任意区域立即收起
  document.addEventListener('click', (e) => {
    if (!isEnabled || !isExpanded) return;
    
    // 检查点击是否在卡片或圆点内部
    const isInsideCard = infoCard.contains(e.target);
    const isInsideDot = dot.contains(e.target);
    
    // 如果点击在外部，立即收起
    if (!isInsideCard && !isInsideDot) {
      clearTimeout(collapseTimer);
      collapse();
    }
  });
}

/**
 * 搜索当前壁纸
 */
function searchCurrentWallpaper() {
  const wp = wallpaperState.current;
  if (!wp || !wp.desc) return;
  
  // 使用壁纸描述作为搜索关键词
  const searchQuery = encodeURIComponent(wp.desc);
  const searchUrl = `https://www.bing.com/search?q=${searchQuery}`;
  
  // 后台打开新标签页
  if (chrome?.tabs?.create) {
    chrome.tabs.create({ url: searchUrl, active: false });
  } else {
    // 降级处理：普通新标签页打开
    window.open(searchUrl, '_blank');
  }
}

/**
 * 更新壁纸状态（设置面板和按钮）
 */
function updateWallpaperStatus() {
  const favoriteBtn = document.getElementById('wpFavorite');
  const favoriteText = document.getElementById('wpFavoriteText');
  const favoriteGroup = document.getElementById('wpFavoriteGroup');
  const setWallpaperBtn = document.getElementById('wpSetWallpaper');
  const setWallpaperText = document.getElementById('wpSetWallpaperText');
  
  const wp = wallpaperState.current;
  
  // 对勾图标 SVG
  const checkIconSvg = '<svg viewBox="0 0 24 24" class="wp-icon wp-check"><path fill="currentColor" d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>';
  // 心形图标（空心和实心）
  const heartOutlineSvg = '<svg viewBox="0 0 24 24" class="wp-icon wp-heart"><path fill="currentColor" d="M16.5 3c-1.74 0-3.41.81-4.5 2.09C10.91 3.81 9.24 3 7.5 3 4.42 3 2 5.42 2 8.5c0 3.78 3.4 6.86 8.55 11.54L12 21.35l1.45-1.32C18.6 15.36 22 12.28 22 8.5 22 5.42 19.58 3 16.5 3zm-4.4 15.55l-.1.1-.1-.1C7.14 14.24 4 11.39 4 8.5 4 6.5 5.5 5 7.5 5c1.54 0 3.04.99 3.57 2.36h1.87C13.46 5.99 14.96 5 16.5 5c2 0 3.5 1.5 3.5 3.5 0 2.89-3.14 5.74-7.9 10.05z"/></svg>';
  const heartFilledSvg = '<svg viewBox="0 0 24 24" class="wp-icon wp-heart wp-heart-filled"><path fill="currentColor" d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>';
  const imageIconSvg = '<svg viewBox="0 0 24 24" class="wp-icon"><path fill="currentColor" d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/></svg>';
  
  // 更新收藏按钮状态（心形图标）
  if (wp && favoriteBtn) {
    const isFavorited = wallpaperState.favorites.includes(wp.date);
    favoriteBtn.classList.toggle('active', isFavorited);
    // 更新按钮组状态（控制「管理」按钮显示）
    favoriteGroup?.classList.toggle('active', isFavorited);
    // 切换图标（空心/实心心形）
    const iconContainer = favoriteBtn.querySelector('.wp-icon');
    if (iconContainer) {
      iconContainer.outerHTML = isFavorited ? heartFilledSvg : heartOutlineSvg;
    }
    // 切换文字
    if (favoriteText) {
      favoriteText.textContent = isFavorited ? '已收藏壁纸' : '收藏壁纸';
    }
  }
  
  // 更新"锁定壁纸"按钮状态
  // 简化判断：只看 pinnedDate 是否匹配当前壁纸
  if (wp && setWallpaperBtn) {
    const isPinned = wallpaperState.settings.pinnedDate === wp.date;
    setWallpaperBtn.classList.toggle('active', isPinned);
    // 切换图标
    const iconContainer = setWallpaperBtn.querySelector('.wp-icon');
    if (iconContainer) {
      iconContainer.outerHTML = isPinned ? checkIconSvg : imageIconSvg;
    }
    // 切换文字
    if (setWallpaperText) {
      setWallpaperText.textContent = isPinned ? '已锁定壁纸' : '锁定壁纸';
    }
  }
}

/**
 * 隐藏壁纸 UI
 */
function hideWallpaperUI() {
  const wallpaperBg = document.getElementById('wallpaperBg');
  
  if (wallpaperBg) wallpaperBg.innerHTML = '';
}

/**
 * 初始化壁纸控制按钮
 */
function initWallpaperControls() {
  // 换一张（随机）- 进入预览状态
  document.getElementById('wpRandom')?.addEventListener('click', () => {
    randomWallpaper();
  });
  
  // ====== 锁定壁纸按钮 ======
  // 简化逻辑：pinnedDate 是锁定的唯一判断条件
  document.getElementById('wpSetWallpaper')?.addEventListener('click', async () => {
    const wp = wallpaperState.current;
    if (!wp) return;
    
    const { pinnedDate } = wallpaperState.settings;
    const setWallpaperBtn = document.getElementById('wpSetWallpaper');
    
    // 判断当前壁纸是否已被锁定（pinnedDate 匹配当前壁纸）
    if (pinnedDate === wp.date) {
      // 取消锁定 - 只需清除 pinnedDate
      wallpaperState.settings.pinnedDate = null;
      
      // 根据当前模式重新选择壁纸
      const newWp = selectWallpaper();
      if (newWp) displayWallpaper(newWp);
      
      await saveWallpaperSettings();
      updateWallpaperStatus();
      updateL2SourceSelector();
      
      showToast('已恢复自动轮播', setWallpaperBtn);
    } else {
      // 锁定壁纸 - 只需设置 pinnedDate
      // 【解耦设计】锁定与收藏完全独立
      wallpaperState.settings.pinnedDate = wp.date;
      // mode 保持不变，这样取消锁定后自动恢复原模式
      
      await saveWallpaperSettings();
      updateWallpaperStatus();
      updateL2SourceSelector();
      
      showToast('已锁定壁纸，自动更新已暂停', setWallpaperBtn);
    }
  });
  
  // ====== 收藏按钮（解耦后：与壁纸设置完全独立）======
  document.getElementById('wpFavorite')?.addEventListener('click', async () => {
    const wp = wallpaperState.current;
    if (!wp) return;
    
    const favoriteBtn = document.getElementById('wpFavorite');
    
    if (wallpaperState.favorites.includes(wp.date)) {
      // 自定义壁纸：取消收藏 = 删除壁纸
      if (isCustomWallpaper(wp)) {
        await deleteCustomWallpaper(wp.date);
        // 删除后回到当日壁纸
        const nextWp = selectWallpaper();
        if (nextWp) displayWallpaper(nextWp);
        return;
      }
      // 已收藏 → 取消收藏
      // 【解耦设计】移出收藏不影响当前壁纸显示（锁定是独立的）
      wallpaperState.favorites = wallpaperState.favorites.filter(d => d !== wp.date);
      await saveFavorites();
      updateFavoriteCount();
      updateWallpaperStatus();
      updateL2SourceSelector();
      
      // 如果当前是"轮播收藏"模式（未锁定）且收藏为空，自动切回每日模式
      const isLocked = !!wallpaperState.settings.pinnedDate;
      if (wallpaperState.settings.mode === 'collection' && 
          !isLocked &&
          wallpaperState.favorites.length === 0) {
        wallpaperState.settings.mode = 'daily';
        await saveWallpaperSettings();
        updateL2SourceSelector();
      }
    } else {
      // 未收藏 → 加入收藏
      wallpaperState.favorites.push(wp.date);
      await saveFavorites();
      updateFavoriteCount();
      updateWallpaperStatus();
      updateL2SourceSelector();
      
      // 显示 Toast
      showToast('已加入收藏', favoriteBtn);
    }
  });
  
  // ====== 「管理」按钮点击 - 打开壁纸库面板 ======
  document.getElementById('wpFavoriteManage')?.addEventListener('click', () => {
    showCollectionPanel();
  });
  
  // 设置按钮
  document.getElementById('wpSettingsBtn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    const panel = document.getElementById('settingsPanel');
    panel?.classList.toggle('visible');
    // 关闭收藏面板
    hideCollectionPanel();
  });
  
  // 关闭设置
  document.getElementById('settingsClose')?.addEventListener('click', () => {
    document.getElementById('settingsPanel')?.classList.remove('visible');
  });
  
  // 管理收藏按钮 - 打开收藏面板
  document.getElementById('manageCollectionBtn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    document.getElementById('settingsPanel')?.classList.remove('visible');
    showCollectionPanel();
  });
  
  // ECHO 插件设置按钮 - 打开插件设置页
  document.getElementById('echoSettingsBtn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    document.getElementById('settingsPanel')?.classList.remove('visible');
    // 打开插件设置页
    if (typeof chrome !== 'undefined' && chrome.runtime?.openOptionsPage) {
      chrome.runtime.openOptionsPage();
    } else {
      // 演示模式：提示
      alert('演示模式：将打开 ECHO 插件设置页');
    }
  });
  
  // 收藏面板 - 关闭按钮
  document.getElementById('collectionClose')?.addEventListener('click', () => {
    hideCollectionPanel();
  });
  
  // 收藏面板 - 播放模式切换
  // 注意：这些按钮仅在收藏模式下显示，用于切换轮播/锁定
  document.getElementById('playModeRandom')?.addEventListener('click', async () => {
    // 切换到轮播模式 = 清除锁定
    wallpaperState.settings.pinnedDate = null;
    setCollectionPlayMode('random');  // 更新 UI 状态
    await saveWallpaperSettings();
    updateWallpaperStatusText();
    
    // 重新选择壁纸（基于日期的稳定随机）
    if (wallpaperState.settings.mode === 'collection') {
      const wp = selectWallpaper();
      if (wp) displayWallpaper(wp);
    }
    
    // 刷新面板显示
    showCollectionPanel();
    updateL2SourceSelector();
  });
  
  document.getElementById('playModeFixed')?.addEventListener('click', async () => {
    // 切换到固定模式 = 设置锁定
    // 如果没有锁定的壁纸，自动选中最新收藏的那张
    if (!wallpaperState.settings.pinnedDate && wallpaperState.favorites.length > 0) {
      const latestFavorite = wallpaperState.favorites[wallpaperState.favorites.length - 1];
      wallpaperState.settings.pinnedDate = latestFavorite;
    }
    
    setCollectionPlayMode('fixed');  // 更新 UI 状态
    await saveWallpaperSettings();
    updateWallpaperStatusText();
    
    // 显示固定的壁纸
    if (wallpaperState.settings.pinnedDate) {
      const wp = wallpaperState.history.find(w => w.date === wallpaperState.settings.pinnedDate);
      if (wp) displayWallpaper(wp);
    }
    
    // 刷新面板显示
    showCollectionPanel();
    updateL2SourceSelector();
  });
  
  // 收藏面板背景遮罩点击关闭
  document.getElementById('collectionBackdrop')?.addEventListener('click', () => {
    hideCollectionPanel();
  });
  
  // 备份与恢复入口 - 打开设置页并定位
  document.getElementById('collectionBackupLink')?.addEventListener('click', (e) => {
    e.preventDefault();
    // 直接用 tabs.create 打开设置页并带上 hash
    const optionsUrl = chrome.runtime.getURL('options/options.html#backupSection');
    chrome.tabs.create({ url: optionsUrl });
  });
  
  // 点击外部关闭设置面板
  document.addEventListener('click', (e) => {
    const settingsPanel = document.getElementById('settingsPanel');
    const settingsBtn = document.getElementById('wpSettingsBtn');
    
    if (settingsPanel?.classList.contains('visible')) {
      if (!settingsPanel.contains(e.target) && !settingsBtn?.contains(e.target)) {
        settingsPanel.classList.remove('visible');
      }
    }
  });
  
  // 自定义壁纸上传
  document.getElementById('customWallpaperInput')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    try {
      const result = await uploadCustomWallpaper(file);
      if (result) {
        renderFavoritesGrid();
        showCollectionPanel();
      }
    } catch (err) {
      console.error('[ECHO NTP] 上传壁纸失败:', err);
    }
  });
}

/**
 * 显示 Toast 提示（跟随指定元素）
 */
function showToast(message, anchorElement) {
  // 移除已有的 toast/snackbar
  document.querySelector('.wp-toast')?.remove();
  document.querySelector('.wp-snackbar')?.remove();
  
  const toast = document.createElement('div');
  toast.className = 'wp-toast';
  toast.textContent = message;
  document.body.appendChild(toast);
  
  // 定位到按钮下方
  if (anchorElement) {
    const rect = anchorElement.getBoundingClientRect();
    toast.style.top = `${rect.bottom + 10}px`;
    toast.style.right = `${window.innerWidth - rect.right}px`;
  }
  
  // 显示动画
  requestAnimationFrame(() => {
    toast.classList.add('visible');
  });
  
  // 自动消失
  setTimeout(() => {
    toast.classList.remove('visible');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

/**
 * 显示 Snackbar 提示（带操作按钮）
 * @param {string} message - 提示消息
 * @param {string} actionText - 第一个按钮文字
 * @param {Function} actionCallback - 第一个按钮回调
 * @param {HTMLElement} anchorElement - 锚点元素（用于定位）
 * @param {string} [secondActionText] - 第二个按钮文字（可选）
 * @param {Function} [secondActionCallback] - 第二个按钮回调（可选）
 */
function showSnackbar(message, actionText, actionCallback, anchorElement, secondActionText, secondActionCallback) {
  // 移除已有的 toast/snackbar
  document.querySelector('.wp-toast')?.remove();
  document.querySelector('.wp-snackbar')?.remove();
  
  const snackbar = document.createElement('div');
  snackbar.className = 'wp-snackbar';
  
  const msgSpan = document.createElement('span');
  msgSpan.className = 'wp-snackbar-message';
  msgSpan.textContent = message;
  snackbar.appendChild(msgSpan);
  
  // 按钮容器
  const btnContainer = document.createElement('div');
  btnContainer.className = 'wp-snackbar-actions';
  
  if (actionText && actionCallback) {
    const actionBtn = document.createElement('button');
    actionBtn.className = 'wp-snackbar-action';
    actionBtn.textContent = actionText;
    actionBtn.addEventListener('click', () => {
      snackbar.classList.remove('visible');
      setTimeout(() => snackbar.remove(), 300);
      actionCallback();
    });
    btnContainer.appendChild(actionBtn);
  }
  
  // 第二个按钮（高亮样式）
  if (secondActionText && secondActionCallback) {
    const secondBtn = document.createElement('button');
    secondBtn.className = 'wp-snackbar-action wp-snackbar-action-primary';
    secondBtn.textContent = secondActionText;
    secondBtn.addEventListener('click', () => {
      snackbar.classList.remove('visible');
      setTimeout(() => snackbar.remove(), 300);
      secondActionCallback();
    });
    btnContainer.appendChild(secondBtn);
  }
  
  if (btnContainer.children.length > 0) {
    snackbar.appendChild(btnContainer);
  }
  
  document.body.appendChild(snackbar);
  
  // 定位到按钮下方
  if (anchorElement) {
    const rect = anchorElement.getBoundingClientRect();
    snackbar.style.top = `${rect.bottom + 10}px`;
    snackbar.style.right = `${window.innerWidth - rect.right}px`;
  }
  
  // 显示动画
  requestAnimationFrame(() => {
    snackbar.classList.add('visible');
  });
  
  // 自动消失（7秒，留更多时间给用户操作）
  setTimeout(() => {
    snackbar.classList.remove('visible');
    setTimeout(() => snackbar.remove(), 300);
  }, 7000);
}

/**
 * 随机选择壁纸（进入预览状态）- 优先使用预加载的图片
 */
function randomWallpaper() {
  const { history, preloadedImages, settings } = wallpaperState;
  
  if (history.length === 0) return;
  
  const quality = settings.quality;
  const currentUrl = wallpaperState.current ? buildBingUrl(wallpaperState.current.id, quality) : null;
  
  // 优先查找已预加载完成的壁纸（排除当前壁纸）
  for (const [url, img] of preloadedImages.entries()) {
    if (url !== currentUrl && img.complete && img.naturalWidth > 0 && !img.error) {
      const wp = img.wpData || history.find(w => buildBingUrl(w.id, quality) === url);
      if (wp) {
        // 从缓存中移除（已使用）
        preloadedImages.delete(url);
        
        // 进入预览状态
        wallpaperState.isPreview = true;
        wallpaperState.browseIndex = history.indexOf(wp);
        displayWallpaper(wp);
        updateWallpaperStatus();
        return;
      }
    }
  }
  
  // 没有可用的预加载，随机选择新的
  let wp;
  let attempts = 0;
  do {
    const randomIndex = Math.floor(Math.random() * history.length);
    wp = history[randomIndex];
    attempts++;
  } while (wp === wallpaperState.current && attempts < 10);
  
  // 进入预览状态
  wallpaperState.isPreview = true;
  wallpaperState.browseIndex = history.indexOf(wp);
  
  displayWallpaper(wp);
  updateWallpaperStatus();
}

/**
 * 更新收藏数量显示
 */
function updateFavoriteCount() {
  // 更新收藏面板中的收藏数描述
  const countDescEl = document.getElementById('collectionCountDesc');
  if (countDescEl) {
    countDescEl.textContent = `已收藏 ${wallpaperState.favorites.length} 张壁纸`;
  }
  
  // 更新主设置面板的状态显示
  updateWallpaperStatusText();
}

/**
 * 更新主设置面板的壁纸状态文字
 */
function updateWallpaperStatusText() {
  const statusModeEl = document.getElementById('wallpaperStatusMode');
  const statusTitleEl = document.getElementById('wallpaperStatusTitle');
  
  if (!statusModeEl || !statusTitleEl) return;
  
  const { mode, pinnedDate } = wallpaperState.settings;
  const currentWp = wallpaperState.current;
  
  // 优先判断锁定状态（pinnedDate 有值）
  if (pinnedDate) {
    const pinnedWp = wallpaperState.history.find(w => w.date === pinnedDate);
    statusModeEl.textContent = '已锁定';
    statusTitleEl.textContent = pinnedWp?.desc || '';
  } else if (mode === 'daily') {
    statusModeEl.textContent = '必应每日';
    statusTitleEl.textContent = currentWp?.desc || '';
  } else if (mode === 'collection') {
    // 轮播收藏模式（没有锁定）
    statusModeEl.textContent = `每日随机 · ${wallpaperState.favorites.length}张收藏`;
    statusTitleEl.textContent = currentWp?.desc || '';
  } else {
    statusModeEl.textContent = '已关闭';
    statusTitleEl.textContent = '';
  }
}

/**
 * 显示壁纸库面板（L3）
 */
function showCollectionPanel() {
  const panel = document.getElementById('collectionPanel');
  const backdrop = document.getElementById('collectionBackdrop');
  
  if (!panel) return;
  
  // 加载浏览历史
  loadViewHistory();
  
  // 更新 Tab 计数
  const tabFavoritesCount = document.getElementById('tabFavoritesCount');
  const tabHistoryCount = document.getElementById('tabHistoryCount');
  if (tabFavoritesCount) tabFavoritesCount.textContent = `(${wallpaperState.favorites.length})`;
  if (tabHistoryCount) tabHistoryCount.textContent = `(${wallpaperState.viewHistory.length})`;
  
  // 渲染当前活动的 Tab（默认为收藏）
  const activeTab = document.querySelector('.collection-tab.active')?.dataset.tab || 'favorites';
  if (activeTab === 'favorites') {
    renderFavoritesGrid();
  } else {
    renderHistoryGrid();
  }
  
  // 显示面板和遮罩
  backdrop?.classList.add('visible');
  panel.classList.add('visible');
}

/**
 * 隐藏收藏面板
 */
function hideCollectionPanel() {
  document.getElementById('collectionPanel')?.classList.remove('visible');
  document.getElementById('collectionBackdrop')?.classList.remove('visible');
}

/**
 * 设置收藏播放模式（仅用于 UI 显示）
 * 注意：核心锁定逻辑由 pinnedDate 控制，此函数仅更新 UI 状态
 */
function setCollectionPlayMode(mode) {
  wallpaperState.settings.collectionPlayMode = mode;
  
  // 更新收藏面板中的按钮状态
  document.getElementById('playModeRandom')?.classList.toggle('active', mode === 'random');
  document.getElementById('playModeFixed')?.classList.toggle('active', mode === 'fixed');
  
  // 更新收藏面板中的提示文字
  const hintText = document.getElementById('collectionHintText');
  if (hintText) {
    if (mode === 'random') {
      hintText.textContent = '每天从收藏中随机展示一张壁纸';
    } else {
      hintText.textContent = '点击下方壁纸将其设为固定壁纸';
    }
  }
}

/**
 * 初始化设置面板
 */
function initWallpaperSettings() {
  // 壁纸子设置的显示/隐藏
  const updateSubSettingsVisibility = () => {
    const subSettings = document.getElementById('wallpaperSubSettings');
    const isOn = wallpaperState.settings.mode !== 'off';
    if (subSettings) {
      subSettings.classList.toggle('hidden', !isOn);
    }
  };
  
  // 初始化时更新
  updateSubSettingsVisibility();
  updateFavoriteCount();
  updateWallpaperStatus();
  updateWallpaperStatusText();
  initBlankModeSwitch();
  updateBlankModeSettingsState();
  
  // ====== 极简模式开关 ======
  initMinimalModeSwitch();
  
  // ====== L2 新的壁纸来源选择器逻辑 ======
  initL2SourceSelector();
  initL2PlayModeButtons();
  initLockedStatusUnlock();
  
  // ====== L3 壁纸库 Tab 切换 ======
  initCollectionTabs();
  
  // 收藏面板中的壁纸来源选择（保留旧的 L3 逻辑兼容）
  document.querySelectorAll('input[name="collectionWallpaperSource"]').forEach(radio => {
    radio.addEventListener('change', async (e) => {
      const value = e.target.value;
      const collectionSettings = document.getElementById('collectionSettings');
      const collectionBody = document.getElementById('collectionBody');
      
      if (value === 'daily') {
        // 切换到必应每日模式
        // 注意：不清除 collectionPlayMode 和 pinnedDate，保留用户之前的收藏模式设置
        wallpaperState.settings.mode = 'daily';
        wallpaperState.settings.lastActiveMode = 'daily';
        wallpaperState.isPreview = false;
        wallpaperState.browseIndex = 0;
        
        // 隐藏收藏设置区域，显示遮罩
        // 隐藏播放模式选项，显示遮罩
        const playModeInline = document.getElementById('playModeInline');
        const sourceDivider = document.getElementById('sourceDivider');
        playModeInline?.classList.remove('visible');
        sourceDivider?.classList.remove('visible');
        collectionBody?.classList.add('disabled');
        
        const todayWp = wallpaperState.history[0];
        if (todayWp) displayWallpaper(todayWp);
        
        await saveWallpaperSettings();
        updateWallpaperStatusText();
        updateL2SourceSelector();
      } else if (value === 'collection') {
        // 切换到收藏模式
        if (wallpaperState.favorites.length === 0) {
          // 没有收藏，不允许切换
          const dailyRadio = document.querySelector('input[name="collectionWallpaperSource"][value="daily"]');
          if (dailyRadio) dailyRadio.checked = true;
          showToast('请先收藏一些壁纸', e.target);
          return;
        }
        
        wallpaperState.settings.mode = 'collection';
        wallpaperState.settings.lastActiveMode = 'collection';
        wallpaperState.isPreview = false;
        
        // 简化：pinnedDate 有值就是锁定状态，无需检查 collectionPlayMode
        // 如果锁定的壁纸不在收藏中（被删除了），清除锁定
        const pinnedDate = wallpaperState.settings.pinnedDate;
        if (pinnedDate && !wallpaperState.history.find(w => w.date === pinnedDate)) {
          wallpaperState.settings.pinnedDate = null;
        }
        
        // 显示播放模式选项，移除遮罩
        const playModeInline = document.getElementById('playModeInline');
        const sourceDivider = document.getElementById('sourceDivider');
        playModeInline?.classList.add('visible');
        sourceDivider?.classList.add('visible');
        collectionBody?.classList.remove('disabled');
        
        // 根据当前状态选择壁纸
        const wp = selectWallpaper();
        if (wp) displayWallpaper(wp);
        
        await saveWallpaperSettings();
        updateWallpaperStatusText();
        updateL2SourceSelector();
        
        // 刷新面板以更新 UI 状态
        showCollectionPanel();
      }
    });
  });
}

/**
 * 初始化 L2 壁纸来源选择器
 */
function initL2SourceSelector() {
  const sourceDailyRadio = document.getElementById('sourceDaily');
  const sourceCollectionRadio = document.getElementById('sourceCollection');
  
  // 根据当前状态初始化选中状态
  updateL2SourceSelector();
  
  // 必应每日壁纸选择
  sourceDailyRadio?.addEventListener('change', async (e) => {
    if (!e.target.checked) return;
    
    wallpaperState.settings.mode = 'daily';
    wallpaperState.settings.lastActiveMode = 'daily';
    wallpaperState.isPreview = false;
    wallpaperState.browseIndex = 0;
    
    const todayWp = wallpaperState.history[0];
    if (todayWp) displayWallpaper(todayWp);
    
    await saveWallpaperSettings();
    updateWallpaperStatusText();
    updateL2SourceSelector();
  });
  
  // 我的壁纸库选择
  sourceCollectionRadio?.addEventListener('change', async (e) => {
    if (!e.target.checked) return;
    
    if (wallpaperState.favorites.length === 0) {
      // 没有收藏，不允许切换
      sourceDailyRadio.checked = true;
      sourceCollectionRadio.checked = false;
      showToast('请先收藏一些壁纸', document.getElementById('sourceCollectionCard'));
      return;
    }
    
    wallpaperState.settings.mode = 'collection';
    wallpaperState.settings.lastActiveMode = 'collection';
    wallpaperState.isPreview = false;
    
    // 简化：pinnedDate 有值就是锁定状态，无需额外处理
    // 如果锁定的壁纸不存在，selectWallpaper 会自动清除
    
    // 根据当前状态选择壁纸
    const wp = selectWallpaper();
    if (wp) displayWallpaper(wp);
    
    await saveWallpaperSettings();
    updateWallpaperStatusText();
    updateL2SourceSelector();
  });
}

/**
 * 更新 L2 壁纸来源选择器状态
 */
function updateL2SourceSelector() {
  const mode = wallpaperState.settings.mode;
  const pinnedDate = wallpaperState.settings.pinnedDate;
  const sourceDailyRadio = document.getElementById('sourceDaily');
  const sourceCollectionRadio = document.getElementById('sourceCollection');
  const sourceDailyCurrent = document.getElementById('sourceDailyCurrent');
  const sourceCollectionCount = document.getElementById('sourceCollectionCount');
  const manageCollectionCount = document.getElementById('manageCollectionCount');
  const playModeSelector = document.getElementById('playModeSelector');
  const lockedStatusCard = document.getElementById('lockedStatusCard');
  const lockedStatusTitle = document.getElementById('lockedStatusTitle');
  const wallpaperSubSettings = document.getElementById('wallpaperSubSettings');
  
  // 判断是否处于锁定状态（唯一条件：pinnedDate 有值）
  const isLocked = !!pinnedDate;
  
  // 锁定状态时，上方选项置灰（添加 is-locked 类）
  if (wallpaperSubSettings) {
    wallpaperSubSettings.classList.toggle('is-locked', isLocked);
  }
  
  // 更新 radio 选中状态
  if (sourceDailyRadio) sourceDailyRadio.checked = (mode === 'daily');
  if (sourceCollectionRadio) sourceCollectionRadio.checked = (mode === 'collection');
  
  // 更新收藏数量显示
  const favCount = wallpaperState.favorites.length;
  if (sourceCollectionCount) sourceCollectionCount.textContent = `(${favCount}张)`;
  if (manageCollectionCount) manageCollectionCount.textContent = `(${favCount})`;
  
  // 更新必应每日当前壁纸信息（锁定时不显示）
  if (sourceDailyCurrent) {
    if (mode === 'daily' && wallpaperState.current && !isLocked) {
      sourceDailyCurrent.textContent = wallpaperState.current.desc || '';
      sourceDailyCurrent.classList.add('visible');
    } else {
      sourceDailyCurrent.classList.remove('visible');
    }
  }
  
  // 播放模式选择器：锁定时隐藏
  if (playModeSelector) {
    playModeSelector.classList.toggle('visible', mode === 'collection' && !isLocked);
  }
  
  // 锁定状态卡片显示
  if (lockedStatusCard) {
    if (isLocked) {
      const pinnedWp = wallpaperState.history.find(wp => wp.date === pinnedDate);
      if (lockedStatusTitle) {
        lockedStatusTitle.textContent = pinnedWp?.desc || pinnedDate;
      }
      lockedStatusCard.classList.add('visible');
    } else {
      lockedStatusCard.classList.remove('visible');
    }
  }
  
  // 更新播放模式按钮状态
  updateL2PlayModeButtons();
}

/**
 * 初始化 L2 播放模式按钮
 */
function initL2PlayModeButtons() {
  const randomBtn = document.getElementById('playModeRandomBtn');
  const fixedBtn = document.getElementById('playModeFixedBtn');
  
  randomBtn?.addEventListener('click', async () => {
    // 切换到轮播模式 = 清除锁定
    wallpaperState.settings.pinnedDate = null;
    await saveWallpaperSettings();
    
    // 如果当前是收藏模式，重新选择壁纸
    if (wallpaperState.settings.mode === 'collection') {
      const wp = selectWallpaper();
      if (wp) displayWallpaper(wp);
    }
    
    updateL2PlayModeButtons();
    updateL2SourceSelector();
    updateWallpaperStatusText();
  });
  
  fixedBtn?.addEventListener('click', async () => {
    // 切换到固定模式 = 设置锁定
    // 如果没有锁定的壁纸，自动选中最新收藏的那张
    if (!wallpaperState.settings.pinnedDate && wallpaperState.favorites.length > 0) {
      const latestFavorite = wallpaperState.favorites[wallpaperState.favorites.length - 1];
      wallpaperState.settings.pinnedDate = latestFavorite;
    }
    
    await saveWallpaperSettings();
    
    // 显示固定的壁纸
    if (wallpaperState.settings.pinnedDate) {
      const wp = wallpaperState.history.find(w => w.date === wallpaperState.settings.pinnedDate);
      if (wp) displayWallpaper(wp);
    }
    
    updateL2PlayModeButtons();
    updateL2SourceSelector();
    updateWallpaperStatusText();
  });
  
  // 初始化按钮状态
  updateL2PlayModeButtons();
}

/**
 * 初始化极简模式开关
 */
function initMinimalModeSwitch() {
  const toggle = document.getElementById('minimalModeSwitch');
  if (!toggle) return;
  
  // 初始化开关状态
  toggle.checked = wallpaperState.settings.minimalMode === true;
  
  // 应用初始状态
  if (toggle.checked) {
    document.body.classList.add('minimal-mode');
  }
  
  // 监听开关变化
  toggle.addEventListener('change', async () => {
    wallpaperState.settings.minimalMode = toggle.checked;
    
    if (toggle.checked) {
      document.body.classList.add('minimal-mode');
    } else {
      document.body.classList.remove('minimal-mode');
    }
    
    await saveWallpaperSettings();
  });
}

/**
 * 更新 L2 播放模式按钮状态
 */
function updateL2PlayModeButtons() {
  const currentMode = wallpaperState.settings.mode;
  const isLocked = !!wallpaperState.settings.pinnedDate;
  const randomBtn = document.getElementById('playModeRandomBtn');
  const fixedBtn = document.getElementById('playModeFixedBtn');
  
  // 只有在 collection 模式时才显示选中状态
  if (currentMode === 'collection') {
    randomBtn?.classList.toggle('active', !isLocked);
    fixedBtn?.classList.toggle('active', isLocked);
  } else {
    // 非 collection 模式时，移除所有选中状态
    randomBtn?.classList.remove('active');
    fixedBtn?.classList.remove('active');
  }
}

/**
 * 初始化"恢复轮播"按钮（解除锁定状态）
 */
function initLockedStatusUnlock() {
  const unlockBtn = document.getElementById('lockedStatusUnlock');
  if (!unlockBtn) return;
  
  unlockBtn.addEventListener('click', async () => {
    // 解除锁定状态 - 只需清除 pinnedDate
    wallpaperState.settings.pinnedDate = null;
    
    // 根据当前模式重新选择壁纸
    const wp = selectWallpaper();
    if (wp) displayWallpaper(wp);
    
    await saveWallpaperSettings();
    updateWallpaperStatus();
    updateWallpaperStatusText();
    updateL2SourceSelector();
    
    // 显示 Toast
    showToast('已解除锁定', unlockBtn);
  });
}

/**
 * 初始化 L3 壁纸库 Tab 切换
 */
function initCollectionTabs() {
  const tabFavorites = document.getElementById('tabFavorites');
  const tabHistory = document.getElementById('tabHistory');
  
  tabFavorites?.addEventListener('click', () => {
    setActiveCollectionTab('favorites');
  });
  
  tabHistory?.addEventListener('click', () => {
    setActiveCollectionTab('history');
  });
}

/**
 * 设置活动的壁纸库 Tab
 */
function setActiveCollectionTab(tab) {
  const tabFavorites = document.getElementById('tabFavorites');
  const tabHistory = document.getElementById('tabHistory');
  
  // 更新 Tab 样式
  tabFavorites?.classList.toggle('active', tab === 'favorites');
  tabHistory?.classList.toggle('active', tab === 'history');
  
  // 重新渲染内容
  if (tab === 'favorites') {
    renderFavoritesGrid();
  } else {
    renderHistoryGrid();
  }
}

/**
 * 渲染收藏网格
 */
function renderFavoritesGrid() {
  const emptyEl = document.getElementById('collectionEmpty');
  const gridEl = document.getElementById('collectionGrid');
  
  if (!gridEl) return;
  
  // 清空网格
  gridEl.innerHTML = '';
  
  const { favorites, history, settings } = wallpaperState;
  
  // 更新 Tab 计数
  const tabFavoritesCount = document.getElementById('tabFavoritesCount');
  if (tabFavoritesCount) tabFavoritesCount.textContent = `(${favorites.length})`;
  
  if (favorites.length === 0) {
    emptyEl?.classList.remove('hidden');
    gridEl.classList.add('hidden');
    // 上传按钮放在空提示区域内
    const existingUploadBtn = emptyEl?.querySelector('.empty-upload-btn');
    if (!existingUploadBtn && emptyEl) {
      const btn = document.createElement('button');
      btn.className = 'empty-upload-btn';
      btn.innerHTML = '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>上传壁纸';
      btn.addEventListener('click', () => {
        const input = document.getElementById('customWallpaperInput');
        if (input) { input.value = ''; input.click(); }
      });
      emptyEl.appendChild(btn);
    }
  } else {
    emptyEl?.classList.add('hidden');
    gridEl.classList.remove('hidden');
    
    // 首位插入上传卡片
    gridEl.appendChild(createUploadCard());
    
    // 渲染收藏的壁纸（倒序：新收藏的在前）
    const reversedFavorites = [...favorites].reverse();
    reversedFavorites.forEach(date => {
      const wp = history.find(w => w.date === date);
      if (!wp) return;
      
      // 跨设备同步时，自定义壁纸可能没有 IndexedDB 数据，静默跳过
      // （会在 createWallpaperGridItem 中通过缩略图加载失败来处理）
      
      // 简化：只用 pinnedDate 判断锁定状态
      const isPinned = settings.pinnedDate === date;
      
      const item = createWallpaperGridItem(wp, isPinned, true);
      gridEl.appendChild(item);
    });
  }
}

/**
 * 渲染历史足迹网格
 */
function renderHistoryGrid() {
  const emptyEl = document.getElementById('collectionEmpty');
  const gridEl = document.getElementById('collectionGrid');
  
  if (!gridEl) return;
  
  // 清空网格
  gridEl.innerHTML = '';
  
  const { viewHistory, history, favorites, settings } = wallpaperState;
  
  // 更新 Tab 计数
  const tabHistoryCount = document.getElementById('tabHistoryCount');
  if (tabHistoryCount) tabHistoryCount.textContent = `(${viewHistory.length})`;
  
  if (viewHistory.length === 0) {
    emptyEl?.classList.remove('hidden');
    gridEl.classList.add('hidden');
    // 更新空状态文案和图标
    const emptyIcon = emptyEl?.querySelector('.empty-icon');
    const emptyText = emptyEl?.querySelector('p:not(.empty-hint)');
    const emptyHint = emptyEl?.querySelector('.empty-hint');
    if (emptyIcon) emptyIcon.innerHTML = '<path fill="currentColor" d="M13 3c-4.97 0-9 4.03-9 9H1l3.89 3.89.07.14L9 12H6c0-3.87 3.13-7 7-7s7 3.13 7 7-3.13 7-7 7c-1.93 0-3.68-.79-4.94-2.06l-1.42 1.42C8.27 19.99 10.51 21 13 21c4.97 0 9-4.03 9-9s-4.03-9-9-9zm-1 5v5l4.28 2.54.72-1.21-3.5-2.08V8H12z"/>';
    if (emptyText) emptyText.textContent = '还没有浏览记录';
    if (emptyHint) emptyHint.textContent = '浏览过的壁纸会自动记录在这里';
  } else {
    emptyEl?.classList.add('hidden');
    gridEl.classList.remove('hidden');
    
    // 渲染历史记录（倒序：最近浏览的在前）
    const reversedHistory = [...viewHistory].reverse();
    reversedHistory.forEach(date => {
      const wp = history.find(w => w.date === date);
      if (!wp) return;
      
      const isFavorited = favorites.includes(date);
      // 简化：只用 pinnedDate 判断锁定状态
      const isPinned = settings.pinnedDate === date;
      
      const item = createWallpaperGridItem(wp, isPinned, isFavorited, true);
      gridEl.appendChild(item);
    });
  }
}

/**
 * 创建上传壁纸卡片（+）
 */
function createUploadCard() {
  const card = document.createElement('div');
  card.className = 'collection-upload-card';
  card.innerHTML = `
    <svg viewBox="0 0 24 24"><path fill="currentColor" d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
    <span>上传壁纸</span>
  `;
  card.addEventListener('click', () => {
    const input = document.getElementById('customWallpaperInput');
    if (input) {
      input.value = '';
      input.click();
    }
  });
  return card;
}

/**
 * 创建壁纸网格项
 * @param {Object} wp - 壁纸数据
 * @param {boolean} isPinned - 是否被锁定（显示「当前壁纸」标识）
 * @param {boolean} isFavorited - 是否已收藏（仅收藏 Tab 使用）
 * @param {boolean} isHistoryTab - 是否在历史 Tab 中
 */
function createWallpaperGridItem(wp, isPinned, isFavorited, isHistoryTab = false) {
  const item = document.createElement('div');
  item.className = 'collection-item' + (isPinned ? ' pinned' : '');
  
  const isCustom = isCustomWallpaper(wp);
  if (isCustom) item.classList.add('custom');
  
  // 历史 Tab：纯预览，不显示操作按钮
  // 收藏 Tab：显示删除按钮
  let actionButtons = '';
  if (!isHistoryTab) {
    // 收藏 Tab 中显示删除按钮
    actionButtons = `
      <button class="item-delete" data-date="${wp.date}" title="${isCustom ? '删除壁纸' : '移除收藏'}">
        <svg viewBox="0 0 24 24"><path fill="currentColor" d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
      </button>
    `;
  }
  
  // overlay 信息：自定义壁纸显示"本地上传"并常驻可见
  const overlayTitle = isCustom ? '本地上传' : (wp.desc || '');
  const overlayDate = isCustom ? '' : (wp.date || '');
  
  item.innerHTML = `
    <img alt="${overlayTitle}" loading="lazy">
    ${isPinned ? '<div class="pin-indicator">当前壁纸</div>' : ''}
    <div class="item-overlay">
      <span class="item-title">${overlayTitle}</span>
      ${overlayDate ? `<span class="item-date">${overlayDate}</span>` : ''}
    </div>
    ${actionButtons}
  `;
  
  // 设置图片来源
  const imgEl = item.querySelector('img');
  if (isCustom) {
    // 自定义壁纸：从 IndexedDB 读取缩略图
    const timestamp = wp.date.replace('custom:', '');
    const thumbKey = `custom_thumb:${timestamp}`;
    getCachedWallpaper(thumbKey).then(blob => {
      if (blob && imgEl) {
        imgEl.src = URL.createObjectURL(blob);
        imgEl.onload = () => {
          // 延迟释放，给浏览器渲染时间
          setTimeout(() => URL.revokeObjectURL(imgEl.src), 2000);
        };
      }
    });
  } else {
    imgEl.src = buildBingUrl(wp.id, '1080p');
  }
  
  // 点击预览壁纸（不改变锁定状态）
  item.addEventListener('click', async (e) => {
    if (e.target.closest('.item-delete') || e.target.closest('.item-favorite')) return;
    
    // 预览模式：只显示壁纸，不修改 pinnedDate
    wallpaperState.isPreview = true;
    wallpaperState.browseIndex = wallpaperState.history.findIndex(w => w.date === wp.date);
    
    displayWallpaper(wp);
    updateWallpaperStatus();
    
    // 关闭面板，让用户看到预览效果
    hideCollectionPanel();
  });
  
  // 删除按钮（收藏 Tab）
  item.querySelector('.item-delete')?.addEventListener('click', async (e) => {
    e.stopPropagation();
    const dateToRemove = e.currentTarget.dataset.date;
    
    // 自定义壁纸：同时删除 IndexedDB 中的 Blob 和缩略图
    if (isCustomDate(dateToRemove)) {
      await deleteCustomWallpaper(dateToRemove);
      renderFavoritesGrid();
      // 如果收藏全部删空且当前是轮播收藏模式（未锁定），切换回每日模式
      const isLocked = !!wallpaperState.settings.pinnedDate;
      if (wallpaperState.favorites.length === 0 && 
          wallpaperState.settings.mode === 'collection' &&
          !isLocked) {
        wallpaperState.settings.mode = 'daily';
        const todayWp = wallpaperState.history[0];
        if (todayWp) displayWallpaper(todayWp);
        await saveWallpaperSettings();
        updateL2SourceSelector();
      }
      return;
    }
    
    wallpaperState.favorites = wallpaperState.favorites.filter(d => d !== dateToRemove);
    
    await saveFavorites();
    updateFavoriteCount();
    updateWallpaperStatus();
    updateL2SourceSelector();
    renderFavoritesGrid();
    
    // 如果收藏全部删空且当前是轮播收藏模式（未锁定），切换回每日模式
    const isLocked = !!wallpaperState.settings.pinnedDate;
    if (wallpaperState.favorites.length === 0 && 
        wallpaperState.settings.mode === 'collection' &&
        !isLocked) {
      wallpaperState.settings.mode = 'daily';
      const todayWp = wallpaperState.history[0];
      if (todayWp) displayWallpaper(todayWp);
      await saveWallpaperSettings();
      updateL2SourceSelector();
    }
  });
  
  return item;
}

/**
 * 添加到浏览历史
 */
function addToViewHistory(date) {
  if (!date) return;
  
  // 移除已存在的（如果有），然后添加到末尾
  wallpaperState.viewHistory = wallpaperState.viewHistory.filter(d => d !== date);
  wallpaperState.viewHistory.push(date);
  
  // 限制最多保存 100 条
  const MAX_HISTORY = 100;
  if (wallpaperState.viewHistory.length > MAX_HISTORY) {
    wallpaperState.viewHistory = wallpaperState.viewHistory.slice(-MAX_HISTORY);
  }
  
  // 保存到 localStorage
  saveViewHistory();
}

/**
 * 保存浏览历史
 */
async function saveViewHistory() {
  try {
    localStorage.setItem('echo_ntp_view_history', JSON.stringify(wallpaperState.viewHistory));
  } catch (e) {
    console.warn('[ECHO NTP] 保存浏览历史失败:', e);
  }
}

/**
 * 加载浏览历史
 */
function loadViewHistory() {
  try {
    const saved = localStorage.getItem('echo_ntp_view_history');
    if (saved) {
      wallpaperState.viewHistory = JSON.parse(saved);
    }
  } catch (e) {
    console.warn('[ECHO NTP] 加载浏览历史失败:', e);
    wallpaperState.viewHistory = [];
  }
}

/**
 * 键盘快捷键
 */
function handleWallpaperKeyboard(e) {
  if (isBlankModeEnabled()) {
    if (e.key === 'Escape') {
      document.getElementById('settingsPanel')?.classList.remove('visible');
      hideCollectionPanel();
    }
    return;
  }

  // 只在壁纸模式下响应
  if (!document.body.classList.contains('wallpaper-mode')) return;
  
  // 忽略输入框
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  
  switch (e.key) {
    case 'r':
    case 'R':
      document.getElementById('wpRandom')?.click();
      break;
    case 'f':
    case 'F':
      document.getElementById('wpFavorite')?.click();
      break;
    case 'Escape':
      document.getElementById('settingsPanel')?.classList.remove('visible');
      hideCollectionPanel();
      break;
  }
}

/**
 * 加载壁纸设置
 */
async function loadWallpaperSettings() {
  try {
    const cachedBlankMode = localStorage.getItem(BLANK_MODE_CACHE_KEY);
    const hasCachedBlankMode = cachedBlankMode !== null;
    if (hasCachedBlankMode) {
      wallpaperState.settings.blankMode = cachedBlankMode === 'true';
    }

    // 本地设置（设备相关）
    const localStored = await chrome.storage.local.get([WALLPAPER_KEY]);
    // 同步收藏（跨设备）
    const syncStored = await chrome.storage.sync.get([WALLPAPER_FAVORITES_KEY]);
    
    if (localStored[WALLPAPER_KEY]) {
      Object.assign(wallpaperState.settings, localStored[WALLPAPER_KEY]);
    }

    if (hasCachedBlankMode) {
      wallpaperState.settings.blankMode = cachedBlankMode === 'true';
    }
    
    if (syncStored[WALLPAPER_FAVORITES_KEY]) {
      wallpaperState.favorites = syncStored[WALLPAPER_FAVORITES_KEY];
    }
    
    // 加载浏览历史（修复：防止初始 history 为空不仅无法显示，还会导致覆盖写导致丢失）
    loadViewHistory();
  } catch (error) {
    console.error('[ECHO NTP] 加载壁纸设置失败:', error);
  }
}

/**
 * 保存壁纸设置
 */
async function saveWallpaperSettings() {
  try {
    localStorage.setItem(BLANK_MODE_CACHE_KEY, wallpaperState.settings.blankMode ? 'true' : 'false');
    await chrome.storage.local.set({
      [WALLPAPER_KEY]: wallpaperState.settings
    });
  } catch (error) {
    console.error('[ECHO NTP] 保存壁纸设置失败:', error);
  }
}

/**
 * 保存收藏（使用 sync 存储实现跨设备同步）
 */
async function saveFavorites() {
  try {
    await chrome.storage.sync.set({
      [WALLPAPER_FAVORITES_KEY]: wallpaperState.favorites
    });
  } catch (error) {
    console.error('[ECHO NTP] 保存收藏失败:', error);
    // 如果 sync 失败（如超出配额），回退到 local
    if (error.message?.includes('QUOTA')) {
      console.warn('[ECHO NTP] 同步配额已满，保存到本地');
      await chrome.storage.local.set({
        [WALLPAPER_FAVORITES_KEY]: wallpaperState.favorites
      });
    }
  }
}

/**
 * 提取壁纸左上角区域的主色调，应用到信息卡片和圆点
 * 根据亮度自动切换深/浅色模式，并提取主色用于点缀
 */
function extractAndApplyWallpaperTheme(img) {
  const wrapper = document.getElementById('wallpaperInfoWrapper');
  if (!wrapper) return;
  
  // 创建 canvas 采样图片左上角区域
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  
  // 计算图片与视口的缩放比例
  const scaleX = img.naturalWidth / window.innerWidth;
  const scaleY = img.naturalHeight / window.innerHeight;
  
  // 采样左上角区域（大约卡片位置，200x150 像素区域）
  const sampleX = 20 * scaleX;
  const sampleY = 50 * scaleY;
  const sampleW = 300 * scaleX;
  const sampleH = 150 * scaleY;
  
  // 采样尺寸（缩小以提高性能）
  canvas.width = 60;
  canvas.height = 30;
  
  try {
    ctx.drawImage(img, sampleX, sampleY, sampleW, sampleH, 0, 0, 60, 30);
    const imageData = ctx.getImageData(0, 0, 60, 30);
    const data = imageData.data;
    
    // 计算平均颜色和亮度
    let totalR = 0, totalG = 0, totalB = 0;
    let totalBrightness = 0;
    const pixelCount = data.length / 4;
    
    // 用于提取主色的颜色桶
    const colorBuckets = {};
    
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      
      totalR += r;
      totalG += g;
      totalB += b;
      
      // 感知亮度
      const brightness = (0.299 * r + 0.587 * g + 0.114 * b);
      totalBrightness += brightness;
      
      // 量化颜色到桶（每32级一个桶）
      const bucketKey = `${Math.floor(r/32)},${Math.floor(g/32)},${Math.floor(b/32)}`;
      if (!colorBuckets[bucketKey]) {
        colorBuckets[bucketKey] = { count: 0, r: 0, g: 0, b: 0 };
      }
      colorBuckets[bucketKey].count++;
      colorBuckets[bucketKey].r += r;
      colorBuckets[bucketKey].g += g;
      colorBuckets[bucketKey].b += b;
    }
    
    const avgBrightness = totalBrightness / pixelCount;
    const avgR = Math.round(totalR / pixelCount);
    const avgG = Math.round(totalG / pixelCount);
    const avgB = Math.round(totalB / pixelCount);
    
    // 找出最主要的颜色桶
    let dominantBucket = null;
    let maxCount = 0;
    for (const key in colorBuckets) {
      if (colorBuckets[key].count > maxCount) {
        maxCount = colorBuckets[key].count;
        dominantBucket = colorBuckets[key];
      }
    }
    
    // 计算主色
    let accentR = avgR, accentG = avgG, accentB = avgB;
    if (dominantBucket && dominantBucket.count > 0) {
      accentR = Math.round(dominantBucket.r / dominantBucket.count);
      accentG = Math.round(dominantBucket.g / dominantBucket.count);
      accentB = Math.round(dominantBucket.b / dominantBucket.count);
    }
    
    // 应用 CSS 变量
    const root = document.documentElement;
    
    // 计算更鲜艳的主题色版本
    const maxChannel = Math.max(accentR, accentG, accentB);
    const boost = maxChannel > 0 ? 200 / maxChannel : 1;
    const vibrantR = Math.min(255, Math.round(accentR * boost * 0.8));
    const vibrantG = Math.min(255, Math.round(accentG * boost * 0.8));
    const vibrantB = Math.min(255, Math.round(accentB * boost * 0.8));
    
    root.style.setProperty('--info-accent', `rgb(${vibrantR}, ${vibrantG}, ${vibrantB})`);
    root.style.setProperty('--info-accent-glow', `rgba(${vibrantR}, ${vibrantG}, ${vibrantB}, 0.6)`);
    
    // 卡片背景：左侧带主题色，右侧正常深色
    const bgOpacity = avgBrightness > 140 ? 0.6 : 0.45;
    const accentOpacity = avgBrightness > 140 ? 0.25 : 0.2;
    root.style.setProperty('--info-bg-gradient', 
      `linear-gradient(to right, rgba(${vibrantR}, ${vibrantG}, ${vibrantB}, ${accentOpacity}) 0%, rgba(0, 0, 0, ${bgOpacity}) 40%, rgba(0, 0, 0, ${bgOpacity}) 100%)`);
    
    root.style.setProperty('--info-text', `rgba(255, 255, 255, 0.95)`);
    root.style.setProperty('--info-text-secondary', `rgba(255, 255, 255, 0.7)`);
    
    // 圆点使用主题色
    if (avgBrightness > 140) {
      // 亮壁纸：圆点用主题色（稍深），白色边框
      root.style.setProperty('--dot-bg-base', `rgba(${vibrantR}, ${vibrantG}, ${vibrantB}, 0.5)`);
      root.style.setProperty('--dot-border', `rgba(255, 255, 255, 0.6)`);
      root.style.setProperty('--dot-icon', `rgba(255, 255, 255, 0.85)`);
    } else {
      // 暗壁纸：圆点用主题色（稍亮），深色边框
      root.style.setProperty('--dot-bg-base', `rgba(${vibrantR}, ${vibrantG}, ${vibrantB}, 0.4)`);
      root.style.setProperty('--dot-border', `rgba(0, 0, 0, 0.3)`);
      root.style.setProperty('--dot-icon', `rgba(255, 255, 255, 0.8)`);
    }
    
    
  } catch (e) {
    console.warn('[ECHO NTP] 无法提取壁纸主题:', e);
    // 使用默认主题
  }
}

/**
 * 计算热搜区域对应的壁纸亮度，动态设置文字颜色
 * 这是核心的颜色自适应函数，根据壁纸背景亮度自动调整毛玻璃和文字颜色
 */
function calculateAndSetTextColor(img) {
  const trendingSection = document.getElementById('trendingSection');
  if (!trendingSection) return;
  
  // 获取热搜区域在视口中的位置
  const rect = trendingSection.getBoundingClientRect();
  
  // 创建 canvas 采样图片
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  
  // 计算图片与视口的缩放比例
  const scaleX = img.naturalWidth / window.innerWidth;
  const scaleY = img.naturalHeight / window.innerHeight;
  
  // 热搜区域对应的图片区域
  const sampleX = rect.left * scaleX;
  const sampleY = rect.top * scaleY;
  const sampleW = rect.width * scaleX;
  const sampleH = rect.height * scaleY;
  
  // 采样尺寸（缩小以提高性能）
  canvas.width = 50;
  canvas.height = 30;
  
  try {
    ctx.drawImage(img, sampleX, sampleY, sampleW, sampleH, 0, 0, 50, 30);
    const imageData = ctx.getImageData(0, 0, 50, 30);
    const data = imageData.data;
    
    // 计算平均亮度
    let totalBrightness = 0;
    const pixelCount = data.length / 4;
    
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      // 使用感知亮度公式
      const brightness = (0.299 * r + 0.587 * g + 0.114 * b);
      totalBrightness += brightness;
    }
    
    const avgBrightness = totalBrightness / pixelCount;
    
    // 移除之前的文字颜色类
    document.body.classList.remove('text-dark', 'text-light', 'text-gray');
    
    // 根据亮度选择文字颜色
    if (avgBrightness > 170) {
      // 亮背景：用深色文字
      document.body.classList.add('text-dark');
    } else if (avgBrightness < 85) {
      // 暗背景：用浅色文字
      document.body.classList.add('text-light');
    } else {
      // 中等亮度：用灰色文字
      document.body.classList.add('text-gray');
    }
  } catch (e) {
    console.warn('[ECHO NTP] 无法计算壁纸亮度:', e);
    // 默认使用深色文字
    document.body.classList.add('text-dark');
  }
}

// ============================================
// 热搜榜单功能
// ============================================

const CACHE_DURATION = 10 * 60 * 1000; // 10 分钟缓存
const MIN_TRENDING_ITEMS = 20; // 榜单最少需要 20 条数据才显示

// 热搜类别配置（百度热搜 API）
const TRENDING_CATEGORIES = [
  { tab: 'realtime',   name: '热搜',   icon: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>' },
  { tab: 'livelihood', name: '民生榜', icon: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/></svg>' },
  { tab: 'finance',    name: '财经榜', icon: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3.5 18.49l6-6.01 4 4L22 6.92l-1.41-1.41-7.09 7.97-4-4L2 16.99z"/></svg>' },
  { tab: 'sports',     name: '体育榜', icon: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 17.93c-3.94-.49-7-3.85-7-7.93s3.05-7.44 7-7.93v15.86zm2-15.86c1.03.13 2 .45 2.87.93H13v-.93zM13 7h5.24c.25.31.48.65.68 1H13V7zm0 3h6.74c.08.33.15.66.19 1H13v-1zm0 9.93V19h2.87c-.87.48-1.84.8-2.87.93zM18.24 17H13v-1h5.92c-.2.35-.43.69-.68 1zm1.5-3H13v-1h6.93c-.04.34-.11.67-.19 1z"/></svg>' },
  { tab: 'games',      name: '游戏榜', icon: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M21 6H3c-1.1 0-2 .9-2 2v8c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm-10 7H8v3H6v-3H3v-2h3V8h2v3h3v2zm4.5 2c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm4-3c-.83 0-1.5-.67-1.5-1.5S18.67 9 19.5 9s1.5.67 1.5 1.5-.67 1.5-1.5 1.5z"/></svg>' },
  { tab: 'movie',      name: '电影榜', icon: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M18 4l2 4h-3l-2-4h-2l2 4h-3l-2-4H8l2 4H7L5 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V4h-4z"/></svg>' },
  { tab: 'teleplay',   name: '剧集榜', icon: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M21 3H3c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h5v2h8v-2h5c1.1 0 1.99-.9 1.99-2L23 5c0-1.1-.9-2-2-2zm0 14H3V5h18v12z"/></svg>' },
  { tab: 'novel',      name: '小说榜', icon: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M18 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM6 4h5v8l-2.5-1.5L6 12V4z"/></svg>' },
  { tab: 'car',        name: '汽车榜', icon: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M18.92 6.01C18.72 5.42 18.16 5 17.5 5h-11c-.66 0-1.21.42-1.42 1.01L3 12v8c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h12v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-8l-2.08-5.99zM6.5 16c-.83 0-1.5-.67-1.5-1.5S5.67 13 6.5 13s1.5.67 1.5 1.5S7.33 16 6.5 16zm11 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zM5 11l1.5-4.5h11L19 11H5z"/></svg>' },
  { tab: 'drama',      name: '短剧榜', icon: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 3c-4.97 0-9 4.03-9 9v7c0 1.1.9 2 2 2h4v-8H5v-1c0-3.87 3.13-7 7-7s7 3.13 7 7v1h-4v8h4c1.1 0 2-.9 2-2v-7c0-4.97-4.03-9-9-9z"/></svg>' }
];

// 数据不足 20 条的分类索引集合，这些分类不显示、不留翻页 dot
const disabledCategories = new Set();

let currentCategoryIndex = 0;

/**
 * 初始化热搜开关
 */
async function initTrendingToggle() {
  const toggle = document.getElementById('trendingSwitch');
  const section = document.getElementById('trendingSection');
  
  if (!toggle || !section) return;
  
  // 初始化点击事件处理器（只注册一次）
  initTrendingClickHandler();
  
  // 从 storage 读取状态
  const stored = await chrome.storage.local.get(TRENDING_KEY);
  const enabled = stored[TRENDING_KEY] !== false; // 默认开启
  
  toggle.checked = enabled;
  // 同步 localStorage（供 blank-init.js 首帧读取，消除布局跳动）
  try { localStorage.setItem(TRENDING_KEY, String(enabled)); } catch (e) {}
  if (!enabled) {
    section.classList.add('hidden');
    document.body.classList.add('trending-hidden');
  } else {
    // 热榜开启时移除可能由 blank-init 预设的 class
    document.documentElement.classList.remove('trending-hidden');
    // 恢复用户上次选择的分类
    const categoryStored = await chrome.storage.local.get(TRENDING_CATEGORY_KEY);
    if (categoryStored[TRENDING_CATEGORY_KEY] !== undefined) {
      currentCategoryIndex = categoryStored[TRENDING_CATEGORY_KEY];
    }
    initTrendingDots();
    loadTrendingData();
  }
  
  // 监听开关变化
  toggle.addEventListener('change', async () => {
    const searchInput = document.getElementById('searchInput');
    const searchBox = document.querySelector('.search-box');
    
    // 添加过渡动画类
    document.body.classList.add('trending-transitioning');
    
    // 切换时保持搜索框的焦点样式
    if (searchBox) {
      searchBox.classList.add('search-focused');
    }
    
    if (toggle.checked) {
      section.classList.remove('hidden');
      document.body.classList.remove('trending-hidden');
      document.documentElement.classList.remove('trending-hidden');
      // 恢复用户上次选择的分类
      const categoryStored = await chrome.storage.local.get(TRENDING_CATEGORY_KEY);
      if (categoryStored[TRENDING_CATEGORY_KEY] !== undefined) {
        currentCategoryIndex = categoryStored[TRENDING_CATEGORY_KEY];
      }
      initTrendingDots();
      loadTrendingData();
    } else {
      section.classList.add('hidden');
      document.body.classList.add('trending-hidden');
    }
    await chrome.storage.local.set({ [TRENDING_KEY]: toggle.checked });
    try { localStorage.setItem(TRENDING_KEY, String(toggle.checked)); } catch (e) {}
    
    // 动画结束后移除过渡类和焦点样式类，并恢复实际焦点
    setTimeout(() => {
      document.body.classList.remove('trending-transitioning');
      if (searchBox) {
        searchBox.classList.remove('search-focused');
      }
      if (searchInput) {
        focusSearchInputIfAvailable();
      }
    }, 400); // 与 CSS transition 时长一致
  });
  
  // 监听滚轮事件切换类别
  section.addEventListener('wheel', handleTrendingWheel, { passive: false });
}

/**
 * 初始化/刷新类别圆点导航（排除数据不足的分类）
 */
function initTrendingDots() {
  const dotsContainer = document.getElementById('trendingDots');
  if (!dotsContainer) return;
  
  dotsContainer.innerHTML = TRENDING_CATEGORIES.map((cat, index) => {
    if (disabledCategories.has(index)) return '';
    return `<div class="trending-dot${index === currentCategoryIndex ? ' active' : ''}" 
          data-index="${index}" 
          title="${cat.name}"></div>`;
  }).join('');
  
  // 点击切换类别（根据目标索引确定滑动方向）
  dotsContainer.addEventListener('click', (e) => {
    const dot = e.target.closest('.trending-dot');
    if (dot) {
      const index = parseInt(dot.dataset.index, 10);
      if (index !== currentCategoryIndex) {
        // 点击右边的dot：内容从右侧进入；点击左边的dot：内容从左侧进入
        const direction = index > currentCategoryIndex ? 'right' : 'left';
        switchCategory(index, direction);
      }
    }
  });
}

/**
 * 更新圆点激活状态
 */
function updateDotsActiveState() {
  const dots = document.querySelectorAll('.trending-dot');
  dots.forEach(dot => {
    const index = parseInt(dot.dataset.index, 10);
    dot.classList.toggle('active', index === currentCategoryIndex);
  });
}

/**
 * 获取下一个可用的分类索引（跳过 disabled）
 */
function getNextValidCategoryIndex(fromIndex, direction) {
  const total = TRENDING_CATEGORIES.length;
  let index = fromIndex;
  for (let i = 0; i < total; i++) {
    index = direction === 'right'
      ? (index + 1) % total
      : (index - 1 + total) % total;
    if (!disabledCategories.has(index)) return index;
  }
  return fromIndex; // 全部 disabled 则不动
}

/**
 * 处理滚轮事件切换类别
 */
let wheelTimeout = null;
function handleTrendingWheel(e) {
  // 防抖处理
  if (wheelTimeout) return;
  
  const delta = e.deltaY;
  if (Math.abs(delta) < 10) return;
  
  e.preventDefault();
  
  wheelTimeout = setTimeout(() => {
    wheelTimeout = null;
  }, 300);
  
  if (delta > 0) {
    const nextIndex = getNextValidCategoryIndex(currentCategoryIndex, 'right');
    switchCategory(nextIndex, 'right');
  } else {
    const prevIndex = getNextValidCategoryIndex(currentCategoryIndex, 'left');
    switchCategory(prevIndex, 'left');
  }
}

/**
 * 切换类别（带左右滑动动画）
 * @param {number} index - 目标分类索引
 * @param {string} direction - 滑动方向 'left' 或 'right'
 *   - 'right': 切换到下一个分类（旧内容向左飞出，新内容从右侧进入）
 *   - 'left': 切换到上一个分类（旧内容向右飞出，新内容从左侧进入）
 */
let isSwitching = false; // 防止快速切换导致的数据错乱
function switchCategory(index, direction = 'right') {
  // 如果正在切换中，忽略新的切换请求
  if (isSwitching) return;
  isSwitching = true;
  
  const grid = document.getElementById('trendingList');
  const targetIndex = index; // 保存目标索引，防止闭包问题
  
  // 第一步：旧内容飞出
  // direction='right' 表示去下一个，旧内容应该向左飞出
  // direction='left' 表示去上一个，旧内容应该向右飞出
  if (grid) {
    grid.classList.add(direction === 'right' ? 'slide-out-left' : 'slide-out-right');
  }
  
  // 等待飞出动画完成后切换数据
  setTimeout(async () => {
    currentCategoryIndex = targetIndex;
    updateDotsActiveState();
    
    // 加载数据（优先使用缓存）
    await loadTrendingData(false, targetIndex);
    
    // 保存用户选择的分类
    chrome.storage.local.set({ [TRENDING_CATEGORY_KEY]: targetIndex });
    
    if (grid) {
      // 第二步：移除飞出类，设置新内容的起始位置
      grid.classList.remove('slide-out-left', 'slide-out-right');
      // 新内容从相反方向进入
      grid.classList.add(direction === 'right' ? 'slide-in-from-right' : 'slide-in-from-left');
      
      // 强制重绘，确保起始位置生效
      grid.offsetHeight;
      
      // 第三步：触发滑入动画
      grid.classList.remove('slide-in-from-right', 'slide-in-from-left');
      grid.classList.add('slide-in');
      
      setTimeout(() => {
        grid.classList.remove('slide-in');
        isSwitching = false;
      }, 120);
    } else {
      isSwitching = false;
    }
  }, 120);
}

/**
 * 标记分类为不可用（数据不足 20 条），刷新 dots 并自动跳到下一个有效分类
 */
function markCategoryDisabled(categoryIndex) {
  disabledCategories.add(categoryIndex);
  initTrendingDots();
  
  // 如果当前正在显示的就是这个被禁用的分类，跳到下一个有效分类
  if (currentCategoryIndex === categoryIndex) {
    const nextValid = getNextValidCategoryIndex(categoryIndex, 'right');
    if (nextValid !== categoryIndex) {
      currentCategoryIndex = nextValid;
      updateDotsActiveState();
      loadTrendingData(false, nextValid);
    }
  }
}

/**
 * 加载热搜数据（优先从缓存读取，与悬浮搜索框保持一致）
 * @param {boolean} forceRefresh - 是否强制从网络刷新（忽略缓存）
 * @param {number} targetIndex - 指定加载的分类索引（可选，默认使用 currentCategoryIndex）
 */
async function loadTrendingData(forceRefresh = false, targetIndex = null) {
  const container = document.getElementById('trendingList');
  if (!container) return;
  
  // 使用指定的索引或当前索引
  const categoryIndex = targetIndex !== null ? targetIndex : currentCategoryIndex;
  const category = TRENDING_CATEGORIES[categoryIndex];
  const cacheKey = `${TRENDING_CACHE_KEY}_baidu_${category.tab}`;
  
  // 用于验证数据返回时分类是否仍然匹配
  const expectedIndex = categoryIndex;
  
  // 更新标题
  updateTrendingTitle(category);
  
  try {
    // 先尝试从本地缓存读取该类别的数据
    const cached = await chrome.storage.local.get(cacheKey);
    const cacheData = cached[cacheKey];
    
    // 如果缓存有效且非强制刷新，直接使用缓存
    if (!forceRefresh && cacheData && cacheData.data && Date.now() - cacheData.timestamp < CACHE_DURATION) {
      // 缓存数据也要检查数量是否达标
      if (cacheData.data.length < MIN_TRENDING_ITEMS) {
        markCategoryDisabled(categoryIndex);
        return;
      }
      // 检查分类是否仍然匹配
      if (currentCategoryIndex === expectedIndex) {
        renderTrendingList(cacheData.data);
        updateTrendingTime(cacheData.timestamp);
      }
      return;
    }
    
    // 如果有该类别的缓存（即使过期），先显示旧数据，再后台刷新
    if (cacheData && cacheData.data) {
      if (cacheData.data.length < MIN_TRENDING_ITEMS) {
        markCategoryDisabled(categoryIndex);
        return;
      }
      // 检查分类是否仍然匹配
      if (currentCategoryIndex === expectedIndex) {
        renderTrendingList(cacheData.data);
        updateTrendingTime(cacheData.timestamp);
      }
    }
    
    // 请求新数据（百度热搜 API）
    // 构建百度热搜 API URL
    const apiUrl = `https://top.baidu.com/api/board?platform=wise&tab=${category.tab}`;
    const result = await chrome.runtime.sendMessage({
      action: 'proxyFetch',
      url: apiUrl,
      options: {
        method: 'GET',
        headers: { 
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      }
    });
    
    // 解析百度热搜数据格式
    const baiduData = result?.data?.data?.cards?.[0]?.content?.[0]?.content;
    if (result && result.success && result.data?.success && Array.isArray(baiduData)) {
      // 注意：不同分类使用不同字段名
      // realtime/livelihood/finance/sports/games 使用 'word'
      // movie/teleplay/novel/car/drama 使用 'title'
      const trendingData = baiduData.slice(0, 20).map(item => ({
        title: item.word || item.title || ''
      })).filter(item => item.title);
      
      const timestamp = Date.now();
      
      // 保存到缓存（使用类别特定的 key）
      await chrome.storage.local.set({
        [cacheKey]: {
          data: trendingData,
          timestamp: timestamp
        }
      });
      
      // 数据不足 20 条，标记该分类为不可用并跳走
      if (trendingData.length < MIN_TRENDING_ITEMS) {
        markCategoryDisabled(categoryIndex);
        return;
      }
      
      // 只有当当前分类仍然匹配时才渲染
      if (currentCategoryIndex === expectedIndex) {
        renderTrendingList(trendingData);
        updateTrendingTime(timestamp);
      }
    } else {
      throw new Error('数据格式错误');
    }
  } catch (error) {
    console.error('[ECHO NTP] 热搜加载失败:', error);
    // 只有在分类仍匹配且没有任何数据显示时才显示错误
    if (currentCategoryIndex === expectedIndex && (container.innerHTML === '' || container.querySelector('.trending-error'))) {
      container.innerHTML = '<div class="trending-error">热搜加载失败，请刷新重试</div>';
    }
  }
}

/**
 * 更新热搜标题
 */
function updateTrendingTitle(category) {
  const titleEl = document.getElementById('trendingTitle');
  if (titleEl) {
    titleEl.innerHTML = `<span class="trending-icon">${category.icon}</span>${category.name}`;
    titleEl.classList.remove('trending-loading-hide');
  }
}

/**
 * 更新热搜时间
 */
function updateTrendingTime(timestamp) {
  const timeEl = document.getElementById('trendingUpdateTime');
  if (timeEl && timestamp) {
    const date = new Date(timestamp);
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const hour = date.getHours().toString().padStart(2, '0');
    const minute = date.getMinutes().toString().padStart(2, '0');
    timeEl.textContent = `更新于 ${month}月${day}日 ${hour}:${minute}`;
    timeEl.classList.remove('trending-loading-hide');
  }
}

/**
 * 获取当前热搜列数（根据视口宽度与 CSS 媒体查询断点保持一致）
 */
function getTrendingColumnCount() {
  return window.innerWidth <= 1400 ? 3 : 4;
}

// 缓存上次渲染的热搜数据和列数，用于 resize 时重新渲染
let _lastTrendingData = null;
let _lastTrendingColCount = null;

// 窗口宽度变化时，如果跨越断点则重新渲染热搜列表
window.addEventListener('resize', () => {
  if (!_lastTrendingData) return;
  const newColCount = getTrendingColumnCount();
  if (newColCount !== _lastTrendingColCount) {
    renderTrendingList(_lastTrendingData);
  }
});

/**
 * 渲染热搜列表 - 根据屏幕宽度动态调整列数
 */
function renderTrendingList(data) {
  const container = document.getElementById('trendingList');
  if (!container || !data || data.length === 0) return;
  
  // 缓存数据以便 resize 时重新渲染
  _lastTrendingData = data;
  
  const colCount = getTrendingColumnCount();
  _lastTrendingColCount = colCount;
  const columns = Array.from({ length: colCount }, () => []);
  data.slice(0, colCount * 5).forEach((item, index) => {
    const colIndex = Math.floor(index / 5);
    if (colIndex < colCount) columns[colIndex].push({ ...item, rank: index + 1 });
  });
  
  container.innerHTML = columns.map(column => {
    const items = column.map(item => {
      let rankClass = 'normal';
      if (item.rank === 1) rankClass = 'top-1';
      else if (item.rank === 2) rankClass = 'top-2';
      else if (item.rank === 3) rankClass = 'top-3';
      const url = `https://www.bing.com/search?q=${encodeURIComponent(item.title)}`;
      return `<a class="trending-item" href="${url}" data-url="${url}">
        <span class="trending-rank ${rankClass}">${item.rank}</span>
        <span class="trending-text">${escapeHtml(item.title)}</span>
      </a>`;
    }).join('');
    return `<div class="trending-column">${items}</div>`;
  }).join('');
}

/**
 * 初始化热搜列表点击事件（只调用一次）
 */
let trendingClickInitialized = false;
function initTrendingClickHandler() {
  if (trendingClickInitialized) return;
  
  const container = document.getElementById('trendingList');
  if (!container) return;
  
  // 使用事件委托，点击时在后台新标签页打开
  container.addEventListener('click', (e) => {
    const link = e.target.closest('.trending-item');
    if (link) {
      e.preventDefault();
      const url = link.dataset.url || link.href;
      chrome.tabs.create({ url, active: false });
    }
  });
  
  trendingClickInitialized = true;
}

/**
 * 初始化热搜左右切换箭头
 */
function initTrendingArrows() {
  const prevBtn = document.getElementById('trendingPrev');
  const nextBtn = document.getElementById('trendingNext');
  
  if (prevBtn) {
    prevBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const prevIndex = getNextValidCategoryIndex(currentCategoryIndex, 'left');
      switchCategory(prevIndex, 'left');
    });
  }
  
  if (nextBtn) {
    nextBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const nextIndex = getNextValidCategoryIndex(currentCategoryIndex, 'right');
      switchCategory(nextIndex, 'right');
    });
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
// NTP 专用缩放状态（使用 CSS transform）
// ============================================

const ZOOM_STORAGE_KEY = 'echo_ntp_zoom';
let currentNtpZoom = 1.0;

// 从 storage 恢复缩放比例
async function loadNtpZoom() {
  try {
    const result = await chrome.storage.local.get(ZOOM_STORAGE_KEY);
    if (result[ZOOM_STORAGE_KEY]) {
      currentNtpZoom = result[ZOOM_STORAGE_KEY];
      applyNtpZoom();
    }
  } catch (e) {
  }
}

// 保存缩放比例
async function saveNtpZoom() {
  try {
    await chrome.storage.local.set({ [ZOOM_STORAGE_KEY]: currentNtpZoom });
  } catch (e) {
  }
}

// 应用 CSS transform 缩放（只缩放内容容器，保持居中）
function applyNtpZoom() {
  const container = document.querySelector('.container');
  if (container) {
    container.style.transform = `scale(${currentNtpZoom})`;
    container.style.transformOrigin = 'center center';
  }
}

// 设置缩放
function setNtpZoom(newZoom) {
  // 限制范围 25% - 500%
  newZoom = Math.max(0.25, Math.min(5.0, newZoom));
  currentNtpZoom = newZoom;
  applyNtpZoom();
  saveNtpZoom();
  showZoomIndicator(Math.round(newZoom * 100));
}

// ============================================
// 缩放指示器
// ============================================

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
      font-weight: bold;
      z-index: 999999;
      pointer-events: none;
      transition: opacity 0.3s;
    `;
    document.body.appendChild(zoomIndicator);
  }

  zoomIndicator.textContent = zoom + '%';
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
// 鼠标手势和精细缩放支持
// ============================================

(function initNtpGestures() {
  let isRightMouseDown = false;
  let preventContextMenu = false;
  let lastWheelTime = 0;
  let wheelCount = 0;  // 滚轮触发次数
  
  // 右键按下
  document.addEventListener('mousedown', (e) => {
    if (e.button === 2) {
      isRightMouseDown = true;
      wheelCount = 0;
      preventContextMenu = false;
    }
  });
  
  // 右键松开
  document.addEventListener('mouseup', (e) => {
    if (e.button === 2) {
      isRightMouseDown = false;
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
  }, true);
  
  // 滚轮事件：鼠标手势 + 精细缩放
  document.addEventListener('wheel', async (e) => {
    // 精细缩放：Ctrl + 滚轮（使用 CSS transform）
    if (e.ctrlKey) {
      e.preventDefault();
      e.stopPropagation();
      
      const currentZoomRounded = Math.round(currentNtpZoom * 100);
      const isZoomingIn = e.deltaY < 0;
      
      let newZoom;
      
      // 大比例加速步进逻辑（与 options.js 保持一致）
      if (currentZoomRounded >= 175 && isZoomingIn) {
        newZoom = currentNtpZoom + 0.25;
        newZoom = Math.round(newZoom * 4) / 4;
      } else if (currentZoomRounded > 175 && !isZoomingIn) {
        newZoom = currentNtpZoom - 0.25;
        newZoom = Math.round(newZoom * 4) / 4;
        if (newZoom < 1.75) newZoom = 1.75;
      } else {
        newZoom = isZoomingIn ? currentNtpZoom + 0.05 : currentNtpZoom - 0.05;
        newZoom = Math.round(newZoom * 20) / 20;
      }
      
      setNtpZoom(newZoom);
      return;
    }
    
    // 鼠标手势：右键 + 滚轮切换标签
    // 使用 e.buttons & 2 实时检测右键状态，避免依赖可能有延迟的标志位
    if ((e.buttons & 2) && !e.ctrlKey) {
      e.preventDefault();
      e.stopPropagation();
      preventContextMenu = true;
      wheelCount++;
      
      // 节流（优化为 50ms）
      const currentTime = Date.now();
      if (currentTime - lastWheelTime < 50) return;
      lastWheelTime = currentTime;
      
      const direction = e.deltaY > 0 ? 'right' : 'left';
      chrome.runtime.sendMessage({ action: 'switchTab', direction, source: 'mouseGesture' });
    }
  }, { passive: false, capture: true });
  
  // F2/F3 切换标签
  document.addEventListener('keydown', (e) => {
    if (e.key === 'F2' || e.key === 'F3') {
      // 不在输入框中触发
      const activeEl = document.activeElement;
      const isInSearchInput = activeEl && activeEl.classList.contains('search-input');
      
      // 如果在搜索框中，不拦截
      if (isInSearchInput) return;
      
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      const direction = e.key === 'F2' ? 'left' : 'right';
      chrome.runtime.sendMessage({ action: 'switchTab', direction, source: 'keyboard' });
      return false;
    }
  }, true);
})();

// ============================================
// 超级拖拽：拖拽链接/文字
// ============================================

(function initNtpSuperDrag() {
  let dragStartPos = { x: 0, y: 0 };
  let isDraggingForSuperDrag = false;

  // 判断是否是输入框
  const isTextInput = (element) => element.matches(
    'input[type="email"], input[type="number"], input[type="password"], input[type="search"], ' +
    'input[type="tel"], input[type="text"], input[type="url"], input:not([type]), textarea, ' +
    '[contenteditable="true"], [contenteditable=""]'
  );

  // 工具函数
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

  // dragstart: 记录起始位置
  document.addEventListener('dragstart', (e) => {
    dragStartPos = { x: e.clientX, y: e.clientY };
    isDraggingForSuperDrag = true;
  }, false);

  // dragover: 允许在页面任意位置释放
  document.addEventListener('dragover', (e) => {
    if (!isDraggingForSuperDrag) return;
    if (isTextInput(e.target)) return;
    
    const types = e.dataTransfer.types;
    if (types.includes('text/uri-list') || types.includes('text/plain')) {
      e.dataTransfer.dropEffect = 'copy';
      e.preventDefault();
    }
  }, false);

  // drop: 执行操作
  document.addEventListener('drop', (e) => {
    if (!isDraggingForSuperDrag) return;
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
        chrome.runtime.sendMessage({ action: 'openInNewTab', url: url });
        isDraggingForSuperDrag = false;
        return;
      }
    }
    
    // 处理文字拖拽
    if (types.includes('text/plain')) {
      const text = e.dataTransfer.getData('text/plain')?.trim();
      if (text && text.length > 0 && text.length < 1000) {
        e.preventDefault();
        
        if (isValidUrl(text)) {
          chrome.runtime.sendMessage({
            action: 'openInNewTab',
            url: ensureProtocol(text)
          });
        } else {
          chrome.runtime.sendMessage({
            action: 'searchInNewTab',
            text: text
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

// ============================================
// 初始化
// ============================================

document.addEventListener('DOMContentLoaded', async () => {
  // 初始化自绘收藏栏
  if (!isBlankModeEnabled()) {
    await initBookmarkBar();
  } else {
    setBookmarkBarHeightVar(0);
  }
  
  // 初始化壁纸功能
  await initWallpaper();
  
  // 初始化热搜开关
  initTrendingToggle();
  
  // 初始化热搜切换箭头
  initTrendingArrows();
  
  // 恢复缩放比例
  loadNtpZoom();
  
  // 搜索框：拦截表单提交，改为新标签前台打开
  initSearchForm();
  
  // 聚焦搜索框
  focusSearchInputIfAvailable();
});

// ============================================
// 搜索框：新标签前台打开
// ============================================

/**
 * 初始化搜索表单，拦截提交改为新标签前台打开
 * 集成搜索建议功能
 */
function initSearchForm() {
  const form = document.querySelector('.search-form');
  if (!form) return;
  
  const input = form.querySelector('.search-input');
  const searchBox = form.querySelector('.search-box');
  const suggestContainer = document.getElementById('searchSuggest');
  const clearBtn = document.getElementById('searchClear');
  
  // ---- 搜索建议状态 ----
  let suggestActiveIndex = -1;  // 当前高亮的建议项索引，-1表示无高亮
  let currentSuggestions = [];  // 当前建议列表
  let debounceTimer = null;
  let isComposing = false;      // 输入法 composing 状态
  
  // ---- 清除按钮显隐控制 ----
  function updateClearBtn() {
    if (!clearBtn) return;
    if (input.value.length > 0) {
      clearBtn.classList.add('visible');
    } else {
      clearBtn.classList.remove('visible');
    }
  }
  
  if (clearBtn) {
    clearBtn.addEventListener('click', (e) => {
      e.preventDefault();
      input.value = '';
      updateClearBtn();
      hideSuggest(true);
      input.focus();
    });
  }
  
  // ---- 表单提交 ----
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    
    // 如果有高亮的建议项，搜索高亮项的文字
    let query;
    if (suggestActiveIndex >= 0 && currentSuggestions[suggestActiveIndex]) {
      query = currentSuggestions[suggestActiveIndex];
    } else {
      query = input?.value?.trim();
    }
    if (!query) return;
    
    hideSuggest(true);
    
    // 构建搜索 URL
    const searchUrl = `https://www.bing.com/search?q=${encodeURIComponent(query)}`;
    
    // 新标签前台打开
    chrome.tabs.create({ url: searchUrl, active: true });
  });
  
  // ---- 输入法 composing 处理 ----
  if (input) {
    input.addEventListener('compositionstart', () => { isComposing = true; });
    input.addEventListener('compositionend', () => {
      isComposing = false;
      // compositionend 后手动触发一次建议请求
      handleInputChange();
    });
    
    // ---- 输入事件：触发搜索建议 ----
    input.addEventListener('input', () => {
      updateClearBtn();
      if (isComposing) return; // composing 期间不请求
      handleInputChange();
    });
    
    // ---- 键盘导航 ----
    input.addEventListener('keydown', (e) => {
      if (!suggestContainer || !suggestContainer.classList.contains('visible')) {
        return; // 建议列表未显示时不处理
      }
      
      const items = suggestContainer.querySelectorAll('.search-suggest-item');
      if (items.length === 0) return;
      
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        suggestActiveIndex = Math.min(suggestActiveIndex + 1, items.length - 1);
        updateActiveItem(items);
        // 将高亮项的文字填入输入框
        if (currentSuggestions[suggestActiveIndex]) {
          input.value = currentSuggestions[suggestActiveIndex];
          updateClearBtn();
        }
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        suggestActiveIndex--;
        if (suggestActiveIndex < 0) {
          suggestActiveIndex = -1;
          // 恢复用户原始输入
          input.value = input.dataset.originalQuery || '';
        } else {
          if (currentSuggestions[suggestActiveIndex]) {
            input.value = currentSuggestions[suggestActiveIndex];
          }
        }
        updateClearBtn();
        updateActiveItem(items);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        hideSuggest(true);
        // 恢复原始输入
        if (input.dataset.originalQuery !== undefined) {
          input.value = input.dataset.originalQuery;
        }
      }
    });
    
    // ---- 失焦时隐藏建议（延迟，以便点击建议项时能先触发 click） ----
    input.addEventListener('blur', () => {
      setTimeout(() => { hideSuggest(false); }, 150);
    });
    
    // ---- 聚焦时：如果有缓存的建议且输入框有内容，恢复显示 ----
    input.addEventListener('focus', () => {
      const query = input.value.trim();
      if (query.length >= 1 && lastSuggestions.length > 0) {
        // 如果输入内容和上次查询一致，直接恢复显示
        if (query === lastQuery) {
          currentSuggestions = lastSuggestions;
          suggestActiveIndex = -1;
          renderSuggestions(lastSuggestions);
          showSuggest();
        } else {
          // 输入内容变了（比如用户在失焦期间通过其他方式修改了输入），重新请求
          fetchSuggestions(query);
        }
      }
    });
  }
  
  // ---- 核心函数 ----
  
  // 缓存上一次的建议结果（用于 focus 时恢复显示）
  let lastSuggestions = [];
  let lastQuery = '';
  
  function handleInputChange() {
    const query = input.value.trim();
    
    // 保存用户原始输入（用于 ArrowUp 恢复）
    input.dataset.originalQuery = query;
    
    if (query.length < 1) {
      hideSuggest(true);
      return;
    }
    
    // debounce 200ms
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      fetchSuggestions(query);
    }, 200);
  }
  
  function fetchSuggestions(query) {
    chrome.runtime.sendMessage({ action: 'bingSuggest', query: query }, (response) => {
      if (chrome.runtime.lastError) {
        hideSuggest(false);
        return;
      }
      
      // 二次校验：response返回时，输入框可能已被清空或内容已变
      const currentValue = input.value.trim();
      if (currentValue.length < 1) {
        hideSuggest(true);
        return;
      }
      
      const suggestions = response?.suggestions || [];
      
      // 空结果不显示
      if (suggestions.length === 0) {
        hideSuggest(false);
        return;
      }
      
      currentSuggestions = suggestions;
      lastSuggestions = suggestions;
      lastQuery = currentValue;
      suggestActiveIndex = -1;
      renderSuggestions(suggestions);
      showSuggest();
    });
  }
  
  function renderSuggestions(suggestions) {
    if (!suggestContainer) return;
    
    const searchIconSvg = '<svg class="search-suggest-icon" viewBox="0 0 24 24" fill="none" stroke="#999" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>';
    
    suggestContainer.innerHTML = suggestions.map((text, index) => 
      `<div class="search-suggest-item" data-index="${index}">
        ${searchIconSvg}
        <span class="search-suggest-text">${escapeHtml(text)}</span>
      </div>`
    ).join('');
    
    // 点击建议项
    suggestContainer.querySelectorAll('.search-suggest-item').forEach(item => {
      item.addEventListener('mousedown', (e) => {
        e.preventDefault(); // 防止 blur 先于 click 触发
        const idx = parseInt(item.dataset.index);
        const query = currentSuggestions[idx];
        if (!query) return;
        
        input.value = query;
        hideSuggest(true);
        
        const searchUrl = `https://www.bing.com/search?q=${encodeURIComponent(query)}`;
        chrome.tabs.create({ url: searchUrl, active: true });
      });
    });
  }
  
  function showSuggest() {
    if (!suggestContainer) return;
    suggestContainer.classList.add('visible');
    if (searchBox) searchBox.classList.add('suggest-open');
  }
  
  function hideSuggest(clearData) {
    if (!suggestContainer) return;
    suggestContainer.classList.remove('visible');
    if (searchBox) searchBox.classList.remove('suggest-open');
    suggestActiveIndex = -1;
    if (clearData) {
      currentSuggestions = [];
      lastSuggestions = [];
      lastQuery = '';
    }
  }
  
  function updateActiveItem(items) {
    items.forEach((item, i) => {
      item.classList.toggle('active', i === suggestActiveIndex);
    });
  }
  
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

// ============================================
// 自绘收藏栏初始化
// ============================================

/**
 * 获取当前收藏栏高度（根据密度设置）
 */
async function getBookmarkBarHeight() {
  // 注意：大部分用户都是默认密度，为避免异步闪烁，可以直接假定为 32
  // 如果需要极其精确，可以开启这段异步逻辑，但会导致布局重排
  
  // 目前策略：默认直接返回 32，后续异步微调（如果不是默认密度）
  // 这样 99% 的情况下不会闪烁
  
  // 密度配置映射（与 bookmark-bar/state.js 保持一致）
  const DENSITY_CONFIG = {
    compact:     { barHeight: 28 },
    default:     { barHeight: 32 },
    comfortable: { barHeight: 40 },
    spacious:    { barHeight: 48 }
  };
  
  const settings = await chrome.storage.sync.get({
    bookmarkBarDensity: 'default'
  });
  
  const density = settings.bookmarkBarDensity || 'default';
  return DENSITY_CONFIG[density]?.barHeight || 32;
}

/**
 * 设置收藏栏高度 CSS 变量
 */
function setBookmarkBarHeightVar(height) {
  // 如果当前已经是这个高度，就不重新设置，减少 DOM 操作
  const current = document.documentElement.style.getPropertyValue('--bookmark-bar-height');
  if (current === height + 'px') return;
  
  document.documentElement.style.setProperty('--bookmark-bar-height', height + 'px');
}

/**
 * 初始化自绘收藏栏
 */
async function initBookmarkBar() {
  if (isBlankModeEnabled()) {
    setBookmarkBarHeightVar(0);
    return;
  }

  // 检查 EchoBookmarkBar 模块是否已加载
  if (!window.EchoBookmarkBar || !window.EchoBookmarkBar.init) {
    console.warn('[ECHO NTP] BookmarkBar module not loaded');
    setBookmarkBarHeightVar(0);
    return;
  }
  
  // 1. 同步策略：立即使用 localStorage 缓存避免闪烁
  // 默认认为是启用的 (null or 'true')，除非明确是 'false'
  const cachedEnabled = localStorage.getItem('echo_ntp_bookmark_bar_enabled');
  if (cachedEnabled === 'false') {
    setBookmarkBarHeightVar(0);
  } else {
    // 默认为 32px
    setBookmarkBarHeightVar(32);
  }
  
  // 2. 异步策略：获取真实设置并更新
  const settings = await chrome.storage.sync.get({
    customBookmarkBar: true, // 注意这里的默认值改为 true，与产品策略保持一致
    bookmarkOpenInNewTab: true
  });
  
  // 更新缓存
  localStorage.setItem('echo_ntp_bookmark_bar_enabled', settings.customBookmarkBar);
  
  // 在 NTP 上始终显示收藏栏（如果用户开启了该功能）
  if (settings.customBookmarkBar) {
    const barHeight = await getBookmarkBarHeight();
    setBookmarkBarHeightVar(barHeight);
    
    await window.EchoBookmarkBar.init({
      customBookmarkBar: true,
      bookmarkOpenInNewTab: settings.bookmarkOpenInNewTab
    });
  } else {
    // 收藏栏未启用，高度设为 0
    setBookmarkBarHeightVar(0);
  }
}

// 监听设置变化（包括密度变化、壁纸收藏同步）
chrome.storage.onChanged.addListener(async (changes, areaName) => {
  if (areaName !== 'sync') return;
  
  // 密度变化时更新高度
  if (changes.bookmarkBarDensity) {
    const barHeight = await getBookmarkBarHeight();
    setBookmarkBarHeightVar(barHeight);
  }

  // 壁纸收藏变化（来自其他设备的同步）
  if (changes[WALLPAPER_FAVORITES_KEY]) {
    const newFavorites = changes[WALLPAPER_FAVORITES_KEY].newValue;
    if (!Array.isArray(newFavorites)) return;  // 防御性校验
    wallpaperState.favorites = newFavorites;
    
    // 刷新相关 UI
    updateFavoriteCount();
    updateWallpaperStatus();
    updateL2SourceSelector();
    
    // 如果收藏面板正在展示，刷新网格和 Tab 计数
    const collectionPanel = document.getElementById('collectionPanel');
    if (collectionPanel?.classList.contains('visible')) {
      const activeTab = document.querySelector('.collection-tab.active')?.dataset.tab;
      if (activeTab === 'favorites') {
        renderFavoritesGrid();
      }
      // 同步更新 Tab 标签上的收藏计数
      const tabFavoritesCount = document.getElementById('tabFavoritesCount');
      if (tabFavoritesCount) tabFavoritesCount.textContent = `(${newFavorites.length})`;
    }
    
    // 如果当前是"轮播收藏"模式（未锁定）且收藏变空，自动切回每日模式并切换壁纸
    if (wallpaperState.settings.mode === 'collection' && 
        !wallpaperState.settings.pinnedDate &&
        newFavorites.length === 0) {
      wallpaperState.settings.mode = 'daily';
      const todayWp = wallpaperState.history[0];
      if (todayWp) displayWallpaper(todayWp);
      await saveWallpaperSettings();
      updateL2SourceSelector();
    }
  }
});

// 监听来自 background 的消息（书签更新）
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'bookmarkBarUpdated' || message.action === 'bookmarkFolderUpdated') {
    if (window.EchoBookmarkBar && window.EchoBookmarkBar.handleMessage) {
      const settings = { customBookmarkBar: true }; // NTP 上已初始化就认为开启了
      window.EchoBookmarkBar.handleMessage(message, settings);
    }
    sendResponse({ ok: true });
    return false;
  }
  return false;
});

// ============================================
// Low Poly 背景控制（使用共享模块 common/lowpoly-bg.js）
// ============================================

/**
 * 初始化背景渐变随机起始角度
 */
function initRandomGradientAngle() {
  const randomAngle = Math.floor(Math.random() * 360);
  document.body.style.setProperty('--gradient-angle', randomAngle + 'deg');
}

/**
 * 初始化 Low Poly 背景（使用共享模块）
 */
function initLowPolyBackground() {
  if (window.LowPolyBg && !window.LowPolyBg.isInitialized) {
    window.LowPolyBg.init();
  }
}

/**
 * 显示 Low Poly 背景（无壁纸模式）
 */
function showLowPolyBackground() {
  if (!window.LowPolyBg?.isInitialized) {
    initLowPolyBackground();
  }

  if (window.LowPolyBg) {
    window.LowPolyBg.show();
  }
}

/**
 * 隐藏 Low Poly 背景（壁纸模式）
 */
function hideLowPolyBackground() {
  if (window.LowPolyBg) {
    window.LowPolyBg.hide();
  }
}

// 在 DOMContentLoaded 时初始化（几何背景）
document.addEventListener('DOMContentLoaded', () => {
  if (isBlankModeEnabled()) return;

  // 设置渐变随机起始角度
  initRandomGradientAngle();
  
  // 延迟初始化 Low Poly 背景以避免影响首屏渲染
  requestAnimationFrame(() => {
    setTimeout(() => {
      initLowPolyBackground();
    }, 100);
  });
});
