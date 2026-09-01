(function(root) {
  'use strict';

  function create(options) {
    const chromeApi = options.chrome;
    const documentApi = options.document;
    const actions = options.actions;
    let initialized = false;

    function escapeHtml(value) {
      const element = documentApi.createElement('div');
      element.textContent = value;
      return element.innerHTML;
    }

    function init() {
      if (initialized) return;
      const form = documentApi.querySelector('.search-form');
      if (!form) return;
      initialized = true;
      const input = form.querySelector('.search-input');
      const searchBox = form.querySelector('.search-box');
      const suggestionContainer = documentApi.getElementById('searchSuggest');
      const clearButton = documentApi.getElementById('searchClear');
      let activeIndex = -1;
      let currentSuggestions = [];
      let lastSuggestions = [];
      let lastQuery = '';
      let debounceTimer = null;
      let composing = false;

      function updateClearButton() {
        clearButton?.classList.toggle('visible', input.value.length > 0);
      }

      function showSuggestions() {
        suggestionContainer?.classList.add('visible');
        searchBox?.classList.add('suggest-open');
      }

      function hideSuggestions(clearData) {
        suggestionContainer?.classList.remove('visible');
        searchBox?.classList.remove('suggest-open');
        activeIndex = -1;
        if (clearData) {
          currentSuggestions = [];
          lastSuggestions = [];
          lastQuery = '';
        }
      }

      function openSearch(query) {
        chromeApi.tabs.create({
          url: `https://www.bing.com/search?q=${encodeURIComponent(query)}`,
          active: true
        });
      }

      function renderSuggestions(suggestions) {
        if (!suggestionContainer) return;
        const icon = '<svg class="search-suggest-icon" viewBox="0 0 24 24" fill="none" stroke="#999" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>';
        suggestionContainer.innerHTML = suggestions.map((text, index) =>
          `<div class="search-suggest-item" data-index="${index}">${icon}<span class="search-suggest-text">${escapeHtml(text)}</span></div>`
        ).join('');
        suggestionContainer.querySelectorAll('.search-suggest-item').forEach(item => {
          item.addEventListener('mousedown', event => {
            event.preventDefault();
            const query = currentSuggestions[Number.parseInt(item.dataset.index, 10)];
            if (!query) return;
            input.value = query;
            hideSuggestions(true);
            openSearch(query);
          });
        });
      }

      function updateActiveItem() {
        suggestionContainer?.querySelectorAll('.search-suggest-item').forEach((item, index) => {
          item.classList.toggle('active', index === activeIndex);
        });
      }

      function fetchSuggestions(query) {
        chromeApi.runtime.sendMessage({ action: actions.BING_SUGGEST, query }, response => {
          if (chromeApi.runtime.lastError) {
            hideSuggestions(false);
            return;
          }
          const currentValue = input.value.trim();
          if (!currentValue) {
            hideSuggestions(true);
            return;
          }
          if (currentValue !== query) return;
          const suggestions = Array.isArray(response?.suggestions) ? response.suggestions : [];
          if (!suggestions.length) {
            hideSuggestions(false);
            return;
          }
          currentSuggestions = suggestions;
          lastSuggestions = suggestions;
          lastQuery = currentValue;
          activeIndex = -1;
          renderSuggestions(suggestions);
          showSuggestions();
        });
      }

      function handleInputChange() {
        const query = input.value.trim();
        input.dataset.originalQuery = query;
        if (!query) {
          hideSuggestions(true);
          return;
        }
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => fetchSuggestions(query), 200);
      }

      clearButton?.addEventListener('click', event => {
        event.preventDefault();
        input.value = '';
        updateClearButton();
        hideSuggestions(true);
        input.focus();
      });

      form.addEventListener('submit', event => {
        event.preventDefault();
        const query = activeIndex >= 0 && currentSuggestions[activeIndex]
          ? currentSuggestions[activeIndex]
          : input.value.trim();
        if (!query) return;
        hideSuggestions(true);
        openSearch(query);
      });

      input.addEventListener('compositionstart', () => { composing = true; });
      input.addEventListener('compositionend', () => {
        composing = false;
        handleInputChange();
      });
      input.addEventListener('input', () => {
        updateClearButton();
        if (!composing) handleInputChange();
      });
      input.addEventListener('keydown', event => {
        if (!suggestionContainer?.classList.contains('visible')) return;
        const itemCount = suggestionContainer.querySelectorAll('.search-suggest-item').length;
        if (!itemCount) return;
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          activeIndex = Math.min(activeIndex + 1, itemCount - 1);
          input.value = currentSuggestions[activeIndex] || input.value;
          updateClearButton();
          updateActiveItem();
        } else if (event.key === 'ArrowUp') {
          event.preventDefault();
          activeIndex -= 1;
          if (activeIndex < 0) {
            activeIndex = -1;
            input.value = input.dataset.originalQuery || '';
          } else {
            input.value = currentSuggestions[activeIndex] || input.value;
          }
          updateClearButton();
          updateActiveItem();
        } else if (event.key === 'Escape') {
          event.preventDefault();
          hideSuggestions(true);
          input.value = input.dataset.originalQuery || input.value;
        }
      });
      input.addEventListener('blur', () => setTimeout(() => hideSuggestions(false), 150));
      input.addEventListener('focus', () => {
        const query = input.value.trim();
        if (!query || !lastSuggestions.length) return;
        if (query === lastQuery) {
          currentSuggestions = lastSuggestions;
          activeIndex = -1;
          renderSuggestions(lastSuggestions);
          showSuggestions();
        } else {
          fetchSuggestions(query);
        }
      });
    }

    return Object.freeze({ init });
  }

  root.EchoNtpSearchController = Object.freeze({ create });
})(globalThis);