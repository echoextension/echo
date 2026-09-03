/**
 * ECHO Options Page Script
 */

// 开关类设置 - 全部默认开启
const SETTING_IDS = [
  'mouseGesture',
  'bossKey',
  'quickMute',
  'fineZoom',
  'fineZoomLargeStep',    // 大比例时加速步进
  'superDrag',            // 超级拖拽（默认开启）
  'tabSwitchKey',         // F2/F3 切换标签
  'quickSaveImage',       // Alt+点击快速保存图片
  'biliTool',             // B站视频优化工具（默认开启）
  'biliFeedHistory'       // B站推荐回退（默认开启）
];

// 开关类设置 - 默认关闭
const SETTING_IDS_DEFAULT_OFF = [
  'superDragActivate',         // 拖拽产生的标签立即激活（默认关闭，即后台打开）
  'quickSaveImageDateFolder',  // 按日期创建子文件夹
  'applyToPlusButton'          // 同时应用于「+」新建标签页
];

// 开关类设置 - 默认关闭
const SETTING_IDS_OFF = [
  'floatingSearchBoxAlwaysShow',  // 悬浮搜索框常驻显示（默认关闭）
  'floatingSearchBoxFollowZoom'   // 悬浮搜索框跟随页面缩放（默认关闭）
];

// 开关类设置 - 默认开启
const SETTING_IDS_ON_LAB = [
  'floatingSearchBox',        // 悬浮搜索框（默认开启）
  'floatingSearchBoxTrending' // 悬浮搜索框热搜榜（默认关闭）
];

// 单选设置
const RADIO_SETTINGS = [
  'closeTabActivate',
  'newTabPosition',
  'newTabOrder'
];

// 唯一设置 schema 由 core/settings.js 提供。
const DEFAULT_SETTINGS = EchoSettings.getAreaDefaults('sync', { includeDeprecated: false });
const backupController = EchoOptionsBackupController.create({
  chrome,
  document,
  settingsSchema: EchoSettings,
  onSettingsRestored: () => loadSettings()
});

/**
 * 加载并应用设置到 UI
 */
async function loadSettings() {
  const settings = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  
  // 加载开关状态（默认开启的）
  SETTING_IDS.forEach(id => {
    const checkbox = document.getElementById(id);
    if (checkbox) {
      checkbox.checked = settings[id];
    }
  });
  
  // 加载开关状态（默认关闭的）
  SETTING_IDS_DEFAULT_OFF.forEach(id => {
    const checkbox = document.getElementById(id);
    if (checkbox) {
      checkbox.checked = settings[id];
    }
  });
  
  // 加载其他默认关闭的开关状态
  SETTING_IDS_OFF.forEach(id => {
    const checkbox = document.getElementById(id);
    if (checkbox) {
      checkbox.checked = settings[id];
    }
  });

  // 加载开关状态（默认开启的）
  SETTING_IDS_ON_LAB.forEach(id => {
    const checkbox = document.getElementById(id);
    if (checkbox) {
      checkbox.checked = settings[id];
    }
  });
  
  // 加载 radio 按钮状态
  RADIO_SETTINGS.forEach(name => {
    const radios = document.querySelectorAll(`input[name="${name}"]`);
    radios.forEach(radio => {
      radio.checked = radio.value === settings[name];
    });
  });
  
  // 更新 newTabOrder 可用状态
  updateNewTabOrderState(settings.newTabPosition);
  
  // 更新超级拖拽子选项状态
  updateSuperDragOptionState(settings.superDrag);
  
  // 更新悬浮搜索框子选项状态
  updateFloatingSearchBoxOptionState(settings.floatingSearchBox);
  
  // 更新快速保存图片子选项状态
  updateQuickSaveImageOptionState(settings.quickSaveImage);
  
  // 更新精细缩放子选项状态
  updateFineZoomOptionState(settings.fineZoom);
  
  // 初始化动画演示
  initDemos(settings);
}

/**
 * 更新超级拖拽子选项的可用状态（显示/隐藏）
 */
function updateSuperDragOptionState(superDrag) {
  const activateOption = document.getElementById('superDragActivate')?.closest('.option');
  
  if (superDrag) {
    if (activateOption) activateOption.style.display = 'flex';
  } else {
    if (activateOption) activateOption.style.display = 'none';
  }
}

