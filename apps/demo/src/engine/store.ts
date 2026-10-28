// データベースの中身と写真を、ブラウザの保存領域(IndexedDB)に置く。再読み込みしても続きから使える。
// 保存できない環境(プライベートブラウズなど)では、保存せずに動く。

import type { StoredObject } from './r2';

const DB_NAME = 'dr-demo';
const VERSION = 1;

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      if (!db.objectStoreNames.contains('media')) db.createObjectStore('media');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

let dbp: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  dbp ??= open().catch((e) => {
    dbp = null;
    throw e;
  });
  return dbp;
}

function tx<T>(store: 'kv' | 'media', mode: IDBTransactionMode, fn: (s: IDBObjectStore) => { readonly result: unknown } | void): Promise<T | undefined> {
  return db().then(
    (d) =>
      new Promise<T | undefined>((resolve, reject) => {
        const t = d.transaction(store, mode);
        const req = fn(t.objectStore(store));
        t.oncomplete = () => resolve(req ? (req.result as T) : undefined);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      }),
  );
}

export type SavedState = {
  /** 「翌日にする」で進めた日数 */
  dayOffset: number;
  /** 画面ごとのクッキー */
  jars: Record<string, [string, { value: string; expires: number | null }][]>;
  /** 初期データを作った時刻 */
  seededAt: number;
};

export const store = {
  async loadDb(): Promise<Uint8Array | null> {
    try {
      return ((await tx<Uint8Array>('kv', 'readonly', (s) => s.get('db'))) as Uint8Array | undefined) ?? null;
    } catch {
      return null;
    }
  },
  async saveDb(bytes: Uint8Array) {
    try {
      await tx('kv', 'readwrite', (s) => s.put(bytes, 'db'));
    } catch {
      // 保存できなくても動く
    }
  },
  async loadState(): Promise<SavedState | null> {
    try {
      return ((await tx<SavedState>('kv', 'readonly', (s) => s.get('state'))) as SavedState | undefined) ?? null;
    } catch {
      return null;
    }
  },
  async saveState(state: SavedState) {
    try {
      await tx('kv', 'readwrite', (s) => s.put(state, 'state'));
    } catch {
      // 保存できなくても動く
    }
  },
  async loadMedia(): Promise<[string, StoredObject][]> {
    try {
      const d = await db();
      return await new Promise((resolve, reject) => {
        const out: [string, StoredObject][] = [];
        const req = d.transaction('media', 'readonly').objectStore('media').openCursor();
        req.onsuccess = () => {
          const c = req.result;
          if (!c) return resolve(out);
          out.push([String(c.key), c.value as StoredObject]);
          c.continue();
        };
        req.onerror = () => reject(req.error);
      });
    } catch {
      return [];
    }
  },
  async putMedia(key: string, value: StoredObject | null) {
    try {
      await tx('media', 'readwrite', (s) => {
        if (value) s.put(value, key);
        else s.delete(key);
      });
    } catch {
      // 保存できなくても動く
    }
  },
  async clear() {
    try {
      await tx('kv', 'readwrite', (s) => s.clear());
      await tx('media', 'readwrite', (s) => s.clear());
    } catch {
      // 保存できなくても動く
    }
  },
};
