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
    let mutationQueue = Promise.resolve();
    let lastTimestamp = 0;
    const deletedDates = new Set();

    function sameList(left, right) {
      return left.length === right.length && left.every((item, index) => item === right[index]);
    }

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
      let expectedFavorites = null;
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
        expectedFavorites = [...state.favorites];
        metadataChanged = true;
        await options.saveFavorites(expectedFavorites);
        state.settings.pinnedDate = dateKey;
        state.isPreview = false;
        await options.saveSettings();
        await options.display(wallpaper);
        options.refreshStatus();
        return wallpaper;
      } catch (error) {
        const ownsFavorites = metadataChanged && sameList(state.favorites, expectedFavorites);
        const containsFailedDate = state.favorites.includes(dateKey);
        state.history = state.history.filter(wallpaper => wallpaper.date !== dateKey);
        state.favorites = ownsFavorites
          ? previousFavorites
          : state.favorites.filter(item => item !== dateKey);
        state.availableFavorites = ownsFavorites
          ? previousAvailableFavorites
          : (state.availableFavorites || state.favorites).filter(item => item !== dateKey);
        if (state.settings.pinnedDate === dateKey) state.settings.pinnedDate = previousPinnedDate;
        if (ownsFavorites && state.isPreview === false) state.isPreview = previousPreview;
        if (dateKey && thumbnailKey) await cache.remove(dateKey, thumbnailKey);
        if (metadataChanged && (ownsFavorites || containsFailedDate)) {
          try {
            await options.saveFavorites([...state.favorites], { removeFavorites: [dateKey] });
          } catch (rollbackError) {
            console.error('[ECHO NTP] 自定义壁纸收藏回滚失败:', rollbackError);
          }
        }
        console.error('[ECHO NTP] 自定义壁纸上传失败:', error);
        options.showToast('上传失败，请重试');
        return null;
      }
    }

    function enqueue(operation) {
      const task = mutationQueue.then(operation);
      mutationQueue = task.catch(() => null);
      return task;
    }

    function upload(file) {
      return enqueue(() => performUpload(file));
    }

    async function restoreRemoval(previous, operation, restoreFavorites, restoreSettings, dateKey) {
      const ownsFavorites = sameList(state.favorites, operation.favorites);
      if (!ownsFavorites) {
        if (state.favorites.includes(dateKey)) {
          const previousIndex = previous.history.findIndex(wallpaper => wallpaper.date === dateKey);
          const wallpaper = previous.history[previousIndex];
          if (wallpaper && !state.history.some(item => item.date === dateKey)) {
            state.history.splice(Math.max(0, previousIndex), 0, wallpaper);
          }
          if (previous.availableFavorites.includes(dateKey)
              && !state.availableFavorites.includes(dateKey)) {
            state.availableFavorites.push(dateKey);
          }
        }
        return false;
      }
      state.history = previous.history;
      state.favorites = previous.favorites;
      state.availableFavorites = previous.availableFavorites;
      for (const key of ['pinnedDate', 'mode', 'lastActiveMode']) {
        if (state.settings[key] === operation.settings[key]) {
          state.settings[key] = previous.settings[key];
        }
      }
      try {
        if (restoreFavorites) {
          await options.saveFavorites(previous.favorites, {
            addFavorites: [dateKey]
          });
        }
        if (restoreSettings) await options.saveSettings();
      } catch (error) {
        console.error('[ECHO NTP] 自定义壁纸删除回滚失败:', error);
      }
    }

    async function performRemove(dateKey) {
      if (!domain.isCustomDate(dateKey)) return;
      const timestamp = dateKey.replace('custom:', '');
      const previous = {
        history: [...state.history],
        favorites: [...state.favorites],
        availableFavorites: [...(state.availableFavorites || state.favorites)],
        settings: { ...state.settings }
      };
      const clearsPin = state.settings.pinnedDate === dateKey;
      const availableFavorites = state.availableFavorites || state.favorites;
      state.history = state.history.filter(wallpaper => wallpaper.date !== dateKey);
      state.favorites = state.favorites.filter(date => date !== dateKey);
      state.availableFavorites = availableFavorites.filter(date => date !== dateKey);
      if (clearsPin) state.settings.pinnedDate = null;
      const fallsBackToDaily = state.settings.mode === 'collection'
        && !state.settings.pinnedDate
        && state.availableFavorites.length === 0;
      if (fallsBackToDaily) {
        state.settings.mode = 'daily';
        state.settings.lastActiveMode = 'daily';
      }
      const settingsChanged = clearsPin || fallsBackToDaily;
      const operation = {
        favorites: [...state.favorites],
        settings: {
          pinnedDate: state.settings.pinnedDate,
          mode: state.settings.mode,
          lastActiveMode: state.settings.lastActiveMode
        }
      };
      let favoritesPersisted = false;

      try {
        await options.saveFavorites([...state.favorites]);
        favoritesPersisted = true;
        if (settingsChanged) await options.saveSettings();
      } catch (error) {
        await restoreRemoval(previous, operation, true, settingsChanged, dateKey);
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
        await restoreRemoval(previous, operation, true, settingsChanged, dateKey);
        options.showToast('删除失败，请重试');
        return false;
      }
      options.refreshStatus();
      return { fellBack: fallsBackToDaily };
    }

    function remove(dateKey) {
      return enqueue(() => performRemove(dateKey));
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
