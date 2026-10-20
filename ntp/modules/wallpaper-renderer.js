(function(root) {
  'use strict';

  const MAX_FALLBACK_ATTEMPTS = 3;

  function create(options) {
    const state = options.state;
    const documentApi = options.document;
    const ImageConstructor = options.Image;
    const urlApi = options.URL;
    const fetchImpl = options.fetch;
    const randomValue = options.random || Math.random;
    let renderRequestId = 0;
    let interactionVersion = 0;
    let commitVersion = 0;
    let cacheVersion = 0;
    let refreshPending = false;
    const preloading = new Map();
    let preloadTarget = 5;
    let dailyPriorityActive = false;
    const today = options.today || (() => {
      const date = new Date();
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    });
    const jobs = new Set();
    const dailyRequests = new Map();

    function showImage(image, container) {
      image.style.transition = 'none';
      image.style.opacity = '1';
      container.replaceChildren(image);
      options.theme.applyTextTheme(image);
      options.theme.applyInfoTheme(image);
    }

    function stopPreload() {
      for (const [url, image] of preloading) {
        image.onload = null;
        image.onerror = null;
        image.removeAttribute('src');
        state.preloadedImages.delete(url);
      }
      preloading.clear();
    }

    function hasPriorityWork() {
      const daily = state.settings.mode === 'daily' && !state.settings.pinnedDate
        && !state.settings.blankMode && !state.isPreview;
      const currentDate = state.current && !options.domain.isCustomWallpaper(state.current)
        ? state.current.date : null;
      const currentToday = typeof currentDate === 'string' && currentDate >= today();
      // A metadata revalidation is not a missing daily image. Once today's
      // picture is visible, keep the user's random-image pool productive.
      return (refreshPending && daily && !currentToday)
        || [...jobs].some(job => job.priority && job.isCurrent());
    }

    function updateLoading() {
      state.isWallpaperLoading = [...jobs].some(job => job.isCurrent());
      const priority = hasPriorityWork();
      const resumeDaily = dailyPriorityActive && !priority;
      dailyPriorityActive = priority;
      if (priority || state.settings.mode === 'off' || state.settings.blankMode) stopPreload();
      else if (resumeDaily) preload(preloadTarget);
    }

    function cancel() {
      renderRequestId += 1;
      interactionVersion += 1;
      state.wallpaperRenderRequestId = renderRequestId;
      stopPreload();
      updateLoading();
    }

    function setRefreshPending(pending) {
      refreshPending = pending;
      updateLoading();
    }

    function commit(wallpaper, image, container, custom = false) {
      commitVersion += 1;
      documentApi.body.classList.toggle('custom-wallpaper-active', custom);
      state.current = wallpaper;
      const index = state.history.indexOf(wallpaper);
      if (index !== -1) state.browseIndex = index;
      options.addToHistory(wallpaper.date);
      showImage(image, container);
      options.updateStatus();
      options.updateStatusText();
      if (!custom) {
        options.updateInfo(wallpaper);
        options.infoController.onWallpaperChange();
      }
      if (!custom) preload(preloadTarget);
    }

    function renderBlob(wallpaper, blob, container, isCurrent, custom = false) {
      return new Promise(resolve => {
        const image = new ImageConstructor();
        const objectUrl = urlApi.createObjectURL(blob);
        image.alt = custom ? '自定义壁纸' : wallpaper.desc || 'Bing Wallpaper';
        image.onload = () => {
          if (!isCurrent()) {
            urlApi.revokeObjectURL(objectUrl);
            resolve({ status: 'stale' });
            return;
          }
          commit(wallpaper, image, container, custom);
          root.setTimeout(() => urlApi.revokeObjectURL(objectUrl), 1000);
          resolve({ image, status: 'success' });
        };
        image.onerror = () => {
          urlApi.revokeObjectURL(objectUrl);
          resolve({ status: isCurrent() ? 'failed' : 'stale' });
        };
        image.src = objectUrl;
      });
    }

    function preload(count = 5) {
      preloadTarget = count;
      if (hasPriorityWork() || !state.current || state.settings.mode === 'off'
          || state.settings.blankMode || !state.history.length) return;
      const { history, preloadedImages, settings } = state;
      for (const [url, image] of preloadedImages) {
        if (image.error) preloadedImages.delete(url);
      }
      if (preloadedImages.size > 8) {
        [...preloadedImages.keys()].slice(0, preloadedImages.size - 8)
          .forEach(url => preloadedImages.delete(url));
      }
      const currentUrl = options.domain.isCustomWallpaper(state.current)
        ? null : options.domain.buildBingUrl(state.current.id, settings.quality);
      let attempts = 0;
      // Keep the 1.4.6 immediate, five-image parallel fill. Only a pending
      // daily update may hold it back; ordinary image changes refill at commit.
      while (preloadedImages.size < count && attempts < count * 3) {
        attempts += 1;
        const wallpaper = history[Math.floor(randomValue() * history.length)];
        if (options.domain.isCustomWallpaper(wallpaper)) continue;
        const imageUrl = options.domain.buildBingUrl(wallpaper.id, settings.quality);
        if (imageUrl === currentUrl || preloadedImages.has(imageUrl)) continue;
        const image = new ImageConstructor();
        image.wpData = wallpaper;
        image.onload = () => preloading.delete(imageUrl);
        image.onerror = () => {
          image.error = true;
          preloading.delete(imageUrl);
        };
        preloading.set(imageUrl, image);
        preloadedImages.set(imageUrl, image);
        image.src = imageUrl;
      }
    }

    async function displayCached(wallpapers, canCommit = null) {
      // A new daily download must not cancel the local first paint. A successful
      // replacement, explicit user action or newer cache pass invalidates it.
      const interaction = interactionVersion;
      const committed = commitVersion;
      const cacheRequest = ++cacheVersion;
      const isCurrent = () => interaction === interactionVersion && committed === commitVersion
        && cacheRequest === cacheVersion && (!canCommit || canCommit());
      const job = { isCurrent };
      jobs.add(job);
      updateLoading();
      try {
        const container = documentApi.getElementById('wallpaperBg');
        const candidates = new Map(wallpapers.filter(w => !options.domain.isCustomWallpaper(w))
          .map(w => [options.domain.buildBingUrl(w.id, state.settings.quality), w]));
        while (container && candidates.size && isCurrent()) {
          const cached = await options.cache.getFirst([...candidates.keys()]);
          if (!cached || !isCurrent()) break;
          const wallpaper = candidates.get(cached.url);
          candidates.delete(cached.url);
          const result = await renderBlob(wallpaper, cached.blob, container, isCurrent);
          if (result.status === 'success') return true;
          if (result.status === 'stale') return false;
          await options.cache.remove(cached.url);
        }
        return false;
      } finally {
        jobs.delete(job);
        updateLoading();
      }
    }

    function display(wallpaper, fallbackAttempts = 0, canCommit = null) {
      if (!wallpaper || (canCommit && !canCommit())) return Promise.resolve();
      const key = options.domain.isCustomWallpaper(wallpaper) ? wallpaper.date
        : options.domain.buildBingUrl(wallpaper.id, state.settings.quality);
      const existing = dailyRequests.get(key);
      if (canCommit && existing?.isCurrent()) return existing.promise;
      const requestId = ++renderRequestId;
      if (!canCommit) interactionVersion += 1;
      state.wallpaperRenderRequestId = requestId;
      const isCurrent = () => requestId === renderRequestId && (!canCommit || canCommit());
      const job = { isCurrent, priority: Boolean(canCommit) };
      jobs.add(job);
      updateLoading();
      const promise = displayTarget(wallpaper, fallbackAttempts, canCommit, isCurrent).finally(() => {
        jobs.delete(job);
        if (dailyRequests.get(key)?.promise === promise) dailyRequests.delete(key);
        updateLoading();
      });
      if (canCommit) dailyRequests.set(key, { promise, isCurrent });
      return promise;
    }

    async function displayTarget(wallpaper, fallbackAttempts, canCommit, isCurrent) {
      const container = documentApi.getElementById('wallpaperBg');
      if (!container) return;
      const custom = options.domain.isCustomWallpaper(wallpaper);
      const imageUrl = custom ? wallpaper.date
        : options.domain.buildBingUrl(wallpaper.id, state.settings.quality);
      if (!custom) {
        const preloaded = state.preloadedImages.get(imageUrl);
        if (preloaded?.complete && preloaded.naturalWidth > 0 && isCurrent()) {
          state.preloadedImages.delete(imageUrl);
          preloading.delete(imageUrl);
          preloaded.onload = null;
          preloaded.onerror = null;
          commit(wallpaper, preloaded, container);
          return;
        }
      }
      try {
        const cached = await options.cache.get(imageUrl);
        if (!isCurrent()) return;
        if (cached) {
          const result = await renderBlob(wallpaper, cached, container, isCurrent, custom);
          if (result.status !== 'failed') {
            if (custom && result.status === 'success' && cached.size > 2 * 1024 * 1024) {
              options.custom.recompress(wallpaper.date, result.image);
            }
            return;
          }
          if (custom) return;
          await options.cache.remove(imageUrl);
          if (!isCurrent()) return;
        } else if (custom) {
          console.warn('[ECHO NTP] 自定义壁纸数据丢失:', wallpaper.date);
          return;
        }
        const response = await fetchImpl(imageUrl);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const contentType = (response.headers.get('Content-Type') || '').toLowerCase();
        if (!contentType.startsWith('image/')) throw new Error(`Unexpected wallpaper content type: ${contentType || 'missing'}`);
        const blob = await response.blob();
        if (!blob.size) throw new Error('Empty wallpaper response');
        if (!isCurrent()) return;
        const result = await renderBlob(wallpaper, blob, container, isCurrent);
        if (result.status === 'success') void options.cache.put(imageUrl, blob);
        else if (result.status === 'failed') await displayNext(fallbackAttempts, canCommit, isCurrent);
      } catch (error) {
        if (!isCurrent()) return;
        console.warn('[ECHO NTP] 壁纸加载失败:', error);
        await displayNext(fallbackAttempts, canCommit, isCurrent);
      }
    }

    async function displayNext(fallbackAttempts, canCommit, isCurrent) {
      if (!isCurrent() || (canCommit && (state.current || !canCommit()))) return;
      if (fallbackAttempts >= MAX_FALLBACK_ATTEMPTS || state.browseIndex >= state.history.length - 1) return;
      state.browseIndex += 1;
      await display(state.history[state.browseIndex], fallbackAttempts + 1, canCommit);
    }

    return Object.freeze({ cancel, display, displayCached, preload, setRefreshPending, showImage });
  }

  root.EchoNtpWallpaperRenderer = Object.freeze({ create });
})(globalThis);
