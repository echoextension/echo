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
  'superDrag',
  'tabSwitchKey',         // F2/F3 切换标签
  'quickSaveImage'        // Alt+点击快速保存图片
];

// 开关类设置 - 默认关闭（非实验室）
const SETTING_IDS_DEFAULT_OFF = [
  'superDragActivate',         // 拖拽产生的标签立即激活（默认关闭，即后台打开）
  'quickSaveImageDateFolder',  // 按日期创建子文件夹
  'applyToPlusButton'          // 同时应用于「+」新建标签页
];

// 开关类设置 - 默认关闭（实验室功能）
const SETTING_IDS_OFF = [
  'floatingSearchBoxAlwaysShow',  // 悬浮搜索框常驻显示（默认关闭）
  'floatingSearchBoxFollowZoom',  // 悬浮搜索框跟随页面缩放（默认关闭）
  'relatedSearchFollowZoom'       // 关联搜索推荐跟随页面缩放（默认关闭）
];

// 开关类设置 - 默认开启（实验室功能）
const SETTING_IDS_ON_LAB = [
  'floatingSearchBox',        // 悬浮搜索框（默认开启）
  'floatingSearchBoxTrending' // 悬浮搜索框热搜榜（默认开启）
];

// 单选设置
const RADIO_SETTINGS = [
  'closeTabActivate',
  'newTabPosition',
  'newTabOrder'
];

// 默认设置（与 background.js 保持一致）
// 注意：所有开关默认开启，实验室功能默认关闭
const DEFAULT_SETTINGS = {
  mouseGesture: true,
  bossKey: true,
  quickMute: true,
  fineZoom: true,
  fineZoomLargeStep: true,     // 大比例时加速步进
  superDrag: true,
  superDragActivate: false,    // 拖拽产生的标签立即激活（默认关闭，即后台打开）
  tabSwitchKey: true,          // F2/F3 切换标签
  quickSaveImage: true,        // Alt+点击快速保存图片
  quickSaveImageDateFolder: false, // 按日期创建子文件夹（默认关闭）
  floatingSearchBox: true,     // 悬浮搜索框（默认开启）
  floatingSearchBoxAlwaysShow: false,  // 悬浮搜索框常驻显示（默认关闭）
  floatingSearchBoxFollowZoom: false,  // 悬浮搜索框跟随页面缩放（默认关闭）
  floatingSearchBoxTrending: true,     // 悬浮搜索框热搜榜（默认开启）
  relatedSearchRecommend: false, // 网页关联搜索推荐（实验室，默认关闭）
  relatedSearchFollowZoom: false,  // 关联搜索推荐跟随页面缩放（默认关闭）
  customBookmarkBar: false,    // 自绘书签栏（已隐藏，默认关闭）
  bookmarkOpenInNewTab: false, // 收藏栏点击链接新标签打开（已隐藏，默认关闭）
  bookmarkBarPinned: true,     // 收藏栏常驻显示（已隐藏）
  closeTabActivate: 'left',    // 关闭标签后激活左侧
  newTabPosition: 'afterCurrent',
  newTabOrder: 'newest',
  applyToPlusButton: false     // 同时应用于「+」新建标签页
};

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
  
  // 加载开关状态（默认关闭的 - 非实验室）
  SETTING_IDS_DEFAULT_OFF.forEach(id => {
    const checkbox = document.getElementById(id);
    if (checkbox) {
      checkbox.checked = settings[id];
    }
  });
  
  // 加载开关状态（默认关闭的 - 实验室）
  SETTING_IDS_OFF.forEach(id => {
    const checkbox = document.getElementById(id);
    if (checkbox) {
      checkbox.checked = settings[id];
    }
  });

  // 加载关联搜索推荐（单独处理）
  const relatedSearchCheckbox = document.getElementById('relatedSearchRecommend');
  if (relatedSearchCheckbox) {
    relatedSearchCheckbox.checked = settings['relatedSearchRecommend'];
  }
  
  // 加载开关状态（实验室子功能，默认开启的）
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
  
  // 更新关联搜索推荐子选项状态
  updateRelatedSearchOptionState(settings.relatedSearchRecommend);
  
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
 * 更新关联搜索推荐子选项的可用状态（显示/隐藏）
 */
