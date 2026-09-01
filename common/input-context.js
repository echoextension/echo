(function(root) {
  'use strict';

  const keys = ['mouseGesture', 'fineZoom', 'fineZoomLargeStep', 'tabSwitchKey', 'superDrag'];
  const mode = root.EchoInputConfig?.mode === 'demo' ? 'demo' : 'settings';
  const values = Object.fromEntries(keys.map(key => [key, mode === 'demo']));

  const ready = mode === 'demo'
    ? Promise.resolve(values)
    : root.chrome.storage.sync.get(root.EchoSettings.getDefaults(keys)).then(stored => {
        for (const key of keys) values[key] = root.EchoSettings.isValid(key, stored[key])
          ? stored[key]
          : root.EchoSettings.getDefault(key);
        return values;
      });

  if (mode !== 'demo') {
    root.chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'sync') return;
      for (const key of keys) {
        if (changes[key] && root.EchoSettings.isValid(key, changes[key].newValue)) {
          values[key] = changes[key].newValue;
        }
      }
    });
  }

  root.EchoInputContext = Object.freeze({
    mode,
    ready,
    get: key => values[key],
    isEnabled: key => mode === 'demo' || values[key] === true
  });
})(globalThis);