/**
 * ECHO B站推荐回退
 * 在当前标签页内保存最近 10 批首页推荐，并提供前后导航。
 */

(async function() {
  'use strict';

  if (window !== window.top || window.__ECHO_BILI_FEED_HISTORY_ACTIVE__) return;
  window.__ECHO_BILI_FEED_HISTORY_ACTIVE__ = true;

  const SETTING_KEY = 'biliFeedHistory';
  const SCHEMA_VERSION = 2;
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
  let feedObserverRoot = null;
  let controlObserver = null;
  let controlObserverRoot = null;
  let pageObserver = null;
  let resizeObserver = null;
  let settleVersion = 0;
  let initialSettleRunning = false;
  let overlay = null;
  let styleElement = null;
  let persistTimer = 0;
  let restoredFromSession = false;

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

  function classifyCard(url) {
    try {
      const parsed = new URL(url);
      if (/^\/video\/BV/i.test(parsed.pathname)) return 'video';
      if (parsed.pathname.startsWith('/bangumi/play/')) return 'bangumi';
      if (parsed.hostname === 'live.bilibili.com') return 'live';
      return 'other';
    } catch {
      return 'other';
    }
  }

  function extractCard(node) {
    const links = [...node.querySelectorAll('a[href]')];
    const targetLink = node.querySelector('.bili-video-card__image--link[href], .bili-video-card__info--tit[href]')
      || links.find((link) => /\/video\/|\/bangumi\/play\/|live\.bilibili\.com/.test(link.getAttribute('href') || ''))
      || links.find((link) => !/space\.bilibili\.com/.test(link.getAttribute('href') || ''));
    const url = normalizeUrl(targetLink?.getAttribute('href'));
    if (!url) return null;

    const image = node.querySelector('img');
    const coverUrl = normalizeUrl(image?.currentSrc || image?.getAttribute('src') || image?.getAttribute('data-src'));
    const statItems = [...node.querySelectorAll('.bili-video-card__stats--left .bili-video-card__stats--item')];
    const statText = (item) => (item?.querySelector('.bili-video-card__stats--text')?.textContent || item?.textContent || '').trim();
    const authorLink = node.querySelector('.bili-video-card__info--owner[href]');
    const authorName = textFrom(node, ['.bili-video-card__info--author']);
    const authorLabel = (authorLink?.textContent || authorName).trim().replace(/\s+/g, ' ');

    return {
      schemaVersion: SCHEMA_VERSION,
      type: classifyCard(url),
      url,
      coverUrl,
      title: textFrom(node, ['.bili-video-card__info--tit', 'h3', '[title]']),
      author: {
        name: authorName,
        label: authorLabel,
        url: normalizeUrl(authorLink?.getAttribute('href')),
      },
      duration: textFrom(node, ['.bili-video-card__stats__duration', '.bili-video-card__stats--duration', '[class*="duration"]']),
      metrics: {
        playCount: statText(statItems[0]),
        danmakuCount: statText(statItems[1]),
      },
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
      .feed-roll-btn.echo-bili-feed-rail{height:90px!important;min-height:90px!important}
      .feed-roll-btn.echo-bili-feed-rail>.primary-btn.roll-btn{display:flex!important;flex-direction:column!important;align-items:center!important;justify-content:center!important;gap:1px!important;width:40px!important;height:42px!important;min-height:42px!important;padding:2px 0!important}
      .feed-roll-btn.echo-bili-feed-rail>.primary-btn.roll-btn>svg{width:14px!important;height:14px!important;flex:none!important}
      .feed-roll-btn.echo-bili-feed-rail>.primary-btn.roll-btn>span{font-size:11px!important;line-height:12px!important;white-space:nowrap!important;writing-mode:horizontal-tb!important}
      .echo-bili-feed-navigation{position:absolute;top:46px;right:0;z-index:4;display:flex;flex-direction:column;gap:3px;width:40px;height:43px;margin:0;pointer-events:none}
      .echo-bili-feed-navigation button{display:flex;align-items:center;justify-content:center;width:40px;height:20px;padding:0;border:1px solid rgba(251,114,153,.38);border-radius:5px;background:rgba(255,255,255,.96);color:#fb7299;cursor:pointer;pointer-events:auto;box-shadow:0 1px 4px rgba(0,0,0,.08)}
      .echo-bili-feed-navigation button svg{width:13px;height:13px;fill:none;stroke:currentColor;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}
      .echo-bili-feed-navigation button:hover:not(:disabled){border-color:#fb7299;background:rgba(251,114,153,.12);color:#e85c86}
      .echo-bili-feed-navigation button:active:not(:disabled){background:rgba(251,114,153,.2);transform:translateY(1px)}
      .echo-bili-feed-navigation button:disabled{border-color:#d8dadd;background:rgba(255,255,255,.88);color:#b5b8bd;cursor:not-allowed;box-shadow:none}
      .echo-bili-feed-overlay{position:absolute;inset:0;z-index:20;pointer-events:none}
      .echo-bili-history-card{position:absolute;overflow:hidden;background:var(--bg1,#fff);color:var(--text1,#18191c);pointer-events:auto}
      .echo-bili-history-card a{color:inherit;text-decoration:none}
      .echo-bili-history-cover{position:relative;width:100%;aspect-ratio:16/9;overflow:hidden;border-radius:6px;background:var(--graph_bg_regular,#f1f2f3)}
      .echo-bili-history-cover img{display:block;width:100%;height:100%;object-fit:cover}
      .echo-bili-history-duration{position:absolute;right:6px;bottom:6px;padding:1px 4px;border-radius:3px;background:rgba(0,0,0,.65);color:#fff;font-size:12px;line-height:18px}
      .echo-bili-history-metrics{position:absolute;bottom:6px;left:6px;display:flex;gap:8px;color:#fff;font-size:12px;line-height:18px;text-shadow:0 1px 2px rgba(0,0,0,.9)}
      .echo-bili-history-title{display:-webkit-box;overflow:hidden;margin-top:8px;font-size:15px;font-weight:500;line-height:22px;-webkit-line-clamp:2;-webkit-box-orient:vertical}
      .echo-bili-history-author{display:block;overflow:hidden;margin-top:5px;color:var(--text3,#9499a0);font-size:13px;line-height:18px;text-overflow:ellipsis;white-space:nowrap}
      @media (prefers-color-scheme:dark){.echo-bili-feed-navigation button{background:rgba(30,30,34,.96);border-color:rgba(251,114,153,.48)}.echo-bili-feed-navigation button:disabled{border-color:#4b4f55;background:rgba(30,30,34,.88);color:#686d73}}
    `;
    document.head.appendChild(styleElement);
  }

  function createNavigationButton(label, direction) {
    const button = document.createElement('button');
    button.type = 'button';
    button.title = label;
    button.setAttribute('aria-label', label);
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.setAttribute('viewBox', '0 0 24 24');
    icon.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', direction === 'previous' ? 'm15 18-6-6 6-6' : 'm9 18 6-6-6-6');
    icon.appendChild(path);
    button.appendChild(icon);
    return button;
  }

  function injectNavigation() {
    const nextNativeButton = document.querySelector(NATIVE_BUTTON_SELECTOR);
    if (!nextNativeButton) return false;
    if (nativeButton === nextNativeButton && navigation?.isConnected) return true;

    removeNavigation();
    document.querySelectorAll('.echo-bili-feed-navigation').forEach((item) => item.remove());
    nativeButton = nextNativeButton;
    nativeButton.closest('.feed-roll-btn')?.classList.add('echo-bili-feed-rail');
    nativeButton.title = '换一换';
    navigation = document.createElement('div');
    navigation.className = 'echo-bili-feed-navigation';
    const previousButton = createNavigationButton('上一批推荐', 'previous');
    const nextButton = createNavigationButton('下一批推荐', 'next');
    previousButton.dataset.action = 'previous';
    nextButton.dataset.action = 'next';
    previousButton.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      navigate(-1);
    });
    nextButton.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      navigate(1);
    });
    navigation.append(previousButton, nextButton);
    nativeButton.closest('.feed-roll-btn')?.appendChild(navigation);
    nativeButton.addEventListener('click', handleNativeRefresh, true);
    updateNavigation();
    return true;
  }

  function removeNavigation() {
    if (nativeButton) nativeButton.removeEventListener('click', handleNativeRefresh, true);
    nativeButton?.closest('.feed-roll-btn')?.classList.remove('echo-bili-feed-rail');
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

  function isValidStoredState(state) {
    return state?.schemaVersion === SCHEMA_VERSION
      && Array.isArray(state.batches)
      && state.batches.every((batch) => typeof batch?.identity === 'string' && Array.isArray(batch.cards));
  }

  async function restoreSessionState() {
    try {
      const response = await chrome.runtime.sendMessage({ action: 'loadBiliFeedHistory' });
      if (!response?.ok || !isValidStoredState(response.state)) return;
      batches = response.state.batches.slice(-MAX_BATCHES);
      currentIndex = Math.max(0, Math.min(Number(response.state.currentIndex) || 0, batches.length - 1));
      restoredFromSession = batches.length > 0;
    } catch (error) {
      console.warn('[ECHO Bili History] Failed to restore session:', error);
    }
  }

  function persistState() {
    if (!enabled) return;
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      persistTimer = 0;
      chrome.runtime.sendMessage({
        action: 'saveBiliFeedHistory',
        state: {
          schemaVersion: SCHEMA_VERSION,
          batches,
          currentIndex,
          updatedAt: Date.now(),
        }
      }).catch((error) => console.warn('[ECHO Bili History] Failed to save session:', error));
    }, 50);
  }

  function clearPersistedState() {
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = 0;
    chrome.runtime.sendMessage({ action: 'clearBiliFeedHistory' }).catch(() => {});
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
        const contentLink = document.createElement('a');
        contentLink.href = data.url;
        const cover = document.createElement('div');
        cover.className = 'echo-bili-history-cover';
        if (data.coverUrl) {
          const image = document.createElement('img');
          image.src = data.coverUrl;
          image.alt = '';
          cover.appendChild(image);
        }
        const metrics = document.createElement('span');
        metrics.className = 'echo-bili-history-metrics';
        if (data.metrics?.playCount) {
          const playCount = document.createElement('span');
          playCount.textContent = `播放 ${data.metrics.playCount}`;
          metrics.appendChild(playCount);
        }
        if (data.metrics?.danmakuCount) {
          const danmakuCount = document.createElement('span');
          danmakuCount.textContent = `弹幕 ${data.metrics.danmakuCount}`;
          metrics.appendChild(danmakuCount);
        }
        if (metrics.children.length) cover.appendChild(metrics);
        if (data.duration) {
          const duration = document.createElement('span');
          duration.className = 'echo-bili-history-duration';
          duration.textContent = data.duration;
          cover.appendChild(duration);
        }
        const title = document.createElement('div');
        title.className = 'echo-bili-history-title';
        title.textContent = data.title || 'B站推荐内容';
        contentLink.append(cover, title);
        card.appendChild(contentLink);

        const author = document.createElement('span');
        author.className = 'echo-bili-history-author';
        author.textContent = data.author?.label || data.author?.name || '';
        if (data.author?.url) {
          const authorLink = document.createElement('a');
          authorLink.href = data.author.url;
          authorLink.appendChild(author);
          card.appendChild(authorLink);
        } else {
          card.appendChild(author);
        }
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
    persistState();
  }

  function saveBatch(batch, options = {}) {
    if (!batch.cards.some(Boolean)) return;
    if (batches.at(-1)?.identity === batch.identity) {
      renderHistoryBatch();
      updateNavigation();
      return;
    }
    const wasViewingLatest = currentIndex < 0 || currentIndex === batches.length - 1;
    batches.push({ identity: batch.identity, cards: batch.cards });
    if (batches.length > MAX_BATCHES) {
      batches.shift();
      if (!wasViewingLatest) currentIndex = Math.max(0, currentIndex - 1);
    }
    if (!options.preserveCurrentIndex || wasViewingLatest) currentIndex = batches.length - 1;
    if (currentIndex === batches.length - 1) removeOverlay();
    else renderHistoryBatch();
    updateNavigation();
    persistState();
  }

  async function settleInitialBatch(version) {
    if (initialSettleRunning) return;
    initialSettleRunning = true;
    if (navigation) navigation.dataset.initialState = 'waiting';
    const startedAt = performance.now();
    let stableFrames = 0;
    let previousIdentity = '';
    while (enabled && version === settleVersion && performance.now() - startedAt < INITIAL_SETTLE_TIMEOUT_MS) {
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
        const preserveCurrentIndex = restoredFromSession && currentIndex < batches.length - 1;
        saveBatch(batch, { preserveCurrentIndex });
        restoredFromSession = false;
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
    persistState();
    settleVersion += 1;
    settleNewBatch(settleVersion);
  }

  function bindFeedObserver() {
    feedObserver?.disconnect();
    const container = document.querySelector(CARD_SELECTOR)?.parentElement;
    if (!container) return;
    feedObserverRoot = container;
    feedObserver = new MutationObserver(() => {
      if (!navigation?.isConnected) injectNavigation();
      if (navigation?.dataset.initialState !== 'complete') settleInitialBatch(settleVersion);
    });
    feedObserver.observe(container, { childList: true, subtree: true });

    controlObserver?.disconnect();
    const controlRoot = nativeButton?.closest('.feed2') || document.querySelector('.feed2');
    controlObserverRoot = controlRoot;
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
        const currentFeedRoot = document.querySelector(CARD_SELECTOR)?.parentElement;
        const currentControlRoot = nativeButton?.closest('.feed2') || document.querySelector('.feed2');
        if (feedObserverRoot !== currentFeedRoot || controlObserverRoot !== currentControlRoot) {
          bindFeedObserver();
        }
        settleInitialBatch(settleVersion);
      }
    };
    pageObserver?.disconnect();
    pageObserver = new MutationObserver(waitForPage);
    pageObserver.observe(document.body, { childList: true, subtree: true });
    waitForPage();
  }

  function stop() {
    settleVersion += 1;
    removeOverlay();
    removeNavigation();
    feedObserver?.disconnect();
    feedObserver = null;
    feedObserverRoot = null;
    controlObserver?.disconnect();
    controlObserver = null;
    controlObserverRoot = null;
    pageObserver?.disconnect();
    pageObserver = null;
    batches = [];
    currentIndex = -1;
    restoredFromSession = false;
    initialSettleRunning = false;
    clearPersistedState();
    styleElement?.remove();
    styleElement = null;
  }

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'sync' || !changes[SETTING_KEY]) return;
    enabled = Boolean(changes[SETTING_KEY].newValue);
    if (enabled) start();
    else stop();
  });

  if (enabled) await restoreSessionState();
  start();
})();