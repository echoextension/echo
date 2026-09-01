(function(root) {
  'use strict';

  const DB_NAME = 'echo_wallpaper_cache';
  const STORE_NAME = 'images';

  function create(indexedDb, options = {}) {
    const now = options.now || Date.now;
    let databasePromise = null;

    function open() {
      if (databasePromise) return databasePromise;
      databasePromise = new Promise((resolve, reject) => {
        const request = indexedDb.open(DB_NAME, 1);
        request.onerror = () => {
          databasePromise = null;
          reject(request.error);
        };
        request.onsuccess = () => {
          const database = request.result;
          database.onversionchange = () => {
            database.close();
            databasePromise = null;
          };
          resolve(database);
        };
        request.onupgradeneeded = event => {
          const database = event.target.result;
          if (!database.objectStoreNames.contains(STORE_NAME)) {
            database.createObjectStore(STORE_NAME, { keyPath: 'url' });
          }
        };
      });
      return databasePromise;
    }

    async function get(url) {
      try {
        const database = await open();
        return await new Promise(resolve => {
          const request = database.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(url);
          request.onsuccess = () => resolve(request.result?.blob || null);
          request.onerror = () => resolve(null);
        });
      } catch {
        return null;
      }
    }

    async function put(url, blob) {
      try {
        const database = await open();
        return await new Promise(resolve => {
          const transaction = database.transaction(STORE_NAME, 'readwrite');
          transaction.objectStore(STORE_NAME).put({ url, blob, timestamp: now() });
          transaction.oncomplete = () => resolve(true);
          transaction.onerror = () => resolve(false);
          transaction.onabort = () => resolve(false);
        });
      } catch {
        return false;
      }
    }

    async function remove(...urls) {
      try {
        const database = await open();
        return await new Promise(resolve => {
          const transaction = database.transaction(STORE_NAME, 'readwrite');
          const store = transaction.objectStore(STORE_NAME);
          urls.forEach(url => store.delete(url));
          transaction.oncomplete = () => resolve(true);
          transaction.onerror = () => resolve(false);
          transaction.onabort = () => resolve(false);
        });
      } catch {
        return false;
      }
    }

    async function cleanExpired(maxAgeMs = 7 * 24 * 60 * 60 * 1000) {
      try {
        const database = await open();
        const cutoff = now() - maxAgeMs;
        return await new Promise(resolve => {
          let removed = 0;
          const transaction = database.transaction(STORE_NAME, 'readwrite');
          const request = transaction.objectStore(STORE_NAME).openCursor();
          request.onsuccess = () => {
            const cursor = request.result;
            if (!cursor) return;
            const item = cursor.value;
            if (item.url && !item.url.startsWith('custom:') && !item.url.startsWith('custom_thumb:')
                && item.timestamp < cutoff) {
              cursor.delete();
              removed += 1;
            }
            cursor.continue();
          };
          transaction.oncomplete = () => resolve(removed);
          transaction.onerror = () => resolve(removed);
          transaction.onabort = () => resolve(removed);
        });
      } catch {
        return 0;
      }
    }

    return Object.freeze({ cleanExpired, get, open, put, remove });
  }

  root.EchoNtpWallpaperCache = Object.freeze({ DB_NAME, STORE_NAME, create });
})(globalThis);