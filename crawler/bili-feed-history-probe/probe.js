(() => {
  'use strict';

  if (window.top !== window || window.__echoBiliFeedProbeLoaded) return;
  window.__echoBiliFeedProbeLoaded = true;

  const CARD_SELECTOR = '.feed-card';
  const SETTLE_FRAMES = 2;
  const SETTLE_TIMEOUT_MS = 5000;
  const state = {
    running: false,
    observer: null,
    container: null,
    sampling: false,
    lastUrls: [],
    lastSignature: '',
    report: null,
  };

  const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));

  function normalizeTargetUrl(href) {
    if (!href) return null;
    try {
      const url = new URL(href, location.origin);
      if (!/^(https?:)$/.test(url.protocol)) return null;
      url.hash = '';
      return url.href;
    } catch {
      return null;
    }
  }

  function classifyTarget(url) {
    if (!url) return 'missing';
    const parsed = new URL(url);
    if (/^\/video\/BV[\w]+/i.test(parsed.pathname)) return 'video-bv';
    if (parsed.pathname.startsWith('/bangumi/play/')) return 'bangumi';
    if (parsed.hostname === 'live.bilibili.com') return 'live';
    if (parsed.pathname.startsWith('/video/')) return 'video-other';
    return 'other';
  }

  function hasText(node, selectors) {
    return selectors.some((selector) => {
      const target = node.querySelector(selector);
      return Boolean(target && (target.textContent || target.getAttribute('title') || '').trim());
    });
  }

  function extractCard(node) {
    const links = [...node.querySelectorAll('a[href]')];
    const preferredLink = node.querySelector('.bili-video-card__image--link[href], .bili-video-card__info--tit[href]')
      || links.find((link) => /\/video\/|\/bangumi\/play\/|live\.bilibili\.com/.test(link.getAttribute('href') || ''))
      || links.find((link) => {
        const href = link.getAttribute('href') || '';
        return !/space\.bilibili\.com/.test(href) && normalizeTargetUrl(href);
      });
    const targetUrl = normalizeTargetUrl(preferredLink?.getAttribute('href'));
    const image = node.querySelector('img');
    const cover = image?.currentSrc || image?.getAttribute('src') || image?.getAttribute('data-src') || '';
    return {
      targetUrl,
      type: classifyTarget(targetUrl),
      hasTitle: hasText(node, ['h3', '[title]', '.bili-video-card__info--tit']),
      hasCover: Boolean(cover),
      hasAuthor: hasText(node, ['.bili-video-card__info--author', '.bili-video-card__info--owner', 'a[href*="/space.bilibili.com/"]']),
      hasDuration: hasText(node, ['.bili-video-card__stats__duration', '.bili-video-card__stats--duration', '[class*="duration"]']),
      hasStats: hasText(node, ['.bili-video-card__stats', '[class*="stats"]']),
    };
  }

  function captureBatch() {
    const cards = [...document.querySelectorAll(CARD_SELECTOR)].map(extractCard);
    return {
      cards,
      urls: cards.map((card) => card.targetUrl).filter(Boolean),
    };
  }

  function getIdentitySignature(batch) {
    return batch.cards
      .map((card) => [
        card.targetUrl || '',
        card.type,
        Number(card.hasTitle),
        Number(card.hasCover),
        Number(card.hasAuthor),
        Number(card.hasDuration),
        Number(card.hasStats),
      ].join('|'))
      .join('\n');
  }

  function summarizeBatch(batch, previousUrls, timing = {}) {
    const uniqueUrls = new Set(batch.urls);
    const previousSet = new Set(previousUrls);
    const typeCounts = {};
    const fieldCoverage = { targetUrl: 0, title: 0, cover: 0, author: 0, duration: 0, stats: 0 };
    for (const card of batch.cards) {
      typeCounts[card.type] = (typeCounts[card.type] || 0) + 1;
      if (card.targetUrl) fieldCoverage.targetUrl += 1;
      if (card.hasTitle) fieldCoverage.title += 1;
      if (card.hasCover) fieldCoverage.cover += 1;
      if (card.hasAuthor) fieldCoverage.author += 1;
      if (card.hasDuration) fieldCoverage.duration += 1;
      if (card.hasStats) fieldCoverage.stats += 1;
    }
    return {
      capturedAt: new Date().toISOString(),
      cardCount: batch.cards.length,
      uniqueTargetCount: uniqueUrls.size,
      duplicateTargetCount: batch.urls.length - uniqueUrls.size,
      missingTargetCount: batch.cards.length - batch.urls.length,
      overlapWithPrevious: [...uniqueUrls].filter((url) => previousSet.has(url)).length,
      typeCounts,
      fieldCoverage,
      lateSameTargetUpdates: 0,
      latestObservedFieldCoverage: fieldCoverage,
      ...timing,
    };
  }

  function findFeedContainer() {
    const cards = [...document.querySelectorAll(CARD_SELECTOR)];
    if (!cards.length) return null;
    let candidate = cards[0].parentElement;
    while (candidate && candidate !== document.body) {
      if (candidate.querySelectorAll(CARD_SELECTOR).length === cards.length) return candidate;
      candidate = candidate.parentElement;
    }
    return cards[0].parentElement;
  }

  async function settleChangedBatch(initialBatch) {
    if (state.sampling) return;
    state.sampling = true;
    const startedAt = performance.now();
    let batch = initialBatch;
    let signature = getIdentitySignature(batch);
    let stableFrames = 0;
    let framesObserved = 0;
    let signatureChanges = 0;
    let timedOut = false;

    while (stableFrames < SETTLE_FRAMES) {
      if (!state.running || performance.now() - startedAt >= SETTLE_TIMEOUT_MS) {
        timedOut = true;
        break;
      }
      await nextFrame();
      framesObserved += 1;
      const nextBatch = captureBatch();
      const nextSignature = getIdentitySignature(nextBatch);
      if (nextSignature === signature) {
        stableFrames += 1;
      } else {
        batch = nextBatch;
        signature = nextSignature;
        stableFrames = 0;
        signatureChanges += 1;
      }
    }

    if (state.running) {
      const previousUrls = state.lastUrls;
      state.report.batches.push(summarizeBatch(batch, previousUrls, {
        settleMs: Math.round(performance.now() - startedAt),
        framesObserved,
        signatureChanges,
        timedOut,
      }));
      state.lastUrls = batch.urls;
      state.lastSignature = getIdentitySignature(batch);
      updateStatus();
    }
    state.sampling = false;
  }

  function checkForBatchChange() {
    if (!state.running || state.sampling) return;
    const batch = captureBatch();
    if (!batch.urls.length) return;
    if (batch.urls.join('\n') === state.lastUrls.join('\n')) {
      const signature = getIdentitySignature(batch);
      if (signature !== state.lastSignature) {
        const currentSummary = state.report.batches.at(-1) || state.report.initialBatch;
        const latestSummary = summarizeBatch(batch, state.lastUrls);
        currentSummary.lateSameTargetUpdates += 1;
        currentSummary.latestObservedFieldCoverage = latestSummary.fieldCoverage;
        state.lastSignature = signature;
        updateStatus();
      }
      return;
    }
    settleChangedBatch(batch);
  }

  function start() {
    if (state.running) return;
    const container = findFeedContainer();
    if (!container) throw new Error('未找到 .feed-card 推荐容器');
    const initialBatch = captureBatch();
    state.running = true;
    state.container = container;
    state.lastUrls = initialBatch.urls;
    state.lastSignature = getIdentitySignature(initialBatch);
    state.report = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      pageUrl: `${location.origin}${location.pathname}`,
      userAgent: navigator.userAgent,
      viewport: { width: innerWidth, height: innerHeight, devicePixelRatio },
      privacy: 'No URLs, BV identifiers, titles, authors, covers, card HTML, cookies, or response bodies are included.',
      selector: CARD_SELECTOR,
      initialBatch: summarizeBatch(initialBatch, []),
      batches: [],
    };
    state.observer = new MutationObserver(checkForBatchChange);
    state.observer.observe(container, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['href', 'src', 'data-src', 'title'],
    });
    updateControls();
    updateStatus();
  }

  function stop() {
    state.running = false;
    state.observer?.disconnect();
    state.observer = null;
    state.container = null;
    updateControls();
    updateStatus();
  }

  function downloadReport() {
    if (!state.report) return;
    const report = { ...state.report, generatedAt: new Date().toISOString() };
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `echo-bili-feed-probe-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  let controls;
  let status;

  function updateControls() {
    if (!controls) return;
    controls.start.disabled = state.running;
    controls.stop.disabled = !state.running;
    controls.download.disabled = !state.report;
  }

  function updateStatus(message, error = false) {
    if (!status) return;
    status.className = `status${error ? ' error' : ''}`;
    status.textContent = message || (state.running
      ? `观察中：已记录 ${state.report.batches.length} 个新批次。请使用原生“换一换”。`
      : state.report
        ? `已停止：共记录 ${state.report.batches.length} 个新批次。`
        : '等待开始。探针不会主动点击“换一换”。');
  }

  function mountPanel() {
    const host = document.createElement('div');
    host.id = 'echo-bili-feed-probe';
    host.style.cssText = 'all:initial;position:fixed;right:16px;bottom:16px;z-index:2147483647';
    const shadow = host.attachShadow({ mode: 'closed' });
    shadow.innerHTML = `
      <style>
        .panel{width:320px;padding:14px;background:#fff;color:#18191c;border:1px solid #e3e5e7;border-radius:8px;box-shadow:0 8px 28px rgba(0,0,0,.18);font:13px/1.5 "Microsoft YaHei",sans-serif}
        h2{margin:0 0 8px;font-size:15px}p{margin:6px 0;color:#61666d}.actions{display:flex;gap:8px;margin-top:10px;flex-wrap:wrap}
        button{height:30px;padding:0 10px;border:1px solid #c9ccd0;border-radius:6px;background:#fff;color:#18191c;cursor:pointer;font:inherit}
        button.primary{background:#00aeec;border-color:#00aeec;color:#fff}button:disabled{opacity:.5;cursor:default}
        .status{margin-top:10px;padding:8px;background:#f1f2f3;border-radius:6px;word-break:break-word}.error{color:#d03050}
      </style>
      <div class="panel">
        <h2>ECHO B站推荐批次调研</h2>
        <p>只观察推荐卡片变化；报告不保存链接、BV号、标题、作者、封面或卡片 HTML。</p>
        <div class="actions">
          <button class="primary" data-action="start">开始观察</button>
          <button data-action="stop" disabled>停止</button>
          <button data-action="download" disabled>下载报告</button>
        </div>
        <div class="status">等待开始。探针不会主动点击“换一换”。</div>
      </div>`;
    status = shadow.querySelector('.status');
    controls = {
      start: shadow.querySelector('[data-action="start"]'),
      stop: shadow.querySelector('[data-action="stop"]'),
      download: shadow.querySelector('[data-action="download"]'),
    };
    controls.start.addEventListener('click', () => {
      try {
        start();
      } catch (error) {
        updateStatus(`启动失败：${error.message}`, true);
      }
    });
    controls.stop.addEventListener('click', stop);
    controls.download.addEventListener('click', downloadReport);
    document.documentElement.appendChild(host);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountPanel, { once: true });
  } else {
    mountPanel();
  }
})();