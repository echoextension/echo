(function(root) {
  'use strict';

  const CACHE_DURATION = 10 * 60 * 1000;
  const ITEM_HEIGHT = 18;
  const TOUTIAO_API = 'https://www.toutiao.com/hot-event/hot-board/?origin=toutiao_pc';

  function create(options) {
    const chromeApi = options.chrome;
    const documentApi = options.document;
    const panel = options.panel;
    const actions = options.actions;
    const now = options.now || Date.now;
    const schedule = options.setTimeout || root.setTimeout.bind(root);
    const startInterval = options.setInterval || root.setInterval.bind(root);
    const stopInterval = options.clearInterval || root.clearInterval.bind(root);
    const onAvailabilityChange = options.onAvailabilityChange || (() => {});
    let trendingData = null;
    let trendingScrollInterval = null;
    let currentTrendingIndex = 0;
    let lastFetchTime = 0;
    let trendingPaused = false;
    let scrollWrapper = null;
    let isScrollAnimating = false;
    let active = false;
    let unavailable = false;
    let requestVersion = 0;

    function escapeHtml(text) {
      const element = documentApi.createElement('div');
      element.textContent = text;
      return element.innerHTML;
    }

    function getLoopIndex(index, length) {
      return ((index % length) + length) % length;
    }

    function renderVisibleWords() {
      if (!panel || !trendingData || trendingData.length === 0) return;
      const scrollTrack = panel.querySelector('.trending-scroll-track');
      if (!scrollTrack) return;
      const length = trendingData.length;
      const items = [];
      for (let offset = -1; offset <= 1; offset += 1) {
        const dataIndex = getLoopIndex(currentTrendingIndex + offset, length);
        const item = trendingData[dataIndex];
        let classes = 'trending-word';
        if (offset === 0) classes += ' active';
        else classes += ' adjacent';
        items.push(`
          <a class="${classes}"
             data-offset="${offset}"
             data-query="${escapeHtml(item.title)}"
             title="${escapeHtml(item.title)}">${escapeHtml(item.title)}</a>
        `);
      }
      scrollTrack.innerHTML = items.join('');
      scrollTrack.querySelectorAll('.trending-word.active').forEach(word => {
        word.addEventListener('click', event => {
          event.preventDefault();
          event.stopPropagation();
          const query = word.dataset.query;
          if (!query) return;
          chromeApi.runtime.sendMessage({
            action: actions.OPEN_IN_NEW_TAB,
            url: `https://www.bing.com/search?q=${encodeURIComponent(query)}`,
            active: true,
            forceAdjacentPosition: true
          });
        });
      });
      scrollTrack.style.transform = 'translateY(-18px)';
    }

    function scrollByDelta(delta) {
      if (isScrollAnimating || !trendingData) return;
      const scrollTrack = panel?.querySelector('.trending-scroll-track');
      if (!scrollTrack) return;
      isScrollAnimating = true;
      currentTrendingIndex = getLoopIndex(currentTrendingIndex + delta, trendingData.length);
      scrollTrack.style.transition = 'none';
      renderVisibleWords();
      const startOffset = 18 - (delta * ITEM_HEIGHT);
      scrollTrack.style.transform = `translateY(-${startOffset}px)`;
      scrollTrack.offsetHeight;
      scrollTrack.style.transition = 'transform 0.3s ease-out';
      scrollTrack.style.transform = 'translateY(-18px)';
      if (trendingPaused) {
        scrollTrack.querySelector('.trending-word.active')?.classList.add('hovered');
      }
      schedule(() => {
        isScrollAnimating = false;
      }, 300);
    }

    function handleMouseEnter() {
      trendingPaused = true;
      panel?.classList.add('hint-arrows');
    }

    function handleMouseLeave() {
      trendingPaused = false;
      if (!panel) return;
      panel.classList.remove('hint-arrows');
      panel.querySelectorAll('.trending-word.hovered').forEach(element => {
        element.classList.remove('hovered');
      });
    }

    function handleWheel(event) {
      event.preventDefault();
      event.stopPropagation();
      if (!trendingData || isScrollAnimating) return;
      if (event.deltaY > 0) scrollByDelta(1);
      else if (event.deltaY < 0) scrollByDelta(-1);
    }

    function stopScroll() {
      if (trendingScrollInterval) {
        stopInterval(trendingScrollInterval);
        trendingScrollInterval = null;
      }
      if (!panel) return;
      panel.removeEventListener('mouseenter', handleMouseEnter);
      panel.removeEventListener('mouseleave', handleMouseLeave);
      panel.removeEventListener('wheel', handleWheel);
    }

    function stop() {
      active = false;
      requestVersion += 1;
      stopScroll();
      unavailable = false;
    }

    function startScroll() {
      stopScroll();
      if (!trendingData || trendingData.length <= 1) return;
      scrollWrapper = panel?.querySelector('.trending-scroll-wrapper');
      if (!scrollWrapper) return;
      currentTrendingIndex = 0;
      trendingPaused = false;
      renderVisibleWords();
      trendingScrollInterval = startInterval(() => {
        if (trendingPaused || isScrollAnimating) return;
        scrollByDelta(1);
      }, 7000);
      panel.addEventListener('mouseenter', handleMouseEnter);
      panel.addEventListener('mouseleave', handleMouseLeave);
      panel.addEventListener('wheel', handleWheel, { passive: false });
    }

    async function fetchToutiaoTrends() {
      try {
        const result = await chromeApi.runtime.sendMessage({
          action: actions.PROXY_FETCH,
          url: TOUTIAO_API,
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
        if (data && Array.isArray(data.data) && data.data.length > 0) {
          return data.data.slice(0, 20)
            .map(item => ({ title: item.Title || '' }))
            .filter(item => item.title);
        }
        return null;
      } catch (error) {
        console.error('[ECHO] fetchToutiaoTrends 异常:', error);
        return null;
      }
    }

    async function fetchTrendingData(forceRefresh = false) {
      if (!panel) return;
      if (!forceRefresh && trendingData && now() - lastFetchTime < CACHE_DURATION) {
        startScroll();
        return;
      }
      const version = ++requestVersion;
      const trends = await fetchToutiaoTrends();
      if (version !== requestVersion) return;
      if (trends && trends.length > 0) {
        trendingData = trends;
        lastFetchTime = now();
        unavailable = false;
        onAvailabilityChange(true);
      } else {
        console.warn('[ECHO] 热搜获取失败，使用兜底数据');
        trendingData = null;
        unavailable = true;
        stopScroll();
        onAvailabilityChange(false);
      }
      if (active) startScroll();
    }

    function start() {
      active = true;
      if (unavailable) return;
      if (!trendingData || now() - lastFetchTime > CACHE_DURATION) {
        void fetchTrendingData();
      } else {
        startScroll();
      }
    }

    return Object.freeze({
      fetchTrendingData,
      fetchToutiaoTrends,
      renderVisibleWords,
      scrollByDelta,
      start,
      stop
    });
  }

  root.EchoSearchBoxTrendingController = Object.freeze({
    CACHE_DURATION,
    ITEM_HEIGHT,
    TOUTIAO_API,
    create
  });
})(globalThis);