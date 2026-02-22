/**
 * ECHO Background Service Worker
 * 处理快捷键命令和标签页事件
 */

// Jieba library removed in Lite version


// ============================================
// 默认设置
// ============================================

const DEFAULT_SETTINGS = {
  mouseGesture: true,
  bossKey: true,
  quickMute: true,
  fineZoom: true,
  superDrag: true,
  superDragActivate: false,    // 拖拽产生的标签是否立即激活，默认关闭（即后台打开）
  tabSwitchKey: true,          // F2/F3 切换标签，默认开启
  floatingSearchBox: true,     // 悬浮搜索框（实验室），默认开启
  floatingSearchBoxAlwaysShow: false,  // 悬浮搜索框常驻显示，默认关闭
  floatingSearchBoxTrending: true,     // 悬浮搜索框热搜榜，默认开启
  customBookmarkBar: false,    // 自绘书签栏（已隐藏），默认关闭
  bookmarkBarPinned: true,     // 书签栏是否固定显示（已隐藏）
  bookmarkOpenInNewTab: false, // 收藏栏点击链接新标签打开（已隐藏，默认关闭）
  quickSaveImage: true,        // Alt+点击快速保存图片，默认开启
  quickSaveImageDateFolder: false, // 按日期创建子文件夹（在ECHO目录内）
  // 标签页行为设置
  closeTabActivate: 'left',    // 'left' | 'right' - 关闭标签后激活哪侧
  newTabPosition: 'afterCurrent',  // 'afterCurrent' | 'atEnd'
  newTabOrder: 'newest',            // 'newest' | 'ordered'
  applyToPlusButton: false         // 是否将位置规则应用于「+」新建标签页
};

// 初始化设置（含旧设置迁移）+ 首次安装 FRE
chrome.runtime.onInstalled.addListener(async (details) => {
  // 设置初始化/迁移
  chrome.storage.sync.get(null, (items) => {
    const newSettings = { ...DEFAULT_SETTINGS, ...items };
    
    // 迁移旧设置：activateLeftTab (boolean) -> closeTabActivate (string)
    if ('activateLeftTab' in items && !('closeTabActivate' in items)) {
      newSettings.closeTabActivate = items.activateLeftTab ? 'left' : 'right';
      delete newSettings.activateLeftTab;
    }
    
    // 移除已废弃的侧边栏设置
    delete newSettings.sidepanelEnhanced;
    
    chrome.storage.sync.set(newSettings);
  });

  // 首次安装时打开 FRE 引导页
  if (details.reason === 'install') {
    // 检查是否已完成过 FRE（防止重复触发）
    const { freCompleted } = await chrome.storage.local.get('freCompleted');
    if (!freCompleted) {
      chrome.tabs.create({ url: 'fre/fre-step1.html' });
    }
  }
});

// 点击图标事件：直接打开设置页
chrome.action.onClicked.addListener(async (tab) => {
  chrome.runtime.openOptionsPage();
});

// ============================================
// 工具函数
// ============================================

async function getSetting(key) {
  const result = await chrome.storage.sync.get({ [key]: DEFAULT_SETTINGS[key] });
  return result[key];
}

// 老板键状态：记录最小化前的窗口状态
let bossKeyState = {
  isMinimized: false,
  windowStates: [] // 记录每个窗口最小化前的状态
};

// ============================================
// 鼠标手势状态（全局共享，跨标签）
// ============================================

let isRightMouseDown = false;

// ============================================
// 新标签位置控制
// ============================================

/**
 * 每个窗口的新标签插入状态
 * Map<windowId, { baseTabId, baseTabIndex, insertCount }>
 * 
 * baseTabId: 基准标签（触发新开的母标签）
 * baseTabIndex: 基准标签的位置
 * insertCount: 已从该基准插入的新标签数量
 */
const newTabInsertState = new Map();

/**
 * 记录由扩展自己创建的标签 ID（用于在 onCreated 中跳过）
 */
const extensionCreatedTabs = new Set();

/**
 * 获取或初始化窗口的插入状态
 */
function getInsertState(windowId) {
  if (!newTabInsertState.has(windowId)) {
    newTabInsertState.set(windowId, {
      baseTabId: null,
      baseTabIndex: -1,
      insertCount: 0
    });
  }
  return newTabInsertState.get(windowId);
}

/**
 * 更新基准标签（当用户切换标签时调用）
 */
async function updateBaseTab(tabId, windowId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    const state = getInsertState(windowId);
    // 只有当 baseTabId 仍然是当前 tabId 时才更新索引
    // 防止异步操作期间用户又切换了标签
    if (state.baseTabId === tabId) {
      state.baseTabIndex = tab.index;
      // insertCount 已在 onActivated 中重置
    }
  } catch (e) {
    // 标签可能已不存在
  }
}

/**
 * 计算新标签应该插入的位置
 */
async function calculateNewTabIndex(windowId) {
  const settings = await chrome.storage.sync.get({
    newTabPosition: DEFAULT_SETTINGS.newTabPosition,
    newTabOrder: DEFAULT_SETTINGS.newTabOrder
  });
  
  // 如果设置是"最右侧"，返回 undefined 让浏览器使用默认行为
  if (settings.newTabPosition === 'atEnd') {
    return undefined;
  }
  
  const state = getInsertState(windowId);
  
  // 如果 baseTabIndex 无效但有 ID，尝试刷新
  if (state.baseTabIndex < 0 && state.baseTabId) {
    try {
      const baseTab = await chrome.tabs.get(state.baseTabId);
      state.baseTabIndex = baseTab.index;
    } catch (e) {}
  }

  // 如果没有基准标签，获取当前激活的标签
  if (state.baseTabId === null || state.baseTabIndex < 0) {
    try {
      const [activeTab] = await chrome.tabs.query({ windowId, active: true });
      if (activeTab) {
        state.baseTabId = activeTab.id;
        state.baseTabIndex = activeTab.index;
        state.insertCount = 0;
      }
    } catch (e) {
      return undefined;
    }
  }
  
  let targetIndex;
  
  if (settings.newTabOrder === 'newest') {
    // 最新的靠前：总是在 baseTabIndex + 1
    targetIndex = state.baseTabIndex + 1;
  } else {
    // 按打开顺序：在 baseTabIndex + 1 + insertCount
    targetIndex = state.baseTabIndex + 1 + state.insertCount;
  }
  
  state.insertCount++;
  return targetIndex;
}

/**
 * 监听标签激活变化，更新基准标签
 */
chrome.tabs.onActivated.addListener(async ({ tabId, windowId }) => {
  // 如果正在处理标签关闭，不更新基准
  if (isProcessingRemoval) return;
  
  // 同步更新 ID 并标记索引为待定，解决 Race Condition
  const state = getInsertState(windowId);
  state.baseTabId = tabId;
  state.baseTabIndex = -1;
  state.insertCount = 0;
  
  await updateBaseTab(tabId, windowId);
});

/**
 * 监听标签移动，同步更新基准标签位置
 * 解决用户拖拽标签后 baseTabIndex 不同步的问题
 */
chrome.tabs.onMoved.addListener(async (tabId, { windowId, fromIndex, toIndex }) => {
  const state = getInsertState(windowId);
  
  // 如果移动的是基准标签本身，直接更新其位置
  if (state.baseTabId === tabId) {
    state.baseTabIndex = toIndex;
    // 重置插入计数，因为位置变了，之前插入的标签相对位置也变了
    state.insertCount = 0;
    return;
  }
  
  // 如果其他标签移动影响了基准标签的相对位置，需要调整
  // Chrome 的 onMoved 事件：fromIndex 是移动前位置，toIndex 是移动后位置
  if (state.baseTabIndex >= 0) {
    if (fromIndex < toIndex) {
      // 标签向右移动：fromIndex 和 toIndex 之间的标签都会左移一位
      // 如果基准标签在这个范围内（包含 fromIndex 后一位到 toIndex）
      if (state.baseTabIndex > fromIndex && state.baseTabIndex <= toIndex) {
        state.baseTabIndex--;
      }
    } else if (fromIndex > toIndex) {
      // 标签向左移动：toIndex 和 fromIndex 之间的标签都会右移一位
      // 如果基准标签在这个范围内（包含 toIndex 到 fromIndex 前一位）
      if (state.baseTabIndex >= toIndex && state.baseTabIndex < fromIndex) {
        state.baseTabIndex++;
      }
    }
  }
});

/**
 * 新标签处理队列（防止并发导致顺序错乱）
 * Map<windowId, Promise>
 */
