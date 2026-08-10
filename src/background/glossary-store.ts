import type { GlossaryCollection, GlossaryEntry, GlossaryMatch } from '../lib/contracts';
import { matchGlossaryEntries, type GlossaryLookupContext } from '../lib/glossary';

const DB_NAME = 'weave-glossary';
const DB_VERSION = 1;
const ENTRY_STORE = 'entries';
const COLLECTION_STORE = 'collections';

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(ENTRY_STORE)) {
        const entries = db.createObjectStore(ENTRY_STORE, { keyPath: 'id' });
        entries.createIndex('collectionId', 'collectionId', { unique: false });
        entries.createIndex('status', 'status', { unique: false });
      }
      if (!db.objectStoreNames.contains(COLLECTION_STORE)) db.createObjectStore(COLLECTION_STORE, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function listGlossaryEntries(filters: { collectionId?: string; status?: GlossaryEntry['status'] } = {}): Promise<GlossaryEntry[]> {
  const db = await openDatabase();
  const entries = await requestResult(db.transaction(ENTRY_STORE, 'readonly').objectStore(ENTRY_STORE).getAll()) as GlossaryEntry[];
  return entries
    .filter((entry) => !filters.collectionId || entry.collectionId === filters.collectionId)
    .filter((entry) => !filters.status || entry.status === filters.status)
    .sort((left, right) => right.priority - left.priority || left.source.localeCompare(right.source));
}

export async function putGlossaryEntry(entry: GlossaryEntry): Promise<void> {
  const db = await openDatabase();
  await requestResult(db.transaction(ENTRY_STORE, 'readwrite').objectStore(ENTRY_STORE).put(entry));
}

export async function deleteGlossaryEntry(id: string): Promise<void> {
  const db = await openDatabase();
  await requestResult(db.transaction(ENTRY_STORE, 'readwrite').objectStore(ENTRY_STORE).delete(id));
}

export async function importGlossaryEntries(entries: GlossaryEntry[]): Promise<{ imported: number }> {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(ENTRY_STORE, 'readwrite');
    for (const entry of entries) tx.objectStore(ENTRY_STORE).put(entry);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  return { imported: entries.length };
}

export async function listGlossaryCollections(): Promise<GlossaryCollection[]> {
  const db = await openDatabase();
  return requestResult(db.transaction(COLLECTION_STORE, 'readonly').objectStore(COLLECTION_STORE).getAll()) as Promise<GlossaryCollection[]>;
}

export async function putGlossaryCollection(collection: GlossaryCollection): Promise<void> {
  const db = await openDatabase();
  await requestResult(db.transaction(COLLECTION_STORE, 'readwrite').objectStore(COLLECTION_STORE).put(collection));
}

export async function deleteGlossaryCollection(id: string): Promise<void> {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([COLLECTION_STORE, ENTRY_STORE], 'readwrite');
    tx.objectStore(COLLECTION_STORE).delete(id);
    const cursor = tx.objectStore(ENTRY_STORE).index('collectionId').openCursor(IDBKeyRange.only(id));
    cursor.onsuccess = () => {
      if (!cursor.result) return;
      cursor.result.delete();
      cursor.result.continue();
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function lookupGlossary(text: string, context: GlossaryLookupContext): Promise<GlossaryMatch[]> {
  return matchGlossaryEntries(await listGlossaryEntries({ status: 'approved' }), text, context);
}

export async function storeSuggestedTerms(
  suggestions: Array<{ source: string; preferred: string; note?: string }>,
  context: GlossaryLookupContext,
): Promise<void> {
  if (!suggestions.length) return;
  const collections = await listGlossaryCollections();
  if (!collections.some((collection) => collection.id === 'suggestions')) {
    const now = Date.now();
    await putGlossaryCollection({
      id: 'suggestions', name: '待确认术语', description: '模型提出、尚未获得用户确认的候选词条', enabled: true, createdAt: now, updatedAt: now,
    });
  }
  const existing = await listGlossaryEntries();
  const existingSources = new Set(existing.map((entry) => entry.source.trim().toLocaleLowerCase()));
  const now = Date.now();
  const additions: GlossaryEntry[] = suggestions.slice(0, 10)
    .filter((item) => item.source.trim() && item.preferred.trim() && !existingSources.has(item.source.trim().toLocaleLowerCase()))
    .map((item) => ({
      id: crypto.randomUUID(),
      collectionId: 'suggestions',
      source: item.source.trim(),
      preferred: item.preferred.trim(),
      aliases: [],
      sourceLanguage: context.sourceLanguage,
      targetLanguage: context.targetLanguage,
      domain: context.domain ?? '',
      scope: 'domain',
      scopeValue: context.hostname,
      caseSensitive: false,
      priority: 0,
      note: item.note?.trim() ?? '',
      enabled: false,
      status: 'suggested',
      createdAt: now,
      updatedAt: now,
    }));
  await importGlossaryEntries(additions);
}