/**
 * 更新悬浮搜索框子选项的可用状态（显示/隐藏）
 */
function updateFloatingSearchBoxOptionState(floatingSearchBox) {
  const alwaysShowOption = document.getElementById('floatingSearchBoxAlwaysShowOption');
  const trendingOption = document.getElementById('floatingSearchBoxTrendingOption');
  const followZoomOption = document.getElementById('floatingSearchBoxFollowZoomOption');
  
  if (floatingSearchBox) {
    if (alwaysShowOption) alwaysShowOption.style.display = 'flex';
    if (trendingOption) trendingOption.style.display = 'flex';
    if (followZoomOption) followZoomOption.style.display = 'flex';
  } else {
    if (alwaysShowOption) alwaysShowOption.style.display = 'none';
    if (trendingOption) trendingOption.style.display = 'none';
    if (followZoomOption) followZoomOption.style.display = 'none';
  }
}

/**
 * 更新精细缩放子选项的可用状态（显示/隐藏）
 */
function updateFineZoomOptionState(fineZoom) {
  const largeStepOption = document.getElementById('fineZoomLargeStepOption');
  
  if (fineZoom) {
    if (largeStepOption) largeStepOption.style.display = 'flex';
  } else {
    if (largeStepOption) largeStepOption.style.display = 'none';
  }
}

/**
 * 更新快速保存图片子选项的可用状态（显示/隐藏）
 */
function updateQuickSaveImageOptionState(quickSaveImage) {
  const dateFolderOption = document.getElementById('quickSaveImageDateFolderOption');
  
  if (quickSaveImage) {
    if (dateFolderOption) dateFolderOption.style.display = 'flex';
  } else {
    if (dateFolderOption) dateFolderOption.style.display = 'none';
  }
}

/**
 * 更新 newTabOrder 选项组的可用状态
 */
function updateNewTabOrderState(newTabPosition) {
  const orderOptions = document.getElementById('orderOptions');
  const orderDisabledInfo = document.getElementById('orderDisabledInfo');
  const applyToPlusButtonOption = document.getElementById('applyToPlusButtonOption');
  const orderDemo = document.getElementById('orderDemo');
  
  if (!orderOptions || !orderDisabledInfo) return;
  
  if (newTabPosition === 'atEnd') {
    // 隐藏选项，显示说明文字
    orderOptions.style.display = 'none';
    orderDisabledInfo.style.display = 'block';
    if (applyToPlusButtonOption) applyToPlusButtonOption.style.display = 'none';
    // 隐藏动画（此时无需演示顺序）
    if (orderDemo) orderDemo.style.display = 'none';
    // 停止动画
    stopOrderDemo();
  } else {
    // 显示选项，隐藏说明文字
    orderOptions.style.display = 'block';
    orderDisabledInfo.style.display = 'none';
    if (applyToPlusButtonOption) applyToPlusButtonOption.style.display = 'flex';
    // 显示并恢复动画
    if (orderDemo) orderDemo.style.display = 'block';
    const selectedOrder = document.querySelector('input[name="newTabOrder"]:checked');
    if (selectedOrder) {
      playOrderDemo(selectedOrder.value);
    }
  }
}

// ============================================
// 示意动画控制
// ============================================

let closeTabAnimationInterval = null;
let positionAnimationInterval = null;
let orderAnimationInterval = null;

// 动画版本号，用于取消过期的 setTimeout 回调
let closeTabAnimationVersion = 0;
let positionAnimationVersion = 0;
let orderAnimationVersion = 0;

/**
 * 创建标签元素
 */
function createTab(className = '', text = '') {
  const tab = document.createElement('div');
  tab.className = 'demo-tab ' + className;
  tab.textContent = text;
  return tab;
}

/**
 * 播放关闭标签示意动画（循环播放）
 * 动画：当前标签变红 -> 消失 -> 左侧或右侧变为激活
 */