const tabCreationQueue = new Map();

/**
 * 获取窗口的处理队列
 */
function getWindowQueue(windowId) {
  if (!tabCreationQueue.has(windowId)) {
    tabCreationQueue.set(windowId, Promise.resolve());
  }
  return tabCreationQueue.get(windowId);
}

/**
 * 监听由浏览器创建的新标签（收藏夹、地址栏等）
 * 将其移动到正确的位置
 * 使用队列确保同一窗口的标签按顺序处理
 */
chrome.tabs.onCreated.addListener((tab) => {
  // 跳过由扩展创建的标签（已经在 create 时指定了位置）
  if (tab.pendingUrl?.startsWith('chrome-extension://') || 
      tab.url?.startsWith('chrome-extension://')) {
    return;
  }
  
  const windowId = tab.windowId;
  
  // 关键修复：在 onCreated 的同步时刻立即捕获当前的 baseTabId
  // 此时 onActivated 尚未触发（或尚未改变 state），state.baseTabId 还是父标签
  const state = getInsertState(windowId);
  const snapshotBaseTabId = state.baseTabId;
  
  // 将处理任务加入队列，确保顺序执行
  const currentQueue = getWindowQueue(windowId);
  // 将快照 ID 传递给处理函数
  const newQueue = currentQueue.then(() => handleNewTabCreated(tab, snapshotBaseTabId));
  tabCreationQueue.set(windowId, newQueue);
});

/**
 * 处理新创建的标签（实际逻辑）
 */
async function handleNewTabCreated(tab, snapshotBaseTabId) {
  const settings = await chrome.storage.sync.get({
    newTabPosition: DEFAULT_SETTINGS.newTabPosition,
    newTabOrder: DEFAULT_SETTINGS.newTabOrder,
    applyToPlusButton: DEFAULT_SETTINGS.applyToPlusButton
  });
  
  // 如果设置是"最右侧"，不需要移动
  if (settings.newTabPosition === 'atEnd') {
    return;
  }

  // 检查是否是「+」按钮创建的标签页（通常没有 openerTabId 且 URL 是 NTP）
  // 注意：如果用户使用了本扩展的 NTP，URL 可能会在后续变化，但初始 pendingUrl 通常是 edge://newtab/
  
  // 辅助函数：判断 URL 是否是 NTP
  const checkIsNtp = (u) => {
    if (!u) return false;
    // 移除可能存在的参数干扰
    const urlBase = u.split('?')[0];
    
    return urlBase.startsWith('edge://newtab') || 
           urlBase.startsWith('chrome://newtab') ||
           urlBase.includes('/ntp/ntp.html') ||
           // 新增：识别第三方 NTP 插件 (排除本插件自身的其他页面)
           (urlBase.startsWith('chrome-extension://') && !urlBase.includes(chrome.runtime.id));
  };

  // 获取有效 URL：如果 url 是 about:blank 或空字符串，则尝试使用 pendingUrl
  // 很多时候新标签页初始状态是 about:blank，pendingUrl 才是真正的 edge://newtab
  let effectiveUrl = tab.url;
  if ((!effectiveUrl || effectiveUrl === 'about:blank') && tab.pendingUrl) {
    effectiveUrl = tab.pendingUrl;
  }

  const isNtp = checkIsNtp(effectiveUrl);

  // 只要是 NTP 页面，我们就认为是“新建标签页”行为（包括点击+号、Ctrl+T等）
  // 即使有 openerTabId（某些情况下 Edge 会分配，或者通过其他方式触发），只要是 NTP，
  // 我们就遵循 applyToPlusButton 的设置。
  const isPlusTab = isNtp;

  // 如果是「+」创建的标签，且设置不应用，则不移动（保持默认行为，即最右侧）
  if (isPlusTab && !settings.applyToPlusButton) {
    return;
  }
  
  const windowId = tab.windowId;
  let state = getInsertState(windowId);
  
  // 确定基准标签 ID
  // 优先级：
  // 1. tab.openerTabId (如果有，这是最准确的父子关系)
  // 2. snapshotBaseTabId (onCreated 时刻捕获的激活标签)
  // 3. state.baseTabId (当前的激活标签，可能已经被新标签覆盖)
  
  let effectiveBaseTabId = tab.openerTabId || snapshotBaseTabId || state.baseTabId;
  
  // 如果基准标签就是新标签自己（这种情况不应该发生，除非 snapshot 也没抓到），尝试修正
  if (effectiveBaseTabId === tab.id) {
    // 尝试使用 snapshot（如果它不同）或者放弃
    if (snapshotBaseTabId && snapshotBaseTabId !== tab.id) {
      effectiveBaseTabId = snapshotBaseTabId;
    } else {
      // 实在没办法，只能尝试获取当前激活的（虽然可能就是自己）
      // 或者查找当前标签的前一个标签？
      // 这里我们先置空，让后续逻辑去兜底（比如获取 active tab）
      effectiveBaseTabId = null;
    }
  }

  // 如果有了有效的 ID，更新 state 中的基准信息（如果需要）
  // 注意：我们不直接修改 state.baseTabId，因为那代表"当前激活的标签"
  // 我们只是为了计算位置而临时使用 effectiveBaseTabId
  
  let baseTabIndex = -1;
  
  if (effectiveBaseTabId) {
    try {
      const baseTab = await chrome.tabs.get(effectiveBaseTabId);
      baseTabIndex = baseTab.index;
      
      // 如果我们使用的是 openerTabId 或 snapshot，
      // 且它与 state.baseTabId 不同（说明用户已经切换了，或者新标签激活了），
      // 我们是否应该更新 state.insertCount？
      // 如果新标签是"后台打开"，state.baseTabId 没变，insertCount 应该累加。
      // 如果新标签是"前台打开"，state.baseTabId 变成了新标签，insertCount 重置了。
      
      // 这里有一个复杂点：insertCount 是绑定在 state.baseTabId 上的。
      // 如果我们用的 baseTab 不是 state.baseTabId，那么 insertCount 可能不适用。
      
      // 简化逻辑：
      // 如果 effectiveBaseTabId !== state.baseTabId，说明基准变了。
      // 这种情况下，我们应该认为这是一个新的插入序列的开始？
      // 或者，如果 effectiveBaseTabId 是之前的 baseTabId，我们应该继续使用之前的 insertCount？
      
      // 针对用户的问题：前台打开新标签。
      // 1. onCreated: snapshot = OldTab.
      // 2. onActivated: state.baseTabId = NewTab, insertCount = 0.
      // 3. handleNewTab: effective = OldTab.
      
      // 如果我们用 OldTab 作为基准，我们应该把 NewTab 放在 OldTab + 1。
      // 此时 insertCount 应该是多少？
      // 如果这是连续打开的第二个标签（前台），前一个标签已经把焦点抢走了。
      // 用户说：在 3 点击链接打开 X。
      // 3 是激活的。
      // 打开 X (前台)。
      // 此时 3 不再激活。
      // 我们希望 X 在 3 后面。
      
      // 所以，只要我们找到了 3 (OldTab) 的 index，target 就是 index + 1。
      // 这种情况下 insertCount 应该是 0 (因为这是相对于 OldTab 的第一个新标签，或者我们不关心连续性，因为焦点已经变了)。
      
      // 但是，如果用户是"后台打开"多个标签：
      // 1. Click 1 -> NewTab1 (Background). state.baseTabId = OldTab. insertCount = 1.
      // 2. Click 2 -> NewTab2 (Background). state.baseTabId = OldTab. insertCount = 2.
      // 此时 effective = OldTab = state.baseTabId.
      // 我们需要用到 insertCount。
      
      // 结论：
      // 如果 effectiveBaseTabId === state.baseTabId，使用 state.insertCount。
      // 如果 effectiveBaseTabId !== state.baseTabId，说明焦点已变（或者是前台打开），
      // 此时我们只保证它在父标签旁边，insertCount 视为 0。
      
      if (effectiveBaseTabId !== state.baseTabId) {
         // 临时覆盖 state，以便后续逻辑复用
         // 注意：这可能会干扰后续的 onActivated？
         // 不会，因为 onActivated 会再次覆盖它。
         // 但是我们不能修改全局 state.baseTabId，否则会影响后续操作。
         
         // 我们构造一个临时的上下文
         state = {
           baseTabId: effectiveBaseTabId,
           baseTabIndex: baseTabIndex,
           insertCount: 0 // 焦点变了，重置计数
         };
      } else {
         // 即使 ID 相同，也要更新 index 以防万一
         state.baseTabIndex = baseTabIndex;
      }
      
    } catch (e) {
    }
  }
  
  // 如果 baseTabIndex 无效，尝试从当前活动标签初始化
  if (state.baseTabIndex < 0 || state.baseTabId === null) {
    try {
      const [activeTab] = await chrome.tabs.query({ windowId, active: true });
      if (activeTab && activeTab.id !== tab.id) {
        state.baseTabId = activeTab.id;
        state.baseTabIndex = activeTab.index;
        state.insertCount = 0;
      } else {
        // 无法确定基准位置，不移动
        return;
      }
    } catch (e) {
      return;
    }
  }
  
  // 如果是我们自己创建的标签，跳过（已经在 create 时指定了位置并更新了 insertCount）
  if (extensionCreatedTabs.has(tab.id)) {
    extensionCreatedTabs.delete(tab.id);  // 清理
    return;
  }
  
  // 计算目标位置
  let targetIndex;
  if (settings.newTabOrder === 'newest') {
    targetIndex = state.baseTabIndex + 1;
  } else {
    targetIndex = state.baseTabIndex + 1 + state.insertCount;
  }
  // 如果目标位置有效且与当前位置不同，移动标签
  if (targetIndex >= 0 && targetIndex !== tab.index) {
    try {
      await chrome.tabs.move(tab.id, { index: targetIndex });
    } catch (e) {
      // 移动失败，忽略
    }
  } else {
  }
  
  // 无论是否移动，都要增加 insertCount，因为这个位置已经被占用了
  // 注意：如果我们使用的是临时 state（因为焦点变了），不要更新全局 insertCount
  // 只有当我们在同一个 baseTabId 下连续打开时才更新全局 insertCount
  const globalState = getInsertState(windowId);
  if (globalState.baseTabId === state.baseTabId) {
    globalState.insertCount++;
  }
}

