(function(root) {
  'use strict';

  function create(options) {
    const state = options.state;
    const documentApi = options.document;
    const windowApi = options.window;
    let initialized = false;
    let collapseTimer = null;
    let expanded = false;
    let enabled = false;
    let dragging = false;
    let dragStartY = 0;
    let dragStartTop = 0;
    let wrapper;
    let dot;
    let card;

    const AUTO_HIDE_DELAY = 5000;
    const LEAVE_DELAY = 3000;
    const MAX_DISTANCE = 500;
    const TRIGGER_DISTANCE = 80;

    function update(wallpaper) {
      if (!wallpaper) return;
      const title = documentApi.getElementById('wallpaperTitle');
      const copyright = documentApi.getElementById('wallpaperCopyright');
      const date = documentApi.getElementById('wallpaperDate');
      if (title) title.textContent = wallpaper.desc || '';
      if (copyright) copyright.textContent = wallpaper.copyright || '';
      if (!date) return;

      const now = options.now ? options.now() : new Date();
      const parts = String(wallpaper.date || '').split('-').map(Number);
      const wallpaperTime = parts.length === 3
        ? new Date(parts[0], parts[1] - 1, parts[2]).getTime()
        : Number.NaN;
      const todayTime = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
      const daysDifference = Math.round((todayTime - wallpaperTime) / 86400000);
      if (daysDifference >= 0 && daysDifference <= 8) {
        date.textContent = wallpaper.date;
        date.style.display = '';
      } else {
        date.textContent = '';
        date.style.display = 'none';
      }
    }

    function searchCurrent() {
      const description = state.current?.desc;
      if (!description || !options.openSearch) return;
      options.openSearch(`https://www.bing.com/search?q=${encodeURIComponent(description)}`);
    }

    function initSearchInteraction() {
      const searchLink = card.querySelector('.wallpaper-search-link');
      searchLink?.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        searchCurrent();
      });
      let clickStartTime = 0;
      let clickStartX = 0;
      card.addEventListener('mousedown', event => {
        clickStartTime = Date.now();
        clickStartX = event.clientX;
      });
      card.addEventListener('click', () => {
        const isDragHandle = clickStartX - card.getBoundingClientRect().left < 30;
        if (!isDragHandle && Date.now() - clickStartTime <= 200) searchCurrent();
      });
    }

    function currentTop() {
      return wrapper.getBoundingClientRect().top;
    }

    async function savePosition(value) {
      state.settings.infoPositionY = value;
      await options.saveSettings();
    }

    function restorePosition() {
      const saved = state.settings.infoPositionY;
      if (saved === null || saved === undefined) return;
      wrapper.style.setProperty('--info-position-y', `${saved}px`);
      wrapper.classList.add('custom-position');
    }

    function beginDrag(event) {
      event.preventDefault();
      dragging = true;
      dragStartY = event.clientY;
      dragStartTop = currentTop();
      wrapper.classList.add('dragging');
      documentApi.body.style.userSelect = 'none';
    }

    function moveDrag(event) {
      if (!dragging) return;
      const height = wrapper.getBoundingClientRect().height || 60;
      const top = Math.max(10, Math.min(windowApi.innerHeight - height - 10,
        dragStartTop + event.clientY - dragStartY));
      wrapper.style.setProperty('--info-position-y', `${top}px`);
      wrapper.classList.add('custom-position');
    }

    function endDrag() {
      if (!dragging) return;
      dragging = false;
      wrapper.classList.remove('dragging');
      documentApi.body.style.userSelect = '';
      void savePosition(currentTop());
    }

    function collapse() {
      if (!expanded || !enabled) return;
      expanded = false;
      wrapper.classList.remove('expanded');
      wrapper.classList.add('collapsed');
    }

    function collapseInstant() {
      expanded = false;
      wrapper.classList.add('no-transition');
      wrapper.classList.remove('expanded');
      wrapper.classList.add('collapsed');
      void wrapper.offsetHeight;
      wrapper.classList.remove('no-transition');
    }

    function expand() {
      expanded = true;
      wrapper.classList.remove('collapsed');
      wrapper.classList.add('expanded');
      clearTimeout(collapseTimer);
      dot.style.setProperty('--dot-size', '30px');
      dot.style.setProperty('--dot-opacity', '0.25');
      dot.style.setProperty('--dot-glow', '0px');
      windowApi.requestAnimationFrame(() => {
        const rectangle = card.getBoundingClientRect();
        const overflow = rectangle.bottom - (windowApi.innerHeight - 10);
        if (overflow <= 0) return;
        const top = Math.max(10, currentTop() - overflow);
        wrapper.style.setProperty('--info-position-y', `${top}px`);
        wrapper.classList.add('custom-position');
        void savePosition(top);
      });
    }

    function startCollapseTimer(delay = LEAVE_DELAY) {
      if (!enabled) return;
      clearTimeout(collapseTimer);
      collapseTimer = setTimeout(collapse, delay);
    }

    function updateDot(distance) {
      if (distance >= MAX_DISTANCE) {
        dot.style.setProperty('--dot-size', '30px');
        dot.style.setProperty('--dot-opacity', '0.25');
        dot.style.setProperty('--dot-glow', '0px');
        return;
      }
      const ratio = 1 - distance / MAX_DISTANCE;
      dot.style.setProperty('--dot-size', `${30 + 25 * ratio}px`);
      dot.style.setProperty('--dot-opacity', (0.25 + 0.4 * ratio).toFixed(2));
      dot.style.setProperty('--dot-glow', `${15 * ratio}px`);
    }

    function onWallpaperChange() {
      if (!initialized) return;
      const currentId = state.current?.id;
      const lastShownId = state.settings.lastShownWallpaperId;
      if (!enabled) {
        expand();
      } else if (currentId && currentId === lastShownId) {
        clearTimeout(collapseTimer);
        collapseInstant();
      } else {
        if (currentId) {
          state.settings.lastShownWallpaperId = currentId;
          void options.saveSettings();
        }
        expand();
        startCollapseTimer(AUTO_HIDE_DELAY);
      }
    }

    async function enable() {
      enabled = true;
      state.settings.lastShownWallpaperId = null;
      await options.saveSettings();
      onWallpaperChange();
    }

    function disable() {
      enabled = false;
      clearTimeout(collapseTimer);
      expand();
    }

    function init() {
      if (initialized) return;
      wrapper = documentApi.getElementById('wallpaperInfoWrapper');
      dot = documentApi.getElementById('wallpaperInfoDot');
      card = documentApi.getElementById('wallpaperInfo');
      const toggle = documentApi.getElementById('autoHideInfoSwitch');
      if (!wrapper || !dot || !card) return;
      initialized = true;
      enabled = state.settings.autoHideInfo || false;
      restorePosition();
      initSearchInteraction();

      dot.addEventListener('mousedown', beginDrag);
      card.addEventListener('mousedown', event => {
        if (event.clientX - card.getBoundingClientRect().left < 30) beginDrag(event);
      });
      card.addEventListener('mousemove', event => {
        card.classList.toggle('drag-handle-hover',
          event.clientX - card.getBoundingClientRect().left < 30);
      });
      card.addEventListener('mouseleave', () => card.classList.remove('drag-handle-hover'));
      documentApi.addEventListener('mousemove', moveDrag);
      documentApi.addEventListener('mouseup', endDrag);
      windowApi.addEventListener('resize', () => {
        const height = wrapper.getBoundingClientRect().height || 60;
        const maximum = windowApi.innerHeight - height - 10;
        if (currentTop() <= maximum) return;
        const top = Math.max(10, maximum);
        wrapper.style.setProperty('--info-position-y', `${top}px`);
        wrapper.classList.add('custom-position');
        void savePosition(top);
      });

      if (toggle) {
        toggle.checked = enabled;
        toggle.addEventListener('change', async () => {
          state.settings.autoHideInfo = toggle.checked;
          await options.saveSettings();
          if (toggle.checked) await enable();
          else disable();
        });
      }
      if (!enabled) {
        wrapper.classList.add('expanded');
        expanded = true;
      }
      card.addEventListener('mouseenter', () => enabled && clearTimeout(collapseTimer));
      card.addEventListener('mouseleave', () => enabled && startCollapseTimer());
      documentApi.addEventListener('mousemove', event => {
        if (dragging || !documentApi.body.classList.contains('wallpaper-mode') || !enabled || expanded) return;
        const rectangle = wrapper.getBoundingClientRect();
        const dotSize = Number.parseFloat(root.getComputedStyle(dot).getPropertyValue('--dot-size')) || 30;
        const distance = Math.hypot(
          event.clientX - (rectangle.left + dotSize / 2),
          event.clientY - (rectangle.top + dotSize / 2)
        );
        updateDot(distance);
        if (distance < TRIGGER_DISTANCE) {
          expand();
          startCollapseTimer();
        }
      });
      let clickStartTime = 0;
      dot.addEventListener('mousedown', () => { clickStartTime = Date.now(); });
      dot.addEventListener('click', () => {
        if (Date.now() - clickStartTime > 200) return;
        expand();
        startCollapseTimer();
      });
      documentApi.addEventListener('click', event => {
        if (!enabled || !expanded || card.contains(event.target) || dot.contains(event.target)) return;
        clearTimeout(collapseTimer);
        collapse();
      });
    }

    return Object.freeze({ disable, enable, init, onWallpaperChange, searchCurrent, update });
  }

  root.EchoNtpWallpaperInfoController = Object.freeze({ create });
})(globalThis);
