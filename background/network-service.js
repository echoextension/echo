(function(root) {
  'use strict';

  function create(options = {}) {
    const fetchImpl = options.fetch || root.fetch;

    async function proxyJson(url) {
      try {
        const response = await fetchImpl(url, {
          method: 'GET',
          credentials: 'omit',
          headers: { Accept: 'application/json' }
        });
        if (!response.ok) return { success: false, error: `HTTP ${response.status}` };
        return { success: true, data: await response.json() };
      } catch (error) {
        return { success: false, error: error.message };
      }
    }

    async function bingSuggest(query) {
      if (!query) return { suggestions: [] };
      try {
        const response = await fetchImpl(
          `https://api.bing.com/osjson.aspx?query=${encodeURIComponent(query)}`,
          { method: 'GET', credentials: 'omit' }
        );
        if (!response.ok) return { suggestions: [] };
        const data = await response.json();
        const suggestions = Array.isArray(data) && Array.isArray(data[1]) ? data[1] : [];
        return { suggestions: suggestions.slice(0, 8) };
      } catch {
        return { suggestions: [] };
      }
    }

    return Object.freeze({ bingSuggest, proxyJson });
  }

  root.EchoBackgroundNetworkService = Object.freeze({ create });
})(globalThis);