function playCloseTabDemo(mode) {
  const bar = document.getElementById('closeTabBar');
  if (!bar) return;
  
  // 清除之前的动画，递增版本号使旧的 setTimeout 失效
  stopCloseTabDemo();
  const currentVersion = ++closeTabAnimationVersion;
  
  // 执行一次完整动画
  function runAnimation() {
    // 版本检查：如果版本已更新，说明动画已被切换，不再执行
    if (currentVersion !== closeTabAnimationVersion) return;
    
    // 重建 DOM
    bar.innerHTML = '';
    
    // 左侧灰色标签（2个）
    bar.appendChild(createTab('', ''));
    bar.appendChild(createTab('', ''));
    
    // 左侧标签（可能变为激活）
    const leftTab = createTab('left-neighbor', '左侧');
    bar.appendChild(leftTab);
    
    // 当前标签（将被关闭）
    const currentTab = createTab('active closing-target', '当前');
    bar.appendChild(currentTab);
    
    // 右侧标签（可能变为激活）
    const rightTab = createTab('right-neighbor', '右侧');
    bar.appendChild(rightTab);
    
    // 右侧灰色标签（2个）
    bar.appendChild(createTab('', ''));
    bar.appendChild(createTab('', ''));
    
    // 动画序列（带版本检查）
    // 1. 500ms 后：当前标签变红 (预警)
    setTimeout(() => {
      if (currentVersion !== closeTabAnimationVersion) return;
      currentTab.classList.add('closing');
    }, 600);
    
    // 2. 1100ms 后：当前标签开始缩小 (CSS transition 0.4s)
    setTimeout(() => {
      if (currentVersion !== closeTabAnimationVersion) return;
      currentTab.classList.add('closed');
    }, 1100);

    // 3. 1300ms 后（提前200ms）：邻居标签开始激活 (重叠时间轴)
    setTimeout(() => {
      if (currentVersion !== closeTabAnimationVersion) return;
      if (mode === 'left') {
        leftTab.classList.add('becoming-active');
      } else {
        rightTab.classList.add('becoming-active');
      }
    }, 1300);

    // 4. 1550ms 后：彻底移除 DOM 占位 (解决 Ghost Gap，消除 gap 间距)
    setTimeout(() => {
      if (currentVersion !== closeTabAnimationVersion) return;
      currentTab.style.display = 'none';
    }, 1550);
  }
  
  // 立即播放一次
  runAnimation();
  
  // 设置循环（加长停顿时间，4200ms）
  closeTabAnimationInterval = setInterval(runAnimation, 4200);
}

/**
 * 停止关闭标签动画
 */
function stopCloseTabDemo() {
  if (closeTabAnimationInterval) {
    clearInterval(closeTabAnimationInterval);
    closeTabAnimationInterval = null;
  }
}

/**
 * 播放位置示意动画（循环播放，有挤开效果）
 */
function playPositionDemo(position) {
  const bar = document.getElementById('positionBar');
  if (!bar) return;
  
  // 清除之前的动画，递增版本号使旧的 setTimeout 失效
  stopPositionDemo();
  const currentVersion = ++positionAnimationVersion;
  
  // 执行一次完整动画
  function runAnimation() {
    // 版本检查：如果版本已更新，说明动画已被切换，不再执行
    if (currentVersion !== positionAnimationVersion) return;
    
    // 重建 DOM：初始状态没有新标签
    bar.innerHTML = '';
    
    // 左侧灰色标签
    bar.appendChild(createTab());
    bar.appendChild(createTab());
    
    // 当前标签
    const activeTab = createTab('active', '当前');
    bar.appendChild(activeTab);
    
    // 新标签占位（初始宽度为0）
    const newTab = createTab('new-tab', '新标签');
    
    // 右侧灰色标签
    const rightTabs = [createTab(), createTab(), createTab()];
    
    if (position === 'afterCurrent') {
      // 新标签在当前标签后面
      bar.appendChild(newTab);
      rightTabs.forEach(t => bar.appendChild(t));
    } else {
      // 新标签在最右边
      rightTabs.forEach(t => bar.appendChild(t));
      bar.appendChild(newTab);
    }
    
    // 1. 200ms Active 标签脉冲 (模拟操作源头)
    setTimeout(() => {
      if (currentVersion !== positionAnimationVersion) return;
      activeTab.classList.add('pulse');
    }, 200);

    // 2. 700ms 延迟后展开新标签 (脉冲后出现，体现因果)
    setTimeout(() => {
      if (currentVersion !== positionAnimationVersion) return;
      newTab.classList.add('show');
    }, 700);
  }
  
  // 立即播放一次
  runAnimation();
  
  // 设置循环（加长停顿时间，4000ms）
  positionAnimationInterval = setInterval(runAnimation, 4000);
}

