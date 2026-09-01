(function(root) {
  'use strict';

  const MAX_COUNT = 10;
  const MAX_SIZE = 20 * 1024 * 1024;
  const ACCEPTED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

  function create(options) {
    const state = options.state;
    const domain = options.domain;
    const cache = options.cache;
    const imageProcessor = options.imageProcessor;
    const now = options.now || Date.now;
    let uploadQueue = Promise.resolve();
    let lastTimestamp = 0;
    const deletedDates = new Set();

    function count() {
      const favorites = state.availableFavorites || state.favorites;
      return favorites.filter(dateKey => state.history.some(
        wallpaper => wallpaper.date === dateKey && domain.isCustomWallpaper(wallpaper)
      )).length;
    }

    async function countLocalWallpapers() {
      let total = 0;
      for (const dateKey of state.favorites.filter(domain.isCustomDate)) {
        const known = state.history.some(
          wallpaper => wallpaper.date === dateKey && domain.isCustomWallpaper(wallpaper)
        );
        if (known || await cache.get(dateKey)) total += 1;
      }
      return total;
    }

    function recompress(dateKey, image) {
      void imageProcessor.renderDisplayBlob(image)
        .then(blob => {
          if (deletedDates.has(dateKey)) return false;
          return cache.put(dateKey, blob);
        })
        .catch(error => console.warn('[ECHO NTP] 自定义壁纸懒压缩失败:', error));
    }

    async function performUpload(file) {
      if (!ACCEPTED_TYPES.has(file.type)) {
        options.showToast('仅支持 JPG、PNG、WebP 格式');
        return null;
      }
      if (file.size > MAX_SIZE) {
        options.showToast('图片大小不能超过 20MB');
        return null;
      }
      if (await countLocalWallpapers() >= MAX_COUNT) {
        options.showToast(`已达上限（${MAX_COUNT}/${MAX_COUNT}），请先删除一些自定义壁纸`);
        return null;
      }

      let dateKey = null;
      let thumbnailKey = null;
      const previousHistory = [...state.history];
      const previousFavorites = [...state.favorites];
      const previousAvailableFavorites = [...(state.availableFavorites || state.favorites)];
      const previousPinnedDate = state.settings.pinnedDate;
      const previousPreview = state.isPreview;
      let metadataChanged = false;
      try {
        let timestamp = Math.max(now(), lastTimestamp + 1);
        while (state.history.some(wallpaper => wallpaper.date === `custom:${timestamp}`)) timestamp += 1;
        lastTimestamp = timestamp;
        dateKey = `custom:${timestamp}`;
        thumbnailKey = `custom_thumb:${timestamp}`;
        deletedDates.delete(dateKey);
        const [displayBlob, thumbnailBlob] = await Promise.all([
          imageProcessor.createDisplayImage(file),
          imageProcessor.createThumbnail(file)
        ]);
        const saved = await Promise.all([
          cache.put(dateKey, displayBlob),
          cache.put(thumbnailKey, thumbnailBlob)
        ]);
        if (saved.includes(false)) {
          await cache.remove(dateKey, thumbnailKey);
          throw new Error('自定义壁纸缓存写入失败');
        }

        const wallpaper = { id: `custom_${timestamp}`, date: dateKey, type: 'custom', desc: '' };
        state.history.unshift(wallpaper);
        state.favorites.push(dateKey);
        state.availableFavorites = [...previousAvailableFavorites, dateKey];
        metadataChanged = true;
        await options.saveFavorites();
        state.settings.pinnedDate = dateKey;
        state.isPreview = false;
        await options.saveSettings();
        await options.display(wallpaper);
        options.refreshStatus();
        return wallpaper;
      } catch (error) {
        state.history = previousHistory;
        state.favorites = previousFavorites;
        state.availableFavorites = previousAvailableFavorites;
        state.settings.pinnedDate = previousPinnedDate;
        state.isPreview = previousPreview;
        if (dateKey && thumbnailKey) await cache.remove(dateKey, thumbnailKey);
        if (metadataChanged) {
          try {
            await options.saveFavorites();
          } catch (rollbackError) {
            console.error('[ECHO NTP] 自定义壁纸收藏回滚失败:', rollbackError);
          }
        }
        console.error('[ECHO NTP] 自定义壁纸上传失败:', error);
        options.showToast('上传失败，请重试');
        return null;
      }
    }

    function upload(file) {
      const task = uploadQueue.then(() => performUpload(file));
      uploadQueue = task.catch(() => null);
      return task;
    }

    async function restoreRemoval(previous, restoreSettings) {
      state.history = previous.history;
      state.favorites = previous.favorites;
      state.availableFavorites = previous.availableFavorites;
      state.settings.pinnedDate = previous.pinnedDate;
      try {
        await options.saveFavorites();
        if (restoreSettings) await options.saveSettings();
      } catch (error) {
        console.error('[ECHO NTP] 自定义壁纸删除回滚失败:', error);
      }
    }

    async function remove(dateKey) {
      if (!domain.isCustomDate(dateKey)) return;
      const timestamp = dateKey.replace('custom:', '');
      const previous = {
        history: [...state.history],
        favorites: [...state.favorites],
        availableFavorites: [...(state.availableFavorites || state.favorites)],
        pinnedDate: state.settings.pinnedDate
      };
      const clearsPin = state.settings.pinnedDate === dateKey;
      const availableFavorites = state.availableFavorites || state.favorites;
      state.history = state.history.filter(wallpaper => wallpaper.date !== dateKey);
      state.favorites = state.favorites.filter(date => date !== dateKey);
      state.availableFavorites = availableFavorites.filter(date => date !== dateKey);
      if (clearsPin) state.settings.pinnedDate = null;

      try {
        await options.saveFavorites();
        if (clearsPin) await options.saveSettings();
      } catch (error) {
        await restoreRemoval(previous, clearsPin);
        console.error('[ECHO NTP] 自定义壁纸删除失败:', error);
        options.showToast('删除失败，请重试');
        return false;
      }

      deletedDates.add(dateKey);
      let removed = false;
      try {
        removed = await cache.remove(dateKey, `custom_thumb:${timestamp}`);
      } catch (error) {
        console.error('[ECHO NTP] 自定义壁纸 Blob 删除失败:', error);
      }
      if (removed === false) {
        deletedDates.delete(dateKey);
        await restoreRemoval(previous, clearsPin);
        options.showToast('删除失败，请重试');
        return false;
      }
      options.refreshStatus();
      return true;
    }

    async function restoreMetadata() {
      const available = state.favorites.filter(dateKey => !domain.isCustomDate(dateKey));
      for (const dateKey of state.favorites.filter(domain.isCustomDate)) {
        const exists = state.history.some(wallpaper => wallpaper.date === dateKey);
        const blob = exists ? true : await cache.get(dateKey);
        if (!blob) continue;
        available.push(dateKey);
        if (!exists) {
          const timestamp = dateKey.replace('custom:', '');
          state.history.unshift({
            id: `custom_${timestamp}`,
            date: dateKey,
            type: 'custom',
            desc: ''
          });
        }
      }
      state.availableFavorites = [...new Set(available)];
    }

    return Object.freeze({ count, recompress, remove, restoreMetadata, upload });
  }

  root.EchoNtpCustomWallpaperController = Object.freeze({ ACCEPTED_TYPES, MAX_COUNT, MAX_SIZE, create });
})(globalThis);
