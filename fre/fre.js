/**
 * FRE (First Run Experience) 通用脚本
 * 处理页面导航和交互
 */

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
    { from: 'Ctrl+滚轮', to: '⌘+滚轮' },
    { from: 'Ctrl + B', to: '⌘ + B' },
    { from: 'Ctrl+B', to: '⌘B' },
    { from: 'Alt 一键存图', to: '⌥ 一键存图' },
    { from: 'Alt + 点击', to: '⌥ + 点击' },
    { from: 'Alt+点击', to: '⌥+点击' },
    { from: '按住 Alt', to: '按住 ⌥' }
  ];
  
  // 1. 替换 .mini-key 元素（如 FRE Step 3 的快捷键按钮）
  document.querySelectorAll('.mini-key').forEach(el => {
    keyMappings.forEach(({ from, to }) => {
      if (el.textContent.includes(from)) {
        el.textContent = el.textContent.replace(from, to);
      }
    });
  });
  
  // 2. 替换 .feature-title 元素（如 FRE Step 1 的功能卡片标题）
  document.querySelectorAll('.feature-title').forEach(el => {
    keyMappings.forEach(({ from, to }) => {
      if (el.textContent.includes(from)) {
        el.textContent = el.textContent.replace(from, to);
      }
    });
  });
  
  // 3. 替换 data-tooltip 属性（功能卡片悬停提示）
  document.querySelectorAll('[data-tooltip]').forEach(el => {
    let tooltip = el.getAttribute('data-tooltip');
    keyMappings.forEach(({ from, to }) => {
      if (tooltip.includes(from)) {
        tooltip = tooltip.replace(new RegExp(from.replace(/[+]/g, '\\+'), 'g'), to);
      }
    });
    el.setAttribute('data-tooltip', tooltip);
  });
  
  // 4. 替换 .hint-text 元素（提示文字）
  document.querySelectorAll('.hint-text, .shortcut-hint').forEach(el => {
    keyMappings.forEach(({ from, to }) => {
      if (el.innerHTML.includes(from)) {
        el.innerHTML = el.innerHTML.replace(new RegExp(from.replace(/[+]/g, '\\+'), 'g'), to);
      }
    });
  });
  
  // 5. 替换 title 属性
  document.querySelectorAll('[title]').forEach(el => {
    let title = el.getAttribute('title');
    keyMappings.forEach(({ from, to }) => {
      if (title && title.includes(from)) {
        title = title.replace(new RegExp(from.replace(/[+]/g, '\\+'), 'g'), to);
      }
    });
    if (title) el.setAttribute('title', title);
  });
  
  // 6. 替换 .alt-hint 元素（Alt 键提示文字）
  document.querySelectorAll('.alt-hint').forEach(el => {
    if (el.textContent.includes('+ 点击')) {
      el.textContent = el.textContent.replace('+ 点击', '+ 点击');
    }
  });
  
  // 7. 替换 .alt-key 元素（Alt 键显示）
  document.querySelectorAll('.alt-key').forEach(el => {
    if (el.textContent.trim() === 'Alt') {
      el.textContent = '⌥';
    }
  });
}

document.addEventListener('DOMContentLoaded', () => {
  // 首先适配平台快捷键显示
  adaptShortcutsForPlatform();
  
  // 绑定 CTA 按钮（如果存在）
  const startBtn = document.getElementById('startBtn');
  if (startBtn) {
    startBtn.addEventListener('click', () => {
      window.location.href = 'fre-step2.html';
    });
  }

  // 绑定步骤指示器的可点击标签
  document.querySelectorAll('.step-label.clickable').forEach(label => {
    label.addEventListener('click', () => {
      const href = label.dataset.href;
      if (href) {
        window.location.href = href;
      }
    });
  });

  // ========== Step 2 卡片轮播逻辑 ==========
  initStep2Carousel();

  // Step 4 特定按钮
  const settingsBtn = document.getElementById('settingsBtn');
  if (settingsBtn) {
    settingsBtn.addEventListener('click', goToSettings);
  }

  const browseBtn = document.getElementById('browseBtn');
  if (browseBtn) {
    browseBtn.addEventListener('click', startBrowsing);
  }

  // Step 3 继续按钮
  const continueBtn = document.getElementById('continueBtn');
  if (continueBtn) {
    continueBtn.addEventListener('click', () => {
      window.location.href = 'fre-step4.html';
    });
  }

  // Step 3 固定定位的继续按钮
  const fixedContinueBtn = document.getElementById('fixedContinueBtn');
  if (fixedContinueBtn) {
    fixedContinueBtn.addEventListener('click', () => {
      window.location.href = 'fre-step4.html';
    });
  }

  // Step 3 快捷键提示区域点击呼出搜索框
  const shortcutHint = document.getElementById('shortcutHint');
  if (shortcutHint) {
    shortcutHint.addEventListener('click', () => {
      if (typeof window.echoToggleSearchBox === 'function') {
        window.echoToggleSearchBox();
      }
    });
  }
});

// 标记 FRE 已完成
async function markFRECompleted() {
  try {
    await chrome.storage.local.set({ freCompleted: true });
  } catch (e) {
    // Could not mark completed (might be in dev mode)
  }
}

// 进入设置页
function goToSettings() {
  markFRECompleted();
  // 打开设置页
  if (chrome.runtime.openOptionsPage) {
    chrome.runtime.openOptionsPage();
  } else {
    window.location.href = '../options/options.html';
  }
}

// 开始上网 - 切换到 NTP
function startBrowsing() {
  markFRECompleted();
  // 跳转到 NTP（新标签页）
  window.location.href = '../ntp/ntp.html';
}

/**
 * Step 2 卡片轮播初始化
 * 仅在 fre-step2.html 页面生效
 */
function initStep2Carousel() {
  const cards = document.querySelectorAll('.feature-card');
  if (cards.length === 0) return; // 不是 Step 2 页面，直接返回

  let activeIndex = 0;
  let isHovering = false;
  let autoPlayInterval = null;
  const ANIMATION_DURATION = 4500; // 4.5秒

  function setActiveCard(index) {
    cards.forEach((card, i) => {
      const isActive = i === index;
      const demoArea = card.querySelector('.demo-area');
      
      // 1. 切换 active 状态
      card.classList.toggle('active', isActive);
      
      // 2. 动画控制逻辑
      if (isActive && demoArea) {
        // 强制重绘 (Reflow) 以重置动画
        demoArea.classList.remove('animating');
        void demoArea.offsetWidth; // 触发 reflow
        demoArea.classList.add('animating');
      } else if (demoArea) {
        // 停止动画并复位
        demoArea.classList.remove('animating');
      }
    });
    activeIndex = index;
  }

  function nextCard() {
    if (!isHovering) {
      const next = (activeIndex + 1) % cards.length;
      setActiveCard(next);
    }
  }

  function startAutoPlay() {
    if (autoPlayInterval) clearInterval(autoPlayInterval);
    autoPlayInterval = setInterval(nextCard, ANIMATION_DURATION);
  }

  // 鼠标交互
  cards.forEach((card, index) => {
    card.addEventListener('mouseenter', () => {
      isHovering = true;
      setActiveCard(index);
    });

    card.addEventListener('mouseleave', () => {
      isHovering = false;
      // 从当前卡片继续自动轮播
      startAutoPlay();
    });
  });

  // 启动自动轮播
  startAutoPlay();
  
  // 立即激活第一个卡片的动画
  const firstCardDemo = document.querySelector('.feature-card.active .demo-area');
  if (firstCardDemo) {
    firstCardDemo.classList.add('animating');
  }
}