/**
 * 停止位置动画
 */
function stopPositionDemo() {
  if (positionAnimationInterval) {
    clearInterval(positionAnimationInterval);
    positionAnimationInterval = null;
  }
}

/**
 * 播放排列顺序示意动画（循环播放，有挤开效果）
 */
function playOrderDemo(order) {
  const bar = document.getElementById('orderBar');
  if (!bar) return;
  
  // 清除之前的动画，递增版本号使旧的 setTimeout 失效
  stopOrderDemo();
  const currentVersion = ++orderAnimationVersion;
  
  const gradients = ['gradient-1', 'gradient-2', 'gradient-3'];
  
  // 执行一次完整动画
  function runAnimation() {
    // 版本检查：如果版本已更新，说明动画已被切换，不再执行
    if (currentVersion !== orderAnimationVersion) return;
    
    // 重建 DOM：初始状态没有新标签
    bar.innerHTML = '';
    
    // 左侧灰色标签
    bar.appendChild(createTab());
    bar.appendChild(createTab());
    
    // 当前标签
    bar.appendChild(createTab('active', '当前'));
    
    // 创建3个新标签（初始宽度为0）
    const newTabs = [
      createTab('new-tab ' + gradients[0], '1'),
      createTab('new-tab ' + gradients[1], '2'),
      createTab('new-tab ' + gradients[2], '3')
    ];
    
    // 插入点：当前标签后面
    // 根据模式决定插入顺序
    if (order === 'newest') {
      // 新的在左：每次都插在当前标签紧后面，所以 3 最靠近当前
      // 最终显示顺序：当前 -> 3 -> 2 -> 1 -> 灰色
      newTabs.forEach(t => bar.appendChild(t));
    } else {
      // 新的在右：依次向右排列
      // 最终显示顺序：当前 -> 1 -> 2 -> 3 -> 灰色
      newTabs.forEach(t => bar.appendChild(t));
    }
    
    // 右侧灰色标签
    bar.appendChild(createTab());
    
    // 依次展开新标签（模拟依次打开，带版本检查）
    // 大幅放慢速度，让用户看清"挤开"的过程
    const delays = [500, 1800, 3100]; 
    
    if (order === 'newest') {
      // 新的在左：1先开，但最终在最右；3最后开，但最终紧贴当前
      // 动画顺序：先展开1，再2，再3
      // 但因为每次新开的都插在最左，所以展开顺序是 1->2->3，位置是 3最左
      newTabs.forEach((tab, i) => {
        setTimeout(() => {
          if (currentVersion !== orderAnimationVersion) return;
          // 把这个标签移到"当前"后面第一个位置 (实现"挤压"效果)
          const activeTab = bar.querySelector('.active');
          activeTab.after(tab);
          tab.classList.add('show');
        }, delays[i]);
      });
    } else {
      // 新的在右：依次向右，1-2-3 按顺序排列
      newTabs.forEach((tab, i) => {
        setTimeout(() => {
          if (currentVersion !== orderAnimationVersion) return;
          tab.classList.add('show');
        }, delays[i]);
      });
    }
  }
  
  // 立即播放一次
  runAnimation();
  
  // 设置循环（加长停顿时间，6000ms，给用户足够的时间看清最后的状态）
  orderAnimationInterval = setInterval(runAnimation, 6000);
}

/**
 * 停止排列动画
 */
function stopOrderDemo() {
  if (orderAnimationInterval) {
    clearInterval(orderAnimationInterval);
    orderAnimationInterval = null;
  }
}

/**
 * 初始化动画演示
 */
function initDemos(settings) {
  // 初始化关闭标签演示
  playCloseTabDemo(settings.closeTabActivate);
  
  // 初始化位置演示
  playPositionDemo(settings.newTabPosition);
  
  // 初始化排列演示
  playOrderDemo(settings.newTabOrder);
}

