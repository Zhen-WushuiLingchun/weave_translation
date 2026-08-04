import type { TranslationResult } from '../lib/contracts';

const DB_NAME = 'weave-translation-cache';
const STORE_NAME = 'translations';

interface CacheRecord {
  key: string;
  host: string;
  value: TranslationResult;
  createdAt: number;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'key' });
        store.createIndex('host', 'host', { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function cacheGet(key: string): Promise<TranslationResult | undefined> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(key);
    request.onsuccess = () => resolve((request.result as CacheRecord | undefined)?.value);
    request.onerror = () => reject(request.error);
  });
}

export async function cachePut(key: string, host: string, value: TranslationResult): Promise<void> {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const request = db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).put({
      key,
      host,
      value,
      createdAt: Date.now(),
    } satisfies CacheRecord);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function cacheClear(scope: 'all' | 'site', host?: string): Promise<void> {
  const db = await openDatabase();
  if (scope === 'all') {
    await new Promise<void>((resolve, reject) => {
      const request = db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).clear();
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
    return;
  }
  if (!host) return;
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const cursor = tx.objectStore(STORE_NAME).index('host').openCursor(IDBKeyRange.only(host));
    cursor.onsuccess = () => {
      const current = cursor.result;
      if (current) {
        current.delete();
        current.continue();
      }
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
