(function(root) {
  'use strict';

  const INPUT_SELECTOR = [
    'input[type="email"]',
    'input[type="number"]',
    'input[type="password"]',
    'input[type="search"]',
    'input[type="tel"]',
    'input[type="text"]',
    'input[type="url"]',
    'input:not([type])',
    'textarea',
    'select',
    '[contenteditable="true"]',
    '[contenteditable=""]'
  ].join(',');

  function isEditable(element) {
    return Boolean(element?.matches?.(INPUT_SELECTOR) || element?.isContentEditable);
  }

  function isValidUrl(value) {
    return typeof value === 'string' && [
      /^https?:\/\//i,
      /^www\./i,
      /^[a-zA-Z0-9][-a-zA-Z0-9]*\.[a-zA-Z]{2,}/
    ].some(pattern => pattern.test(value));
  }

  function ensureProtocol(value) {
    return /^https?:\/\//i.test(value) ? value : `https://${value}`;
  }

  function nextZoom(currentZoom, direction, largeStep = true) {
    const rounded = Math.round(currentZoom * 100);
    const zoomingIn = direction === 'in';
    let next;
    if (largeStep && zoomingIn && rounded >= 175) {
      next = Math.round((currentZoom + 0.25) * 4) / 4;
    } else if (largeStep && !zoomingIn && rounded > 175) {
      next = Math.max(1.75, Math.round((currentZoom - 0.25) * 4) / 4);
    } else {
      next = Math.round((currentZoom + (zoomingIn ? 0.05 : -0.05)) * 20) / 20;
    }
    return Math.max(0.25, Math.min(5, next));
  }

  function dragDistance(start, end) {
    return Math.hypot(end.x - start.x, end.y - start.y);
  }

  function classifyDrop(dataTransfer) {
    const types = [...(dataTransfer?.types || [])];
    if (types.includes('text/uri-list')) {
      const url = dataTransfer.getData('URL') || dataTransfer.getData('text/uri-list');
      if (url && !/^javascript:/i.test(url)) return { type: 'url', value: url };
    }
    if (types.includes('text/plain')) {
      const text = dataTransfer.getData('text/plain')?.trim();
      if (!text || text.length >= 1000) return null;
      return isValidUrl(text)
        ? { type: 'url', value: ensureProtocol(text) }
        : { type: 'search', value: text };
    }
    return null;
  }

  root.EchoInputPolicy = Object.freeze({
    INPUT_SELECTOR,
    classifyDrop,
    dragDistance,
    ensureProtocol,
    isEditable,
    isValidUrl,
    nextZoom
  });
})(globalThis);