// 页面隐藏时暂停动画，显示时恢复
document.addEventListener('visibilitychange', async () => {
  if (document.hidden) {
    stopCloseTabDemo();
    stopPositionDemo();
    stopOrderDemo();
  } else {
    const settings = await chrome.storage.sync.get(DEFAULT_SETTINGS);
    playCloseTabDemo(settings.closeTabActivate);
    playPositionDemo(settings.newTabPosition);
    playOrderDemo(settings.newTabOrder);
  }
});

/**
 * 保存单个设置
 */
function saveSetting(key, value) {
  return chrome.storage.sync.set({ [key]: value });
}

function applySettingValue(key, value) {
  const checkbox = document.getElementById(key);
  if (checkbox?.type === 'checkbox') checkbox.checked = value;
  document.querySelectorAll(`input[name="${key}"]`).forEach(radio => {
    radio.checked = radio.value === value;
  });
  if (key === 'superDrag') updateSuperDragOptionState(value);
  else if (key === 'quickSaveImage') updateQuickSaveImageOptionState(value);
  else if (key === 'fineZoom') updateFineZoomOptionState(value);
  else if (key === 'floatingSearchBox') updateFloatingSearchBoxOptionState(value);
  else if (key === 'closeTabActivate') playCloseTabDemo(value);
  else if (key === 'newTabPosition') {
    updateNewTabOrderState(value);
    playPositionDemo(value);
  } else if (key === 'newTabOrder') {
    playOrderDemo(value);
  }
}

async function persistSetting(key, value) {
  try {
    await saveSetting(key, value);
  } catch (error) {
    console.error(`[ECHO] 保存设置 ${key} 失败:`, error);
    const stored = await chrome.storage.sync.get({ [key]: EchoSettings.getDefault(key) });
    const authoritativeValue = EchoSettings.isValid(key, stored[key])
      ? stored[key]
      : EchoSettings.getDefault(key);
    applySettingValue(key, authoritativeValue);
  }
}

/**
 * 恢复默认设置
 */
async function resetToDefaults() {
  // 保存默认设置
  await chrome.storage.sync.set(DEFAULT_SETTINGS);
  await chrome.storage.sync.remove([
    'customBookmarkBar',
    'bookmarkBarPinned',
    'bookmarkOpenInNewTab',
    'bookmarkBarDensity',
    'searchEngine'
  ]);
  await chrome.storage.local.set({ zhihuBlocklistFilter: false });
  
  // 重新加载 UI
  await loadSettings();
}

/**
 * 初始化事件监听
 */