function updateRelatedSearchOptionState(relatedSearchRecommend) {
  const followZoomOption = document.getElementById('relatedSearchFollowZoomOption');
  const blacklistOption = document.getElementById('relatedSearchBlacklistOption');
  
  if (relatedSearchRecommend) {
    if (followZoomOption) followZoomOption.style.display = 'flex';
    if (blacklistOption) blacklistOption.style.display = 'flex';
  } else {
    if (followZoomOption) followZoomOption.style.display = 'none';
    if (blacklistOption) blacklistOption.style.display = 'none';
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
  chrome.storage.sync.set({ [key]: value });
}

/**
 * 恢复默认设置
 */
async function resetToDefaults() {
  // 保存默认设置
  await chrome.storage.sync.set(DEFAULT_SETTINGS);
  
  // 重新加载 UI
  await loadSettings();
}

/**
 * 初始化事件监听
 */
function initializeEventListeners() {
  // 监听来自其他地方的设置变化，实时更新 UI
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'sync') {
      // 可以在这里添加其他设置变化的监听
    }
  });

  // 监听开关变化（默认开启的）
  SETTING_IDS.forEach(id => {
    const checkbox = document.getElementById(id);
    if (checkbox) {
      checkbox.addEventListener('change', (e) => {
        saveSetting(id, e.target.checked);
        
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
  
  // 监听开关变化（默认关闭的 - 非实验室）
  SETTING_IDS_DEFAULT_OFF.forEach(id => {
    const checkbox = document.getElementById(id);
    if (checkbox) {
      checkbox.addEventListener('change', (e) => {
        saveSetting(id, e.target.checked);
      });
    }
  });
  
  // 监听开关变化（默认关闭的 - 实验室）
  SETTING_IDS_OFF.forEach(id => {
    const checkbox = document.getElementById(id);
    if (checkbox) {
      checkbox.addEventListener('change', (e) => {
        saveSetting(id, e.target.checked);
      });
    }
  });
  
  // 监听开关变化（实验室功能，默认开启的）
  SETTING_IDS_ON_LAB.forEach(id => {
    const checkbox = document.getElementById(id);
    if (checkbox) {
      checkbox.addEventListener('change', (e) => {
        saveSetting(id, e.target.checked);
        
        // 悬浮搜索框开关联动子选项
        if (id === 'floatingSearchBox') {
          updateFloatingSearchBoxOptionState(e.target.checked);
        }
      });
    }
  });
  
  // 监听关联搜索推荐开关（单独处理，需要隐私确认）
  const relatedSearchCheckbox = document.getElementById('relatedSearchRecommend');
  if (relatedSearchCheckbox) {
    // 使用 'click' 事件以更好拦截状态改变
    relatedSearchCheckbox.addEventListener('click', (e) => {
      // 如果当前是选中状态，说明用户刚点击想开启（点击前是未选中，点击后浏览器置为选中）
      if (e.target.checked) {
        e.preventDefault(); // 阻止复选框状态改变（保持未选中）
        
        // 显示模态框
        const modal = document.getElementById('item-modal-overlay');
        const confirmBtn = document.getElementById('modal-confirm-btn');
        const cancelBtn = document.getElementById('modal-cancel-btn');
        
        if (modal) {
          // 清除可能存在的 inline opacity (关键修复：解决 opacity: 0 覆盖 CSS 问题)
          modal.style.opacity = ''; 
          modal.style.display = 'flex';
          
          // 强制重绘
          requestAnimationFrame(() => {
             modal.classList.add('show');
          });

          // Defines callbacks
          let onConfirm, onCancel;

          // 清理函数
          const cleanup = () => {
             modal.classList.remove('show');
             // 这里的延时最好配合 CSS transition 时间
             setTimeout(() => {
                if (!modal.classList.contains('show')) { // 双重检查防止快速切换
                    modal.style.display = 'none';
                }
             }, 300);
             
             confirmBtn.removeEventListener('click', onConfirm);
             cancelBtn.removeEventListener('click', onCancel);
          };

          // 确认开启
          onConfirm = () => {
             relatedSearchCheckbox.checked = true; // 程序化勾选
             saveSetting('relatedSearchRecommend', true);
             updateRelatedSearchOptionState(true);
             cleanup();
          };

          // 取消/拒绝
          onCancel = () => {
             // 保持未选中
             // saveSetting 确保状态为 false
             saveSetting('relatedSearchRecommend', false);
             updateRelatedSearchOptionState(false);
             cleanup();
          };

          confirmBtn.addEventListener('click', onConfirm);
          cancelBtn.addEventListener('click', onCancel);
        }
      } else {
        // 用户想关闭 -> 直接允许，并保存
        saveSetting('relatedSearchRecommend', false);
        updateRelatedSearchOptionState(false);
      }
    }); // End of listener
  }
  
  // 监听 radio 按钮变化
  RADIO_SETTINGS.forEach(name => {
    const radios = document.querySelectorAll(`input[name="${name}"]`);
    radios.forEach(radio => {
      radio.addEventListener('change', (e) => {
        saveSetting(name, e.target.value);
        
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

// ============================================
// 自绘收藏栏初始化
// ============================================

/**
 * 获取当前收藏栏高度（根据密度设置）
 */
async function getBookmarkBarHeight() {
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
 * 注意：设置页使用 CSS zoom 缩放，需要考虑缩放比例
 */
function setBookmarkBarHeightVar(height) {
  document.documentElement.style.setProperty('--bookmark-bar-height', height + 'px');
}

/**
 * 初始化自绘收藏栏
 */
async function initBookmarkBar() {
  // 检查 EchoBookmarkBar 模块是否已加载
  if (!window.EchoBookmarkBar || !window.EchoBookmarkBar.init) {
    console.warn('[ECHO Options] BookmarkBar module not loaded');
    return;
  }
  
  // 读取用户设置，检查是否启用了自绘收藏栏
  const settings = await chrome.storage.sync.get({
    customBookmarkBar: false,
    bookmarkOpenInNewTab: true
  });
  
  // 在设置页显示收藏栏（如果用户开启了该功能）
  if (settings.customBookmarkBar) {
    // 获取并设置收藏栏高度
    const barHeight = await getBookmarkBarHeight();
    setBookmarkBarHeightVar(barHeight);
    
    await window.EchoBookmarkBar.init({
      customBookmarkBar: true,
      bookmarkOpenInNewTab: settings.bookmarkOpenInNewTab
    });
  }
}

// 监听设置变化（包括密度变化、收藏栏开关变化）
chrome.storage.onChanged.addListener(async (changes, areaName) => {
  if (areaName !== 'sync') return;
  
  // 密度变化时更新高度
  if (changes.bookmarkBarDensity) {
    const barHeight = await getBookmarkBarHeight();
    setBookmarkBarHeightVar(barHeight);
  }
  
  // 收藏栏开关变化时重新初始化或移除
  if (changes.customBookmarkBar) {
    if (changes.customBookmarkBar.newValue) {
      // 开启收藏栏
      await initBookmarkBar();
    } else {
      // 关闭收藏栏
      setBookmarkBarHeightVar(0);
      if (window.EchoBookmarkBar && window.EchoBookmarkBar.destroy) {
        window.EchoBookmarkBar.destroy();
      }
    }
  }
});

// 监听来自 background 的消息（书签更新）
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'bookmarkBarUpdated' || message.action === 'bookmarkFolderUpdated') {
    if (window.EchoBookmarkBar && window.EchoBookmarkBar.handleMessage) {
      const settings = { customBookmarkBar: true }; // 设置页上已初始化就认为开启了
      window.EchoBookmarkBar.handleMessage(message, settings);
    }
    sendResponse({ ok: true });
    return false;
  }
  return false;
});

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', async () => {
  // 初始化自绘收藏栏
  await initBookmarkBar();
  
  await loadSettings();
  initializeEventListeners();
  await loadShortcuts();
  
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
  
  // 初始化设置页鼠标手势和精细缩放支持
  initOptionsPageGestures();
  
  // 初始化返回顶部按钮
  initBackToTop();
  
  // 初始化滚动跟随导航
  initScrollNav();
});

/**
 * 初始化返回顶部按钮
 */
function initBackToTop() {
  const btn = document.getElementById('backToTop');
  if (!btn) return;

  window.addEventListener('scroll', () => {
    if (window.scrollY > 300) {
      btn.classList.add('visible');
    } else {
      btn.classList.remove('visible');
    }
  }, { passive: true });

  btn.addEventListener('click', () => {
    window.scrollTo({
      top: 0,
      behavior: 'smooth'
    });
  });
}

// ============================================
// 设置页鼠标手势和精细缩放支持
// 让用户在设置页就能直接体验这些功能
// ============================================

function initOptionsPageGestures() {
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
    // 获取当前设置状态
    const mouseGestureEnabled = document.getElementById('mouseGesture')?.checked;
    const fineZoomEnabled = document.getElementById('fineZoom')?.checked;
    const fineZoomLargeStepEnabled = document.getElementById('fineZoomLargeStep')?.checked;
    
    // 精细缩放：Ctrl + 滚轮
    if (e.ctrlKey && fineZoomEnabled) {
      e.preventDefault();
      e.stopPropagation();
      
      // 获取当前缩放
      const response = await chrome.runtime.sendMessage({ action: 'getZoom' });
      const currentZoom = response?.zoom || 1;
      const currentZoomRounded = Math.round(currentZoom * 100);
      const isZoomingIn = e.deltaY < 0;
      
      let newZoom;
      
      // 大比例加速步进逻辑
      if (fineZoomLargeStepEnabled) {
        if (isZoomingIn) {
          if (currentZoomRounded >= 175) {
            newZoom = currentZoom + 0.25;
            newZoom = Math.round(newZoom * 4) / 4;
          } else {
            newZoom = currentZoom + 0.05;
            newZoom = Math.round(newZoom * 20) / 20;
          }
        } else {
          if (currentZoomRounded > 175) {
            newZoom = currentZoom - 0.25;
            newZoom = Math.round(newZoom * 4) / 4;
            if (newZoom < 1.75) newZoom = 1.75;
          } else {
            newZoom = currentZoom - 0.05;
            newZoom = Math.round(newZoom * 20) / 20;
          }
        }
      } else {
        newZoom = isZoomingIn ? currentZoom + 0.05 : currentZoom - 0.05;
        newZoom = Math.round(newZoom * 20) / 20;
      }
      
      // 限制范围 25% - 500%
      newZoom = Math.max(0.25, Math.min(5.0, newZoom));
      
      await chrome.runtime.sendMessage({ action: 'setZoom', zoom: newZoom });
      showZoomIndicator(Math.round(newZoom * 100));
      return;
    }
    
    // 鼠标手势：右键 + 滚轮切换标签（使用 e.buttons 实时检测）
    const isRightButtonPressed = (e.buttons & 2) !== 0;
    if (isRightButtonPressed && !e.ctrlKey && mouseGestureEnabled) {
      e.preventDefault();
      e.stopPropagation();
      preventContextMenu = true;
      wheelCount++;
      
      // 优化节流：50ms
      const currentTime = Date.now();
      if (currentTime - lastWheelTime < 50) return;
      lastWheelTime = currentTime;
      
      const direction = e.deltaY > 0 ? 'right' : 'left';
      chrome.runtime.sendMessage({ action: 'switchTab', direction, source: 'mouseGesture' });
    }
  }, { passive: false, capture: true });
  
  // F2/F3 切换标签 - 使用 keydown 捕获阶段，优先于浏览器内置快捷键
  document.addEventListener('keydown', (e) => {
    const tabSwitchKeyEnabled = document.getElementById('tabSwitchKey')?.checked;
    
    if (tabSwitchKeyEnabled && (e.key === 'F2' || e.key === 'F3')) {
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
}

// 缩放指示器
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
// 超级拖拽：拖拽链接/文字
// ============================================

(function initOptionsSuperDrag() {
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
// 黑名单管理
// ============================================

/**
 * 初始化黑名单管理功能
 */
async function initBlacklistManager() {
  const container = document.getElementById('blacklistContainer');
  const itemsDiv = document.getElementById('blacklistItems');
  const emptyDiv = document.getElementById('blacklistEmpty');
  const clearBtn = document.getElementById('blacklistClearBtn');
  
  if (!container || !itemsDiv || !emptyDiv || !clearBtn) return;
  
  // 加载并渲染黑名单
  await renderBlacklist();
  
  // 监听 storage 变化，实时更新
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'sync' && changes.relatedSearchBlacklist) {
      renderBlacklist();
    }
  });
  
  // 清空按钮点击事件
  clearBtn.addEventListener('click', async () => {
    if (confirm('确定要清空所有已屏蔽的网站吗？')) {
      await chrome.storage.sync.set({ relatedSearchBlacklist: [] });
      renderBlacklist();
    }
  });
}

/**
 * 渲染黑名单列表
 */
async function renderBlacklist() {
  const itemsDiv = document.getElementById('blacklistItems');
  const emptyDiv = document.getElementById('blacklistEmpty');
  const clearBtn = document.getElementById('blacklistClearBtn');
  
  if (!itemsDiv || !emptyDiv || !clearBtn) return;
  
  // 获取黑名单数据
  const { relatedSearchBlacklist = [] } = await chrome.storage.sync.get('relatedSearchBlacklist');
  
  // 清空现有内容
  itemsDiv.innerHTML = '';
  
  if (relatedSearchBlacklist.length === 0) {
    // 显示空状态
    emptyDiv.style.display = 'flex';
    itemsDiv.style.display = 'none';
    clearBtn.style.display = 'none';
  } else {
    // 显示列表
    emptyDiv.style.display = 'none';
    itemsDiv.style.display = 'flex';
    clearBtn.style.display = 'inline-flex';
    
    // 渲染每个域名
    relatedSearchBlacklist.forEach(domain => {
      const item = document.createElement('div');
      item.className = 'blacklist-item';
      item.innerHTML = `
        <span class="domain-text" title="${domain}">${domain}</span>
        <button class="remove-btn" title="移除此网站">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      `;
      
      // 点击移除按钮
      const removeBtn = item.querySelector('.remove-btn');
      removeBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await removeDomainFromBlacklist(domain);
      });
      
      itemsDiv.appendChild(item);
    });
  }
}

/**
 * 从黑名单中移除指定域名
 * @param {string} domain - 要移除的域名
 */
async function removeDomainFromBlacklist(domain) {
  const { relatedSearchBlacklist = [] } = await chrome.storage.sync.get('relatedSearchBlacklist');
  const newList = relatedSearchBlacklist.filter(d => d !== domain);
  await chrome.storage.sync.set({ relatedSearchBlacklist: newList });
  renderBlacklist();
}

// ============================================
// 滚动跟随导航
// ============================================

/**
 * 初始化滚动跟随导航
 * 使用 Intersection Observer 监听分区进入视口
 */
function initScrollNav() {
  const navItems = document.querySelectorAll('.scroll-nav-item');
  const sections = document.querySelectorAll('.settings-section[id]');
  
  if (!navItems.length || !sections.length) return;
  
  // 点击导航项时平滑滚动到对应分区
  navItems.forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      const targetId = item.getAttribute('data-target');
      const targetSection = document.getElementById(targetId);
      
      if (targetSection) {
        // 计算滚动位置，考虑顶部间距
        const offsetTop = targetSection.offsetTop - 48;
        window.scrollTo({
          top: offsetTop,
          behavior: 'smooth'
        });
        
        // 立即更新激活状态
        navItems.forEach(nav => nav.classList.remove('active'));
        item.classList.add('active');
      }
    });
  });
  
  // 使用 Intersection Observer 监听分区可见性
  const observerOptions = {
    root: null,
    rootMargin: '-10% 0px -70% 0px', // 当分区进入视口上部时触发
    threshold: 0
  };
  
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const sectionId = entry.target.id;
        
        // 更新导航激活状态
        navItems.forEach(nav => {
          if (nav.getAttribute('data-target') === sectionId) {
            navItems.forEach(n => n.classList.remove('active'));
            nav.classList.add('active');
          }
        });
      }
    });
  }, observerOptions);
  
  // 观察所有分区
  sections.forEach(section => observer.observe(section));
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
  initScrollNav();
  initBackToTop();
  adaptShortcutsForPlatform();
  initBlacklistManager();
});
