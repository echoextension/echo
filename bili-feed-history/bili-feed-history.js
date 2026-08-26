/**
 * ECHO B站推荐回退
 * 在当前标签页内保存最近 10 批首页推荐，并提供前后导航。
 */

(async function() {
  'use strict';

  if (window !== window.top || window.__ECHO_BILI_FEED_HISTORY_ACTIVE__) return;
  window.__ECHO_BILI_FEED_HISTORY_ACTIVE__ = true;

  const SETTING_KEY = 'biliFeedHistory';
  const MAX_BATCHES = 10;
  const CARD_SELECTOR = '.feed-card';
  const NATIVE_BUTTON_SELECTOR = '.feed-roll-btn .primary-btn.roll-btn';
  const SETTLE_FRAMES = 2;
  const SETTLE_TIMEOUT_MS = 5000;
  const INITIAL_SETTLE_TIMEOUT_MS = 20000;

  let enabled = (await chrome.storage.sync.get({ [SETTING_KEY]: false }))[SETTING_KEY];
  let batches = [];
  let currentIndex = -1;
  let nativeButton = null;
  let navigation = null;
  let feedObserver = null;
  let controlObserver = null;
  let pageObserver = null;
  let resizeObserver = null;
  let settleVersion = 0;
  let initialSettleRunning = false;
  let overlay = null;
  let styleElement = null;

  const nextFrame = () => new Promise((resolve) => {
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(finish, 100);
    requestAnimationFrame(finish);
  });

  function normalizeUrl(value) {
    if (!value) return '';
    try {
      const url = new URL(value, location.origin);
      if (!/^https?:$/.test(url.protocol)) return '';
      url.hash = '';
      return url.href;
    } catch {
      return '';
    }
  }

  function textFrom(node, selectors) {
    for (const selector of selectors) {
      const element = node.querySelector(selector);
      const text = (element?.getAttribute('title') || element?.textContent || '').trim();
      if (text) return text;
    }
    return '';
  }

  function extractCard(node) {
    const links = [...node.querySelectorAll('a[href]')];
    const targetLink = node.querySelector('.bili-video-card__image--link[href], .bili-video-card__info--tit[href]')
      || links.find((link) => /\/video\/|\/bangumi\/play\/|live\.bilibili\.com/.test(link.getAttribute('href') || ''))
      || links.find((link) => !/space\.bilibili\.com/.test(link.getAttribute('href') || ''));
    const url = normalizeUrl(targetLink?.getAttribute('href'));
    if (!url) return null;

    const image = node.querySelector('img');
    const cover = normalizeUrl(image?.currentSrc || image?.getAttribute('src') || image?.getAttribute('data-src'));
    const stats = [...node.querySelectorAll('.bili-video-card__stats--item, .bili-video-card__stats span')]
      .map((item) => (item.textContent || '').trim())
      .filter(Boolean)
      .slice(0, 2)
      .join(' · ');

    return {
      url,
      cover,
      title: textFrom(node, ['.bili-video-card__info--tit', 'h3', '[title]']),
      author: textFrom(node, ['.bili-video-card__info--author', '.bili-video-card__info--owner']),
      duration: textFrom(node, ['.bili-video-card__stats__duration', '.bili-video-card__stats--duration', '[class*="duration"]']),
      stats,
    };
  }

  function captureBatch() {
    const slots = [...document.querySelectorAll(CARD_SELECTOR)];
    const cards = slots.map(extractCard);
    return {
      slots,
      cards,
      urls: cards.filter(Boolean).map((card) => card.url),
      identity: cards.map((card) => card?.url || '').join('\n'),
    };
  }

  function ensureStyles() {
    if (styleElement) return;
    styleElement = document.createElement('style');
    styleElement.id = 'echo-bili-feed-history-style';
    styleElement.textContent = `
      .echo-bili-feed-navigation{position:absolute;inset:0;z-index:3;width:40px;height:100%;pointer-events:none}
      .echo-bili-feed-navigation button{display:flex;align-items:center;justify-content:center;width:40px;height:32px;padding:0;border:1px solid var(--line_regular,#e3e5e7);border-radius:6px;background:var(--bg1,#fff);color:var(--text2,#61666d);cursor:pointer;font-size:18px;line-height:1;box-shadow:0 1px 2px rgba(0,0,0,.04)}
      .echo-bili-feed-navigation button{position:absolute;left:0;pointer-events:auto}
      .echo-bili-feed-navigation [data-action="previous"]{top:-38px}
      .echo-bili-feed-navigation [data-action="next"]{bottom:-38px}
      .echo-bili-feed-navigation button:hover:not(:disabled){border-color:#00aeec;color:#00aeec;background:#e3f7ff}
      .echo-bili-feed-navigation button:disabled{opacity:.58;cursor:default}
      .echo-bili-feed-overlay{position:absolute;inset:0;z-index:20;pointer-events:none}
      .echo-bili-history-card{position:absolute;overflow:hidden;background:var(--bg1,#fff);color:var(--text1,#18191c);pointer-events:auto}
      .echo-bili-history-card a{color:inherit;text-decoration:none}
      .echo-bili-history-cover{position:relative;width:100%;aspect-ratio:16/9;overflow:hidden;border-radius:6px;background:var(--graph_bg_regular,#f1f2f3)}
      .echo-bili-history-cover img{display:block;width:100%;height:100%;object-fit:cover}
      .echo-bili-history-duration{position:absolute;right:6px;bottom:6px;padding:1px 4px;border-radius:3px;background:rgba(0,0,0,.65);color:#fff;font-size:12px;line-height:18px}
      .echo-bili-history-title{display:-webkit-box;overflow:hidden;margin-top:8px;font-size:15px;font-weight:500;line-height:22px;-webkit-line-clamp:2;-webkit-box-orient:vertical}
      .echo-bili-history-meta{display:flex;justify-content:space-between;gap:8px;margin-top:5px;color:var(--text3,#9499a0);font-size:13px;line-height:18px}
      .echo-bili-history-author{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .echo-bili-history-stats{flex-shrink:0}
    `;
    document.head.appendChild(styleElement);
  }

  function createIconButton(label, symbol) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = symbol;
    button.title = label;
    button.setAttribute('aria-label', label);
    return button;
  }

  function injectNavigation() {
    const nextNativeButton = document.querySelector(NATIVE_BUTTON_SELECTOR);
    if (!nextNativeButton) return false;
    if (nativeButton === nextNativeButton && navigation?.isConnected) return true;

    removeNavigation();
    nativeButton = nextNativeButton;
    navigation = document.createElement('div');
    navigation.className = 'echo-bili-feed-navigation';
    const previousButton = createIconButton('上一批推荐', '←');
    const nextButton = createIconButton('下一批推荐', '→');
    previousButton.dataset.action = 'previous';
    nextButton.dataset.action = 'next';
    previousButton.addEventListener('click', () => navigate(-1));
    nextButton.addEventListener('click', () => navigate(1));
    navigation.append(previousButton, nextButton);
    nativeButton.closest('.feed-roll-btn')?.appendChild(navigation);
    nativeButton.addEventListener('click', handleNativeRefresh, true);
    updateNavigation();
    return true;
  }

  function removeNavigation() {
    if (nativeButton) nativeButton.removeEventListener('click', handleNativeRefresh, true);
    navigation?.remove();
    navigation = null;
    nativeButton = null;
  }

  function updateNavigation() {
    if (!navigation) return;
    navigation.dataset.batchCount = String(batches.length);
    navigation.dataset.currentIndex = String(currentIndex);
    const previousButton = navigation.querySelector('[data-action="previous"]');
    const nextButton = navigation.querySelector('[data-action="next"]');
    previousButton.disabled = currentIndex <= 0;
    nextButton.disabled = currentIndex < 0 || currentIndex >= batches.length - 1;
  }

  function removeOverlay() {
    overlay?.remove();
    overlay = null;
    for (const slot of document.querySelectorAll(`${CARD_SELECTOR}[data-echo-history-hidden]`)) {
      slot.style.visibility = '';
      delete slot.dataset.echoHistoryHidden;
    }
    window.removeEventListener('scroll', positionOverlay, true);
    resizeObserver?.disconnect();
    resizeObserver = null;
  }

  function positionOverlay() {
    if (!overlay) return;
    const slots = [...document.querySelectorAll(CARD_SELECTOR)];
    const renderedCards = [...overlay.children];
    slots.forEach((slot, index) => {
      const card = renderedCards[index];
      if (!card) return;
      const rect = slot.getBoundingClientRect();
      card.style.left = `${rect.left + scrollX}px`;
      card.style.top = `${rect.top + scrollY}px`;
      card.style.width = `${rect.width}px`;
      card.style.height = `${rect.height}px`;
    });
  }

  function renderHistoryBatch() {
    removeOverlay();
    if (currentIndex === batches.length - 1) return;
    const slots = [...document.querySelectorAll(CARD_SELECTOR)];
    const batch = batches[currentIndex];
    if (!slots.length || !batch) return;

    overlay = document.createElement('div');
    overlay.className = 'echo-bili-feed-overlay';
    document.body.appendChild(overlay);
    slots.forEach((slot, index) => {
      slot.style.visibility = 'hidden';
      slot.dataset.echoHistoryHidden = 'true';
      const data = batch.cards[index];
      const card = document.createElement('article');
      card.className = 'echo-bili-history-card';
      if (data) {
        const link = document.createElement('a');
        link.href = data.url;
        const cover = document.createElement('div');
        cover.className = 'echo-bili-history-cover';
        if (data.cover) {
          const image = document.createElement('img');
          image.src = data.cover;
          image.alt = '';
          cover.appendChild(image);
        }
        if (data.duration) {
          const duration = document.createElement('span');
          duration.className = 'echo-bili-history-duration';
          duration.textContent = data.duration;
          cover.appendChild(duration);
        }
        const title = document.createElement('div');
        title.className = 'echo-bili-history-title';
        title.textContent = data.title || 'B站推荐内容';
        const meta = document.createElement('div');
        meta.className = 'echo-bili-history-meta';
        const author = document.createElement('span');
        author.className = 'echo-bili-history-author';
        author.textContent = data.author;
        const stats = document.createElement('span');
        stats.className = 'echo-bili-history-stats';
        stats.textContent = data.stats;
        meta.append(author, stats);
        link.append(cover, title, meta);
        card.appendChild(link);
      }
      overlay.appendChild(card);
    });
    positionOverlay();
    window.addEventListener('scroll', positionOverlay, true);
    resizeObserver = new ResizeObserver(positionOverlay);
    slots.forEach((slot) => resizeObserver.observe(slot));
  }

  function navigate(delta) {
    const nextIndex = currentIndex + delta;
    if (nextIndex < 0 || nextIndex >= batches.length) return;
    currentIndex = nextIndex;
    renderHistoryBatch();
    updateNavigation();
  }

  function saveBatch(batch) {
    if (!batch.cards.some(Boolean)) return;
    if (batches.at(-1)?.identity === batch.identity) return;
    batches.push({ identity: batch.identity, cards: batch.cards });
    if (batches.length > MAX_BATCHES) batches.shift();
    currentIndex = batches.length - 1;
    removeOverlay();
    updateNavigation();
  }

  async function settleInitialBatch(version) {
    if (initialSettleRunning) return;
    initialSettleRunning = true;
    if (navigation) navigation.dataset.initialState = 'waiting';
    const startedAt = performance.now();
    let stableFrames = 0;
    let previousIdentity = '';
    while (enabled && version === settleVersion && !batches.length && performance.now() - startedAt < INITIAL_SETTLE_TIMEOUT_MS) {
      await nextFrame();
      const batch = captureBatch();
      if (navigation) navigation.dataset.initialValidCards = String(batch.cards.filter(Boolean).length);
      if (!batch.cards.some(Boolean)) continue;
      if (batch.identity === previousIdentity) stableFrames += 1;
      else {
        previousIdentity = batch.identity;
        stableFrames = 0;
      }
      if (navigation) navigation.dataset.initialStableFrames = String(stableFrames);
      if (stableFrames >= SETTLE_FRAMES) {
        saveBatch(batch);
        if (navigation) navigation.dataset.initialState = 'complete';
        initialSettleRunning = false;
        return;
      }
    }
    if (navigation) navigation.dataset.initialState = batches.length ? 'complete' : 'timeout';
    initialSettleRunning = false;
  }

  async function settleNewBatch(version) {
    const startedAt = performance.now();
    let stableFrames = 0;
    let previousIdentity = '';
    while (enabled && version === settleVersion && performance.now() - startedAt < SETTLE_TIMEOUT_MS) {
      await nextFrame();
      const batch = captureBatch();
      const previousBatch = batches.at(-1);
      const previousUrls = new Set(previousBatch?.cards.filter(Boolean).map((card) => card.url) || []);
      const overlap = batch.urls.filter((url) => previousUrls.has(url)).length;
      const completeReplacement = batch.slots.length === previousBatch?.cards.length && overlap === 0;
      if (!batch.cards.some(Boolean) || batch.identity === previousBatch?.identity || !completeReplacement) {
        stableFrames = 0;
        continue;
      }
      if (batch.identity === previousIdentity) stableFrames += 1;
      else {
        previousIdentity = batch.identity;
        stableFrames = 0;
      }
      if (stableFrames >= SETTLE_FRAMES) {
        saveBatch(batch);
        return;
      }
    }
  }

  function handleNativeRefresh() {
    removeOverlay();
    if (!batches.length) saveBatch(captureBatch());
    currentIndex = batches.length - 1;
    updateNavigation();
    settleVersion += 1;
    settleNewBatch(settleVersion);
  }

  function bindFeedObserver() {
    feedObserver?.disconnect();
    const container = document.querySelector(CARD_SELECTOR)?.parentElement;
    if (!container) return;
    feedObserver = new MutationObserver(() => {
      if (!navigation?.isConnected) injectNavigation();
      if (!batches.length) settleInitialBatch(settleVersion);
    });
    feedObserver.observe(container, { childList: true, subtree: true });

    controlObserver?.disconnect();
    const controlRoot = nativeButton?.closest('.feed2') || document.querySelector('.feed2');
    if (controlRoot) {
      controlObserver = new MutationObserver(() => {
        const nextButton = document.querySelector(NATIVE_BUTTON_SELECTOR);
        if (nextButton !== nativeButton || !navigation?.isConnected) injectNavigation();
      });
      controlObserver.observe(controlRoot, { childList: true, subtree: true });
    }
  }

  function start() {
    if (!enabled || location.pathname !== '/') return;
    ensureStyles();
    const waitForPage = () => {
      if (!enabled) return;
      if (injectNavigation() && document.querySelectorAll(CARD_SELECTOR).length) {
        pageObserver?.disconnect();
        pageObserver = null;
        if (!batches.length) settleInitialBatch(settleVersion);
        bindFeedObserver();
        return;
      }
      pageObserver ||= new MutationObserver(waitForPage);
      pageObserver.observe(document.body, { childList: true, subtree: true });
    };
    waitForPage();
  }

  function stop() {
    settleVersion += 1;
    removeOverlay();
    removeNavigation();
    feedObserver?.disconnect();
    feedObserver = null;
    controlObserver?.disconnect();
    controlObserver = null;
    pageObserver?.disconnect();
    pageObserver = null;
    batches = [];
    currentIndex = -1;
    initialSettleRunning = false;
    styleElement?.remove();
    styleElement = null;
  }

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'sync' || !changes[SETTING_KEY]) return;
    enabled = Boolean(changes[SETTING_KEY].newValue);
    if (enabled) start();
    else stop();
  });

  start();
})();