function initializeEventListeners() {
  // 监听来自其他地方的设置变化，实时更新 UI
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'sync') return;
    const checkboxIds = new Set([
      ...SETTING_IDS,
      ...SETTING_IDS_DEFAULT_OFF,
      ...SETTING_IDS_OFF,
      ...SETTING_IDS_ON_LAB
    ]);
    Object.entries(changes).forEach(([key, change]) => {
      if (!checkboxIds.has(key) && !RADIO_SETTINGS.includes(key)) return;
      const value = change.newValue === undefined
        ? EchoSettings.getDefault(key)
        : change.newValue;
      if (!EchoSettings.isValid(key, value)) return;
      applySettingValue(key, value);
    });
  });

  // 监听开关变化（默认开启的）
  SETTING_IDS.forEach(id => {
    const checkbox = document.getElementById(id);
    if (checkbox) {
      checkbox.addEventListener('change', (e) => {
        void persistSetting(id, e.target.checked);
        
        // 超级拖拽开关联动子选项
        if (id === 'superDrag') {
          updateSuperDragOptionState(e.target.checked);
        }
        
        // 快速保存图片开关联动子选项
        if (id === 'quickSaveImage') {
          updateQuickSaveImageOptionState(e.target.checked);
        }
        
        // 精细缩放开关联动子选项
        if (id === 'fineZoom') {
          updateFineZoomOptionState(e.target.checked);
        }
      });
    }
  });
  
  // 监听开关变化（默认关闭的）
  SETTING_IDS_DEFAULT_OFF.forEach(id => {
    const checkbox = document.getElementById(id);
    if (checkbox) {
      checkbox.addEventListener('change', (e) => {
        void persistSetting(id, e.target.checked);
      });
    }
  });
  
  // 监听其他默认关闭的开关变化
  SETTING_IDS_OFF.forEach(id => {
    const checkbox = document.getElementById(id);
    if (checkbox) {
      checkbox.addEventListener('change', (e) => {
        void persistSetting(id, e.target.checked);
      });
    }
  });
  
  // 监听开关变化（默认开启的）
  SETTING_IDS_ON_LAB.forEach(id => {
    const checkbox = document.getElementById(id);
    if (checkbox) {
      checkbox.addEventListener('change', (e) => {
        void persistSetting(id, e.target.checked);
        
        // 悬浮搜索框开关联动子选项
        if (id === 'floatingSearchBox') {
          updateFloatingSearchBoxOptionState(e.target.checked);
        }
      });
    }
  });
  
  // 监听 radio 按钮变化
  RADIO_SETTINGS.forEach(name => {
    const radios = document.querySelectorAll(`input[name="${name}"]`);
    radios.forEach(radio => {
      radio.addEventListener('change', (e) => {
        void persistSetting(name, e.target.value);
        
        // 播放对应的动画
        if (name === 'closeTabActivate') {
          playCloseTabDemo(e.target.value);
        } else if (name === 'newTabPosition') {
          updateNewTabOrderState(e.target.value);
          playPositionDemo(e.target.value);
        } else if (name === 'newTabOrder') {
          playOrderDemo(e.target.value);
        }
      });
    });
  });
  
  // 恢复默认按钮
  const resetButton = document.getElementById('resetDefaults');
  if (resetButton) {
    resetButton.addEventListener('click', async () => {
      if (confirm('确定要恢复所有设置为默认值吗？\n（不会影响快捷键设置）')) {
        await resetToDefaults();
      }
    });
  }
}

/**
 * 加载快捷键显示
 */
async function loadShortcuts() {
  try {
    const commands = await chrome.commands.getAll();
    commands.forEach(command => {
      const element = document.getElementById(command.name + '-shortcut');
      if (element && command.shortcut) {
        element.textContent = command.shortcut;
      }
    });
  } catch (error) {
    console.error('Failed to load shortcuts:', error);
  }
}

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', async () => {
  await loadSettings();
  initializeEventListeners();
  await loadShortcuts();
  const zhihuSyncController = EchoOptionsZhihuSyncController.create({
    chrome,
    document,
    messages: EchoMessages,
    settingsSchema: EchoSettings
  });
  await zhihuSyncController.init();
  
  // 快捷键设置入口
  document.getElementById('openShortcutSettings').addEventListener('click', (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: 'edge://extensions/shortcuts' });
  });

  // Edge 鼠标手势设置入口
  document.getElementById('openMouseGestureSettings').addEventListener('click', (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: 'edge://settings/appearance/browserBehavior/mouseGestures' });
  });

  // 反馈邮箱（JS 拼接防爬虫）
  document.getElementById('contactEmail').addEventListener('click', (e) => {
    e.preventDefault();
    const u = 'echoextension';
    const d = 'hotmail' + '.com';
    window.location.href = 'mai' + 'lto:' + u + '@' + d;
  });
  
  // 初始化返回顶部按钮
  initBackToTop();
  
  // 初始化滚动跟随导航
  initScrollNav();
  
  // 初始化备份与恢复
  backupController.init();
});

// ============================================
// 滚动跟随导航
// ============================================

/**
 * 初始化滚动跟随导航。
 * 只跟踪左侧已有的五个目标。
 */
