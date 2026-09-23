(function(root) {
  'use strict';

  const CATEGORY_DEFINITIONS = [
    ['realtime', '热搜', '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>'],
    ['livelihood', '民生榜', '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/></svg>'],
    ['finance', '财经榜', '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3.5 18.49l6-6.01 4 4L22 6.92l-1.41-1.41-7.09 7.97-4-4L2 16.99z"/></svg>'],
    ['sports', '体育榜', '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 17.93c-3.94-.49-7-3.85-7-7.93s3.05-7.44 7-7.93v15.86zm2-15.86c1.03.13 2 .45 2.87.93H13v-.93zM13 7h5.24c.25.31.48.65.68 1H13V7zm0 3h6.74c.08.33.15.66.19 1H13v-1zm0 9.93V19h2.87c-.87.48-1.84.8-2.87.93zM18.24 17H13v-1h5.92c-.2.35-.43.69-.68 1zm1.5-3H13v-1h6.93c-.04.34-.11.67-.19 1z"/></svg>'],
    ['games', '游戏榜', '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M21 6H3c-1.1 0-2 .9-2 2v8c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm-10 7H8v3H6v-3H3v-2h3V8h2v3h3v2zm4.5 2c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm4-3c-.83 0-1.5-.67-1.5-1.5S18.67 9 19.5 9s1.5.67 1.5 1.5-.67 1.5-1.5 1.5z"/></svg>'],
    ['novel', '小说榜', '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M18 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM6 4h5v8l-2.5-1.5L6 12V4z"/></svg>'],
    ['car', '汽车榜', '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M18.92 6.01C18.72 5.42 18.16 5 17.5 5h-11c-.66 0-1.21.42-1.42 1.01L3 12v8c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h12v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-8l-2.08-5.99zM6.5 16c-.83 0-1.5-.67-1.5-1.5S5.67 13 6.5 13s1.5.67 1.5 1.5S7.33 16 6.5 16zm11 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zM5 11l1.5-4.5h11L19 11H5z"/></svg>'],
    ['drama', '短剧榜', '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 3c-4.97 0-9 4.03-9 9v7c0 1.1.9 2 2 2h4v-8H5v-1c0-3.87 3.13-7 7-7s7 3.13 7 7v1h-4v8h4c1.1 0 2-.9 2-2v-7c0-4.97-4.03-9-9-9z"/></svg>']
  ];
  const LEGACY_TABS = [
    'realtime', 'livelihood', 'finance', 'sports', 'games',
    'movie', 'teleplay', 'novel', 'car', 'drama'
  ];

  function create(options) {
    const chromeApi = options.chrome;
    const documentApi = options.document;
    const windowApi = options.window;
    const actions = options.actions;
    const storageKeys = options.storageKeys;
    const cacheDuration = options.cacheDuration || 10 * 60 * 1000;
    const minimumItems = options.minimumItems || 20;
    const categories = CATEGORY_DEFINITIONS.map(([tab, name, icon]) => ({ tab, name, icon }));
    const disabled = new Set();
    let currentIndex = 0;
    let wheelTimer = null;
    let switching = false;
    let clickInitialized = false;
    let dotsInitialized = false;
    let lastData = null;
    let lastColumns = null;

    function escapeHtml(value) {
      const element = documentApi.createElement('div');
      element.textContent = value;
      return element.innerHTML;
    }

    async function loadStoredCategory() {
      const stored = await chromeApi.storage.local.get(storageKeys.category);
      const value = stored[storageKeys.category];
      let tab = typeof value === 'number' && Number.isInteger(value)
        ? (LEGACY_TABS[value] || 'realtime')
        : (typeof value === 'string' ? value : 'realtime');
      if (tab === 'movie' || tab === 'teleplay') tab = 'realtime';
      const index = categories.findIndex(category => category.tab === tab);
      currentIndex = index >= 0 ? index : 0;
      const stableValue = categories[currentIndex].tab;
      if (value !== undefined && value !== stableValue) {
        await chromeApi.storage.local.set({ [storageKeys.category]: stableValue });
      }
      return currentIndex;
    }

    function updateDots() {
      const container = documentApi.getElementById('trendingDots');
      if (!container) return;
      container.innerHTML = categories.map((category, index) => disabled.has(index) ? '' :
        `<div class="trending-dot${index === currentIndex ? ' active' : ''}" data-index="${index}" title="${category.name}"></div>`
      ).join('');
      if (!dotsInitialized) {
        container.addEventListener('click', event => {
          const dot = event.target.closest('.trending-dot');
          if (!dot) return;
          const index = Number.parseInt(dot.dataset.index, 10);
          if (index !== currentIndex) switchCategory(index, index > currentIndex ? 'right' : 'left');
        });
        dotsInitialized = true;
      }
    }

    function updateDotsActiveState() {
      documentApi.querySelectorAll('.trending-dot').forEach(dot => {
        dot.classList.toggle('active', Number.parseInt(dot.dataset.index, 10) === currentIndex);
      });
    }

    function getNextIndex(fromIndex, direction) {
      let index = fromIndex;
      for (let attempt = 0; attempt < categories.length; attempt += 1) {
        index = direction === 'right'
          ? (index + 1) % categories.length
          : (index - 1 + categories.length) % categories.length;
        if (!disabled.has(index)) return index;
      }
      return fromIndex;
    }

    function updateTitle(category) {
      const title = documentApi.getElementById('trendingTitle');
      if (!title) return;
      title.innerHTML = `<span class="trending-icon">${category.icon}</span>${category.name}`;
      title.classList.remove('trending-loading-hide');
    }

    function updateTime(timestamp) {
      const element = documentApi.getElementById('trendingUpdateTime');
      if (!element || !timestamp) return;
      const date = new Date(timestamp);
      element.textContent = `更新于 ${date.getMonth() + 1}月${date.getDate()}日 ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
      element.classList.remove('trending-loading-hide');
    }

    function getColumnCount() {
      return windowApi.innerWidth <= 1400 ? 3 : 4;
    }

    function render(data) {
      const container = documentApi.getElementById('trendingList');
      if (!container || !data?.length) return;
      lastData = data;
      const columnCount = getColumnCount();
      lastColumns = columnCount;
      const columns = Array.from({ length: columnCount }, () => []);
      data.slice(0, columnCount * 5).forEach((item, index) => {
        const column = Math.floor(index / 5);
        if (column < columnCount) columns[column].push({ ...item, rank: index + 1 });
      });
      container.innerHTML = columns.map(column => `<div class="trending-column">${column.map(item => {
        const rankClass = item.rank === 1 ? 'top-1' : item.rank === 2 ? 'top-2' : item.rank === 3 ? 'top-3' : 'normal';
        const url = `https://www.bing.com/search?q=${encodeURIComponent(item.title)}`;
        return `<a class="trending-item" href="${url}" data-url="${url}"><span class="trending-rank ${rankClass}">${item.rank}</span><span class="trending-text">${escapeHtml(item.title)}</span></a>`;
      }).join('')}</div>`).join('');
    }

    function markDisabled(index) {
      disabled.add(index);
      updateDots();
      if (currentIndex !== index) return;
      const next = getNextIndex(index, 'right');
      if (next === index) return;
      currentIndex = next;
      updateDotsActiveState();
      void chromeApi.storage.local.set({ [storageKeys.category]: categories[next].tab });
      void loadData(false, next);
    }

    async function loadData(forceRefresh = false, targetIndex = null) {
      const container = documentApi.getElementById('trendingList');
      if (!container) return;
      const categoryIndex = targetIndex ?? currentIndex;
      const category = categories[categoryIndex];
      const expectedIndex = categoryIndex;
      const cacheKey = `${storageKeys.cache}_baidu_${category.tab}`;
      updateTitle(category);
      try {
        let cached = (await chromeApi.storage.local.get(cacheKey))[cacheKey];
        if (cached?.data?.length < minimumItems) {
          await chromeApi.storage.local.remove(cacheKey);
          cached = null;
        }
        if (cached?.data && currentIndex === expectedIndex) {
          render(cached.data);
          updateTime(cached.timestamp);
          if (!forceRefresh && Date.now() - cached.timestamp < cacheDuration) return;
        }

        const result = await chromeApi.runtime.sendMessage({
          action: actions.PROXY_FETCH,
          url: `https://top.baidu.com/api/board?platform=wise&tab=${category.tab}`,
          options: { method: 'GET' }
        });
        const raw = result?.data?.data?.cards?.[0]?.content?.[0]?.content;
        if (!result?.success || !result.data?.success || !Array.isArray(raw)) throw new Error('数据格式错误');
        const data = raw.slice(0, 20)
          .map(item => ({ title: item.word || item.title || '' }))
          .filter(item => item.title);
        if (data.length < minimumItems) {
          markDisabled(categoryIndex);
          return;
        }
        const timestamp = Date.now();
        await chromeApi.storage.local.set({ [cacheKey]: { data, timestamp } });
        if (disabled.delete(categoryIndex)) updateDots();
        if (currentIndex === expectedIndex) {
          render(data);
          updateTime(timestamp);
        }
      } catch (error) {
        console.error('[ECHO NTP] 热搜加载失败:', error);
        if (currentIndex === expectedIndex && !container.querySelector('.trending-item')) {
          container.innerHTML = '<div class="trending-error">热搜加载失败，请刷新重试</div>';
        }
      }
    }

    function switchCategory(index, direction = 'right') {
      if (switching || index === currentIndex) return;
      switching = true;
      const grid = documentApi.getElementById('trendingList');
      grid?.classList.add(direction === 'right' ? 'slide-out-left' : 'slide-out-right');
      setTimeout(async () => {
        currentIndex = index;
        updateDotsActiveState();
        await loadData(false, index);
        void chromeApi.storage.local.set({ [storageKeys.category]: categories[index].tab });
        if (grid) {
          grid.classList.remove('slide-out-left', 'slide-out-right');
          grid.classList.add(direction === 'right' ? 'slide-in-from-right' : 'slide-in-from-left');
          grid.offsetHeight;
          grid.classList.remove('slide-in-from-right', 'slide-in-from-left');
          grid.classList.add('slide-in');
          setTimeout(() => {
            grid.classList.remove('slide-in');
            switching = false;
          }, 120);
        } else {
          switching = false;
        }
      }, 120);
    }

    function handleWheel(event) {
      if (wheelTimer || Math.abs(event.deltaY) < 10) return;
      event.preventDefault();
      wheelTimer = setTimeout(() => { wheelTimer = null; }, 300);
      const direction = event.deltaY > 0 ? 'right' : 'left';
      switchCategory(getNextIndex(currentIndex, direction), direction);
    }

    function initClickHandler() {
      if (clickInitialized) return;
      const container = documentApi.getElementById('trendingList');
      if (!container) return;
      container.addEventListener('click', event => {
        const link = event.target.closest('.trending-item');
        if (!link) return;
        event.preventDefault();
        chromeApi.tabs.create({ url: link.dataset.url || link.href, active: false });
      });
      clickInitialized = true;
    }

    function initArrows() {
      documentApi.getElementById('trendingPrev')?.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        switchCategory(getNextIndex(currentIndex, 'left'), 'left');
      });
      documentApi.getElementById('trendingNext')?.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        switchCategory(getNextIndex(currentIndex, 'right'), 'right');
      });
    }

    async function init() {
      const toggle = documentApi.getElementById('trendingSwitch');
      const section = documentApi.getElementById('trendingSection');
      if (!toggle || !section) return;
      initClickHandler();
      initArrows();
      const stored = await chromeApi.storage.local.get(storageKeys.enabled);
      const enabled = stored[storageKeys.enabled] !== false;
      toggle.checked = enabled;
      try { windowApi.localStorage.setItem(storageKeys.enabled, String(enabled)); } catch {}
      if (!enabled) {
        section.classList.add('hidden');
        documentApi.body.classList.add('trending-hidden');
      } else {
        documentApi.documentElement.classList.remove('trending-hidden');
        await loadStoredCategory();
        updateDots();
        void loadData();
      }
      toggle.addEventListener('change', async () => {
        const searchBox = documentApi.querySelector('.search-box');
        documentApi.body.classList.add('trending-transitioning');
        searchBox?.classList.add('search-focused');
        section.classList.toggle('hidden', !toggle.checked);
        documentApi.body.classList.toggle('trending-hidden', !toggle.checked);
        documentApi.documentElement.classList.toggle('trending-hidden', !toggle.checked);
        if (toggle.checked) {
          await loadStoredCategory();
          updateDots();
          void loadData();
        }
        await chromeApi.storage.local.set({ [storageKeys.enabled]: toggle.checked });
        try { windowApi.localStorage.setItem(storageKeys.enabled, String(toggle.checked)); } catch {}
        setTimeout(() => {
          documentApi.body.classList.remove('trending-transitioning');
          searchBox?.classList.remove('search-focused');
          options.focusSearch?.();
        }, 400);
      });
      section.addEventListener('wheel', handleWheel, { passive: false });
      windowApi.addEventListener('resize', () => {
        if (lastData && getColumnCount() !== lastColumns) render(lastData);
      });
    }

    return Object.freeze({
      categories,
      getCurrentIndex: () => currentIndex,
      getNextIndex,
      init,
      loadData,
      loadStoredCategory,
      render,
      switchCategory,
      updateDots
    });
  }

  root.EchoNtpTrendingController = Object.freeze({ CATEGORY_DEFINITIONS, LEGACY_TABS, create });
})(globalThis);