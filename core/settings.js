(function(root) {
  'use strict';

  const definitions = {
    mouseGesture: { area: 'sync', default: true, type: 'boolean' },
    bossKey: { area: 'sync', default: true, type: 'boolean' },
    quickMute: { area: 'sync', default: true, type: 'boolean' },
    fineZoom: { area: 'sync', default: true, type: 'boolean' },
    fineZoomLargeStep: { area: 'sync', default: true, type: 'boolean' },
    superDrag: { area: 'sync', default: true, type: 'boolean' },
    superDragActivate: { area: 'sync', default: false, type: 'boolean' },
    tabSwitchKey: { area: 'sync', default: true, type: 'boolean' },
    quickSaveImage: { area: 'sync', default: true, type: 'boolean' },
    quickSaveImageDateFolder: { area: 'sync', default: false, type: 'boolean' },
    floatingSearchBox: { area: 'sync', default: true, type: 'boolean' },
    floatingSearchBoxAlwaysShow: { area: 'sync', default: false, type: 'boolean' },
    floatingSearchBoxTrending: { area: 'sync', default: false, type: 'boolean' },
    floatingSearchBoxFollowZoom: { area: 'sync', default: false, type: 'boolean' },
    biliTool: { area: 'sync', default: true, type: 'boolean' },
    biliFeedHistory: { area: 'sync', default: true, type: 'boolean' },
    closeTabActivate: { area: 'sync', default: 'left', enum: ['left', 'right'] },
    newTabPosition: { area: 'sync', default: 'afterCurrent', enum: ['afterCurrent', 'atEnd'] },
    newTabOrder: { area: 'sync', default: 'newest', enum: ['newest', 'ordered'] },
    applyToPlusButton: { area: 'sync', default: false, type: 'boolean' },
    biliToolPosition: {
      area: 'sync',
      default: { left: '0px', top: '50%' },
      validate: value => Boolean(value)
        && typeof value === 'object'
        && !Array.isArray(value)
        && (value.topRatio === undefined
          || (Number.isFinite(value.topRatio) && value.topRatio >= 0 && value.topRatio <= 1))
        && (value.top === undefined || typeof value.top === 'string')
    },
    customBookmarkBar: { area: 'sync', default: false, type: 'boolean', deprecated: true },
    bookmarkBarPinned: { area: 'sync', default: true, type: 'boolean', deprecated: true },
    bookmarkOpenInNewTab: { area: 'sync', default: false, type: 'boolean', deprecated: true },
    bookmarkBarDensity: {
      area: 'sync',
      default: 'default',
      enum: ['compact', 'default', 'comfortable', 'spacious'],
      deprecated: true
    },
    searchEngine: {
      area: 'sync',
      default: 'https://www.bing.com/search?q=',
      type: 'string',
      deprecated: true
    },
    zhihuBlocklistFilter: { area: 'local', default: false, type: 'boolean', legacySync: true },
    zhihuBlocklistAuthorized: { area: 'local', default: false, type: 'boolean' }
  };

  function clone(value) {
    if (value === undefined || value === null || typeof value !== 'object') return value;
    return JSON.parse(JSON.stringify(value));
  }

  function getDefinition(key) {
    return definitions[key] || null;
  }

  function getDefault(key) {
    const definition = getDefinition(key);
    return definition ? clone(definition.default) : undefined;
  }

  function getAreaDefaults(area, options = {}) {
    const includeDeprecated = options.includeDeprecated !== false;
    return Object.fromEntries(Object.entries(definitions)
      .filter(([, definition]) => definition.area === area && (includeDeprecated || !definition.deprecated))
      .map(([key, definition]) => [key, clone(definition.default)]));
  }

  function getDefaults(keys) {
    return Object.fromEntries(keys
      .filter(key => definitions[key])
      .map(key => [key, getDefault(key)]));
  }

  function isValid(key, value) {
    const definition = getDefinition(key);
    if (!definition) return false;
    if (definition.enum) return definition.enum.includes(value);
    if (definition.validate) return Boolean(definition.validate(value));
    return typeof value === definition.type;
  }

  function sanitize(area, values, options = {}) {
    const includeDeprecated = options.includeDeprecated !== false;
    const sanitized = {};
    const rejected = {};
    for (const [key, value] of Object.entries(values || {})) {
      const definition = getDefinition(key);
      if (!definition || definition.area !== area || (!includeDeprecated && definition.deprecated)) continue;
      if (isValid(key, value)) sanitized[key] = clone(value);
      else rejected[key] = value;
    }
    return { sanitized, rejected };
  }

  root.EchoSettings = Object.freeze({
    definitions: Object.freeze(definitions),
    getAreaDefaults,
    getDefault,
    getDefaults,
    getDefinition,
    isValid,
    sanitize
  });
})(globalThis);