function initScrollNav() {
  if (initScrollNav.initialized) return;
  initScrollNav.initialized = true;

  const navItems = [...document.querySelectorAll('.scroll-nav-item[data-target]')];
  const targets = navItems.map(item => ({
    item,
    section: document.getElementById(item.dataset.target)
  })).filter(target => target.section);

  if (!targets.length) return;

  let frameId = 0;
  let pendingTargetId = null;
  let pendingTimer = 0;

  const getTopOffset = () => {
    const bookmarkHeight = parseFloat(getComputedStyle(document.documentElement)
      .getPropertyValue('--bookmark-bar-height')) || 0;
    const settings = document.querySelector('.settings');
    const settingsStyle = settings ? getComputedStyle(settings) : null;
    const paddingTop = parseFloat(settingsStyle?.paddingTop) || 0;
    const zoom = parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
    return bookmarkHeight + paddingTop * zoom;
  };

  const setActive = (targetId) => {
    navItems.forEach(item => item.classList.toggle('active', item.dataset.target === targetId));
  };

  const updateFromPosition = () => {
    frameId = 0;
    const activationLine = getTopOffset() + 8;
    if (pendingTargetId) {
      const pending = document.getElementById(pendingTargetId);
      if (pending && Math.abs(pending.getBoundingClientRect().top - getTopOffset()) <= 3) {
        clearTimeout(pendingTimer);
        pendingTargetId = null;
      } else {
        return;
      }
    }

    let activeId = targets[0].section.id;
    for (const target of targets) {
      if (target.section.getBoundingClientRect().top <= activationLine) {
        activeId = target.section.id;
      } else {
        break;
      }
    }
    setActive(activeId);
  };

  const scheduleUpdate = () => {
    if (!frameId) frameId = requestAnimationFrame(updateFromPosition);
  };

  const scrollToTarget = (target, behavior = 'smooth') => {
    pendingTargetId = target.section.id;
    clearTimeout(pendingTimer);
    setActive(pendingTargetId);
    const top = window.scrollY + target.section.getBoundingClientRect().top - getTopOffset();
    window.scrollTo({ top, behavior });
    pendingTimer = setTimeout(() => {
      pendingTargetId = null;
      scheduleUpdate();
    }, behavior === 'smooth' ? 2000 : 0);
  };
  
  // 点击导航项时平滑滚动到对应分区
  targets.forEach(target => {
    const { item } = target;
    item.addEventListener('click', (e) => {
      e.preventDefault();
      history.replaceState(null, '', `#${target.section.id}`);
      scrollToTarget(target);
    });
  });

  window.addEventListener('scroll', scheduleUpdate, { passive: true });
  window.addEventListener('resize', scheduleUpdate);
  window.addEventListener('wheel', () => {
    if (!pendingTargetId) return;
    clearTimeout(pendingTimer);
    pendingTargetId = null;
    scheduleUpdate();
  }, { passive: true });
  window.addEventListener('touchstart', () => {
    if (!pendingTargetId) return;
    clearTimeout(pendingTimer);
    pendingTargetId = null;
    scheduleUpdate();
  }, { passive: true });
  document.addEventListener('pointerdown', () => {
    if (!pendingTargetId) return;
    clearTimeout(pendingTimer);
    pendingTargetId = null;
    scheduleUpdate();
  }, { passive: true, capture: true });
  document.addEventListener('keydown', (event) => {
    if (!pendingTargetId || !['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) return;
    clearTimeout(pendingTimer);
    pendingTargetId = null;
    scheduleUpdate();
  }, true);
  window.addEventListener('scrollend', () => {
    if (!pendingTargetId) return;
    clearTimeout(pendingTimer);
    pendingTargetId = null;
    scheduleUpdate();
  });

  const hashTarget = targets.find(target => `#${target.section.id}` === window.location.hash);
  if (hashTarget) {
    setTimeout(() => scrollToTarget(hashTarget), 300);
  } else {
    scheduleUpdate();
  }
}

// ============================================
// 返回顶部按钮
// ============================================

/**
 * 初始化返回顶部按钮
 */
function initBackToTop() {
  const backToTopBtn = document.getElementById('backToTop');
  if (!backToTopBtn) return;
  
  // 监听滚动事件，控制按钮显示/隐藏
  window.addEventListener('scroll', () => {
    if (window.scrollY > 300) {
      backToTopBtn.classList.add('visible');
    } else {
      backToTopBtn.classList.remove('visible');
    }
  });
  
  // 点击返回顶部
  backToTopBtn.addEventListener('click', () => {
    window.scrollTo({
      top: 0,
      behavior: 'smooth'
    });
  });
}

function initSiteEnhancementDemos() {
  const demos = document.querySelectorAll('.bili-demo-stage, .options-bili-feed-demo');
  if (!demos.length) return;

  const setRunning = (demo, running, restart = false) => {
    demo.classList.toggle('animating', running);
    requestAnimationFrame(() => {
      demo.getAnimations({ subtree: true }).forEach(animation => {
        if (running) {
          if (restart) animation.currentTime = 0;
          animation.play();
        } else {
          animation.pause();
        }
      });
    });
  };

  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      const running = entry.isIntersecting && entry.intersectionRatio >= 0.15;
      setRunning(entry.target, running, running);
    });
  }, { threshold: [0, 0.15, 0.4] });

  demos.forEach(demo => {
    observer.observe(demo);
    const rect = demo.getBoundingClientRect();
    const visible = rect.bottom > 0 && rect.top < window.innerHeight;
    setRunning(demo, visible, true);
  });

  document.addEventListener('visibilitychange', () => {
    demos.forEach(demo => {
      const rect = demo.getBoundingClientRect();
      const visible = rect.bottom > 0 && rect.top < window.innerHeight;
      setRunning(demo, visible, false);
    });
  });
}

