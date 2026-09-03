/**
 * ECHO B站推荐回退
 * 在当前标签页内保存最近 10 批首页推荐，并提供前后导航。
 */

(async function() {
  'use strict';

  const MESSAGE_ACTIONS = EchoMessages.ACTIONS;

  if (window !== window.top || window.__ECHO_BILI_FEED_HISTORY_ACTIVE__) return;
  window.__ECHO_BILI_FEED_HISTORY_ACTIVE__ = true;

  const SETTING_KEY = 'biliFeedHistory';
  const SCHEMA_VERSION = 3;
  const MAX_BATCHES = 10;
  const CARD_SELECTOR = '.feed-card';
  const NATIVE_BUTTON_SELECTOR = '.feed-roll-btn .primary-btn.roll-btn';
  const SETTLE_FRAMES = 2;
  const SETTLE_TIMEOUT_MS = 5000;
  const INITIAL_SETTLE_TIMEOUT_MS = 20000;

  let enabled = (await chrome.storage.sync.get({
    [SETTING_KEY]: EchoSettings.getDefault(SETTING_KEY)
  }))[SETTING_KEY];
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
  let initialSettleCompleted = false;
  let overlay = null;
  let styleElement = null;
  let persistTimer = 0;
  let restoredFromSession = false;
  let lifecycleVersion = 0;
  let observedPath = location.pathname;
  let routeObserver = null;

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

  function getPresentationKind(node) {
    if (!node?.querySelector('.bili-video-card__wrap')) return '';
    const directStatsLabel = node.querySelector('.bili-video-card__stats > .bili-video-card__stats--text');
    return node.querySelector('.bili-video-card__info--owner.disable-hover') || directStatsLabel ? 'ad' : 'video';
  }

  function extractCard(node) {
    const presentationKind = getPresentationKind(node);
    if (!presentationKind) return null;
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
    const dateLabel = textFrom(node, ['.bili-video-card__info--date']);
    const badgeText = textFrom(node, ['.bili-video-card__info--icon-text']);
    const adLabel = textFrom(node, ['.bili-video-card__stats > .bili-video-card__stats--text']);

    return {
      schemaVersion: SCHEMA_VERSION,
      type: classifyCard(url),
      url,
      coverUrl,
      title: textFrom(node, ['.bili-video-card__info--tit', 'h3', '[title]']),
      author: {
        name: authorName,
        url: normalizeUrl(authorLink?.getAttribute('href')),
      },
      dateLabel,
      presentation: {
        kind: presentationKind,
        videoCardClass: node.querySelector('.bili-video-card')?.className || '',
        authorLinkClass: authorLink?.className || '',
        hasAuthorIcon: Boolean(authorLink?.querySelector('.bili-video-card__info--owner__up')),
        badgeText,
        adLabel,
      },
      duration: textFrom(node, ['.bili-video-card__stats__duration', '.bili-video-card__stats--duration', '[class*="duration"]']),
      metrics: {
        playCount: statText(statItems[0]),
        danmakuCount: statText(statItems[1]),
      },
    };
  }

  function getFeedSlots() {
    return [...document.querySelectorAll(CARD_SELECTOR)]
      .filter((slot) => !slot.closest('.echo-bili-feed-overlay'));
  }

  function captureBatch() {
    const slots = getFeedSlots();
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
      .echo-bili-feed-navigation{position:absolute;top:calc(100% + 6px);right:0;z-index:4;display:flex;flex-direction:column;gap:4px;width:40px;height:68px;margin:0;pointer-events:none}
      .echo-bili-feed-navigation button{display:flex;align-items:center;justify-content:center;width:40px;height:32px;padding:0;border:1px solid rgba(251,114,153,.48);border-radius:7px;background:rgba(255,255,255,.97);color:#fb7299;cursor:pointer;pointer-events:auto;box-shadow:0 2px 8px rgba(0,0,0,.1)}
      .echo-bili-feed-navigation button svg{width:17px;height:17px;fill:none;stroke:currentColor;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}
      .echo-bili-feed-navigation button:hover:not(:disabled){border-color:#fb7299;background:rgba(251,114,153,.12);color:#e85c86}
      .echo-bili-feed-navigation button:active:not(:disabled){background:rgba(251,114,153,.2);transform:translateY(1px)}
      .echo-bili-feed-navigation button:disabled{border-color:#d8dadd;background:rgba(255,255,255,.88);color:#b5b8bd;cursor:not-allowed;box-shadow:none}
      .echo-bili-feed-overlay{position:absolute;inset:0;z-index:20;pointer-events:none}
      .echo-bili-history-card,.echo-bili-history-empty-slot{position:absolute!important;margin:0!important}
      .echo-bili-history-card{pointer-events:auto}
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
    if (initialSettleCompleted) navigation.dataset.initialState = 'complete';
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

  function isValidStoredState(state) {
    return state?.schemaVersion === SCHEMA_VERSION
      && Array.isArray(state.batches)
      && state.batches.every((batch) => typeof batch?.identity === 'string' && Array.isArray(batch.cards));
  }

  async function restoreSessionState(version = lifecycleVersion) {
    try {
      const response = await chrome.runtime.sendMessage({ action: MESSAGE_ACTIONS.LOAD_BILI_FEED_HISTORY });
      if (!enabled || version !== lifecycleVersion) return;
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
        action: MESSAGE_ACTIONS.SAVE_BILI_FEED_HISTORY,
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
    chrome.runtime.sendMessage({ action: MESSAGE_ACTIONS.CLEAR_BILI_FEED_HISTORY }).catch(() => {});
  }

  function positionOverlay() {
    if (!overlay) return;
    const slots = getFeedSlots();
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

  function setLink(link, url) {
    if (!link) return;
    if (url) link.href = url;
    else link.removeAttribute('href');
  }

  function createHistoryCard(templateSlot, data) {
    if (!templateSlot?.querySelector('.bili-video-card__wrap')) return null;

    const card = templateSlot.cloneNode(true);
    card.classList.add('echo-bili-history-card');
    card.removeAttribute('data-echo-history-hidden');
    card.style.visibility = '';
    card.querySelectorAll('[id]').forEach((item) => item.removeAttribute('id'));
    card.querySelectorAll('.bili-video-card__no-interest,.bili-video-card__info--no-interest,.bili-watch-later--wrap,.v-inline-player')
      .forEach((item) => item.remove());

    const videoCard = card.querySelector('.bili-video-card');
    if (videoCard && data.presentation?.videoCardClass) {
      videoCard.className = data.presentation.videoCardClass;
    }

    card.querySelectorAll('.bili-video-card__image--link,.bili-video-card__info--tit a')
      .forEach((link) => setLink(link, data.url));

    const image = card.querySelector('.bili-video-card__cover img,.bili-video-card__image img');
    if (image) {
      image.closest('picture')?.querySelectorAll('source').forEach((source) => source.remove());
      image.removeAttribute('srcset');
      image.removeAttribute('data-src');
      if (data.coverUrl) image.src = data.coverUrl;
      else image.removeAttribute('src');
      image.hidden = !data.coverUrl;
      image.alt = data.title || '';
    }

    const presentationKind = data.presentation?.kind || 'video';
    const stats = card.querySelector('.bili-video-card__stats');
    const statsLeft = stats?.querySelector('.bili-video-card__stats--left');
    const directStatsLabel = stats?.querySelector(':scope > .bili-video-card__stats--text');
    const duration = stats?.querySelector('.bili-video-card__stats__duration,.bili-video-card__stats--duration');
    if (presentationKind === 'ad') {
      statsLeft?.replaceChildren();
      duration?.remove();
      const adLabel = directStatsLabel || document.createElement('span');
      adLabel.className = 'bili-video-card__stats--text';
      adLabel.textContent = data.presentation?.adLabel || '';
      adLabel.hidden = !data.presentation?.adLabel;
      if (!directStatsLabel) stats?.appendChild(adLabel);
    } else {
      directStatsLabel?.remove();
      const statItems = [...card.querySelectorAll('.bili-video-card__stats--left .bili-video-card__stats--item')];
      const statValues = [data.metrics?.playCount, data.metrics?.danmakuCount];
      statItems.forEach((item, index) => {
        const text = item.querySelector('.bili-video-card__stats--text');
        if (text) text.textContent = statValues[index] || '';
        item.hidden = !statValues[index];
      });
      if (duration) {
        duration.textContent = data.duration || '';
        duration.hidden = !data.duration;
      }
    }

    const title = card.querySelector('.bili-video-card__info--tit');
    if (title) title.title = data.title || '';
    const titleLink = title?.querySelector('a');
    if (titleLink) titleLink.textContent = data.title || '';

    const authorLink = card.querySelector('.bili-video-card__info--owner');
    setLink(authorLink, data.author?.url);
    if (authorLink && data.presentation?.authorLinkClass) {
      authorLink.className = data.presentation.authorLinkClass;
    }
    if (!data.presentation?.hasAuthorIcon) {
      authorLink?.querySelector('.bili-video-card__info--owner__up')?.remove();
    }
    const author = card.querySelector('.bili-video-card__info--author');
    if (author) {
      author.textContent = data.author?.name || '';
      author.title = data.author?.name || '';
    }

    const date = card.querySelector('.bili-video-card__info--date');
    if (date) {
      date.textContent = data.dateLabel || '';
      date.hidden = !data.dateLabel;
    }

    const infoBottom = card.querySelector('.bili-video-card__info--bottom');
    const currentBadge = infoBottom?.querySelector('.bili-video-card__info--icon-text');
    if (presentationKind === 'video' && data.presentation?.badgeText) {
      const badge = currentBadge || document.createElement('div');
      badge.className = 'bili-video-card__info--icon-text';
      badge.textContent = data.presentation.badgeText;
      if (!currentBadge) infoBottom?.prepend(badge);
    } else {
      currentBadge?.remove();
    }

    return card;
  }

  function createEmptyHistorySlot() {
    const slot = document.createElement('div');
    slot.className = 'echo-bili-history-empty-slot';
    return slot;
  }

  function isCompatibleTemplate(slot, data) {
    if (!slot || !data) return false;
    const presentationKind = data.presentation?.kind || 'video';
    if (getPresentationKind(slot) !== presentationKind) return false;
    if (presentationKind === 'ad') return true;

    const requiredStats = [data.metrics?.playCount, data.metrics?.danmakuCount].filter(Boolean).length;
    if (slot.querySelectorAll('.bili-video-card__stats--left .bili-video-card__stats--item').length < requiredStats) {
      return false;
    }
    if (data.duration && !slot.querySelector('.bili-video-card__stats__duration,.bili-video-card__stats--duration')) {
      return false;
    }
    if (data.dateLabel && !slot.querySelector('.bili-video-card__info--date')) return false;
    if (data.presentation?.hasAuthorIcon && !slot.querySelector('.bili-video-card__info--owner__up')) return false;
    return true;
  }

  function renderHistoryBatch() {
    removeOverlay();
    if (currentIndex === batches.length - 1) return;
    const slots = getFeedSlots();
    const batch = batches[currentIndex];
    if (!slots.length || !batch) return;

    overlay = document.createElement('div');
    overlay.className = 'echo-bili-feed-overlay';
    document.body.appendChild(overlay);
    slots.forEach((slot, index) => {
      const data = batch.cards[index];
      const presentationKind = data?.presentation?.kind || 'video';
      const compatibleTemplate = isCompatibleTemplate(slot, data)
        ? slot
        : slots.find((candidate) => isCompatibleTemplate(candidate, data));
      const fallbackTemplate = presentationKind === 'ad'
        ? slots.find((candidate) => getPresentationKind(candidate) === 'video')
        : null;
      const template = compatibleTemplate || fallbackTemplate;
      const card = data ? createHistoryCard(template, data) : null;
      slot.style.visibility = 'hidden';
      slot.dataset.echoHistoryHidden = 'true';
      overlay.appendChild(card || createEmptyHistorySlot());
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
    if (initialSettleRunning || initialSettleCompleted) return;
    initialSettleRunning = true;
    try {
      if (navigation) navigation.dataset.initialState = 'waiting';
      const startedAt = performance.now();
      let stableFrames = 0;
      let previousIdentity = '';
      while (enabled && version === settleVersion && performance.now() - startedAt < INITIAL_SETTLE_TIMEOUT_MS) {
        await nextFrame();
        if (!enabled || version !== settleVersion) return;
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
          initialSettleCompleted = true;
          if (navigation) navigation.dataset.initialState = 'complete';
          return;
        }
      }
      if (batches.length) initialSettleCompleted = true;
      if (navigation) navigation.dataset.initialState = initialSettleCompleted ? 'complete' : 'timeout';
    } finally {
      initialSettleRunning = false;
      if (enabled && !initialSettleCompleted && navigation?.isConnected
          && version !== settleVersion) {
        void settleInitialBatch(settleVersion);
      }
    }
  }

  async function settleNewBatch(version) {
    const startedAt = performance.now();
    let stableFrames = 0;
    let previousIdentity = '';
    while (enabled && version === settleVersion && performance.now() - startedAt < SETTLE_TIMEOUT_MS) {
      await nextFrame();
      if (!enabled || version !== settleVersion) return;
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
    const container = getFeedSlots()[0]?.parentElement;
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
      if (injectNavigation() && getFeedSlots().length) {
        const currentFeedRoot = getFeedSlots()[0]?.parentElement;
        const currentControlRoot = nativeButton?.closest('.feed2') || document.querySelector('.feed2');
        if (feedObserverRoot !== currentFeedRoot || controlObserverRoot !== currentControlRoot) {
          if (feedObserverRoot && feedObserverRoot !== currentFeedRoot) initialSettleCompleted = false;
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

  function deactivatePage() {
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
    restoredFromSession = batches.length > 0;
    initialSettleRunning = false;
    initialSettleCompleted = false;
  }

  function stop() {
    lifecycleVersion += 1;
    deactivatePage();
    unregisterRouteLifecycle();
    batches = [];
    currentIndex = -1;
    restoredFromSession = false;
    clearPersistedState();
    styleElement?.remove();
    styleElement = null;
  }

  function reconcileRoute() {
    const nextPath = location.pathname;
    if (nextPath === observedPath) return;
    observedPath = nextPath;
    if (enabled && nextPath === '/') start();
    else deactivatePage();
  }

  function registerRouteLifecycle() {
    if (routeObserver) return;
    observedPath = location.pathname;
    routeObserver = new MutationObserver(reconcileRoute);
    routeObserver.observe(document.documentElement, { childList: true, subtree: true });
    window.addEventListener('popstate', reconcileRoute);
  }

  function unregisterRouteLifecycle() {
    routeObserver?.disconnect();
    routeObserver = null;
    window.removeEventListener('popstate', reconcileRoute);
  }

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'sync' || !changes[SETTING_KEY]) return;
    enabled = Boolean(changes[SETTING_KEY].newValue);
    if (enabled) {
      registerRouteLifecycle();
      start();
    }
    else stop();
  });

  if (enabled) {
    registerRouteLifecycle();
    await restoreSessionState(lifecycleVersion);
  }
  start();
})();