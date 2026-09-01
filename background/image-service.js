(function(root) {
  'use strict';

  const RULE_MIN_ID = 90000;
  const RULE_MAX_ID = 99999;

  function escapeRegex(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function blobToDataUrl(blob, FileReaderConstructor) {
    return new Promise((resolve, reject) => {
      const reader = new FileReaderConstructor();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('读取图片数据失败'));
      reader.readAsDataURL(blob);
    });
  }

  function create(chromeApi, options = {}) {
    const fetchImpl = options.fetch || root.fetch;
    const FileReaderConstructor = options.FileReader || root.FileReader;
    const settingsSchema = options.settingsSchema || root.EchoSettings;
    let nextRuleId = RULE_MIN_ID;
    let allocationQueue = Promise.resolve();

    async function cleanupStaleRules() {
      const rules = await chromeApi.declarativeNetRequest.getDynamicRules();
      const staleRuleIds = rules
        .map(rule => rule.id)
        .filter(id => id >= RULE_MIN_ID && id <= RULE_MAX_ID);
      if (staleRuleIds.length) {
        await chromeApi.declarativeNetRequest.updateDynamicRules({ removeRuleIds: staleRuleIds });
      }
    }

    const startupCleanup = cleanupStaleRules().catch(error => {
      console.warn('[ECHO] Failed to clean stale image Referer rules:', error);
    });

    function addRefererRule(imageUrl, pageUrl) {
      const allocation = allocationQueue.then(async () => {
        await startupCleanup;
        const parsedImageUrl = new URL(imageUrl);
        const parsedPageUrl = new URL(pageUrl);
        if (!['http:', 'https:'].includes(parsedImageUrl.protocol)
            || !['http:', 'https:'].includes(parsedPageUrl.protocol)) {
          throw new Error('仅支持 HTTP(S) 图片和来源页面');
        }
        parsedImageUrl.hash = '';

        const existingRules = await chromeApi.declarativeNetRequest.getDynamicRules();
        const usedRuleIds = new Set(existingRules.map(rule => rule.id));
        let ruleId = null;
        const availableCount = RULE_MAX_ID - RULE_MIN_ID + 1;
        for (let attempt = 0; attempt < availableCount; attempt += 1) {
          const candidate = nextRuleId;
          nextRuleId = candidate >= RULE_MAX_ID ? RULE_MIN_ID : candidate + 1;
          if (!usedRuleIds.has(candidate)) {
            ruleId = candidate;
            break;
          }
        }
        if (ruleId === null) throw new Error('临时图片请求规则已用尽');

        await chromeApi.declarativeNetRequest.updateDynamicRules({
          addRules: [{
            id: ruleId,
            priority: 2,
            action: {
              type: 'modifyHeaders',
              requestHeaders: [
                { header: 'Referer', operation: 'set', value: `${parsedPageUrl.origin}/` }
              ]
            },
            condition: {
              regexFilter: `^${escapeRegex(parsedImageUrl.href)}$`,
              resourceTypes: ['xmlhttprequest']
            }
          }]
        });
        return ruleId;
      });
      allocationQueue = allocation.then(() => undefined, () => undefined);
      return allocation;
    }

    async function fetchImageAsDataUrl(imageUrl, pageUrl) {
      let ruleId = null;
      try {
        ruleId = await addRefererRule(imageUrl, pageUrl);
        const response = await fetchImpl(imageUrl);
        if (!response.ok) return { error: `服务器拒绝 (${response.status})` };
        const contentType = (response.headers.get('Content-Type') || '').toLowerCase();
        if (!contentType.startsWith('image/')) return { error: '该元素不是可保存的图片' };
        const dataUrl = await blobToDataUrl(await response.blob(), FileReaderConstructor);
        return { dataUrl };
      } catch (error) {
        return { error: error.message || '获取图片失败' };
      } finally {
        if (ruleId !== null) {
          try {
            await chromeApi.declarativeNetRequest.updateDynamicRules({ removeRuleIds: [ruleId] });
          } catch (error) {
            console.warn('[ECHO] Failed to remove image Referer rule:', ruleId, error);
          }
        }
      }
    }

    async function quickSaveImage(dataUrl, originalUrl) {
      try {
        const settings = await chromeApi.storage.sync.get(settingsSchema.getDefaults([
          'quickSaveImage',
          'quickSaveImageDateFolder'
        ]));
        if (!settings.quickSaveImage) return { success: false, error: '功能已关闭' };

        let detectedExt = '';
        const mimeMatch = dataUrl.match(/^data:image\/([\w+.-]+)/i);
        if (mimeMatch) {
          detectedExt = mimeMatch[1].toLowerCase();
          if (detectedExt === 'jpeg') detectedExt = 'jpg';
          if (detectedExt === 'svg+xml') detectedExt = 'svg';
        }

        let filename = '';
        if (originalUrl && !originalUrl.startsWith('data:')) {
          try {
            const url = new URL(originalUrl);
            filename = decodeURIComponent(url.pathname.substring(url.pathname.lastIndexOf('/') + 1));
          } catch {
            filename = '';
          }
          if (!filename || !filename.includes('.')) {
            const extMatch = originalUrl.match(/\.(?:png|jpe?g|gif|webp|avif|svg|bmp|ico|tiff?)(?=[?#]|$)/i);
            const extension = extMatch ? extMatch[0].slice(1).toLowerCase() : (detectedExt || 'jpg');
            filename = `image_${Date.now()}.${extension}`;
          } else if (detectedExt) {
            const currentExt = filename.slice(filename.lastIndexOf('.') + 1).toLowerCase();
            const normalize = {
              jpg: 'jpeg', jpeg: 'jpeg', png: 'png', gif: 'gif', webp: 'webp',
              avif: 'avif', svg: 'svg', bmp: 'bmp'
            };
            if (normalize[currentExt] && normalize[detectedExt]
                && normalize[currentExt] !== normalize[detectedExt]) {
              filename = `${filename.slice(0, filename.lastIndexOf('.') + 1)}${detectedExt}`;
            }
          }
        }
        if (!filename) filename = `image_${Date.now()}.${detectedExt || 'jpg'}`;
        filename = filename.replace(/[<>:"/\\|?*]/g, '_');

        let savePath = 'ECHO快速保存图片/';
        if (settings.quickSaveImageDateFolder) {
          const now = new Date();
          const date = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
          savePath += `${date}/`;
        }
        const downloadId = await chromeApi.downloads.download({
          url: dataUrl,
          filename: savePath + filename,
          saveAs: false,
          conflictAction: 'uniquify'
        });
        return { success: true, downloadId };
      } catch (error) {
        console.error('[ECHO] Quick save image error:', error);
        return { success: false, error: error.message };
      }
    }

    return Object.freeze({ addRefererRule, cleanupStaleRules, fetchImageAsDataUrl, quickSaveImage });
  }

  root.EchoBackgroundImageService = Object.freeze({ RULE_MAX_ID, RULE_MIN_ID, create });
})(globalThis);