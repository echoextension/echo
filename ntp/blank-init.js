(function() {
  'use strict';

  const BLANK_MODE_KEY = 'echo_ntp_blank_mode';

  function getNativeNewTabTitle() {
    try {
      const localized = window.chrome?.i18n?.getMessage?.('ntpNativeTitle');
      if (localized) return localized;
      const language = window.chrome?.i18n?.getUILanguage?.() || window.navigator.language || '';
      return /^zh(?:[-_]|$)/i.test(language) ? '新建标签页' : 'New tab';
    } catch {
      return 'New tab';
    }
  }

  document.title = getNativeNewTabTitle();

  window.LowPolyConfig = { autoInit: false };

  try {
    if (localStorage.getItem('echo_ntp_show_brand') === 'false') {
      document.documentElement.classList.add('brand-hidden');
    }
  } catch {}

  try {
    const storedValue = localStorage.getItem(BLANK_MODE_KEY);
    const blankModeEnabled = storedValue === 'true';

    window.__ECHO_NTP_BLANK_MODE__ = blankModeEnabled;

    if (blankModeEnabled) {
      document.documentElement.classList.add('blank-mode');
      document.documentElement.style.setProperty('--bookmark-bar-height', '0px');
    }

    // 热榜关闭时提前设置布局位置，避免首帧跳动
    const trendingValue = localStorage.getItem('echo_ntp_trending');
    if (trendingValue !== 'true') {
      document.documentElement.classList.add('trending-hidden');
    }
  } catch (error) {
    window.__ECHO_NTP_BLANK_MODE__ = false;
  }
})();
