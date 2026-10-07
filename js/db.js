// db.js — 이 기기의 보관함(IndexedDB). 기록의 정본은 저장소이고, 여기는 사본과 대기열이다.
//   kv     : 기록(lib-local: 이 기기에만 적은 것 · lib: 저장소와 맞추는 사본 · viewer-cache: 받아 둔 공개 기록), local-base, 저장소에서 지울 사진 목록(pending-deletes)
//   photos : 줄인 사진(Blob). 키는 "<bookId>/<slot>", 이 기기에만 적은 기록의 것은 "local:<bookId>/<slot>"

import { DB_NAME } from './config.js';

const DB_VERSION = 1;
let dbPromise = null;
const memory = { kv: new Map(), photos: new Map() };   // IndexedDB를 못 쓰는 환경용

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    let req;
    try { req = indexedDB.open(DB_NAME, DB_VERSION); } catch { resolve(null); return; }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      if (!db.objectStoreNames.contains('photos')) db.createObjectStore('photos');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
  return dbPromise;
}

async function run(store, mode, fn) {
  const db = await open();
  if (!db) { const r = fn(null); return r ? r.result : undefined; }
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const req = fn(tx.objectStore(store));
    tx.oncomplete = () => resolve(req ? req.result : undefined);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function api(store) {
  return {
    get: (key) => run(store, 'readonly', (s) => (s ? s.get(key) : { result: memory[store].get(key) })),
    set: (key, value) => run(store, 'readwrite', (s) => (s ? s.put(value, key) : (memory[store].set(key, value), null))),
    del: (key) => run(store, 'readwrite', (s) => (s ? s.delete(key) : (memory[store].delete(key), null))),
    keys: () => run(store, 'readonly', (s) => (s ? s.getAllKeys() : { result: [...memory[store].keys()] })),
    clear: () => run(store, 'readwrite', (s) => (s ? s.clear() : (memory[store].clear(), null))),
  };
}

/** 이 기기의 보관함(IndexedDB)을 실제로 쓸 수 있는지. false면 창을 닫을 때 사본이 사라진다. */
export const storageReady = () => open().then(Boolean);

export const kv = api('kv');
export const photoStore = api('photos');