// ============================================
// 平台检测与快捷键显示适配
// ============================================

/**
 * 检测是否为 Mac 平台
 */
function isMacPlatform() {
  return navigator.platform.toUpperCase().indexOf('MAC') >= 0 || 
         navigator.userAgent.toUpperCase().indexOf('MAC') >= 0;
}

/**
 * 根据平台适配页面上的快捷键显示
 * Mac 用户看到 ⌘/Option，Windows 用户看到 Ctrl/Alt
 */
function adaptShortcutsForPlatform() {
  const isMac = isMacPlatform();
  if (!isMac) return; // Windows 用户无需替换，HTML 默认就是 Windows 版本
  
  // 快捷键映射表：Windows -> Mac（使用 Mac 符号风格）
  const keyMappings = [
    { from: 'Ctrl+鼠标滚轮', to: '⌘+鼠标滚轮' },
    { from: 'Ctrl+滚轮', to: '⌘+滚轮' },
    { from: 'Ctrl+B', to: '⌘B' },
    { from: 'Ctrl+T', to: '⌘T' },
    { from: 'Ctrl+Q', to: '⌃⇧Q' },  // Mac 老板键改为 Ctrl+Shift+Q
    { from: 'Alt+鼠标点击', to: '⌥+点击' },
    { from: 'Alt+M', to: '⌥M' },
    { from: 'Alt+点击', to: '⌥+点击' },
    { from: 'Alt 键', to: '⌥ 键' },
    { from: '按住 Alt', to: '按住 ⌥' }
  ];
  
  // 遍历所有需要替换的元素
  // 1. .shortcut 标签（如 <span class="shortcut">Ctrl+B</span>）
  document.querySelectorAll('.shortcut').forEach(el => {
    keyMappings.forEach(({ from, to }) => {
      if (el.textContent.includes(from)) {
        el.textContent = el.textContent.replace(from, to);
      }
    });
  });
  
  // 2. 普通段落中的快捷键文本
  document.querySelectorAll('.option-info p, .note, .lab-warning').forEach(el => {
    keyMappings.forEach(({ from, to }) => {
      if (el.innerHTML.includes(from)) {
        el.innerHTML = el.innerHTML.replace(new RegExp(from.replace(/[+]/g, '\\+'), 'g'), to);
      }
    });
  });
}

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', () => {
  initSiteEnhancementDemos();
  adaptShortcutsForPlatform();
});

// ============================================
// 备份与恢复
// ============================================

/**
 * 初始化备份与恢复功能
 */
function initBackupRestore() {
  backupController.init();
}

/**
 * 导出备份
 */
async function handleExportBackup() {
  return backupController.handleExportBackup();
}

/**
 * 导入备份
 */
async function handleImportBackup(e) {
  return backupController.handleImportBackup(e);
}

/**
 * 显示备份操作结果（复用快速保存图片的 toast 风格）
 */
function showBackupResult(type, message) {
  return backupController.showBackupResult(type, message);
}
