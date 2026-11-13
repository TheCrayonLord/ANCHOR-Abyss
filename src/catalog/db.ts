// Minimal IndexedDB wrapper. The catalog lives entirely in the browser.

const DB_NAME = 'anchor-abyss';
const VERSION = 1;
export const STORES = ['photos', 'originals', 'thumbs', 'collections', 'presets', 'exportPresets', 'kv'] as const;
export type StoreName = (typeof STORES)[number];

let dbp: Promise<IDBDatabase> | null = null;

export function openDB(): Promise<IDBDatabase> {
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, VERSION);
    r.onupgradeneeded = () => {
      const db = r.result;
      for (const s of STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s);
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
}

export async function get<T = any>(store: StoreName, key: string): Promise<T | undefined> {
  const db = await openDB();
  return req(db.transaction(store).objectStore(store).get(key));
}

export async function put(store: StoreName, key: string, value: any): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).put(value, key);
  await new Promise<void>((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error); });
}

export async function putMany(store: StoreName, entries: [string, any][]): Promise<void> {
  if (!entries.length) return;
  const db = await openDB();
  const tx = db.transaction(store, 'readwrite');
  const os = tx.objectStore(store);
  for (const [k, v] of entries) os.put(v, k);
  await new Promise<void>((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error); });
}

export async function del(store: StoreName, key: string): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).delete(key);
  await new Promise<void>((res) => { tx.oncomplete = () => res(); tx.onerror = () => res(); });
}

export async function all<T = any>(store: StoreName): Promise<T[]> {
  const db = await openDB();
  return req(db.transaction(store).objectStore(store).getAll());
}

export async function clearAll(): Promise<void> {
  const db = await openDB();
  const tx = db.transaction([...STORES], 'readwrite');
  for (const s of STORES) tx.objectStore(s).clear();
  await new Promise<void>((res) => { tx.oncomplete = () => res(); });
}

export async function estimate(): Promise<{ usage: number; quota: number }> {
  try { const e = await navigator.storage.estimate(); return { usage: e.usage || 0, quota: e.quota || 0 }; } catch { return { usage: 0, quota: 0 }; }
}
