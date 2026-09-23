(function(root) {
  'use strict';

  const UPLOAD_ICON = '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>';
  const HISTORY_ICON = '<path fill="currentColor" d="M13 3c-4.97 0-9 4.03-9 9H1l3.89 3.89.07.14L9 12H6c0-3.87 3.13-7 7-7s7 3.13 7 7-3.13 7-7 7c-1.93 0-3.68-.79-4.94-2.06l-1.42 1.42C8.27 19.99 10.51 21 13 21c4.97 0 9-4.03 9-9s-4.03-9-9-9zm-1 5v5l4.28 2.54.72-1.21-3.5-2.08V8H12z"/>';
  const HEART_ICON = '<path fill="currentColor" d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>';
  const DELETE_ICON = '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>';

  function create(options) {
    const state = options.state;
    const documentApi = options.document;
    const domain = options.domain;
    const urlApi = options.URL;
    let initialized = false;

    function favorites() {
      return state.availableFavorites || state.favorites;
    }

    function requestUpload() {
      const input = documentApi.getElementById('customWallpaperInput');
      if (!input) return;
      input.value = '';
      input.click();
    }

    function createUploadCard() {
      const card = documentApi.createElement('div');
      card.className = 'collection-upload-card';
      card.innerHTML = `${UPLOAD_ICON}<span>上传壁纸</span>`;
      card.addEventListener('click', requestUpload);
      return card;
    }

    function updateEmptyState(kind) {
      const empty = documentApi.getElementById('collectionEmpty');
      if (!empty) return;
      const icon = empty.querySelector('.empty-icon');
      const text = empty.querySelector('p:not(.empty-hint)');
      const hint = empty.querySelector('.empty-hint');
      const upload = empty.querySelector('.empty-upload-btn');
      if (kind === 'history') {
        if (icon) icon.innerHTML = HISTORY_ICON;
        if (text) text.textContent = '还没有浏览记录';
        if (hint) hint.textContent = '浏览过的壁纸会自动记录在这里';
        upload?.remove();
        return;
      }
      if (icon) icon.innerHTML = HEART_ICON;
      if (text) text.textContent = '壁纸库是空的';
      if (hint) hint.textContent = '收藏 Bing 壁纸，或上传自己的图片';
      if (!upload) {
        const button = documentApi.createElement('button');
        button.className = 'empty-upload-btn';
        button.innerHTML = `${UPLOAD_ICON}上传壁纸`;
        button.addEventListener('click', requestUpload);
        empty.appendChild(button);
      }
    }

    function loadThumbnail(wallpaper, image) {
      if (!domain.isCustomWallpaper(wallpaper)) {
        image.src = domain.buildBingUrl(wallpaper.id, '1080p');
        return;
      }
      const timestamp = wallpaper.date.replace('custom:', '');
      void options.cache.get(`custom_thumb:${timestamp}`).then(blob => {
        if (!blob || !image.isConnected) return;
        const objectUrl = urlApi.createObjectURL(blob);
        image.onload = image.onerror = () => {
          setTimeout(() => urlApi.revokeObjectURL(objectUrl), 2000);
        };
        image.src = objectUrl;
      });
    }

    function createGridItem(wallpaper, pinned, historyTab) {
      const item = documentApi.createElement('div');
      item.className = `collection-item${pinned ? ' pinned' : ''}`;
      if (domain.isCustomWallpaper(wallpaper)) item.classList.add('custom');

      const image = documentApi.createElement('img');
      const title = domain.isCustomWallpaper(wallpaper) ? '本地上传' : wallpaper.desc || '';
      image.alt = title;
      image.loading = 'lazy';
      item.appendChild(image);
      if (pinned) {
        const indicator = documentApi.createElement('div');
        indicator.className = 'pin-indicator';
        indicator.textContent = '当前壁纸';
        item.appendChild(indicator);
      }

      const overlay = documentApi.createElement('div');
      overlay.className = 'item-overlay';
      const titleElement = documentApi.createElement('span');
      titleElement.className = 'item-title';
      titleElement.textContent = title;
      overlay.appendChild(titleElement);
      if (!domain.isCustomWallpaper(wallpaper) && wallpaper.date) {
        const date = documentApi.createElement('span');
        date.className = 'item-date';
        date.textContent = wallpaper.date;
        overlay.appendChild(date);
      }
      item.appendChild(overlay);

      if (!historyTab) {
        const removeButton = documentApi.createElement('button');
        removeButton.className = 'item-delete';
        removeButton.dataset.date = wallpaper.date;
        removeButton.title = domain.isCustomWallpaper(wallpaper) ? '删除壁纸' : '移除收藏';
        removeButton.innerHTML = DELETE_ICON;
        removeButton.addEventListener('click', async event => {
          event.stopPropagation();
          await options.commands.removeFavorite(wallpaper.date);
          renderFavorites();
        });
        item.appendChild(removeButton);
      }

      item.addEventListener('click', event => {
        if (event.target.closest('.item-delete')) return;
        state.isPreview = true;
        state.browseIndex = state.history.findIndex(item => item.date === wallpaper.date);
        void options.display(wallpaper);
        options.view.updateActions();
        hide();
      });
      loadThumbnail(wallpaper, image);
      return item;
    }

    function renderFavorites() {
      const empty = documentApi.getElementById('collectionEmpty');
      const grid = documentApi.getElementById('collectionGrid');
      if (!grid) return;
      grid.replaceChildren();
      const count = documentApi.getElementById('tabFavoritesCount');
      if (count) count.textContent = `(${favorites().length})`;
      if (!favorites().length) {
        updateEmptyState('favorites');
        empty?.classList.remove('hidden');
        grid.classList.add('hidden');
        return;
      }
      empty?.classList.add('hidden');
      grid.classList.remove('hidden');
      grid.appendChild(createUploadCard());
      [...favorites()].reverse().forEach(date => {
        const wallpaper = state.history.find(item => item.date === date);
        if (!wallpaper) return;
        grid.appendChild(createGridItem(
          wallpaper,
          state.settings.pinnedDate === date,
          false
        ));
      });
    }

    function renderHistory() {
      const empty = documentApi.getElementById('collectionEmpty');
      const grid = documentApi.getElementById('collectionGrid');
      if (!grid) return;
      grid.replaceChildren();
      const count = documentApi.getElementById('tabHistoryCount');
      if (count) count.textContent = `(${state.viewHistory.length})`;
      if (!state.viewHistory.length) {
        updateEmptyState('history');
        empty?.classList.remove('hidden');
        grid.classList.add('hidden');
        return;
      }
      empty?.classList.add('hidden');
      grid.classList.remove('hidden');
      [...state.viewHistory].reverse().forEach(date => {
        const wallpaper = state.history.find(item => item.date === date);
        if (!wallpaper) return;
        grid.appendChild(createGridItem(
          wallpaper,
          state.settings.pinnedDate === date,
          true
        ));
      });
    }

    function setActiveTab(tab) {
      documentApi.getElementById('tabFavorites')?.classList.toggle('active', tab === 'favorites');
      documentApi.getElementById('tabHistory')?.classList.toggle('active', tab === 'history');
      if (tab === 'favorites') renderFavorites();
      else renderHistory();
    }

    function show() {
      const panel = documentApi.getElementById('collectionPanel');
      if (!panel) return;
      options.loadHistory();
      const favoritesCount = documentApi.getElementById('tabFavoritesCount');
      const historyCount = documentApi.getElementById('tabHistoryCount');
      if (favoritesCount) favoritesCount.textContent = `(${favorites().length})`;
      if (historyCount) historyCount.textContent = `(${state.viewHistory.length})`;
      const activeTab = documentApi.querySelector('.collection-tab.active')?.dataset.tab || 'favorites';
      setActiveTab(activeTab);
      documentApi.getElementById('collectionBackdrop')?.classList.add('visible');
      panel.classList.add('visible');
    }

    function hide() {
      documentApi.getElementById('collectionPanel')?.classList.remove('visible');
      documentApi.getElementById('collectionBackdrop')?.classList.remove('visible');
    }

    function refreshIfVisible() {
      const panel = documentApi.getElementById('collectionPanel');
      if (!panel?.classList.contains('visible')) return;
      const favoritesCount = documentApi.getElementById('tabFavoritesCount');
      const historyCount = documentApi.getElementById('tabHistoryCount');
      if (favoritesCount) favoritesCount.textContent = `(${favorites().length})`;
      if (historyCount) historyCount.textContent = `(${state.viewHistory.length})`;
      const tab = documentApi.querySelector('.collection-tab.active')?.dataset.tab || 'favorites';
      setActiveTab(tab);
    }

    function init() {
      if (initialized) return;
      initialized = true;
      documentApi.getElementById('tabFavorites')?.addEventListener('click', () => setActiveTab('favorites'));
      documentApi.getElementById('tabHistory')?.addEventListener('click', () => setActiveTab('history'));
      documentApi.getElementById('collectionClose')?.addEventListener('click', hide);
      documentApi.getElementById('collectionBackdrop')?.addEventListener('click', hide);
      documentApi.getElementById('playModeRandom')?.addEventListener('click', async () => {
        await options.commands.setCollectionPlayback('random');
        options.view.setCollectionPlayMode('random');
        show();
      });
      documentApi.getElementById('playModeFixed')?.addEventListener('click', async () => {
        await options.commands.setCollectionPlayback('fixed');
        options.view.setCollectionPlayMode('fixed');
        show();
      });
      documentApi.getElementById('collectionBackupLink')?.addEventListener('click', event => {
        event.preventDefault();
        options.openBackup();
      });
      documentApi.getElementById('customWallpaperInput')?.addEventListener('change', async event => {
        const file = event.target.files?.[0];
        if (!file) return;
        const uploaded = await options.uploadCustomWallpaper(file);
        if (!uploaded) return;
        renderFavorites();
        show();
      });
    }

    return Object.freeze({
      hide,
      init,
      refreshIfVisible,
      renderFavorites,
      renderHistory,
      setActiveTab,
      show
    });
  }

  root.EchoNtpWallpaperCollectionController = Object.freeze({ create });
})(globalThis);
