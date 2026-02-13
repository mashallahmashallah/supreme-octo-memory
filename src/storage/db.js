const DB_NAME = 'tts-lab';
const DB_VERSION = 1;

const STORES = {
  history: { keyPath: 'id', autoIncrement: true },
  synthesisHistory: { keyPath: 'id', autoIncrement: true },
  modelCache: { keyPath: 'id' },
  modelManifests: { keyPath: 'id' },
  prompts: { keyPath: 'id', autoIncrement: true },
  benchmarkRuns: { keyPath: 'id', autoIncrement: true },
  downloads: { keyPath: 'id' }
};

let dbPromise;

export async function openDb() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = () => {
      const db = req.result;

      for (const [name, options] of Object.entries(STORES)) {
        if (!db.objectStoreNames.contains(name)) {
          db.createObjectStore(name, options);
        }
      }

      if (db.objectStoreNames.contains('history') && db.objectStoreNames.contains('synthesisHistory')) {
        const historyTx = req.transaction;
        const oldStore = historyTx.objectStore('history');
        const nextStore = historyTx.objectStore('synthesisHistory');
        oldStore.openCursor().onsuccess = (event) => {
          const cursor = event.target.result;
          if (!cursor) return;
          nextStore.put(cursor.value);
          cursor.continue();
        };
      }

      if (db.objectStoreNames.contains('models') && db.objectStoreNames.contains('modelCache')) {
        const tx = req.transaction;
        const oldStore = tx.objectStore('models');
        const nextStore = tx.objectStore('modelCache');
        oldStore.openCursor().onsuccess = (event) => {
          const cursor = event.target.result;
          if (!cursor) return;
          nextStore.put(cursor.value);
          cursor.continue();
        };
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  return dbPromise;
}

export async function put(storeName, value) {
  const db = await openDb();
  return runTransaction(db, storeName, 'readwrite', (store) => store.put(value));
}

export async function get(storeName, key) {
  const db = await openDb();
  return runTransaction(db, storeName, 'readonly', (store) => store.get(key));
}

export async function getAll(storeName) {
  const db = await openDb();
  return runTransaction(db, storeName, 'readonly', (store) => store.getAll());
}

export async function remove(storeName, key) {
  const db = await openDb();
  return runTransaction(db, storeName, 'readwrite', (store) => store.delete(key));
}

export async function clear(storeName) {
  const db = await openDb();
  return runTransaction(db, storeName, 'readwrite', (store) => store.clear());
}

function runTransaction(db, storeName, mode, operation) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    const req = operation(store);

    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error(`Transaction aborted: ${storeName}`));
  });
}