// ============================================
// 快捷键处理
// ============================================

chrome.commands.onCommand.addListener(async (command) => {
  switch (command) {
    case 'boss-key':
      await handleBossKey();
      break;
    case 'toggle-mute':
      await handleToggleMute();
      break;
  }
});

/**
 * 老板键：最小化/恢复所有浏览器窗口
 */
async function handleBossKey() {
  const enabled = await getSetting('bossKey');
  if (!enabled) return;

  try {
    const windows = await chrome.windows.getAll();
    
    if (!bossKeyState.isMinimized) {
      // 最小化：记录当前状态，然后最小化所有窗口
      bossKeyState.windowStates = windows.map(win => ({
        id: win.id,
        state: win.state
      }));
      
      await Promise.all(
        windows.map(win => 
          chrome.windows.update(win.id, { state: 'minimized' })
        )
      );
      
      bossKeyState.isMinimized = true;
    } else {
      // 恢复：将窗口恢复到之前的状态
      await Promise.all(
        bossKeyState.windowStates.map(saved => {
          // 如果之前是最小化的，恢复为 normal
          const restoreState = saved.state === 'minimized' ? 'normal' : saved.state;
          return chrome.windows.update(saved.id, { state: restoreState }).catch(() => {});
        })
      );
      
      bossKeyState.isMinimized = false;
      bossKeyState.windowStates = [];
    }
  } catch (error) {
    console.error('Boss key error:', error);
  }
}

/**
 * 一键静音：切换所有发声标签的静音状态
 */
async function handleToggleMute() {
  const enabled = await getSetting('quickMute');
  if (!enabled) return;

  try {
    const tabs = await chrome.tabs.query({});
    const audibleTabs = tabs.filter(tab => tab.audible || tab.mutedInfo?.muted);
    
    if (audibleTabs.length === 0) return;

    // 如果有任何标签在发声，则全部静音；否则全部取消静音
    const shouldMute = audibleTabs.some(tab => tab.audible && !tab.mutedInfo?.muted);
    
    await Promise.all(
      audibleTabs.map(tab =>
        chrome.tabs.update(tab.id, { muted: shouldMute })
      )
    );
  } catch (error) {
    console.error('Toggle mute error:', error);
  }
}

/**
 * 切换到左/右标签页
 * @param {string} direction - 'left' 或 'right'
 * @param {string} source - 调用来源：'mouseGesture' 或 'keyboard'
 */
async function handleSwitchTab(direction, source = 'keyboard') {
  // 只有键盘快捷键（F2/F3）才检查 tabSwitchKey 设置
  // 鼠标手势有自己的 mouseGesture 设置，在 content script 中已检查
  if (source === 'keyboard') {
    const enabled = await getSetting('tabSwitchKey');
    if (!enabled) {
      return;
    }
  }

  try {
    const [currentTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!currentTab) {
      return;
    }

    const tabs = await chrome.tabs.query({ currentWindow: true });
    const currentIndex = tabs.findIndex(t => t.id === currentTab.id);
    const totalTabs = tabs.length;
    
    // 寻找下一个可切换的标签（跳过浏览器内置页面和其他扩展页面）
    let targetIndex = currentIndex;
    let attempts = 0;
    
    do {
      if (direction === 'left') {
        targetIndex = targetIndex > 0 ? targetIndex - 1 : totalTabs - 1;
      } else {
        targetIndex = targetIndex < totalTabs - 1 ? targetIndex + 1 : 0;
      }
      attempts++;
      
      const targetTab = tabs[targetIndex];
      const targetUrl = targetTab.url || '';
      const targetPendingUrl = targetTab.pendingUrl || '';
      
      // 如果是可切换的标签，或者已经尝试了所有标签，就停止
      if (isSwitchableTab(targetUrl, targetPendingUrl) || attempts >= totalTabs) {
        break;
      }
    } while (targetIndex !== currentIndex);
    
    // 如果找到了不同的可切换标签
    if (targetIndex !== currentIndex) {
      const targetTab = tabs[targetIndex];
      await chrome.tabs.update(targetTab.id, { active: true });
      
      // 如果是鼠标手势触发，且目标页面可注入 content script，同步右键状态
      // 这样用户可以继续滚动切换到下一个标签
      if (source === 'mouseGesture' && isRightMouseDown) {
        const targetUrl = targetTab.url || targetTab.pendingUrl || '';
        if (isInjectablePage(targetUrl)) {
          setTimeout(() => {
            chrome.tabs.sendMessage(targetTab.id, {
              action: 'syncMouseGestureState',
              isRightMouseDown: true
            }).catch(() => {}); // 忽略错误（如页面还没加载完）
          }, 50);
        }
      }
    } else {
    }
  } catch (error) {
    console.error('Switch tab error:', error);
  }
}

// ============================================
// 关闭标签时激活左侧标签
// ============================================

/**
 * 每个窗口的标签缓存
 * Map<windowId, { tabs: [tabId, ...], activeTabId: number, lastActiveTabId: number }>
 */
const windowTabsCache = new Map();

// 是否正在处理标签关闭（防止 onActivated 覆盖状态）
let isProcessingRemoval = false;

/**
 * 初始化指定窗口的标签缓存
 */
async function initWindowCache(windowId) {
  try {
    const tabs = await chrome.tabs.query({ windowId });
    const sortedTabs = tabs.sort((a, b) => a.index - b.index);
    const activeTab = sortedTabs.find(t => t.active);
    
    windowTabsCache.set(windowId, {
      tabs: sortedTabs.map(t => t.id),
      activeTabId: activeTab ? activeTab.id : null,
      lastActiveTabId: null
    });
  } catch (error) {
    console.error('Init window cache error:', error);
  }
}

/**
 * 初始化所有窗口的缓存
 */
async function initAllWindowsCache() {
  try {
    const windows = await chrome.windows.getAll();
    await Promise.all(windows.map(win => initWindowCache(win.id)));
  } catch (error) {
    console.error('Init all windows cache error:', error);
  }
}

// 启动时初始化
initAllWindowsCache();

// 监听标签创建
chrome.tabs.onCreated.addListener(async (tab) => {
  const cache = windowTabsCache.get(tab.windowId);
  if (cache) {
    // 在正确的位置插入新标签
    cache.tabs.splice(tab.index, 0, tab.id);
  } else {
    await initWindowCache(tab.windowId);
  }
});

// 监听标签激活
chrome.tabs.onActivated.addListener(({ tabId, windowId }) => {
  // 如果正在处理关闭事件，不更新 activeTabId
  // 因为这是浏览器自动激活下一个标签的行为，不是用户主动切换
  if (isProcessingRemoval) return;
  
  const cache = windowTabsCache.get(windowId);
  if (cache) {
    // 记录上一个激活的标签，用于在 onRemoved 中判断是否是激活标签被关闭
    // (如果 onActivated 先于 onRemoved 发生)
    if (cache.activeTabId !== tabId) {
      cache.lastActiveTabId = cache.activeTabId;
    }
    cache.activeTabId = tabId;
  }
});

