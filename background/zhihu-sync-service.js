(function(root) {
  'use strict';

  const TASK_STATE_KEY = 'echoZhihuSyncTaskV1';

  function create(chromeApi, ports) {
    const subscribers = new Set();
    let task = null;
    let state = { phase: 'idle' };

    function publish(patch) {
      state = { ...state, ...patch, updatedAt: Date.now() };
      for (const port of subscribers) {
        try { port.postMessage({ type: 'state', state }); } catch {}
      }
    }

    async function persistTask(currentTask, phase) {
      await chromeApi.storage.session.set({
        [TASK_STATE_KEY]: {
          id: currentTask.id,
          mode: currentTask.mode,
          windowId: currentTask.windowId,
          tabId: currentTask.tabId,
          phase,
          updatedAt: Date.now()
        }
      });
    }

    function closeWindow(currentTask) {
      if (!currentTask?.windowId) return;
      const windowId = currentTask.windowId;
      currentTask.windowId = null;
      chromeApi.windows.remove(windowId).catch(() => {});
    }

    async function finish(currentTask, phase, message = '') {
      if (task !== currentTask || currentTask.finished) return;
      currentTask.finished = true;
      try {
        if (phase === 'completed' && currentTask.mode === 'first') {
          await chromeApi.storage.local.set({ zhihuBlocklistFilter: true });
        }
      } catch {
        phase = 'failed';
        message = '名单已读取，但无法保存开启状态，请重新同步';
      }
      publish({ phase, message });
      closeWindow(currentTask);
      try { currentTask.workerPort?.disconnect(); } catch {}
      task = null;
      await chromeApi.storage.session.remove(TASK_STATE_KEY).catch(() => {});
    }

    function connectWorker(tabId) {
      return new Promise((resolve, reject) => {
        const port = chromeApi.tabs.connect(tabId, { name: ports.ZHIHU_WORKER });
        let settled = false;
        const timer = setTimeout(() => settle(new Error('知乎同步窗口未响应')), 10000);
        const settle = (result) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          port.onMessage.removeListener(onMessage);
          port.onDisconnect.removeListener(onDisconnect);
          if (result instanceof Error) {
            try { port.disconnect(); } catch {}
            reject(result);
          } else {
            resolve(port);
          }
        };
        const onMessage = (message) => {
          if (message?.type === 'ready') settle(port);
        };
        const onDisconnect = () => settle(new Error('知乎同步窗口连接已中断'));
        port.onMessage.addListener(onMessage);
        port.onDisconnect.addListener(onDisconnect);
        try { port.postMessage({ type: 'ping' }); } catch (error) { settle(error); }
      });
    }

    async function start(mode) {
      await startupReady;
      if (task) return;
      const currentTask = {
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        mode,
        windowId: null,
        tabId: null,
        workerPort: null,
        finished: false,
        cancelRequested: false
      };
      task = currentTask;
      publish({ phase: 'opening', mode, current: 0, total: null, message: '' });

      try {
        await persistTask(currentTask, 'opening');
        const createdWindow = await chromeApi.windows.create({
          url: 'https://www.zhihu.com/',
          type: 'popup',
          focused: true,
          width: 720,
          height: 720
        });
        if (!createdWindow?.id || !createdWindow.tabs?.[0]?.id) throw new Error('无法打开独立知乎同步窗口');
        currentTask.windowId = createdWindow.id;
        currentTask.tabId = createdWindow.tabs[0].id;
        if (currentTask.cancelRequested || currentTask.finished || task !== currentTask) {
          closeWindow(currentTask);
          throw new DOMException('同步已取消', 'AbortError');
        }
        publish({ phase: 'connecting', message: '正在连接独立知乎窗口...' });
        await persistTask(currentTask, 'connecting');

        const startedAt = Date.now();
        let lastError = null;
        while (!currentTask.cancelRequested && Date.now() - startedAt < 30000) {
          try {
            currentTask.workerPort = await connectWorker(currentTask.tabId);
            break;
          } catch (error) {
            lastError = error;
            await new Promise(resolve => setTimeout(resolve, 300));
          }
        }
        if (currentTask.cancelRequested) throw new DOMException('同步已取消', 'AbortError');
        if (!currentTask.workerPort) throw lastError || new Error('独立知乎同步窗口无法启动');
        await persistTask(currentTask, 'syncing');

        currentTask.workerPort.onMessage.addListener((message) => {
          if (task !== currentTask || currentTask.finished) return;
          if (message.type === 'status') {
            publish({ phase: 'connecting', message: message.message });
          } else if (message.type === 'progress') {
            publish({ phase: 'syncing', current: message.current, total: message.total ?? null });
          } else if (message.type === 'complete') {
            publish({ current: message.total, total: message.total, syncedAt: message.syncedAt });
            void finish(currentTask, 'completed');
          } else if (message.type === 'cancelled') {
            const cancelMessage = currentTask.mode === 'manual'
              ? '同步已取消，本次数据未保存，仍使用上次成功同步的名单'
              : '同步已取消，本次已读取的数据未保存，请重新同步';
            void finish(currentTask, 'cancelled', cancelMessage);
          } else if (message.type === 'error') {
            void finish(currentTask, 'failed', message.message || '同步失败，未保存本次数据');
          }
        });
        currentTask.workerPort.onDisconnect.addListener(() => {
          if (task === currentTask && !currentTask.finished) {
            void finish(currentTask, 'failed', '独立知乎同步窗口已关闭或发生跳转，请重新同步');
          }
        });
        currentTask.workerPort.postMessage({ action: 'start', taskId: currentTask.id });
      } catch (error) {
        const phase = error?.name === 'AbortError' ? 'cancelled' : 'failed';
        const message = phase === 'cancelled'
          ? '同步已取消，未保存本次数据'
          : (error.message || '无法启动知乎同步');
        await finish(currentTask, phase, message);
      }
    }

    function cancel() {
      if (!task) return;
      const currentTask = task;
      currentTask.cancelRequested = true;
      publish({ phase: 'cancelling' });
      try { currentTask.workerPort?.postMessage({ action: 'cancel' }); } catch {}
      if (!currentTask.workerPort) {
        const message = currentTask.mode === 'manual'
          ? '同步已取消，本次数据未保存，仍使用上次成功同步的名单'
          : '同步已取消，本次已读取的数据未保存，请重新同步';
        void finish(currentTask, 'cancelled', message);
      }
    }

    async function recoverStaleTask() {
      const stored = await chromeApi.storage.session.get(TASK_STATE_KEY);
      const stale = stored[TASK_STATE_KEY];
      if (!stale) return;
      if (Number.isInteger(stale.windowId)) {
        await chromeApi.windows.remove(stale.windowId).catch(() => {});
      }
      await chromeApi.storage.session.remove(TASK_STATE_KEY);
      publish({
        phase: 'failed',
        mode: stale.mode,
        message: '同步因扩展后台重启而中断，本次数据未保存，请重新同步'
      });
    }

    const startupReady = recoverStaleTask().catch(error => {
      console.warn('[ECHO] Failed to recover stale Zhihu sync task:', error);
    });

    function handleOptionsPort(optionsPort) {
      if (optionsPort.name !== ports.ZHIHU_OPTIONS) return;
      subscribers.add(optionsPort);
      void startupReady.then(() => optionsPort.postMessage({ type: 'state', state }));
      optionsPort.onMessage.addListener((message) => {
        if (message?.action === 'start') {
          if (task) optionsPort.postMessage({ type: 'state', state });
          else void start(message.mode === 'manual' ? 'manual' : 'first');
        } else if (message?.action === 'cancel') {
          cancel();
        }
      });
      optionsPort.onDisconnect.addListener(() => subscribers.delete(optionsPort));
    }

    function handleWindowRemoved(windowId) {
      if (!task || task.finished || task.windowId !== windowId) return;
      task.windowId = null;
      void finish(task, 'failed', '独立知乎同步窗口已关闭，请重新同步');
    }

    function register() {
      chromeApi.runtime.onConnect.addListener(handleOptionsPort);
      chromeApi.windows.onRemoved.addListener(handleWindowRemoved);
    }

    return Object.freeze({
      cancel,
      getState: () => ({ ...state }),
      handleOptionsPort,
      handleWindowRemoved,
      recoverStaleTask,
      register,
      start,
      startupReady
    });
  }

  root.EchoBackgroundZhihuSyncService = Object.freeze({ TASK_STATE_KEY, create });
})(globalThis);