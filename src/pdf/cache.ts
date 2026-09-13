import type { PdfSettings } from '../lib/contracts';

export interface PdfCacheRecord<T = unknown> {
  key: string; documentId: string; value: T; createdAt: number; accessedAt: number; expiresAt: number; bytes: number;
}
export function evictedKeys(records: PdfCacheRecord[], now: number, days: number, maxBytes: number): string[] {
  const removed = records.filter((item) => item.expiresAt <= now || item.createdAt + days * 86400000 <= now).map((item) => item.key);
  const live = records.filter((item) => !removed.includes(item.key)).sort((a, b) => b.accessedAt - a.accessedAt);
  let used = 0;
  for (const item of live) { used += item.bytes; if (used > maxBytes) removed.push(item.key); }
  return removed;
}
function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('weave-pdf-cache', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('records', { keyPath: 'key' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function transaction<T>(operation: (store: IDBObjectStore, done: (value: T) => void) => void): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction('records', 'readwrite');
      let value: T;
      tx.oncomplete = () => resolve(value);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error('PDF 缓存事务取消'));
      operation(tx.objectStore('records'), (result) => { value = result; });
    });
  } finally { db.close(); }
}

/** Images/results only; never the original PDF, API keys or request prompts. */
export class PdfCache {
  private memory = new Map<string, PdfCacheRecord>();
  async prune(policy: PdfSettings): Promise<void> {
    const now = Date.now();
    for (const key of evictedKeys([...this.memory.values()], now, policy.cacheDays, policy.cacheMaxMb * 1048576)) this.memory.delete(key);
    await transaction<void>((store, done) => {
      const request = store.getAll();
      request.onsuccess = () => {
        for (const key of evictedKeys(request.result as PdfCacheRecord[], now, policy.cacheDays, policy.cacheMaxMb * 1048576)) store.delete(key);
        done();
      };
    });
  }
  async get<T>(key: string, policy: PdfSettings): Promise<T | undefined> {
    const now = Date.now();
    if (policy.cachePersistence === 'session') {
      const record = this.memory.get(key);
      if (!record || record.expiresAt <= now || record.createdAt + policy.cacheDays * 86400000 <= now) { this.memory.delete(key); return undefined; }
      record.accessedAt = now;
      return record.value as T;
    }
    return transaction<T | undefined>((store, done) => {
      const request = store.get(key);
      request.onsuccess = () => {
        const record = request.result as PdfCacheRecord<T> | undefined;
        if (!record || record.expiresAt <= now || record.createdAt + policy.cacheDays * 86400000 <= now) { store.delete(key); done(undefined); }
        else { store.put({ ...record, accessedAt: now }); done(record.value); }
      };
    });
  }
  async put<T>(key: string, documentId: string, value: T, policy: PdfSettings): Promise<void> {
    const bytes = new TextEncoder().encode(JSON.stringify(value)).byteLength;
    if (bytes > policy.cacheMaxMb * 1048576) return;
    const now = Date.now();
    const record: PdfCacheRecord<T> = { key, documentId, value, createdAt: now, accessedAt: now, expiresAt: now + policy.cacheDays * 86400000, bytes };
    if (policy.cachePersistence === 'session') this.memory.set(key, record);
    else await transaction<void>((store, done) => { store.put(record); done(); });
    await this.prune(policy);
  }
  release(): void { this.memory.clear(); }
  async latestImage(documentId: string, policy: PdfSettings): Promise<string | undefined> {
    const choose = (records: PdfCacheRecord[]): string | undefined => {
      const now = Date.now();
      const found = records.filter((item) => item.documentId === documentId && item.key.startsWith('image:')
        && typeof item.value === 'string' && item.expiresAt > now && item.createdAt + policy.cacheDays * 86400000 > now)
        .sort((a, b) => b.accessedAt - a.accessedAt)[0];
      return found?.value as string | undefined;
    };
    if (policy.cachePersistence === 'session') return choose([...this.memory.values()]);
    return transaction<string | undefined>((store, done) => { const request = store.getAll(); request.onsuccess = () => done(choose(request.result)); });
  }
  async clear(documentId?: string): Promise<void> {
    for (const [key, value] of this.memory) if (!documentId || value.documentId === documentId) this.memory.delete(key);
    await transaction<void>((store, done) => {
      const request = store.openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) { done(); return; }
        if (!documentId || (cursor.value as PdfCacheRecord).documentId === documentId) cursor.delete();
        cursor.continue();
      };
    });
  }
}