// 监听标签移动
chrome.tabs.onMoved.addListener(async (tabId, { windowId, fromIndex, toIndex }) => {
  const cache = windowTabsCache.get(windowId);
  if (cache) {
    // 一致性检查：确保缓存中的标签与移动的标签一致
    if (cache.tabs[fromIndex] !== tabId) {
      console.warn('[ECHO Cache] Cache mismatch detected in onMoved, re-initializing...');
      await initWindowCache(windowId);
      return;
    }
    cache.tabs.splice(fromIndex, 1);
    cache.tabs.splice(toIndex, 0, tabId);
  }
});

// 监听标签从窗口分离
chrome.tabs.onDetached.addListener((tabId, { oldWindowId }) => {
  const cache = windowTabsCache.get(oldWindowId);
  if (cache) {
    const index = cache.tabs.indexOf(tabId);
    if (index !== -1) {
      cache.tabs.splice(index, 1);
    }
    if (cache.activeTabId === tabId) {
      cache.activeTabId = null;
    }
  }
});

// 监听标签附加到窗口
chrome.tabs.onAttached.addListener(async (tabId, { newWindowId, newPosition }) => {
  const cache = windowTabsCache.get(newWindowId);
  if (cache) {
    cache.tabs.splice(newPosition, 0, tabId);
  } else {
    await initWindowCache(newWindowId);
  }
});

// 监听窗口创建
chrome.windows.onCreated.addListener(async (window) => {
  await initWindowCache(window.id);
});

// 监听窗口关闭
chrome.windows.onRemoved.addListener((windowId) => {
  windowTabsCache.delete(windowId);
});

/**
 * 监听标签关闭 - 核心逻辑
 * 
 * 场景矩阵：
 * | 关闭的是激活标签？ | 位置   | 左边有标签？ | 需要干预？ |
 * |-------------------|--------|-------------|-----------|
 * | 否                | 任意   | -           | 不需要    |
 * | 是                | 最右边 | 有          | 不需要（浏览器自动激活左边）|
 * | 是                | 最左边 | 无          | 不需要（只能激活右边）|
 * | 是                | 中间   | 有          | 【需要】激活左边 |
 */
chrome.tabs.onRemoved.addListener(async (tabId, removeInfo) => {
  const { windowId, isWindowClosing } = removeInfo;
  
  // 如果是整个窗口关闭，清理缓存即可
  if (isWindowClosing) {
    windowTabsCache.delete(windowId);
    newTabInsertState.delete(windowId);
    return;
  }
  
  // 标记正在处理标签关闭，阻止 onActivated 重置 insertCount
  isProcessingRemoval = true;
  
  const cache = windowTabsCache.get(windowId);
  if (!cache) {
    // 延迟重置 flag
    setTimeout(() => { isProcessingRemoval = false; }, 100);
    return;
  }
  
  // 获取被关闭标签在缓存中的位置和状态
  const closedIndex = cache.tabs.indexOf(tabId);
  // 判断是否是激活标签被关闭：
  // 1. activeTabId === tabId (onRemoved 先于 onActivated)
  // 2. lastActiveTabId === tabId (onActivated 先于 onRemoved，此时 activeTabId 已经是新的了)
  const wasActive = cache.activeTabId === tabId || cache.lastActiveTabId === tabId;
  // 从缓存中移除该标签（无论是否需要干预都要做）
  if (closedIndex !== -1) {
    cache.tabs.splice(closedIndex, 1);
  } else {
    // 如果缓存中没找到，说明缓存可能已经过期，重新初始化并退出（无法干预）
    console.warn('[ECHO onRemoved] Tab not found in cache, re-initializing...');
    initWindowCache(windowId);
    setTimeout(() => { isProcessingRemoval = false; }, 100);
    return;
  }
  
  // 更新新标签插入状态
  const insertState = newTabInsertState.get(windowId);
  if (insertState && closedIndex !== -1) {
    // 如果关闭的标签在基准标签左边，基准位置要左移
    if (closedIndex < insertState.baseTabIndex) {
      insertState.baseTabIndex--;
    }
    // 如果关闭的标签在基准标签右边、且在已插入的范围内，减少计数
    else if (closedIndex > insertState.baseTabIndex && 
             closedIndex <= insertState.baseTabIndex + insertState.insertCount) {
      insertState.insertCount = Math.max(0, insertState.insertCount - 1);
    }
    // 如果关闭的就是基准标签本身，重置状态
    if (tabId === insertState.baseTabId) {
      insertState.baseTabId = null;
      insertState.baseTabIndex = -1;
      insertState.insertCount = 0;
    }
  }
  
  // 检查功能设置：'left' 或 'right'
  const closeTabActivate = await getSetting('closeTabActivate');
  
  // 场景1：设置为右侧（浏览器默认），不干预
  if (closeTabActivate === 'right') {
    // 更新激活标签为当前实际激活的
    try {
      const [activeTab] = await chrome.tabs.query({ windowId, active: true });
      if (activeTab) cache.activeTabId = activeTab.id;
    } catch (e) {}
    setTimeout(() => { isProcessingRemoval = false; }, 100);
    return;
  }
  
  // 场景2：关闭的不是激活标签，不需要干预
  if (!wasActive) {
    setTimeout(() => { isProcessingRemoval = false; }, 100);
    return;
  }
  
  const remainingTabs = cache.tabs;
  
  // 场景3：没有剩余标签，无法干预
  if (remainingTabs.length === 0) {
    setTimeout(() => { isProcessingRemoval = false; }, 100);
    return;
  }
  
  // 场景4：被关闭的标签在最右边
  // （closedIndex 现在等于 remainingTabs.length，因为数组已缩短）
  if (closedIndex >= remainingTabs.length) {
    // 浏览器会自动激活左边的标签，这正是我们想要的，不需要干预
    cache.activeTabId = remainingTabs[remainingTabs.length - 1];
    setTimeout(() => { isProcessingRemoval = false; }, 100);
    return;
  }
  
  // 场景5：被关闭的标签在最左边（index 0），左边没有标签
  if (closedIndex === 0) {
    // 只能激活右边（浏览器默认行为），不需要干预
    cache.activeTabId = remainingTabs[0];
    setTimeout(() => { isProcessingRemoval = false; }, 100);
    return;
  }
  
  // 场景6：【需要干预】关闭的是中间的标签，我们要激活左边而非右边
  const leftTabId = remainingTabs[closedIndex - 1];
  
  try {
    await chrome.tabs.update(leftTabId, { active: true });
    cache.activeTabId = leftTabId;
  } catch (error) {
    console.error('Activate left tab error:', error);
  } finally {
    // 延迟重置 flag，确保 onActivated 回调不会干扰
    setTimeout(() => {
      isProcessingRemoval = false;
    }, 50);
  }
});

