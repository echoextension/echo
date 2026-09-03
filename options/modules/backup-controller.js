(function(root) {
  'use strict';

  const BACKUP_SCHEMA_VERSION = 1;
  const WALLPAPER_BACKUP_VALIDATORS = {
    mode: value => ['daily', 'collection', 'off'].includes(value),
    quality: value => ['4k', '1080p'].includes(value),
    pinnedDate: value => value === null || typeof value === 'string',
    collectionPlayMode: value => ['random', 'fixed'].includes(value),
    lastActiveMode: value => ['daily', 'collection'].includes(value),
    autoHideInfo: value => typeof value === 'boolean',
    minimalMode: value => typeof value === 'boolean',
    blankMode: value => typeof value === 'boolean',
    infoPositionY: value => value === null || Number.isFinite(value),
    lastShownWallpaperId: value => value === null || typeof value === 'string'
  };

  function fingerprintFavorites(favorites) {
    const normalized = [...new Set(favorites.filter(item => typeof item === 'string'))];
    const serialized = JSON.stringify(normalized);
    let hash = 2166136261;
    for (let index = 0; index < serialized.length; index += 1) {
      hash ^= serialized.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return `${serialized.length}:${(hash >>> 0).toString(16).padStart(8, '0')}`;
  }

  function create(options) {
    const chromeApi = options.chrome;
    const documentApi = options.document;
    const settingsSchema = options.settingsSchema;
    const urlApi = options.URL || root.URL;
    const BlobConstructor = options.Blob || root.Blob;
    const requestFrame = options.requestAnimationFrame || root.requestAnimationFrame.bind(root);
    const schedule = options.setTimeout || root.setTimeout.bind(root);
    let initialized = false;
    let backupToast = null;
    let backupToastTimeout = null;

    function sameValue(left, right) {
      return JSON.stringify(left) === JSON.stringify(right);
    }

    function sanitizeBackupFavorites(value) {
      if (value === undefined) return [];
      if (!Array.isArray(value)) throw new Error('favorites 必须是数组');
      const favorites = [];
      for (const item of value) {
        if (typeof item !== 'string') throw new Error('favorites 只能包含字符串');
        if (!item.startsWith('custom:')) favorites.push(item);
      }
      return [...new Set(favorites)];
    }

    function sanitizeWallpaperBackup(value) {
      if (value === undefined) return {};
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('wallpaperSettings 必须是对象');
      }
      const result = {};
      for (const [key, validator] of Object.entries(WALLPAPER_BACKUP_VALIDATORS)) {
        if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
        if (!validator(value[key])) throw new Error(`wallpaperSettings.${key} 类型或取值无效`);
        result[key] = value[key];
      }
      if (typeof result.pinnedDate === 'string' && result.pinnedDate.startsWith('custom:')) {
        result.pinnedDate = null;
      }
      return result;
    }

    function sanitizeExtensionBackup(value) {
      if (value === undefined) return {};
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('extensionSettings 必须是对象');
      }
      const result = {};
      for (const [key, item] of Object.entries(value)) {
        if (key === 'echo_ntp_wallpaper_favorites' || key === 'zhihuBlocklistFilter') continue;
        const definition = settingsSchema.getDefinition(key);
        if (!definition || definition.area !== 'sync' || definition.deprecated) continue;
        if (!settingsSchema.isValid(key, item)) {
          throw new Error(`extensionSettings.${key} 类型或取值无效`);
        }
        result[key] = item && typeof item === 'object' ? structuredClone(item) : item;
      }
      return result;
    }

    function parseBackupPayload(value) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('不是 ECHO 备份对象');
      }
      if (!value.version || !value.exportDate) {
        throw new Error('不是 ECHO 备份文件');
      }
      if (value.schemaVersion !== undefined
          && (!Number.isInteger(value.schemaVersion) || value.schemaVersion < 1
            || value.schemaVersion > BACKUP_SCHEMA_VERSION)) {
        throw new Error(`不支持的备份 schema：${value.schemaVersion}`);
      }
      return {
        favorites: sanitizeBackupFavorites(value.favorites),
        wallpaperSettings: sanitizeWallpaperBackup(value.wallpaperSettings),
        extensionSettings: sanitizeExtensionBackup(value.extensionSettings)
      };
    }

    function showBackupResult(type, message) {
      if (!backupToast) {
        backupToast = documentApi.createElement('div');
        backupToast.className = 'backup-toast';
        documentApi.body.appendChild(backupToast);
      }

      const icons = {
        success: `<svg width="20" height="20" viewBox="0 0 16 16" fill="none" style="flex-shrink:0">
          <circle cx="8" cy="8" r="7" stroke="#34d399" stroke-width="1.5" fill="rgba(52,211,153,0.12)"/>
          <path d="M5 8.2l2 2 4-4.4" stroke="#34d399" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
        </svg>`,
        error: `<svg width="20" height="20" viewBox="0 0 16 16" fill="none" style="flex-shrink:0">
          <circle cx="8" cy="8" r="7" stroke="#f87171" stroke-width="1.5" fill="rgba(248,113,113,0.12)"/>
          <path d="M5.5 5.5l5 5M10.5 5.5l-5 5" stroke="#f87171" stroke-width="1.5" stroke-linecap="round"/>
        </svg>`
      };

      backupToast.innerHTML = icons[type] || icons.success;
      const messageElement = documentApi.createElement('span');
      messageElement.textContent = message;
      backupToast.appendChild(messageElement);
      requestFrame(() => backupToast.classList.add('visible'));
      if (backupToastTimeout) root.clearTimeout(backupToastTimeout);
      backupToastTimeout = schedule(() => {
        backupToast?.classList.remove('visible');
      }, 4000);
    }

    async function handleExportBackup() {
      try {
        const syncData = await chromeApi.storage.sync.get(null);
        const localData = await chromeApi.storage.local.get(['echo_ntp_wallpaper_v2']);
        const favorites = (syncData.echo_ntp_wallpaper_favorites || [])
          .filter(date => !date.startsWith('custom:'));
        const extensionSettings = settingsSchema.sanitize('sync', syncData, {
          includeDeprecated: false
        }).sanitized;
        const backup = {
          backupType: 'echo-extension-backup',
          schemaVersion: BACKUP_SCHEMA_VERSION,
          version: chromeApi.runtime.getManifest().version,
          exportDate: new Date().toISOString().split('T')[0],
          exportTimestamp: Date.now(),
          favorites,
          wallpaperSettings: localData.echo_ntp_wallpaper_v2 || {},
          extensionSettings
        };
        const blob = new BlobConstructor([JSON.stringify(backup, null, 2)], { type: 'application/json' });
        const url = urlApi.createObjectURL(blob);
        const dateString = new Date().toISOString().split('T')[0];
        const anchor = documentApi.createElement('a');
        anchor.href = url;
        anchor.download = `ECHO_备份_${dateString}.json`;
        documentApi.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        urlApi.revokeObjectURL(url);
        showBackupResult('success', `已导出备份（含 ${favorites.length} 张壁纸收藏）`);
      } catch (error) {
        console.error('[ECHO] 导出备份失败:', error);
        showBackupResult('error', `导出失败：${error.message}`);
      }
    }

    async function handleImportBackup(event) {
      const file = event.target.files?.[0];
      if (!file) return;
      event.target.value = '';

      try {
        const text = await file.text();
        let backup;
        try {
          backup = JSON.parse(text);
        } catch {
          showBackupResult('error', '文件格式错误：不是有效的 JSON 文件');
          return;
        }
        const payload = parseBackupPayload(backup);
        const currentSync = await chromeApi.storage.sync.get(null);
        const currentLocal = await chromeApi.storage.local.get(['echo_ntp_wallpaper_v2']);
        const currentFavorites = Array.isArray(currentSync.echo_ntp_wallpaper_favorites)
          ? currentSync.echo_ntp_wallpaper_favorites
          : [];
        const mergedFavorites = [...new Set([...currentFavorites, ...payload.favorites])];
        const syncUpdates = { ...payload.extensionSettings };
        if (payload.favorites.length > 0) {
          syncUpdates.echo_ntp_wallpaper_favorites = mergedFavorites;
          syncUpdates.echo_ntp_wallpaper_favorites_meta = {
            schemaVersion: 1,
            updatedAt: Date.now(),
            fingerprint: fingerprintFavorites(mergedFavorites)
          };
        }
        const hasWallpaperSettings = Object.keys(payload.wallpaperSettings).length > 0;
        const touchedSyncKeys = Object.keys(syncUpdates);
        let syncWriteCompleted = false;

        try {
          if (touchedSyncKeys.length) {
            await chromeApi.storage.sync.set(syncUpdates);
            syncWriteCompleted = true;
          }
          if (hasWallpaperSettings) {
            await chromeApi.storage.local.set({ echo_ntp_wallpaper_v2: payload.wallpaperSettings });
          }
        } catch (writeError) {
          const syncRollback = {};
          const syncRemove = [];
          try {
            if (syncWriteCompleted) {
              const latestSync = await chromeApi.storage.sync.get(touchedSyncKeys);
              for (const key of touchedSyncKeys) {
                if (!sameValue(latestSync[key], syncUpdates[key])) continue;
                if (Object.prototype.hasOwnProperty.call(currentSync, key)) {
                  syncRollback[key] = currentSync[key];
                } else {
                  syncRemove.push(key);
                }
              }
              if (Object.keys(syncRollback).length) await chromeApi.storage.sync.set(syncRollback);
              if (syncRemove.length) await chromeApi.storage.sync.remove(syncRemove);
            }
            if (hasWallpaperSettings) {
              const latestLocal = await chromeApi.storage.local.get('echo_ntp_wallpaper_v2');
              if (sameValue(latestLocal.echo_ntp_wallpaper_v2, payload.wallpaperSettings)) {
                if (Object.prototype.hasOwnProperty.call(currentLocal, 'echo_ntp_wallpaper_v2')) {
                  await chromeApi.storage.local.set({
                    echo_ntp_wallpaper_v2: currentLocal.echo_ntp_wallpaper_v2
                  });
                } else {
                  await chromeApi.storage.local.remove('echo_ntp_wallpaper_v2');
                }
              }
            }
          } catch (rollbackError) {
            throw new Error(
              `导入失败且回滚未完整完成：${writeError.message}；${rollbackError.message}`
            );
          }
          throw writeError;
        }

        const restoredFavoriteCount = mergedFavorites.length - currentFavorites.length;
        const settingsRestored = hasWallpaperSettings
          || Object.keys(payload.extensionSettings).length > 0;
        if (Object.keys(payload.extensionSettings).length > 0) {
          await options.onSettingsRestored?.();
        }
        const parts = [];
        if (restoredFavoriteCount > 0) {
          parts.push(`新增 ${restoredFavoriteCount} 张壁纸收藏`);
        } else if (payload.favorites.length > 0) {
          parts.push(`壁纸收藏已是最新（${payload.favorites.length} 张已存在）`);
        }
        if (settingsRestored) parts.push('设置已恢复');
        const message = parts.length > 0 ? parts.join('，') : '备份文件中没有需要恢复的数据';
        showBackupResult('success', `${message}。新标签页将在下次打开时生效`);
      } catch (error) {
        console.error('[ECHO] 导入备份失败:', error);
        showBackupResult('error', `导入失败：${error.message}`);
      }
    }

    function init() {
      if (initialized) return;
      initialized = true;
      const exportButton = documentApi.getElementById('exportBackup');
      const importButton = documentApi.getElementById('importBackup');
      const fileInput = documentApi.getElementById('importFileInput');
      exportButton?.addEventListener('click', handleExportBackup);
      importButton?.addEventListener('click', () => fileInput?.click());
      fileInput?.addEventListener('change', handleImportBackup);
    }

    return Object.freeze({
      handleExportBackup,
      handleImportBackup,
      init,
      parseBackupPayload,
      showBackupResult
    });
  }

  root.EchoOptionsBackupController = Object.freeze({
    BACKUP_SCHEMA_VERSION,
    WALLPAPER_BACKUP_VALIDATORS,
    create
  });
})(globalThis);