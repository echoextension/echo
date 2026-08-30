/**
 * ECHO 知乎黑名单内容过滤
 * 在 www.zhihu.com 与 zhuanlan.zhihu.com 共享手动同步的账号快照。
 */

(async function() {
  'use strict';

  if (window !== window.top || window.__ECHO_ZHIHU_TOOL_ACTIVE__) return;
  window.__ECHO_ZHIHU_TOOL_ACTIVE__ = true;

  const SETTING_KEY = 'zhihuBlocklistFilter';
  const STORE_KEY = 'echoZhihuBlocklistV1';
  const BLOCKLIST_ENDPOINT = 'https://www.zhihu.com/api/v3/settings/blocked_users';
  const ME_ENDPOINT = 'https://www.zhihu.com/api/v4/me?include=id,url_token';
  const PAGE_LIMIT = 20;
  const MAX_PAGES = 1000;
  const MAX_RETRIES = 3;
  const TASK_TIMEOUT_MS = 10 * 60 * 1000;
  const REQUEST_DELAY_MS = 250;

  const localSetting = await chrome.storage.local.get(SETTING_KEY);
  let hasLocalSetting = Object.prototype.hasOwnProperty.call(localSetting, SETTING_KEY);
  let enabled = hasLocalSetting
    ? Boolean(localSetting[SETTING_KEY])
    : Boolean((await chrome.storage.sync.get({ [SETTING_KEY]: false }))[SETTING_KEY]);
  let observer = null;
  let styleElement = null;
  let blockedIds = null;
  let currentSnapshot = null;
  let scheduledRoots = new Set();
  let scanFrame = 0;
  let scanTimer = 0;
  let syncRunning = false;
  let syncCancelled = false;
  let syncOwnerPort = null;
  let filterVersion = 0;
  let syncWindowOverlay = null;

  const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

  function showSyncWindowOverlay() {
    if (syncWindowOverlay) return;
    syncWindowOverlay = document.createElement('div');
    syncWindowOverlay.id = 'echo-zhihu-sync-window-overlay';
    syncWindowOverlay.innerHTML = `
      <div class="echo-zhihu-sync-window-card">
        <div class="echo-zhihu-sync-window-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/></svg>
        </div>
        <h1>ECHO 正在读取知乎官方黑名单</h1>
        <p>请在 ECHO 设置页查看进度。</p>
        <p>完成前请勿关闭此窗口；读取完成后窗口将自动关闭。</p>
      </div>
    `;
    const style = document.createElement('style');
    style.id = 'echo-zhihu-sync-window-style';
    style.textContent = `
      #echo-zhihu-sync-window-overlay{position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;padding:32px;background:rgba(246,248,251,.96);backdrop-filter:blur(12px);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#1f2329}
      .echo-zhihu-sync-window-card{width:min(520px,100%);padding:48px 40px;text-align:center;border:1px solid rgba(0,102,255,.12);border-radius:20px;background:#fff;box-shadow:0 18px 60px rgba(31,35,41,.12)}
      .echo-zhihu-sync-window-icon{width:64px;height:64px;margin:0 auto 22px;display:grid;place-items:center;border-radius:50%;background:rgba(0,102,255,.08);color:#1677ff}
      .echo-zhihu-sync-window-icon svg{width:32px;height:32px;animation:echoZhihuSyncSpin 1.3s linear infinite}
      .echo-zhihu-sync-window-card h1{margin:0 0 18px;font-size:24px;line-height:1.35}
      .echo-zhihu-sync-window-card p{margin:7px 0;color:#646a73;font-size:16px;line-height:1.65}
      @keyframes echoZhihuSyncSpin{to{transform:rotate(360deg)}}
      @media(prefers-color-scheme:dark){#echo-zhihu-sync-window-overlay{background:rgba(24,26,31,.96);color:#f2f3f5}.echo-zhihu-sync-window-card{background:#25272d;border-color:rgba(80,150,255,.2);box-shadow:0 18px 60px rgba(0,0,0,.35)}.echo-zhihu-sync-window-card p{color:#b8bcc5}}
      @media(prefers-reduced-motion:reduce){.echo-zhihu-sync-window-icon svg{animation:none}}
    `;
    document.documentElement.appendChild(style);
    document.documentElement.appendChild(syncWindowOverlay);
  }

  function removeSyncWindowOverlay() {
    syncWindowOverlay?.remove();
    document.getElementById('echo-zhihu-sync-window-style')?.remove();
    syncWindowOverlay = null;
  }

  function getViewerFromInitialData() {
    try {
      const initial = JSON.parse(document.getElementById('js-initialData')?.textContent || '{}');
      const currentUser = initial?.initialState?.currentUser;
      const me = initial?.initialState?.me;
      const candidate = typeof currentUser === 'string'
        ? currentUser
        : currentUser?.id || currentUser?.urlToken || currentUser?.url_token
          || me?.id || me?.urlToken || me?.url_token;
      return candidate ? String(candidate) : '';
    } catch {
      return '';
    }
  }

  async function getViewerId() {
    if (location.hostname === 'www.zhihu.com') {
      try {
        const response = await fetch(ME_ENDPOINT, { credentials: 'include', cache: 'no-store' });
        if (response.ok) {
          const viewer = await response.json();
          if (viewer?.id) return String(viewer.id);
        }
      } catch (e) {}
    }
    return getViewerFromInitialData();
  }

  async function fetchPage(offset) {
    let lastError = null;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
      if (syncCancelled) throw new DOMException('同步已取消', 'AbortError');
      try {
        const response = await fetch(`${BLOCKLIST_ENDPOINT}?offset=${offset}&limit=${PAGE_LIMIT}`, {
          method: 'GET',
          credentials: 'include',
          cache: 'no-store',
          headers: { Accept: 'application/json, text/plain, */*' },
        });
        if (!response.ok) {
          const error = new Error(`知乎接口返回 HTTP ${response.status}`);
          error.retryable = response.status === 429 || response.status >= 500;
          throw error;
        }
        const body = await response.json();
        if (!Array.isArray(body?.data) || typeof body?.paging?.is_end !== 'boolean') {
          throw new Error('知乎黑名单响应结构不符合预期');
        }
        return body;
      } catch (error) {
        lastError = error;
        const retryable = error?.retryable || error instanceof TypeError;
        if (error?.name === 'AbortError' || !retryable || attempt === MAX_RETRIES) throw error;
        await sleep(Math.min(8000, 500 * (2 ** attempt)));
      }
    }
    throw lastError;
  }

  async function syncBlocklist(port) {
    if (syncRunning) {
      port.postMessage({ type: 'error', message: '已有同步任务正在运行' });
      return;
    }
    syncRunning = true;
    syncOwnerPort = port;
    syncCancelled = false;
    let portConnected = true;
    const post = (message) => {
      if (!portConnected) return;
      try { port.postMessage(message); } catch (e) { portConnected = false; }
    };
    port.onDisconnect.addListener(() => {
      if (syncOwnerPort !== port) return;
      portConnected = false;
      syncCancelled = true;
    });
    try {
      const accountId = await getViewerId();
      if (!accountId) throw new Error('未检测到已登录的知乎账号，请先登录知乎后重新同步');

      const records = [];
      const ids = new Set();
      const tokens = new Set();
      let expectedTotal = null;
      let offset = 0;
      let completed = false;
      const startedAt = Date.now();

      for (let page = 0; page < MAX_PAGES; page += 1) {
        if (syncCancelled) throw new DOMException('同步已取消', 'AbortError');
        if (Date.now() - startedAt > TASK_TIMEOUT_MS) throw new Error('同步超过 10 分钟，未替换旧快照');
        const body = await fetchPage(offset);
        expectedTotal = Number.isFinite(body.paging.totals) ? body.paging.totals : expectedTotal;
        for (const item of body.data) {
          if (!item?.id || !item?.url_token) throw new Error('黑名单成员缺少稳定标识');
          const id = String(item.id);
          const token = String(item.url_token);
          if (ids.has(id) || tokens.has(token)) throw new Error('同步期间出现重复成员，未替换旧快照');
          ids.add(id);
          tokens.add(token);
          records.push({ id, urlToken: token });
        }
        post({ type: 'progress', current: records.length, total: expectedTotal });
        if (body.paging.is_end) {
          completed = true;
          break;
        }
        if (!body.data.length) throw new Error('分页未结束但返回空页');
        offset += body.data.length;
        await sleep(REQUEST_DELAY_MS);
      }

      if (!completed) throw new Error('同步超过最大页数，未替换旧快照');
      if (syncCancelled) throw new DOMException('同步已取消', 'AbortError');
      if (expectedTotal !== null && records.length !== expectedTotal) {
        throw new Error(`同步人数 ${records.length} 与官方总数 ${expectedTotal} 不一致`);
      }
      const confirmedAccountId = await getViewerId();
      if (syncCancelled) throw new DOMException('同步已取消', 'AbortError');
      if (confirmedAccountId !== accountId) throw new Error('同步期间知乎账号发生变化');

      const stored = await chrome.storage.local.get(STORE_KEY);
      const root = stored[STORE_KEY] || { schemaVersion: 1, accounts: {} };
      const syncedAt = Date.now();
      root.schemaVersion = 1;
      root.activeAccountId = accountId;
      root.accounts ||= {};
      root.accounts[accountId] = { accountId, syncedAt, total: records.length, records };
      if (syncCancelled) throw new DOMException('同步已取消', 'AbortError');
      await chrome.storage.local.set({ [STORE_KEY]: root });
      post({ type: 'complete', total: records.length, syncedAt });
    } catch (error) {
      if (error?.name === 'AbortError') {
        post({ type: 'cancelled', message: '同步已取消，本次已读取的数据未保存' });
      } else {
        post({ type: 'error', message: error.message || '同步失败，仍保留上次成功名单' });
      }
    } finally {
      removeSyncWindowOverlay();
      syncRunning = false;
      syncCancelled = false;
      syncOwnerPort = null;
    }
  }

  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== 'echo-zhihu-blocklist-worker' || location.hostname !== 'www.zhihu.com') return;
    showSyncWindowOverlay();
    port.onMessage.addListener((message) => {
      if (message?.type === 'ping') {
        port.postMessage({ type: 'ready' });
        return;
      }
      if (message?.action === 'start') syncBlocklist(port);
      if (message?.action === 'cancel') syncCancelled = true;
    });
    port.onDisconnect.addListener(removeSyncWindowOverlay);
    port.postMessage({ type: 'ready' });
  });

  function ensureStyles() {
    if (styleElement) return;
    styleElement = document.createElement('style');
    styleElement.id = 'echo-zhihu-blocklist-style';
    styleElement.textContent = `
      .echo-zhihu-blocked-content{display:block}
      .echo-zhihu-blocked-placeholder{display:flex;width:100%;align-items:center;justify-content:center;min-height:32px;padding:6px 12px;border:0;border-top:1px solid rgba(133,144,166,.18);border-bottom:1px solid rgba(133,144,166,.18);background:rgba(133,144,166,.06);color:#8491a5;font:13px/18px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;cursor:pointer}
      .echo-zhihu-blocked-placeholder:hover{background:rgba(0,102,255,.06);color:#175199}
      .echo-zhihu-blocked-placeholder[data-revealed="true"]{border-color:rgba(0,102,255,.2);color:#175199}
    `;
    document.head.appendChild(styleElement);
  }

  function getPeoplePath(link) {
    try {
      const baseUrl = location.origin === 'null' ? 'https://www.zhihu.com' : location.origin;
      const url = new URL(link.getAttribute('href'), baseUrl);
      const match = url.pathname.match(/^\/people\/([^/?#]+)/);
      return match ? decodeURIComponent(match[1]) : '';
    } catch {
      return '';
    }
  }

  function getCommentAuthorId(contentNode) {
    const authorRegion = contentNode.parentElement?.firstElementChild?.firstElementChild;
    if (!authorRegion) return '';
    const ids = [...authorRegion.querySelectorAll('a[href*="/people/"]')]
      .map(getPeoplePath)
      .filter(Boolean);
    const uniqueIds = [...new Set(ids)];
    return uniqueIds.length === 1 ? uniqueIds[0] : '';
  }

  function hideContainer(container) {
    if (!container || container.dataset.echoZhihuProcessed) return;
    container.dataset.echoZhihuProcessed = 'blocked';
    container.dataset.echoZhihuDisplay = container.style.display || '';
    const placeholder = document.createElement('button');
    placeholder.type = 'button';
    placeholder.className = 'echo-zhihu-blocked-placeholder';
    placeholder.textContent = '已隐藏黑名单用户内容 · 临时查看';
    placeholder.addEventListener('click', () => {
      const revealed = placeholder.dataset.revealed !== 'true';
      placeholder.dataset.revealed = String(revealed);
      if (revealed) {
        container.style.display = container.dataset.echoZhihuDisplay || '';
        placeholder.textContent = '已隐藏黑名单用户内容 · 临时查看';
        placeholder.remove();
        return;
      }
      container.style.display = 'none';
      placeholder.textContent = '正在临时查看 · 重新隐藏';
    });
    container.style.display = 'none';
    container.before(placeholder);
  }

  function scanComments(root) {
    const nodes = root.matches?.('.CommentContent')
      ? [root]
      : [...root.querySelectorAll?.('.CommentContent') || []];
    for (const content of nodes) {
      if (content.dataset.echoZhihuChecked) continue;
      const authorId = getCommentAuthorId(content);
      if (!authorId) continue;
      content.dataset.echoZhihuChecked = 'true';
      if (!blockedIds.has(authorId)) continue;
      const container = content.closest('[data-id]') || content.parentElement?.parentElement;
      hideContainer(container);
    }
  }

  function scanCards(root) {
    if (location.hostname !== 'www.zhihu.com') return;
    const nodes = root.matches?.('[data-za-extra-module]')
      ? [root]
      : [...root.querySelectorAll?.('[data-za-extra-module]') || []];
    for (const node of nodes) {
      if (node.dataset.echoZhihuChecked) continue;
      node.dataset.echoZhihuChecked = 'true';
      try {
        const extra = JSON.parse(node.getAttribute('data-za-extra-module') || '{}');
        const authorId = String(extra?.card?.content?.author_member_hash_id || '');
        if (!authorId || !blockedIds.has(authorId)) continue;
        hideContainer(node.closest('.List-item,.TopstoryItem,.SearchResult-Card') || node);
      } catch (e) {}
    }
  }

  function scanRoot(root) {
    if (!root?.isConnected) return;
    scanComments(root);
    scanCards(root);
  }

  function scheduleRoot(root) {
    if (!(root instanceof Element)) return;
    scheduledRoots.add(root.closest('[data-id]') || root);
    if (scanFrame || scanTimer) return;
    const flush = () => {
      if (!scanFrame && !scanTimer) return;
      if (scanFrame) cancelAnimationFrame(scanFrame);
      if (scanTimer) clearTimeout(scanTimer);
      scanFrame = 0;
      scanTimer = 0;
      const roots = [...scheduledRoots];
      scheduledRoots.clear();
      roots.forEach(scanRoot);
    };
    scanFrame = requestAnimationFrame(flush);
    scanTimer = setTimeout(flush, 100);
  }

  async function loadSnapshot() {
    const stored = await chrome.storage.local.get(STORE_KEY);
    const root = stored[STORE_KEY];
    const accountId = await getViewerId();
    if (!accountId) return false;
    const snapshot = root?.accounts?.[accountId];
    if (!snapshot || snapshot.accountId !== accountId || !Array.isArray(snapshot.records)
      || !Number.isInteger(snapshot.total) || snapshot.total !== snapshot.records.length
      || !Number.isFinite(snapshot.syncedAt) || snapshot.syncedAt <= 0) return false;
    const validRecords = snapshot.records.every((item) => item?.id && item?.urlToken);
    if (!validRecords) return false;
    currentSnapshot = snapshot;
    blockedIds = new Set(snapshot.records.map((item) => String(item.id)));
    return true;
  }

  async function startFilter() {
    if (!enabled || observer) return;
    const version = ++filterVersion;
    if (!(await loadSnapshot())) return;
    if (!enabled || version !== filterVersion) return;
    ensureStyles();
    scanRoot(document.body);
    observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        mutation.addedNodes.forEach(scheduleRoot);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function stopFilter() {
    filterVersion += 1;
    observer?.disconnect();
    observer = null;
    if (scanFrame) cancelAnimationFrame(scanFrame);
    if (scanTimer) clearTimeout(scanTimer);
    scanFrame = 0;
    scanTimer = 0;
    scheduledRoots.clear();
    blockedIds = null;
    currentSnapshot = null;
    document.querySelectorAll('.echo-zhihu-blocked-placeholder').forEach((item) => item.remove());
    document.querySelectorAll('[data-echo-zhihu-processed]').forEach((item) => {
      item.style.display = item.dataset.echoZhihuDisplay || '';
      delete item.dataset.echoZhihuDisplay;
      item.classList.remove('echo-zhihu-blocked-content');
      delete item.dataset.echoZhihuProcessed;
    });
    document.querySelectorAll('[data-echo-zhihu-checked]').forEach((item) => delete item.dataset.echoZhihuChecked);
    styleElement?.remove();
    styleElement = null;
  }

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && changes[SETTING_KEY]) {
      hasLocalSetting = true;
      enabled = Boolean(changes[SETTING_KEY].newValue);
      if (enabled) startFilter();
      else stopFilter();
    }
    if (areaName === 'sync' && changes[SETTING_KEY] && !hasLocalSetting) {
      enabled = Boolean(changes[SETTING_KEY].newValue);
      if (enabled) startFilter();
      else stopFilter();
    }
    if (areaName === 'local' && changes[STORE_KEY] && enabled) {
      stopFilter();
      startFilter();
    }
  });

  startFilter();
})();