// ============================================
// 消息处理（来自 content script）
// ============================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // DEBUG: 记录所有收到的消息
  // 鼠标手势：右键按下
  if (message.action === 'mouseGestureStart') {
    isRightMouseDown = true;
    sendResponse({ ok: true });
    return false;
  }
  
  // 鼠标手势：右键松开
  if (message.action === 'mouseGestureEnd') {
    isRightMouseDown = false;
    sendResponse({ ok: true });
    return false;
  }
  
  if (message.action === 'switchTab') {
    // source 区分调用来源：鼠标手势 vs 键盘快捷键
    handleSwitchTab(message.direction, message.source || 'mouseGesture').then(() => sendResponse());
    return true;
  }
  
  if (message.action === 'openInNewTab') {
    handleOpenInNewTab(message.url, message.active, message.forceAdjacentPosition).then(() => sendResponse());
    return true;
  }
  
  if (message.action === 'openInCurrentTab') {
    handleOpenInCurrentTab(message.url, sender.tab?.id).then(() => sendResponse());
    return true;
  }
  
  if (message.action === 'searchInNewTab') {
    handleSearchInNewTab(message.text, message.forceAdjacentPosition).then(() => sendResponse());
    return true;
  }

  // Jieba 分词请求
  if (message.action === 'segmentText') {
    (async () => {
      try {
        if (typeof JiebaWasm !== 'undefined' && JiebaWasm.initialized) {
          const result = JiebaWasm.cut_for_search(message.text);
          sendResponse({ success: true, data: result });
        } else {
          sendResponse({ success: false, error: 'Jieba not initialized' });
        }
      } catch (e) {
        console.error('[ECHO Background] Segmentation failed:', e);
        sendResponse({ success: false, error: e.message });
      }
    })();
    return true; // 异步响应
  }

  // 缩放功能
  if (message.action === 'getZoom') {
    // 优先使用 sender.tab.id，如果不存在（如从扩展页面调用）则获取当前活动标签
    const getTabId = async () => {
      if (sender.tab?.id) return sender.tab.id;
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      return activeTab?.id;
    };
    getTabId().then(tabId => {
      if (tabId) {
        chrome.tabs.getZoom(tabId, (zoom) => {
          sendResponse({ zoom: zoom });
        });
      } else {
        sendResponse({ zoom: 1 });
      }
    });
    return true;
  }
  
  if (message.action === 'setZoom') {
    // 优先使用 sender.tab.id，如果不存在（如从扩展页面调用）则获取当前活动标签
    const getTabId = async () => {
      if (sender.tab?.id) return sender.tab.id;
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      return activeTab?.id;
    };
    getTabId().then(tabId => {
      if (tabId) {
        chrome.tabs.setZoom(tabId, message.zoom, () => {
          sendResponse({ success: true });
        });
      } else {
        sendResponse({ success: false });
      }
    });
    return true;
  }

  // 书签栏相关消息
  if (message.action === 'getBookmarkBar') {
    getBookmarkBar().then(data => {
      sendResponse({ success: true, data: data });
    });
    return true;
  }
  
  if (message.action === 'getFolderContents') {
    getFolderContents(message.folderId).then(data => {
      sendResponse({ success: true, data: data });
    });
    return true;
  }
  
  if (message.action === 'addBookmark') {
    addBookmark(message.folderId, message.title, message.url)
      .then(result => {
        sendResponse({ success: true, data: result });
      })
      .catch(error => {
        sendResponse({ success: false, error: error.message });
      });
    return true;
  }
  
  // 创建文件夹
  if (message.action === 'createFolder') {
    chrome.bookmarks.create({
      parentId: message.parentId,
      title: message.title
    })
      .then(data => sendResponse({ success: true, data }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }
  
  // 更新书签
  if (message.action === 'updateBookmark') {
    chrome.bookmarks.update(message.id, message.changes)
      .then(data => sendResponse({ success: true, data }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }
  
  // 删除书签
  if (message.action === 'removeBookmark') {
    chrome.bookmarks.remove(message.id)
      .then(() => sendResponse({ success: true }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }
  
  // 删除文件夹及其内容
  if (message.action === 'removeBookmarkTree') {
    chrome.bookmarks.removeTree(message.id)
      .then(() => sendResponse({ success: true }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }
  
  // 打开 URL（搜索面板点击链接）
  if (message.type === 'openUrlInNewTab' || message.action === 'openUrlInNewTab') {
    const url = message.url;
    const active = message.active !== false;
    chrome.tabs.create({ url, active })
      .then(() => sendResponse({ success: true }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }
  
  // 打开设置页
  if (message.action === 'openOptionsPage') {
    chrome.runtime.openOptionsPage();
    sendResponse({ success: true });
    return true;
  }
  
  // 获取书签信息
  if (message.action === 'getBookmark') {
    chrome.bookmarks.get(message.id)
      .then(data => sendResponse({ success: true, data: data[0] }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }
  
  // 获取子项
  if (message.action === 'getChildren') {
    chrome.bookmarks.getChildren(message.id)
      .then(data => sendResponse({ success: true, data }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }
  
  // 搜索书签
  if (message.action === 'searchBookmarks') {
    chrome.bookmarks.search(message.query)
      .then(data => sendResponse({ success: true, data }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }
  
  // 获取书签路径（单个书签的完整路径）
  if (message.action === 'getBookmarkPath') {
    getBookmarkPathById(message.id).then(path => {
      sendResponse({ success: true, data: path });
    }).catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }
  
  // 移动书签（内部拖拽使用 isInternalMove 标记避免重复刷新）
  if (message.action === 'moveBookmark') {
    // 设置内部拖拽标记，避免 onMoved 触发的通知与前端刷新冲突
    if (message.isInternalMove) {
      setInternalDragMove(true);
    }
    
    chrome.bookmarks.move(message.id, {
      parentId: message.parentId,
      index: message.index
    })
      .then(data => {
        // 移动完成后重置标记
        if (message.isInternalMove) {
          setTimeout(() => setInternalDragMove(false), 50);
        }
        sendResponse({ success: true, data });
      })
      .catch(err => {
        if (message.isInternalMove) {
          setInternalDragMove(false);
        }
        sendResponse({ success: false, error: err.message });
      });
    return true;
  }
  
  // 在新标签页搜索文本 (超级拖拽)
  if (message.action === 'searchInNewTab') {
    const searchUrl = `https://www.bing.com/search?q=${encodeURIComponent(message.text)}`;
    handleOpenUrlFromSidePanel(searchUrl, true)
      .then(() => sendResponse({ success: true }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }
  
  // 在新标签页打开链接（此处为冗余处理，主要逻辑在前面，保留以确保兼容性）
  if (message.action === 'openInNewTab') {
    handleOpenInNewTab(message.url, message.active, message.forceAdjacentPosition)
      .then(() => sendResponse({ success: true }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }
  
  // Alt+点击快速保存图片
  if (message.action === 'quickSaveImage') {
    handleQuickSaveImage(message.dataUrl, message.originalUrl, message.pageUrl, message.pageTitle)
      .then(result => sendResponse(result))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  // 在 background fetch 图片并转为 dataUrl（绕过 CORS + 反盗链）
  // Referer 是 Fetch API forbidden header，浏览器会静默忽略
  // 所以用 declarativeNetRequest 动态规则临时注入 Referer
  if (message.action === 'fetchImageAsDataUrl') {
    const TEMP_REFERER_RULE_ID = 99999;
    (async () => {
      let ruleAdded = false;
      try {
        // 1) 提取图片域名和来源页 origin，添加临时 Referer 规则
        if (message.pageUrl && message.imageUrl) {
          const imgHost = new URL(message.imageUrl).hostname;
          const pageOrigin = new URL(message.pageUrl).origin;
          await chrome.declarativeNetRequest.updateDynamicRules({
            removeRuleIds: [TEMP_REFERER_RULE_ID],
            addRules: [{
              id: TEMP_REFERER_RULE_ID,
              priority: 2,
              action: {
                type: 'modifyHeaders',
                requestHeaders: [
                  { header: 'Referer', operation: 'set', value: pageOrigin + '/' }
                ]
              },
              condition: {
                requestDomains: [imgHost],
                resourceTypes: ['xmlhttprequest']
              }
            }]
          });
          ruleAdded = true;
        }

        // 2) 在 SW 中 fetch（无 CORS 限制，Referer 由 DNR 规则注入）
        const resp = await fetch(message.imageUrl);
        if (!resp.ok) {
          sendResponse({ error: '服务器拒绝 (' + resp.status + ')' });
          return;
        }
        const contentType = (resp.headers.get('Content-Type') || '').toLowerCase();
        if (!contentType.startsWith('image/')) {
          sendResponse({ error: '该元素不是可保存的图片' });
          return;
        }
        const blob = await resp.blob();
        const reader = new FileReader();
        reader.onload = () => sendResponse({ dataUrl: reader.result });
        reader.onerror = () => sendResponse({ error: '读取图片数据失败' });
        reader.readAsDataURL(blob);
      } catch (e) {
        sendResponse({ error: e.message || '获取图片失败' });
      } finally {
        // 3) 无论成功失败，立即清除临时规则
        if (ruleAdded) {
          chrome.declarativeNetRequest.updateDynamicRules({
            removeRuleIds: [TEMP_REFERER_RULE_ID]
          }).catch(() => {});
        }
      }
    })();
    return true;
  }

  // 代理 fetch 请求（用于 content script 跨域请求）
  if (message.action === 'proxyFetch') {
    handleProxyFetch(message.url, message.options)
      .then(result => sendResponse(result))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  // 获取 Favicon（用于 NTP 页面）
  if (message.action === 'getFavicon') {
    handleGetFavicon(message.url, message.size || 32)
      .then(result => sendResponse(result))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }
  
  // 获取壁纸列表（动态扫描 wallpaper 目录）
  if (message.action === 'getWallpaperList') {
    getWallpaperList()
      .then(data => sendResponse({ success: true, data }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }
});

/**
 * 代理 fetch 请求（解决 content script 跨域问题）
 */
async function handleProxyFetch(url, options = {}) {
  try {
    const response = await fetch(url, {
      method: options.method || 'GET',
      headers: options.headers || {},
    });
    if (!response.ok) {
      console.warn('[ECHO BG DEBUG] HTTP 错误:', response.status);
      return { success: false, error: `HTTP ${response.status}` };
    }
    
    const data = await response.json();
    return { success: true, data };
  } catch (error) {
    console.error('[ECHO BG DEBUG] handleProxyFetch 异常:', error);
    return { success: false, error: error.message };
  }
}

/**
 * 获取壁纸列表（动态扫描 wallpaper 目录）
 * 壁纸文件名格式：ECHO NTP (序号).jpg，如 ECHO NTP (1).jpg、ECHO NTP (2).jpg
 * 通过枚举序号 1-99 并用 fetch HEAD 检测文件是否存在
 */
async function getWallpaperList() {
  try {
    const maxIndex = 99; // 最多支持 99 张壁纸
    const checkPromises = [];
    
    // 枚举序号 1 到 99
    for (let i = 1; i <= maxIndex; i++) {
      const filePath = `wallpaper/ECHO NTP (${i}).jpg`;
      checkPromises.push(
        (async () => {
          try {
            const url = chrome.runtime.getURL(filePath);
            const response = await fetch(url, { method: 'HEAD' });
            if (response.ok) {
              return filePath;
            }
          } catch (e) {
            // 文件不存在
          }
          return null;
        })()
      );
    }
    
    const results = await Promise.all(checkPromises);
    const validWallpapers = results.filter(r => r !== null);
    return validWallpapers;
  } catch (error) {
    console.error('[ECHO BG] 获取壁纸列表失败:', error);
    return [];
  }
}

/**
 * 获取 Favicon 并返回 Base64 数据 URL（用于 NTP 页面）
 * 优先使用 Chrome 内置的 _favicon API，失败则尝试直接请求 /favicon.ico
 */
async function handleGetFavicon(pageUrl, size = 32) {
  // 方案1：使用 Chrome 内置 _favicon API
  try {
    const faviconUrl = `chrome-extension://${chrome.runtime.id}/_favicon/?pageUrl=${encodeURIComponent(pageUrl)}&size=${size}`;
    
    const response = await fetch(faviconUrl);
    if (response.ok) {
      const blob = await response.blob();
      
      // 检查是否是有效的图片（不是默认的空白图标，通常大于 100 字节）
      if (blob.size > 100) {
        const dataUrl = await blobToDataUrl(blob);
        return { success: true, dataUrl };
      }
    }
  } catch (e) {
  }
  
  // 方案2：直接请求网站的 /favicon.ico
  try {
    const url = new URL(pageUrl);
    const faviconDirectUrl = `${url.protocol}//${url.hostname}/favicon.ico`;
    
    const response = await fetch(faviconDirectUrl, {
      method: 'GET',
      mode: 'cors',
      credentials: 'omit'
    });
    
    if (response.ok) {
      const blob = await response.blob();
      if (blob.size > 0 && blob.type.startsWith('image/')) {
        const dataUrl = await blobToDataUrl(blob);
        return { success: true, dataUrl };
      }
    }
  } catch (e) {
  }
  
  return { success: false, error: 'Favicon not found' };
}

/**
 * Blob 转 Data URL
 */
function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * Alt+点击快速保存图片处理
 */
async function handleQuickSaveImage(dataUrl, originalUrl, pageUrl, pageTitle) {
  try {
    const settings = await chrome.storage.sync.get({
      quickSaveImage: DEFAULT_SETTINGS.quickSaveImage,
      quickSaveImageDateFolder: DEFAULT_SETTINGS.quickSaveImageDateFolder
    });
    
    if (!settings.quickSaveImage) {
      return { success: false, error: '功能已关闭' };
    }
    
    // data URL 已由 content script 在页面上下文中获取（带 cookie，绕过防盗链）
    // 这里只需提取文件名和执行下载
    
    // 从 data URL 的 MIME 提取格式
    let detectedExt = '';
    const mimeMatch = dataUrl.match(/^data:image\/([\w+.-]+)/i);
    if (mimeMatch) {
      detectedExt = mimeMatch[1].toLowerCase();
      if (detectedExt === 'jpeg') detectedExt = 'jpg';
      if (detectedExt === 'svg+xml') detectedExt = 'svg';
    }
    
    // 从原始 URL 提取文件名
    let filename = '';
    if (originalUrl && !originalUrl.startsWith('data:')) {
      try {
        const urlObj = new URL(originalUrl);
        const pathname = urlObj.pathname;
        filename = pathname.substring(pathname.lastIndexOf('/') + 1);
        if (filename.includes('?')) {
          filename = filename.substring(0, filename.indexOf('?'));
        }
        filename = decodeURIComponent(filename);
      } catch (e) {
        filename = '';
      }
      
      // 如果文件名为空或不包含扩展名，生成一个
      if (!filename || !filename.includes('.')) {
        const extMatch = originalUrl.match(/\.(?:png|jpe?g|gif|webp|avif|svg|bmp|ico|tiff?)(?=[?#]|$)/i);
        const ext = extMatch ? extMatch[0].substring(1).toLowerCase() : (detectedExt || 'jpg');
        filename = `image_${Date.now()}.${ext}`;
      }
      // 如果检测到的实际格式与扩展名不符，修正
      else if (detectedExt) {
        const currentExt = filename.substring(filename.lastIndexOf('.') + 1).toLowerCase();
        const normalize = { 'jpg': 'jpeg', 'jpeg': 'jpeg', 'png': 'png', 'gif': 'gif', 'webp': 'webp', 'avif': 'avif', 'svg': 'svg', 'bmp': 'bmp' };
        if (normalize[currentExt] && normalize[detectedExt] && normalize[currentExt] !== normalize[detectedExt]) {
          filename = filename.substring(0, filename.lastIndexOf('.') + 1) + detectedExt;
        }
      }
    }
    
    // 兜底文件名
    if (!filename) {
      filename = `image_${Date.now()}.${detectedExt || 'jpg'}`;
    }
    
    // 清理文件名中的非法字符
    filename = filename.replace(/[<>:"/\\|?*]/g, '_');
    
    // 构建保存路径：始终保存到 ECHO快速保存图片 目录
    let savePath = 'ECHO快速保存图片/';
    
    // 如果开启按日期分类，在 ECHO 目录内创建日期子文件夹
    if (settings.quickSaveImageDateFolder) {
      const now = new Date();
      const dateStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
      savePath += `${dateStr}/`;
    }
    
    savePath += filename;
    
    // 执行下载（使用 content script 传来的 data URL）
    const downloadId = await chrome.downloads.download({
      url: dataUrl,
      filename: savePath,
      saveAs: false,
      conflictAction: 'uniquify'
    });
    
    return { success: true, downloadId };
  } catch (error) {
    console.error('[ECHO] Quick save image error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * 检查 URL 是否是可注入 content script 的页面
 */
function isInjectablePage(url) {
  if (!url) return false;
  // 只有 http/https 页面可以注入
  return url.startsWith('http://') || url.startsWith('https://');
}

/**
 * 检查标签是否可以被切换到（用于鼠标手势/F2F3切换）
 * 
 * 可切换的标签：
 * 1. 普通网页（http/https）- 有 content script，可以继续手势
 * 2. 我们自己的扩展页面（options.html 等）- 有内置的手势支持
 * 
 * 不可切换的标签（会被跳过）：
 * 1. 浏览器内置页面（chrome://、edge://、about:）
 * 2. 新标签页（chrome://newtab、edge://newtab）- 除非是我们覆盖的
 * 3. 其他扩展的页面（chrome-extension://其他ID/...）
 * 4. 文件协议页面（file://）
 */
function isSwitchableTab(url, pendingUrl) {
  const extensionId = chrome.runtime.id;
  
  // DEBUG
  // 检查 pendingUrl（优先，因为 NTP 覆盖时 url 可能是 edge://newtab 但 pendingUrl 是真实地址）
  if (pendingUrl) {
    if (pendingUrl.startsWith(`chrome-extension://${extensionId}/`) ||
        pendingUrl.startsWith(`extension://${extensionId}/`)) {
      return true;
    }
  }
  
  if (!url) return false;
  
  // 普通网页，可切换
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return true;
  }
  
  // 我们自己的扩展页面（chrome-extension:// 或 extension://），可切换
  // Edge 可能使用 extension:// 而不是 chrome-extension://
  if (url.startsWith(`chrome-extension://${extensionId}/`) ||
      url.startsWith(`extension://${extensionId}/`)) {
    return true;
  }
  
  // 特殊处理：edge://newtab 可能是我们覆盖的 NTP
  // 通过检查 manifest 来确认（这里简化处理，直接认为 newtab 是我们的）
  if (url === 'edge://newtab/' || url === 'chrome://newtab/') {
    // 如果我们注册了 NTP 覆盖，这个 newtab 就是我们的页面
    return true;
  }
  
  // 其他情况（chrome://、edge://、about:、其他扩展、file://等），不可切换
  return false;
}

/**
 * 在新标签页打开 URL（位置根据设置，前台/后台可由参数指定或根据设置）
 * @param {string} url - 要打开的 URL
 * @param {boolean} [active] - 是否激活新标签页，未指定则根据 superDragBackground 设置决定
 * @param {boolean} [forceAdjacentPosition] - 是否强制紧贴当前标签（用于超级拖拽等场景）
 */
async function handleOpenInNewTab(url, active, forceAdjacentPosition = false) {
  try {
    const settings = await chrome.storage.sync.get({
      superDragActivate: DEFAULT_SETTINGS.superDragActivate
    });
    
    // 如果未指定 active，则根据设置决定（superDragActivate=true 表示激活，false 表示后台）
    const shouldBeActive = active !== undefined ? active : settings.superDragActivate;
    
    // 获取当前窗口
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!activeTab) {
      const newTab = await chrome.tabs.create({ url, active: shouldBeActive });
      extensionCreatedTabs.add(newTab.id);
      return;
    }
    
    const createOptions = { url, active: shouldBeActive };
    
    if (forceAdjacentPosition) {
      // 超级拖拽等场景：强制紧贴当前标签右侧，并设置父标签关系
      createOptions.index = activeTab.index + 1;
      createOptions.openerTabId = activeTab.id;
    } else {
      // 自绘收藏栏等场景：根据用户设置决定位置
      const index = await calculateNewTabIndex(activeTab.windowId);
      if (index !== undefined) {
        createOptions.index = index;
      }
    }
    
    const newTab = await chrome.tabs.create(createOptions);
    extensionCreatedTabs.add(newTab.id);  // 记录扩展创建的标签
  } catch (error) {
    console.error('Open in new tab error:', error);
  }
}

/**
 * 在当前标签页打开 URL（Edge 默认行为）
 * @param {string} url - 要打开的 URL
 * @param {number} [tabId] - 当前标签页 ID，如果未提供则使用活动标签页
 */
async function handleOpenInCurrentTab(url, tabId) {
  try {
    if (tabId) {
      await chrome.tabs.update(tabId, { url });
    } else {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (activeTab) {
        await chrome.tabs.update(activeTab.id, { url });
      }
    }
  } catch (error) {
    console.error('Open in current tab error:', error);
  }
}

/**
 * 搜索文本并在新标签页打开（固定使用 Bing，位置和前台/后台根据设置）
 * @param {boolean} [forceAdjacentPosition] - 是否强制紧贴当前标签（用于超级拖拽等场景）
 */
async function handleSearchInNewTab(text, forceAdjacentPosition = false) {
  try {
    const settings = await chrome.storage.sync.get({
      superDragActivate: DEFAULT_SETTINGS.superDragActivate
    });
    
    // 固定使用 Bing 搜索，带追踪参数
    const url = 'https://www.bing.com/search?q=' + encodeURIComponent(text) + '&FORM=ECHODD';
    
    // 获取当前窗口
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!activeTab) {
      const newTab = await chrome.tabs.create({ url, active: settings.superDragActivate });
      extensionCreatedTabs.add(newTab.id);
      return;
    }
    
    const createOptions = { url, active: settings.superDragActivate };
    
    if (forceAdjacentPosition) {
      // 超级拖拽等场景：强制紧贴当前标签右侧，并设置父标签关系
      createOptions.index = activeTab.index + 1;
      createOptions.openerTabId = activeTab.id;
    } else {
      // 其他场景：根据用户设置决定位置
      const index = await calculateNewTabIndex(activeTab.windowId);
      if (index !== undefined) {
        createOptions.index = index;
      }
    }
    
    const newTab = await chrome.tabs.create(createOptions);
    extensionCreatedTabs.add(newTab.id);  // 记录扩展创建的标签
  } catch (error) {
    console.error('Search in new tab error:', error);
  }
}

// ============================================
// 自绘书签栏 - 书签数据获取
// ⚠️ DEPRECATED: 本模块已废弃且失效 (无权限)。保留此代码仅为避免破坏文件结构。
// ⚠️ DEPRECATED: This module is inactive and has no permissions. Code retained for structural integrity only.
// ============================================

/**
 * 获取收藏栏数据（书签栏 ID 为 "1"）
 */
async function getBookmarkBar() {
  return new Promise((resolve) => {
    chrome.bookmarks.getChildren("1", (children) => {
      resolve(children || []);
    });
  });
}

/**
 * 获取书签的完整路径
 */
async function getBookmarkPathById(parentId) {
  const pathParts = [];
  let currentId = parentId;

  try {
    while (currentId && currentId !== '0') {
      if (currentId === '1') {
        pathParts.unshift('书签栏');
        break;
      }
      if (currentId === '2') {
        pathParts.unshift('其他书签');
        break;
      }
      
      const [node] = await chrome.bookmarks.get(currentId);
      if (node) {
        pathParts.unshift(node.title || '未命名');
        currentId = node.parentId;
      } else {
        break;
      }
    }
  } catch (e) {
    // 忽略错误
  }

  return pathParts.join(' > ') || '根目录';
}

/**
 * 获取指定文件夹的内容
 */
async function getFolderContents(folderId) {
  return new Promise((resolve) => {
    chrome.bookmarks.getChildren(folderId, (children) => {
      resolve(children || []);
    });
  });
}

/**
 * 添加书签到指定文件夹
 */
async function addBookmark(folderId, title, url) {
  return new Promise((resolve, reject) => {
    chrome.bookmarks.create({
      parentId: folderId,
      title: title,
      url: url
    }, (result) => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
      } else {
        resolve(result);
      }
    });
  });
}

// ============================================
// 自绘书签栏 - 实时同步
// ⚠️ DEPRECATED: 逻辑已废弃
// ============================================

// 防抖定时器
let notifyBookmarkBarDebounceTimer = null;
let notifyFolderDebounceTimers = new Map();
const NOTIFY_DEBOUNCE_DELAY = 100; // ms

// 内部拖拽标记：当扩展内部进行拖拽移动时，暂时跳过自动通知
let isInternalDragMove = false;

/**
 * 设置内部拖拽状态
 */
function setInternalDragMove(value) {
  isInternalDragMove = value;
  // 自动重置（防止状态卡住）
  if (value) {
    setTimeout(() => { isInternalDragMove = false; }, 1000);
  }
}

/**
 * 通知所有标签页书签栏数据已更新
 * 只通知启用了自绘书签栏的页面
 * 带防抖，避免频繁更新
 */
async function notifyBookmarkBarUpdate() {
  // 如果是内部拖拽移动，跳过（由前端自己控制刷新）
  if (isInternalDragMove) return;
  
  // 防抖
  if (notifyBookmarkBarDebounceTimer) {
    clearTimeout(notifyBookmarkBarDebounceTimer);
  }
  
  notifyBookmarkBarDebounceTimer = setTimeout(async () => {
    notifyBookmarkBarDebounceTimer = null;
    
    try {
      // 检查功能是否启用
      const settings = await chrome.storage.sync.get({ customBookmarkBar: false });
      if (!settings.customBookmarkBar) return;
      
      // 获取最新数据
      const bookmarkBarData = await getBookmarkBar();
      
      // 通知所有标签页
      const tabs = await chrome.tabs.query({});
      for (const tab of tabs) {
        // 只通知 http/https 页面（content script 只在这些页面运行）
        if (tab.url?.startsWith('http://') || tab.url?.startsWith('https://')) {
          chrome.tabs.sendMessage(tab.id, {
            action: 'bookmarkBarUpdated',
            data: bookmarkBarData
          }).catch(() => {}); // 忽略无法接收消息的标签页
        }
      }
    } catch (error) {
      console.error('Notify bookmark bar update error:', error);
    }
  }, NOTIFY_DEBOUNCE_DELAY);
}

/**
 * 通知特定文件夹内容已更新（用于展开的下拉菜单）
 * 带防抖，避免频繁更新
 */
async function notifyFolderUpdate(folderId) {
  // 如果是内部拖拽移动，跳过
  if (isInternalDragMove) return;
  
  // 针对每个 folderId 单独防抖
  if (notifyFolderDebounceTimers.has(folderId)) {
    clearTimeout(notifyFolderDebounceTimers.get(folderId));
  }
  
  const timer = setTimeout(async () => {
    notifyFolderDebounceTimers.delete(folderId);
    
    try {
      const settings = await chrome.storage.sync.get({ customBookmarkBar: false });
      if (!settings.customBookmarkBar) return;
      
      const folderContents = await getFolderContents(folderId);
      
      const tabs = await chrome.tabs.query({});
      for (const tab of tabs) {
        if (tab.url?.startsWith('http://') || tab.url?.startsWith('https://')) {
          chrome.tabs.sendMessage(tab.id, {
            action: 'bookmarkFolderUpdated',
            folderId: folderId,
            data: folderContents
          }).catch(() => {});
        }
      }
    } catch (error) {
      console.error('Notify folder update error:', error);
    }
  }, NOTIFY_DEBOUNCE_DELAY);
  
  notifyFolderDebounceTimers.set(folderId, timer);
}

/**
 * 判断书签是否在书签栏或其子文件夹中
 * 书签栏的 ID 是 "1"
 */
async function isInBookmarkBar(bookmarkId) {
  try {
    const nodes = await new Promise(resolve => {
      chrome.bookmarks.get(bookmarkId, resolve);
    });
    if (!nodes || nodes.length === 0) return false;
    
    let parentId = nodes[0].parentId;
    
    // 向上遍历，检查是否最终属于书签栏
    while (parentId) {
      if (parentId === "1") return true;
      if (parentId === "0") break; // 根节点
      
      const [parentNode] = await new Promise(resolve => {
        chrome.bookmarks.get(parentId, resolve);
      });
      
      if (parentNode) {
        // 如果父节点是书签栏或其他已知文件夹，继续
        if (parentNode.id === "1" || parentNode.id === "2") {
          return true;
        }
        
        parentId = parentNode.parentId;
      } else {
        break;
      }
    }
  } catch (e) {
    // 忽略错误
  }

  return false;
}

// ============================================
// 动态注入 Related Search 脚本
// ============================================

const SEARCH_ENGINES = ['google.com', 'baidu.com', 'sogou.com', 'so.com', 'duckduckgo.com', 'yahoo.com', 'bing.com'];

function isHomePage(url) {
  try {
    const urlObj = new URL(url);
    const path = urlObj.pathname;
    const search = urlObj.search;
    
    // 典型首页路径模式
    const homePatterns = [
      /^\/?$/,                    // 空或单个斜杠: "/" 或 ""
      /^\/index\.html?$/i,       // /index.html 或 /index.htm
      /^\/home\.html?$/i,        // /home.html
      /^\/default\.html?$/i,     // /default.html
      /^\/index\.php$/i,         // /index.php
      /^\/index\.aspx?$/i,       // /index.asp 或 /index.aspx
      /^\/home\/?$/i,            // /home 或 /home/
      /^\/main\/?$/i             // /main 或 /main/
    ];
    
    const isHomeByPath = homePatterns.some(pattern => pattern.test(path));
    
    if (isHomeByPath) {
      const allowedParams = ['utm_source', 'utm_medium', 'utm_campaign', 'ref', 'from'];
      const params = new URLSearchParams(search);
      const hasContentParam = [...params.keys()].some(key => !allowedParams.includes(key.toLowerCase()));
      
      if (!hasContentParam) {
        return true;
      }
    }
    return false;
  } catch (e) {
    return false;
  }
}

// ============================================
// 关联搜索注入模块
// ============================================
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url && tab.url.startsWith('http')) {
    const settings = await chrome.storage.sync.get({ relatedSearchRecommend: false });
    if (!settings.relatedSearchRecommend) return;

    const url = tab.url;
    
    // 检查是否是搜索引擎
    if (SEARCH_ENGINES.some(se => url.includes(se))) return;
    
    // 检查是否是首页
    if (isHomePage(url)) return;

    // 注入脚本
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tabId },
        files: ['related-search/related-search.js']
      });
    } catch (e) {
      console.error('[ECHO Background] Failed to inject related-search.js:', e);
    }
  }
});

// ============================================
// ⚠️ DEPRECATED: 监听器未注册，此函数为死代码
// 监听书签的增删改移，通知前端更新
// ============================================

function handleBookmarkChange(id, info) {
  // 简单粗暴：任何变动都通知更新书签栏
  // 优化：可以判断 id 是否在书签栏内，但为了保险起见（比如移动操作），全局通知也无妨
  notifyBookmarkBarUpdate();
  
  // 如果涉及特定文件夹（如 create/move 到文件夹），也通知该文件夹更新
  if (info && info.parentId) {
    notifyFolderUpdate(info.parentId);
  }
  
  // 如果是 move 操作，还要通知旧的父文件夹
  if (info && info.oldParentId) {
    notifyFolderUpdate(info.oldParentId);
  }
}

// 书签事件监听器已移除（自绘书签栏功能已废弃）
// 如需恢复，参见 BOOKMARK_REMOVAL_GUIDE.md

// ============================================
// 通用消息监听 (Zoom 等)
// ============================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'getZoom') {
    if (sender.tab) {
      chrome.tabs.getZoom(sender.tab.id, (zoomFactor) => {
        sendResponse({ zoom: zoomFactor });
      });
      return true; // 保持通道开启以进行异步响应
    }
  }

  // Bing 搜索建议代理（NTP 搜索框用）
  if (message.action === 'bingSuggest') {
    const query = message.query;
    if (!query) {
      sendResponse({ suggestions: [] });
      return false;
    }
    (async () => {
      try {
        const response = await fetch(
          `https://api.bing.com/osjson.aspx?query=${encodeURIComponent(query)}`,
          { method: 'GET' }
        );
        if (!response.ok) {
          sendResponse({ suggestions: [] });
          return;
        }
        const data = await response.json();
        // OpenSearch JSON 格式: ["query", ["sug1", "sug2", ...]]
        const suggestions = Array.isArray(data) && Array.isArray(data[1]) ? data[1] : [];
        sendResponse({ suggestions: suggestions.slice(0, 8) });
      } catch (e) {
        sendResponse({ suggestions: [] });
      }
    })();
    return true; // 异步响应
  }

  // 处理关键词提取请求 (解决 CSP 问题)
  // 双备份方案：优先 Pollinations.ai，失败后 fallback 到 OllamaFreeAPI
  if (message.action === 'analyzeText') {
    (async () => {
      const TIMEOUT_MS = 30000; // 30秒超时
      const prompt = message.prompt;
      
      // 带超时的 fetch
      const fetchWithTimeout = (url, options, timeout) => {
        return Promise.race([
          fetch(url, options),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Request timeout')), timeout)
          )
        ]);
      };
      
      // 方案1: Pollinations.ai
      const tryPollinations = async () => {
        const response = await fetchWithTimeout('https://text.pollinations.ai/', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: [
              { role: 'system', content: 'You are a helpful assistant that extracts keywords as JSON arrays.' },
              { role: 'user', content: prompt }
            ],
            model: 'openai'
          })
        }, TIMEOUT_MS);
        
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        return await response.text();
      };
      
      // 方案2: OllamaFreeAPI 公开服务器
      const tryOllama = async () => {
        const response = await fetchWithTimeout('http://172.236.213.60:11434/api/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'llama3.2:latest',
            prompt: prompt,
            stream: false,
            options: {
              num_predict: 300,
              temperature: 0.7
            }
          })
        }, TIMEOUT_MS);
        
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const json = await response.json();
        return json.response || '';
      };
      
      // 执行：先 Pollinations，失败后 Ollama
      try {
        const text = await tryPollinations();
        sendResponse({ success: true, data: text });
      } catch (pollinationsError) {
        console.warn('[ECHO Background DEBUG] Pollinations failed:', pollinationsError.message);
        try {
          const text = await tryOllama();
          sendResponse({ success: true, data: text });
        } catch (ollamaError) {
          console.error('[ECHO Background DEBUG] Both services failed.');
          console.error('  Pollinations:', pollinationsError.message);
          console.error('  Ollama:', ollamaError.message);
          sendResponse({ error: 'All AI services unavailable' });
        }
      }
    })();
    return true; // 保持通道开启（异步响应）
  }
});

