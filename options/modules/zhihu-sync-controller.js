(function(root) {
  'use strict';

  const CONFIRMATION_CONTENT = {
    zhihuBlocklist: {
      primary: '您即将授权 ECHO 同步知乎官方黑名单。',
      secondary: '确认后将打开独立知乎窗口并立即开始读取，请在完成前保持窗口开启。',
      risks: [
        ['🔐', '读取与保存', 'ECHO 将读取知乎官方黑名单，并在当前设备保存匹配所需的稳定账号标识、同步时间和人数。'],
        ['💻', '仅限本机', '名单只保存在扩展本地存储中，不进入浏览器同步或 ECHO 备份，也不会发送给 ECHO 或第三方服务。']
      ],
      footer: '同步完整成功后才会开启内容过滤；黑名单为 0 人也视为一次有效同步。',
      confirmText: '同意并同步'
    }
  };

  function create(options) {
    const chromeApi = options.chrome;
    const documentApi = options.document;
    const settingsSchema = options.settingsSchema;
    const messages = options.messages;
    const requestFrame = options.requestAnimationFrame || root.requestAnimationFrame.bind(root);
    const schedule = options.setTimeout || root.setTimeout.bind(root);
    let initialized = false;
    let confirmationPending = false;
    let connection = null;
    let handlePortMessage = null;
    let handlePortDisconnect = null;

    function showConfirmationModal(content) {
      if (confirmationPending) return Promise.resolve(false);
      const modal = documentApi.getElementById('item-modal-overlay');
      const confirmBtn = documentApi.getElementById('modal-confirm-btn');
      const cancelBtn = documentApi.getElementById('modal-cancel-btn');
      const primary = documentApi.getElementById('modal-text-primary');
      const secondary = documentApi.getElementById('modal-text-secondary');
      const riskBox = documentApi.getElementById('modal-risk-box');
      const footer = documentApi.getElementById('modal-text-footer');
      if (!modal || !confirmBtn || !cancelBtn || !primary || !secondary || !riskBox || !footer) {
        return Promise.resolve(false);
      }

      confirmationPending = true;
      primary.textContent = content.primary;
      secondary.textContent = content.secondary;
      riskBox.innerHTML = content.risks.map(([icon, title, description]) => `
        <div class="risk-item">
          <span class="risk-icon">${icon}</span>
          <div class="risk-desc"><strong>${title}</strong><p>${description}</p></div>
        </div>
      `).join('');
      footer.textContent = content.footer;
      confirmBtn.textContent = content.confirmText;
      cancelBtn.textContent = '取消 Cancel';
      modal.style.opacity = '';
      modal.style.display = 'flex';
      requestFrame(() => {
        modal.classList.add('show');
        confirmBtn.focus();
      });

      return new Promise((resolve) => {
        let settled = false;
        const finish = (confirmed) => {
          if (settled) return;
          settled = true;
          modal.classList.remove('show');
          schedule(() => {
            if (!modal.classList.contains('show')) modal.style.display = 'none';
          }, 300);
          confirmBtn.removeEventListener('click', onConfirm);
          cancelBtn.removeEventListener('click', onCancel);
          confirmationPending = false;
          resolve(confirmed);
        };
        const onConfirm = () => finish(true);
        const onCancel = () => finish(false);
        confirmBtn.addEventListener('click', onConfirm);
        cancelBtn.addEventListener('click', onCancel);
      });
    }

    function connect() {
      if (connection) return connection;
      const port = chromeApi.runtime.connect({ name: messages.PORTS.ZHIHU_OPTIONS });
      connection = port;
      port.onMessage.addListener((message) => {
        if (connection === port) handlePortMessage?.(message);
      });
      port.onDisconnect.addListener(() => {
        if (connection !== port) return;
        connection = null;
        handlePortDisconnect?.();
      });
      return port;
    }

    function postMessage(message) {
      let port = connection || connect();
      try {
        port.postMessage(message);
      } catch {
        if (connection === port) connection = null;
        port = connect();
        port.postMessage(message);
      }
    }

    async function readValidSnapshot() {
      const { echoZhihuBlocklistV1: snapshotRoot } = await chromeApi.storage.local.get(
        'echoZhihuBlocklistV1'
      );
      const active = snapshotRoot?.accounts?.[snapshotRoot.activeAccountId];
      if (!active || active.accountId !== snapshotRoot.activeAccountId || !Array.isArray(active.records)
          || !Number.isFinite(active.syncedAt) || active.syncedAt <= 0
          || !Number.isInteger(active.total) || active.total !== active.records.length) return null;
      const ids = new Set();
      const tokens = new Set();
      for (const record of active.records) {
        if (!record?.id || !record?.urlToken || ids.has(record.id) || tokens.has(record.urlToken)) return null;
        ids.add(record.id);
        tokens.add(record.urlToken);
      }
      return active;
    }

    async function init() {
      if (initialized) return;
      const checkbox = documentApi.getElementById('zhihuBlocklistFilter');
      const button = documentApi.getElementById('zhihuBlocklistSync');
      const status = documentApi.getElementById('zhihuBlocklistStatus');
      const title = documentApi.getElementById('zhihuBlocklistSyncTitle');
      const syncOption = documentApi.getElementById('zhihuBlocklistSyncOption');
      if (!checkbox || !button || !status || !title || !syncOption) return;
      initialized = true;

      let taskState = { phase: 'idle' };
      let validSnapshot = null;
      let authorized = false;

      const saveZhihuSetting = (enabled) => chromeApi.storage.local.set({
        zhihuBlocklistFilter: Boolean(enabled)
      });

      const refreshLocalState = async () => {
        validSnapshot = await readValidSnapshot();
        const localSettings = await chromeApi.storage.local.get([
          'zhihuBlocklistFilter',
          'zhihuBlocklistAuthorized'
        ]);
        authorized = Boolean(localSettings.zhihuBlocklistAuthorized || validSnapshot);
        let requestedEnabled = localSettings.zhihuBlocklistFilter;
        if (requestedEnabled === undefined) {
          const legacySettings = await chromeApi.storage.sync.get({
            zhihuBlocklistFilter: settingsSchema.getDefault('zhihuBlocklistFilter')
          });
          requestedEnabled = Boolean(legacySettings.zhihuBlocklistFilter);
          await saveZhihuSetting(Boolean(requestedEnabled && validSnapshot));
        }
        if (requestedEnabled && !validSnapshot) {
          requestedEnabled = false;
          await saveZhihuSetting(false);
        }
        checkbox.checked = Boolean(requestedEnabled && validSnapshot);
      };

      const render = () => {
        const running = ['opening', 'connecting', 'syncing', 'cancelling'].includes(taskState.phase);
        syncOption.hidden = !(authorized || validSnapshot || running);
        checkbox.disabled = running;
        title.textContent = validSnapshot ? '手动同步知乎黑名单' : '同步知乎黑名单';

        if (taskState.phase === 'opening') {
          status.textContent = '正在打开独立知乎窗口...';
          status.dataset.state = 'working';
          button.textContent = '取消同步';
          button.disabled = false;
        } else if (taskState.phase === 'connecting') {
          status.textContent = taskState.message || '正在连接独立知乎窗口...';
          status.dataset.state = 'working';
          button.textContent = '取消同步';
          button.disabled = false;
        } else if (taskState.phase === 'syncing') {
          status.textContent = `正在读取 ${taskState.current ?? 0} / ${taskState.total ?? '...'} 人`;
          status.dataset.state = 'working';
          button.textContent = '取消同步';
          button.disabled = false;
        } else if (taskState.phase === 'cancelling') {
          status.textContent = '正在取消，已读取的数据不会保存...';
          status.dataset.state = 'working';
          button.textContent = '正在取消';
          button.disabled = true;
        } else if (taskState.phase === 'failed' || taskState.phase === 'cancelled') {
          status.textContent = taskState.message || '读取未完成，请重新同步';
          status.dataset.state = 'error';
          button.textContent = '重新同步';
          button.disabled = false;
        } else if (validSnapshot) {
          status.textContent = `已同步 ${validSnapshot.total} 人 · ${new Date(validSnapshot.syncedAt).toLocaleString()}`;
          status.dataset.state = 'success';
          button.textContent = '同步知乎黑名单';
          button.disabled = false;
        } else {
          status.textContent = '尚未同步。名单按知乎账号保存在本地，不进入同步或备份';
          status.dataset.state = '';
          button.textContent = '同步知乎黑名单';
          button.disabled = false;
        }
      };

      handlePortMessage = (message) => {
        if (message?.type !== 'state') return;
        taskState = message.state || { phase: 'idle' };
        void refreshLocalState().then(render);
      };
      handlePortDisconnect = () => {
        taskState = { phase: 'idle' };
        void refreshLocalState().then(render);
      };
      connect();

      checkbox.addEventListener('click', async (event) => {
        if (!event.target.checked) {
          await saveZhihuSetting(false);
          return;
        }
        event.preventDefault();
        checkbox.checked = false;
        validSnapshot = await readValidSnapshot();
        if (validSnapshot) {
          await saveZhihuSetting(true);
          checkbox.checked = true;
          syncOption.hidden = false;
          return;
        }
        const confirmed = await showConfirmationModal(CONFIRMATION_CONTENT.zhihuBlocklist);
        if (!confirmed) {
          await saveZhihuSetting(false);
          return;
        }
        authorized = true;
        await chromeApi.storage.local.set({ zhihuBlocklistAuthorized: true });
        render();
        postMessage({ action: 'start', mode: 'first' });
      });

      button.addEventListener('click', () => {
        if (['opening', 'connecting', 'syncing'].includes(taskState.phase)) {
          postMessage({ action: 'cancel' });
        } else {
          postMessage({ action: 'start', mode: validSnapshot ? 'manual' : 'first' });
        }
      });
      chromeApi.storage.onChanged.addListener((changes, areaName) => {
        if (areaName !== 'local') return;
        if (changes.zhihuBlocklistFilter || changes.echoZhihuBlocklistV1
            || changes.zhihuBlocklistAuthorized) void refreshLocalState().then(render);
      });
      await refreshLocalState();
      render();
    }

    return Object.freeze({ init, postMessage, readValidSnapshot });
  }

  root.EchoOptionsZhihuSyncController = Object.freeze({ CONFIRMATION_CONTENT, create });
})(globalThis);