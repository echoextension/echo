(() => {
  'use strict';

  if (window.top !== window || window.__echoZhihuBlocklistProbeLoaded) return;
  window.__echoZhihuBlocklistProbeLoaded = true;

  const ENDPOINT = 'https://www.zhihu.com/api/v3/settings/blocked_users';
  const ME_ENDPOINT = 'https://www.zhihu.com/api/v4/me';
  const PROBE_LIMITS = [20, 50, 100];
  const REQUEST_DELAY_MS = 250;
  const MAX_PAGES = 1000;
  const MAX_RETRIES = 4;
  const state = { running: false, stopped: false, report: null };

  const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

  async function hashPrefix(value) {
    if (!value || !crypto.subtle) return null;
    const bytes = new TextEncoder().encode(String(value));
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)]
      .slice(0, 8)
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
  }

  async function fetchJson(url, retries = MAX_RETRIES) {
    let lastError;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      if (state.stopped) throw new Error('用户已停止调研');
      const startedAt = performance.now();
      try {
        const response = await fetch(url, {
          method: 'GET',
          credentials: 'include',
          cache: 'no-store',
          headers: { Accept: 'application/json, text/plain, */*' },
        });
        const text = await response.text();
        const elapsedMs = Math.round(performance.now() - startedAt);
        let body;
        try {
          body = JSON.parse(text);
        } catch {
          body = null;
        }
        if (response.ok && body) {
          return {
            body,
            status: response.status,
            elapsedMs,
            responseBytes: new TextEncoder().encode(text).length,
            retries: attempt,
          };
        }
        const retryable = response.status === 429 || response.status >= 500;
        const detail = body?.message || body?.error?.message || text.slice(0, 160);
        lastError = new Error(`HTTP ${response.status}: ${detail || 'empty response'}`);
        lastError.status = response.status;
        if (!retryable || attempt === retries) throw lastError;
      } catch (error) {
        lastError = error;
        if (attempt === retries || (error.status && error.status !== 429 && error.status < 500)) {
          throw error;
        }
      }
      await sleep(Math.min(8000, 500 * (2 ** attempt)));
    }
    throw lastError;
  }

  function summarizePage(result, requestedLimit, offset) {
    const data = Array.isArray(result.body?.data) ? result.body.data : null;
    const paging = result.body?.paging;
    if (!data || !paging || typeof paging.is_end !== 'boolean') {
      throw new Error('响应结构不符合预期：缺少 data[] 或 paging.is_end');
    }
    const fields = { id: 0, url_token: 0, name: 0 };
    for (const item of data) {
      if (item?.id) fields.id += 1;
      if (item?.url_token) fields.url_token += 1;
      if (item?.name) fields.name += 1;
    }
    return {
      offset,
      requestedLimit,
      returned: data.length,
      status: result.status,
      elapsedMs: result.elapsedMs,
      responseBytes: result.responseBytes,
      retries: result.retries,
      isEnd: paging.is_end,
      totals: Number.isFinite(paging.totals) ? paging.totals : null,
      hasNextUrl: typeof paging.next === 'string' && paging.next.length > 0,
      fields,
      data,
    };
  }

  async function getViewer() {
    let apiError = null;
    try {
      const result = await fetchJson(`${ME_ENDPOINT}?include=id,url_token`, 1);
      const viewer = result.body;
      const viewerKey = viewer?.id || viewer?.url_token;
      if (viewerKey) {
        return {
          authenticated: true,
          source: 'api/v4/me',
          viewerHash: await hashPrefix(viewerKey),
          status: result.status,
          elapsedMs: result.elapsedMs,
        };
      }
    } catch (error) {
      apiError = error.message;
    }

    try {
      const initialDataNode = document.getElementById('js-initialData');
      const initialData = JSON.parse(initialDataNode?.textContent || '{}');
      const viewerKey = initialData?.initialState?.currentUser
        || initialData?.initialState?.me?.id
        || initialData?.initialState?.me?.urlToken;
      if (viewerKey) {
        return {
          authenticated: true,
          source: 'js-initialData',
          viewerHash: await hashPrefix(viewerKey),
          status: null,
          elapsedMs: null,
        };
      }
    } catch {
      // Fall through to the non-authenticated result.
    }

    return {
      authenticated: false,
      source: null,
      viewerHash: null,
      error: apiError || '页面和接口均未提供账号标识',
    };
  }

  async function runLimitProbe(onProgress) {
    const results = [];
    for (const limit of PROBE_LIMITS) {
      onProgress(`探测 limit=${limit}...`);
      const result = await fetchJson(`${ENDPOINT}?offset=0&limit=${limit}`);
      const page = summarizePage(result, limit, 0);
      results.push({ ...page, data: undefined });
      await sleep(REQUEST_DELAY_MS);
    }
    const accepted = results
      .filter((item) => item.returned > 0)
      .sort((left, right) => right.returned - left.returned)[0];
    return {
      results,
      recommendedLimit: accepted?.returned || 20,
    };
  }

  async function runFullScan(limit, onProgress) {
    const seenIds = new Set();
    const seenTokens = new Set();
    const pageMetrics = [];
    let duplicateIds = 0;
    let duplicateTokens = 0;
    let missingIds = 0;
    let missingTokens = 0;
    let offset = 0;
    let expectedTotals = null;
    let completed = false;

    for (let pageIndex = 0; pageIndex < MAX_PAGES; pageIndex += 1) {
      onProgress(`完整扫描：已读取 ${seenIds.size} 人，第 ${pageIndex + 1} 页...`);
      const result = await fetchJson(`${ENDPOINT}?offset=${offset}&limit=${limit}`);
      const page = summarizePage(result, limit, offset);
      expectedTotals = page.totals ?? expectedTotals;
      pageMetrics.push({ ...page, data: undefined });

      for (const item of page.data) {
        if (item?.id) {
          if (seenIds.has(item.id)) duplicateIds += 1;
          seenIds.add(item.id);
        } else {
          missingIds += 1;
        }
        if (item?.url_token) {
          if (seenTokens.has(item.url_token)) duplicateTokens += 1;
          seenTokens.add(item.url_token);
        } else {
          missingTokens += 1;
        }
      }

      if (page.isEnd) {
        completed = true;
        break;
      }
      if (page.returned === 0) throw new Error('paging.is_end=false 但当前页为空，停止以避免无限请求');
      offset += page.returned;
      await sleep(REQUEST_DELAY_MS);
    }

    const totalElapsedMs = pageMetrics.reduce((sum, page) => sum + page.elapsedMs, 0);
    const totalResponseBytes = pageMetrics.reduce((sum, page) => sum + page.responseBytes, 0);
    return {
      completed,
      requestedLimit: limit,
      pages: pageMetrics.length,
      uniqueIds: seenIds.size,
      uniqueUrlTokens: seenTokens.size,
      duplicateIds,
      duplicateUrlTokens: duplicateTokens,
      missingIds,
      missingUrlTokens: missingTokens,
      expectedTotals,
      totalsMatch: expectedTotals === null ? null : seenIds.size === expectedTotals,
      totalElapsedMs,
      wallClockEstimateMs: totalElapsedMs + Math.max(0, pageMetrics.length - 1) * REQUEST_DELAY_MS,
      totalResponseBytes,
      retryCount: pageMetrics.reduce((sum, page) => sum + page.retries, 0),
      pageMetrics,
    };
  }

  async function run(mode, onProgress) {
    if (state.running) throw new Error('调研正在运行');
    state.running = true;
    state.stopped = false;
    state.report = null;
    const startedAt = new Date().toISOString();
    try {
      onProgress('确认知乎登录账号...');
      const viewer = await getViewer();
      if (!viewer.authenticated) {
        throw new Error(`无法确认知乎登录态：${viewer.error || '接口未返回账号标识'}`);
      }
      const limitProbe = await runLimitProbe(onProgress);
      const report = {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        startedAt,
        pageUrl: `${location.origin}${location.pathname}`,
        userAgent: navigator.userAgent,
        mode,
        privacy: 'No names, raw user IDs, URL tokens, cookies, or response bodies are included.',
        viewer,
        limitProbe,
        fullScan: null,
      };
      if (mode === 'full') {
        report.fullScan = await runFullScan(limitProbe.recommendedLimit, onProgress);
      }
      state.report = report;
      return report;
    } finally {
      state.running = false;
    }
  }

  function downloadReport(report) {
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `echo-zhihu-blocklist-probe-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function mountPanel() {
    const host = document.createElement('div');
    host.id = 'echo-zhihu-blocklist-probe';
    host.style.cssText = 'all:initial;position:fixed;right:16px;bottom:16px;z-index:2147483647';
    const shadow = host.attachShadow({ mode: 'closed' });
    shadow.innerHTML = `
      <style>
        .panel{width:310px;padding:14px;background:#fff;color:#24292f;border:1px solid #d0d7de;border-radius:8px;box-shadow:0 8px 28px rgba(0,0,0,.18);font:13px/1.5 "Microsoft YaHei",sans-serif}
        h2{margin:0 0 8px;font-size:15px}p{margin:6px 0;color:#57606a}.actions{display:flex;gap:8px;margin-top:10px;flex-wrap:wrap}
        button{height:30px;padding:0 10px;border:1px solid #afb8c1;border-radius:6px;background:#f6f8fa;color:#24292f;cursor:pointer;font:inherit}
        button.primary{background:#0969da;border-color:#0969da;color:#fff}button:disabled{opacity:.5;cursor:default}
        .status{margin-top:10px;padding:8px;background:#f6f8fa;border-radius:6px;word-break:break-word}.error{color:#cf222e}.success{color:#1a7f37}
      </style>
      <div class="panel">
        <h2>ECHO 知乎黑名单调研</h2>
        <p>只读调用知乎接口。报告不包含姓名、原始用户 ID、URL Token 或 Cookie。</p>
        <div class="actions">
          <button class="primary" data-action="probe">快速探测</button>
          <button data-action="full">完整扫描</button>
          <button data-action="stop" disabled>停止</button>
          <button data-action="download" disabled>下载报告</button>
        </div>
        <div class="status">等待开始。完整扫描会串行读取全部分页。</div>
      </div>`;
    const status = shadow.querySelector('.status');
    const buttons = [...shadow.querySelectorAll('button')];
    const button = (action) => shadow.querySelector(`[data-action="${action}"]`);
    const setRunning = (running) => {
      button('probe').disabled = running;
      button('full').disabled = running;
      button('stop').disabled = !running;
      button('download').disabled = running || !state.report;
    };
    const setStatus = (message, type = '') => {
      status.textContent = message;
      status.className = `status ${type}`;
    };
    const execute = async (mode) => {
      setRunning(true);
      try {
        const report = await run(mode, (message) => setStatus(message));
        const summary = report.fullScan
          ? `完成：${report.fullScan.uniqueIds} 人，${report.fullScan.pages} 页，接口耗时 ${report.fullScan.totalElapsedMs} ms。`
          : `探测完成：建议分页大小 ${report.limitProbe.recommendedLimit}。`;
        setStatus(summary, 'success');
      } catch (error) {
        setStatus(`失败：${error.message}`, 'error');
      } finally {
        setRunning(false);
      }
    };
    button('probe').addEventListener('click', () => execute('probe'));
    button('full').addEventListener('click', () => execute('full'));
    button('stop').addEventListener('click', () => {
      state.stopped = true;
      setStatus('正在停止，将在当前请求结束后退出...');
    });
    button('download').addEventListener('click', () => state.report && downloadReport(state.report));
    buttons.forEach((item) => item.addEventListener('mousedown', (event) => event.stopPropagation()));
    document.documentElement.appendChild(host);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountPanel, { once: true });
  } else {
    mountPanel();
  }
})();
