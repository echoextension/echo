(function(root) {
  'use strict';

  const CHECK_ICON = '<svg viewBox="0 0 24 24" class="wp-icon wp-check"><path fill="currentColor" d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>';
  const HEART_OUTLINE_ICON = '<svg viewBox="0 0 24 24" class="wp-icon wp-heart"><path fill="currentColor" d="M16.5 3c-1.74 0-3.41.81-4.5 2.09C10.91 3.81 9.24 3 7.5 3 4.42 3 2 5.42 2 8.5c0 3.78 3.4 6.86 8.55 11.54L12 21.35l1.45-1.32C18.6 15.36 22 12.28 22 8.5 22 5.42 19.58 3 16.5 3zm-4.4 15.55l-.1.1-.1-.1C7.14 14.24 4 11.39 4 8.5 4 6.5 5.5 5 7.5 5c1.54 0 3.04.99 3.57 2.36h1.87C13.46 5.99 14.96 5 16.5 5c2 0 3.5 1.5 3.5 3.5 0 2.89-3.14 5.74-7.9 10.05z"/></svg>';
  const HEART_FILLED_ICON = '<svg viewBox="0 0 24 24" class="wp-icon wp-heart wp-heart-filled"><path fill="currentColor" d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>';
  const IMAGE_ICON = '<svg viewBox="0 0 24 24" class="wp-icon"><path fill="currentColor" d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/></svg>';

  function create(options) {
    const state = options.state;
    const documentApi = options.document;
    const domain = options.domain;

    function favorites() {
      return state.availableFavorites || state.favorites;
    }

    function updateActions() {
      const wallpaper = state.current;
      const favoriteButton = documentApi.getElementById('wpFavorite');
      const favoriteText = documentApi.getElementById('wpFavoriteText');
      const favoriteGroup = documentApi.getElementById('wpFavoriteGroup');
      const pinButton = documentApi.getElementById('wpSetWallpaper');
      const pinText = documentApi.getElementById('wpSetWallpaperText');

      if (wallpaper && favoriteButton) {
        const favorited = favorites().includes(wallpaper.date);
        favoriteButton.classList.toggle('active', favorited);
        favoriteGroup?.classList.toggle('active', favorited);
        const icon = favoriteButton.querySelector('.wp-icon');
        if (icon) icon.outerHTML = favorited ? HEART_FILLED_ICON : HEART_OUTLINE_ICON;
        if (favoriteText) favoriteText.textContent = favorited ? '已收藏壁纸' : '收藏壁纸';
      }

      if (wallpaper && pinButton) {
        const pinned = state.settings.pinnedDate === wallpaper.date;
        pinButton.classList.toggle('active', pinned);
        const icon = pinButton.querySelector('.wp-icon');
        if (icon) icon.outerHTML = pinned ? CHECK_ICON : IMAGE_ICON;
        if (pinText) pinText.textContent = pinned ? '已锁定壁纸' : '锁定壁纸';
      }
    }

    function updateSummary() {
      const modeElement = documentApi.getElementById('wallpaperStatusMode');
      const titleElement = documentApi.getElementById('wallpaperStatusTitle');
      if (!modeElement || !titleElement) return;
      const { mode, pinnedDate } = state.settings;
      if (pinnedDate) {
        const wallpaper = state.history.find(item => item.date === pinnedDate);
        modeElement.textContent = '已锁定';
        titleElement.textContent = wallpaper?.desc || '';
      } else if (mode === 'daily') {
        modeElement.textContent = '必应每日';
        titleElement.textContent = state.current?.desc || '';
      } else if (mode === 'collection') {
        modeElement.textContent = `每日随机 · ${favorites().length}张收藏`;
        titleElement.textContent = state.current?.desc || '';
      } else {
        modeElement.textContent = '已关闭';
        titleElement.textContent = '';
      }
    }

    function updateFavoriteCount() {
      const description = documentApi.getElementById('collectionCountDesc');
      if (description) description.textContent = `已收藏 ${favorites().length} 张壁纸`;
      updateSummary();
    }

    function updatePlayModeButtons() {
      const collectionMode = state.settings.mode === 'collection';
      const pinned = !!state.settings.pinnedDate;
      const randomButton = documentApi.getElementById('playModeRandomBtn');
      const fixedButton = documentApi.getElementById('playModeFixedBtn');
      randomButton?.classList.toggle('active', collectionMode && !pinned);
      fixedButton?.classList.toggle('active', collectionMode && pinned);
    }

    function updateSourceSelector() {
      const { mode, pinnedDate } = state.settings;
      const pinned = !!pinnedDate;
      const dailyRadio = documentApi.getElementById('sourceDaily');
      const collectionRadio = documentApi.getElementById('sourceCollection');
      const dailyCurrent = documentApi.getElementById('sourceDailyCurrent');
      const collectionCount = documentApi.getElementById('sourceCollectionCount');
      const manageCount = documentApi.getElementById('manageCollectionCount');
      const playModeSelector = documentApi.getElementById('playModeSelector');
      const lockedCard = documentApi.getElementById('lockedStatusCard');
      const lockedTitle = documentApi.getElementById('lockedStatusTitle');
      const subSettings = documentApi.getElementById('wallpaperSubSettings');

      subSettings?.classList.toggle('is-locked', pinned);
      if (dailyRadio) dailyRadio.checked = !pinned && mode === 'daily';
      if (collectionRadio) collectionRadio.checked = !pinned && mode === 'collection';
      if (collectionCount) collectionCount.textContent = `(${favorites().length}张)`;
      if (manageCount) manageCount.textContent = `(${favorites().length})`;

      if (dailyCurrent) {
        dailyCurrent.textContent = mode === 'daily' && state.current && !pinned
          ? state.current.desc || ''
          : '';
        dailyCurrent.classList.toggle('visible', mode === 'daily' && !!state.current && !pinned);
      }
      playModeSelector?.classList.toggle('visible', mode === 'collection' && !pinned);
      if (lockedCard) {
        lockedCard.classList.toggle('visible', pinned);
        if (pinned && lockedTitle) {
          const wallpaper = state.history.find(item => item.date === pinnedDate);
          lockedTitle.textContent = wallpaper?.desc
            || (domain.isCustomDate(pinnedDate) ? '本地上传壁纸' : pinnedDate);
        }
      }
      updatePlayModeButtons();
    }

    function setCollectionPlayMode(mode = state.settings.collectionPlayMode) {
      documentApi.getElementById('playModeRandom')?.classList.toggle('active', mode === 'random');
      documentApi.getElementById('playModeFixed')?.classList.toggle('active', mode === 'fixed');
      const hint = documentApi.getElementById('collectionHintText');
      if (hint) {
        hint.textContent = mode === 'random'
          ? '每天从收藏中随机展示一张壁纸'
          : '点击下方壁纸将其设为固定壁纸';
      }
    }

    function refresh() {
      updateFavoriteCount();
      updateActions();
      updateSourceSelector();
    }

    return Object.freeze({
      refresh,
      setCollectionPlayMode,
      updateActions,
      updateFavoriteCount,
      updatePlayModeButtons,
      updateSourceSelector,
      updateSummary
    });
  }

  root.EchoNtpWallpaperStatusView = Object.freeze({ create });
})(globalThis);
