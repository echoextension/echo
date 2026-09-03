(function(root) {
  'use strict';

  const MAX_FALLBACK_ATTEMPTS = 3;

  function create(options) {
    const state = options.state;
    const documentApi = options.document;
    const ImageConstructor = options.Image;
    const urlApi = options.URL;
    const fetchImpl = options.fetch;
    let renderRequestId = 0;

    function showImage(image, container) {
      image.style.transition = 'none';
      image.style.opacity = '1';
      container.replaceChildren(image);
      options.theme.applyTextTheme(image);
      options.theme.applyInfoTheme(image);
    }

    function cancel() {
      renderRequestId += 1;
      state.wallpaperRenderRequestId = renderRequestId;
      state.isWallpaperLoading = false;
    }

    function updateUi(wallpaper) {
      options.updateInfo(wallpaper);
      options.updateStatus();
      options.updateStatusText();
      options.infoController.onWallpaperChange();
    }

    function commit(wallpaper, image, container, custom = false) {
      documentApi.body.classList.toggle('custom-wallpaper-active', custom);
      state.current = wallpaper;
      options.addToHistory(wallpaper.date);
      showImage(image, container);
      state.isWallpaperLoading = false;
      if (custom) {
        options.updateStatus();
        options.updateStatusText();
      } else {
        updateUi(wallpaper);
        preload();
      }
    }

    function renderBlob(wallpaper, blob, container, requestId, custom = false) {
      return new Promise(resolve => {
        const image = new ImageConstructor();
        const objectUrl = urlApi.createObjectURL(blob);
        image.alt = custom ? '自定义壁纸' : wallpaper.desc || 'Bing Wallpaper';
        image.onload = () => {
          if (requestId !== renderRequestId) {
            urlApi.revokeObjectURL(objectUrl);
            resolve({ status: 'stale' });
            return;
          }
          commit(wallpaper, image, container, custom);
          setTimeout(() => urlApi.revokeObjectURL(objectUrl), 1000);
          resolve({ image, status: 'success' });
        };
        image.onerror = () => {
          urlApi.revokeObjectURL(objectUrl);
          if (requestId !== renderRequestId) {
            resolve({ status: 'stale' });
            return;
          }
          state.isWallpaperLoading = false;
          resolve({ status: 'failed' });
        };
        image.src = objectUrl;
      });
    }

    function preload(count = 5) {
      const { history, preloadedImages, settings } = state;
      if (!history.length) return;
      for (const [url, image] of preloadedImages) {
        if (image.error) preloadedImages.delete(url);
      }
      if (preloadedImages.size > 8) {
        [...preloadedImages.keys()].slice(0, preloadedImages.size - 8)
          .forEach(url => preloadedImages.delete(url));
      }
      const currentUrl = state.current && !options.domain.isCustomWallpaper(state.current)
        ? options.domain.buildBingUrl(state.current.id, settings.quality)
        : null;
      let attempts = 0;
      while (preloadedImages.size < count && attempts < count * 3) {
        attempts += 1;
        const wallpaper = history[Math.floor(Math.random() * history.length)];
        if (options.domain.isCustomWallpaper(wallpaper)) continue;
        const imageUrl = options.domain.buildBingUrl(wallpaper.id, settings.quality);
        if (imageUrl === currentUrl || preloadedImages.has(imageUrl)) continue;
        const image = new ImageConstructor();
        image.onerror = () => { image.error = true; };
        image.src = imageUrl;
        image.wpData = wallpaper;
        preloadedImages.set(imageUrl, image);
      }
    }

    async function display(wallpaper, fallbackAttempts = 0) {
      if (!wallpaper) return;
      const requestId = ++renderRequestId;
      state.wallpaperRenderRequestId = requestId;
      state.isWallpaperLoading = true;
      const container = documentApi.getElementById('wallpaperBg');
      if (!container) {
        state.isWallpaperLoading = false;
        return;
      }

      if (options.domain.isCustomWallpaper(wallpaper)) {
        try {
          const blob = await options.cache.get(wallpaper.date);
          if (requestId !== renderRequestId) return;
          if (!blob) {
            state.isWallpaperLoading = false;
            console.warn('[ECHO NTP] 自定义壁纸数据丢失:', wallpaper.date);
            return;
          }
          const result = await renderBlob(wallpaper, blob, container, requestId, true);
          if (result.status === 'success' && blob.size > 2 * 1024 * 1024) {
            options.custom.recompress(wallpaper.date, result.image);
          }
        } catch (error) {
          console.warn('[ECHO NTP] 自定义壁纸加载失败:', error);
          if (requestId === renderRequestId) state.isWallpaperLoading = false;
        }
        return;
      }

      const imageUrl = options.domain.buildBingUrl(wallpaper.id, state.settings.quality);
      const preloaded = state.preloadedImages.get(imageUrl);
      if (preloaded?.complete && preloaded.naturalWidth > 0) {
        state.preloadedImages.delete(imageUrl);
        commit(wallpaper, preloaded.cloneNode(), container);
        return;
      }

      const cached = await options.cache.get(imageUrl);
      if (requestId !== renderRequestId) return;
      if (cached) {
        const result = await renderBlob(wallpaper, cached, container, requestId);
        if (result.status !== 'failed') return;
        await options.cache.remove(imageUrl);
        if (requestId !== renderRequestId) return;
        state.isWallpaperLoading = true;
      }

      await loadNetworkImage(wallpaper, imageUrl, container, requestId, fallbackAttempts);
    }

    async function loadNetworkImage(wallpaper, imageUrl, container, requestId, fallbackAttempts) {
      try {
        const response = await fetchImpl(imageUrl);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const contentType = (response.headers.get('Content-Type') || '').toLowerCase();
        if (!contentType.startsWith('image/')) {
          throw new Error(`Unexpected wallpaper content type: ${contentType || 'missing'}`);
        }
        const blob = await response.blob();
        if (!blob.size) throw new Error('Empty wallpaper response');
        if (requestId !== renderRequestId) return;
        const result = await renderBlob(wallpaper, blob, container, requestId);
        if (result.status === 'success') {
          void options.cache.put(imageUrl, blob);
        } else if (result.status === 'failed') {
          await displayNext(fallbackAttempts);
        }
      } catch (error) {
        if (requestId !== renderRequestId) return;
        state.isWallpaperLoading = false;
        console.warn('[ECHO NTP] 壁纸加载失败:', error);
        await displayNext(fallbackAttempts);
      }
    }

    async function displayNext(fallbackAttempts) {
      if (fallbackAttempts >= MAX_FALLBACK_ATTEMPTS) return;
      if (state.browseIndex >= state.history.length - 1) return;
      state.browseIndex += 1;
      await display(state.history[state.browseIndex], fallbackAttempts + 1);
    }

    return Object.freeze({ cancel, display, preload, showImage });
  }

  root.EchoNtpWallpaperRenderer = Object.freeze({ create });
})(globalThis);
