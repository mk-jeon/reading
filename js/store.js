// store.js — 앱의 상태와 기록(library)을 바꾸는 유일한 통로.
// 화면은 여기의 함수로만 기록을 바꾸고, 바뀌면 subscribe()로 알림을 받는다.
//
// 모드와 이 기기의 보관 칸(서로 섞이지 않는다)
//   local  : 이 기기에 기록(기본). 토큰 없이 바로 쓴다. 저장소로 올라가지 않는다. → kv 'lib-local', 사진 키 'local:…'
//   owner  : 저장소 연결. 이 기기에 사본을 두고 저장소(data 브랜치)와 맞춘다.   → kv 'lib'
//   viewer : 구경. 저장소에 공개된 기록을 읽기만 한다.                        → kv 'viewer-cache'
//
// 처음 연 기기는 설정 없이 local로 시작한다. 다만 이 기기에 적은 것이 없고 공개된 기록이 이미 있으면 그 기록을 보여 준다(viewer).

import { kv, photoStore } from './db.js';
import { seedLibrary } from './seed.js';
import { DB_NAME, LS, lsGet, lsSet, MAX_READING, PHOTO_SLOTS, SCHEMA } from './config.js';

export const state = {
  mode: 'viewer',
  lib: null,
  sync: { status: 'idle', error: null, lastAt: null },
  ready: false,
  fetching: false,                         // 구경 모드에서 공개된 기록을 받는 중인지
};

const KEY = { owner: 'lib', local: 'lib-local', viewer: 'viewer-cache' };
const keyOf = (mode = state.mode) => KEY[mode] || KEY.viewer;

const subs = new Set();
let afterCommit = null;                    // sync.js가 건다: 기록이 바뀌면 올릴 차례를 잡는다
export let lastReason = '';

// 기록이 통째로 바뀐 횟수(모드 전환 · 사본 지우기 · 구경 기록 받기 · 다른 창의 저장).
// 맞추기(sync)는 시작할 때의 값을 쥐고 있다가, 달라졌으면 올리지 않고 그만둔다.
let epoch = 0;
export const libEpoch = () => epoch;

export function subscribe(fn) { subs.add(fn); return () => subs.delete(fn); }
export function emit(type, detail = {}) { for (const fn of [...subs]) fn(type, detail); }
export function onCommit(fn) { afterCommit = fn; }

export const canEdit = () => state.mode !== 'viewer';
export const now = () => new Date().toISOString();
export const uid = (prefix = 'b') => `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

// 책·블록·연혁 줄의 id로 받아들이는 모양. 저장소 경로와 선택자에 쓰이므로 좁게 잡는다.
// 객체에 원래 들어 있는 이름(constructor, toString …)은 받지 않는다.
const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
export const safeId = (id) => typeof id === 'string' && SAFE_ID_RE.test(id) && !(id in Object.prototype);

/** 지금 시각. 다만 prev보다는 반드시 뒤다. 기기 시계가 늦거나, 앞선 값이 섞여 있어도 방금 고친 쪽이 이긴다. */
export function stampAfter(prev) {
  const t = Date.now();
  const p = prev ? new Date(prev).getTime() : NaN;
  return new Date(Number.isNaN(p) ? t : Math.max(t, p + 1)).toISOString();
}

// ── 읽어 들인 기록 다듬기 ────────────────────────────────
const clip = (v, n) => (typeof v === 'string' || typeof v === 'number' ? String(v) : '').slice(0, n);
const isObj = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const intIn = (v, min, max, fallback) => (Number.isFinite(v) ? Math.max(min, Math.min(max, Math.round(v))) : fallback);
const DAY = 86400000;

/** 날짜를 한 가지 모양(UTC ISO)으로 맞춘다. 글자 순서가 곧 시간 순서가 되게 하려는 것이다. */
function isoOr(v, fallback) {
  if (typeof v !== 'string' || v.length > 40) return fallback;
  const t = new Date(v).getTime();
  return Number.isNaN(t) ? fallback : new Date(t).toISOString();
}
/** 고친 시각. 하루 넘게 앞선 값은 지금으로 당긴다(그대로 두면 그 뒤의 어떤 수정도 이기지 못한다). */
function stampOr(v, fallback) {
  const iso = isoOr(v, null);
  if (!iso) return fallback;
  return new Date(iso).getTime() > Date.now() + DAY ? now() : iso;
}

export const MAX_PAGES = 20000;
export const MAX_BLOCKS = 400;
const BLOCK_TYPES = new Set(['p', 'h1', 'h2', 'h3', 'bullet', 'number', 'todo', 'quote', 'callout', 'toggle', 'divider']);
const TONES = new Set(['gray', 'blue', 'green', 'yellow', 'red']);
const STATUSES = new Set(['queue', 'reading', 'done']);

function cleanReview(r, fallbackAt) {
  if (!isObj(r)) return null;
  const p = isObj(r.props) ? r.props : {};
  const seen = new Set();
  const blocks = (Array.isArray(r.blocks) ? r.blocks : []).filter(isObj).slice(0, MAX_BLOCKS).map((k) => {
    let id = safeId(k.id) && !seen.has(k.id) ? k.id : uid('k');
    while (seen.has(id)) id = uid('k');
    seen.add(id);
    const type = BLOCK_TYPES.has(k.type) ? k.type : 'p';
    const out = { id, type, text: type === 'divider' ? '' : clip(k.text, 4000) };
    if (type === 'todo') out.checked = Boolean(k.checked);
    if (type === 'callout') out.tone = TONES.has(k.tone) ? k.tone : 'gray';
    if (type === 'toggle') out.body = clip(k.body, 4000);
    if (k.seed === true) out.seed = true;
    if (typeof k.ph === 'string' && k.ph) out.ph = clip(k.ph, 80);
    return out;
  });
  return {
    props: {
      rating: intIn(p.rating, 0, 5, 0),
      oneLine: clip(p.oneLine, 400), before: clip(p.before, 400), after: clip(p.after, 400),
      tags: (Array.isArray(p.tags) ? p.tags : []).filter((t) => typeof t === 'string').map((t) => clip(t.trim(), 40).trim()).filter(Boolean).slice(0, 8),
    },
    blocks,
    updatedAt: stampOr(r.updatedAt, fallbackAt),
  };
}

function cleanPhotos(photos) {
  const out = {};
  if (!isObj(photos)) return out;
  for (const { key } of PHOTO_SLOTS) {
    const m = photos[key];
    if (!isObj(m) || !Number.isFinite(m.v) || Math.round(m.v) < 1) continue;
    out[key] = { v: Math.round(m.v), w: intIn(m.w, 0, 20000, 0), h: intIn(m.h, 0, 20000, 0), bytes: intIn(m.bytes, 0, 50 * 1024 * 1024, 0), remote: m.remote === true };
  }
  return out;
}

/**
 * 빠진 칸을 채우고 모양이 어긋난 값을 걸러, 옛 기록이나 손으로 고친 기록도 읽히게 한다.
 * 저장소에서 받은 기록과 이 기기의 사본은 모두 여기를 거친 뒤에만 화면과 저장으로 간다.
 * 두 번 거쳐도 결과가 같아야 한다(같지 않으면 맞출 때마다 다시 올리게 된다).
 */
export function normalize(lib) {
  if (!isObj(lib)) return seedLibrary();
  const at = stampOr(lib.updatedAt, now());
  const out = { schema: SCHEMA, updatedAt: at, seq: intIn(lib.seq, 0, 1e6, 0), books: {}, tombstones: {} };

  if (isObj(lib.tombstones)) {
    for (const [id, when] of Object.entries(lib.tombstones)) {
      const stamp = stampOr(when, null);
      if (safeId(id) && stamp) out.tombstones[id] = stamp;
    }
  }

  if (isObj(lib.books)) {
    for (const [id, b] of Object.entries(lib.books)) {
      if (!safeId(id) || !isObj(b)) continue;
      const totalPages = Number.isFinite(b.totalPages) && Math.round(b.totalPages) >= 1 ? Math.min(MAX_PAGES, Math.round(b.totalPages)) : null;
      const addedAt = isoOr(b.addedAt, at);
      const status = STATUSES.has(b.status) ? b.status : 'queue';
      const page = intIn(b.page, 0, totalPages || MAX_PAGES, 0);
      out.books[id] = {
        id,
        no: Number.isInteger(b.no) && b.no > 0 ? b.no : null,
        title: clip(b.title, 200).trim() || '제목 없음',
        author: clip(b.author, 120), publisher: clip(b.publisher, 120), tag: clip(b.tag, 40), rival: clip(b.rival, 200),
        totalPages, status,
        addedAt,
        startedAt: isoOr(b.startedAt, null),
        finishedAt: isoOr(b.finishedAt, null),
        updatedAt: stampOr(b.updatedAt, addedAt),
        photos: cleanPhotos(b.photos),
        page,
        logs: (Array.isArray(b.logs) ? b.logs : []).filter((l) => isObj(l) && Number.isFinite(l.page)).slice(-2000).map((l) => ({
          id: safeId(l.id) ? l.id : uid('l'),
          at: isoOr(l.at, addedAt), from: intIn(l.from, 0, MAX_PAGES, 0), page: intIn(l.page, 0, MAX_PAGES, 0), memo: clip(l.memo, 2000),
        })),
        review: cleanReview(b.review, at),
      };
    }
  }

  // 두 기기에서 따로 붙여 겹친 도감 번호는, 먼저 읽기 시작한 쪽이 갖고 나머지는 새 번호를 받는다.
  const numbered = Object.values(out.books).filter((b) => b.no)
    .sort((x, y) => x.no - y.no || String(x.startedAt || x.addedAt).localeCompare(String(y.startedAt || y.addedAt)) || x.id.localeCompare(y.id));
  for (const b of numbered) out.seq = Math.max(out.seq, b.no);
  const taken = new Set();
  for (const b of numbered) {
    if (taken.has(b.no)) { out.seq += 1; b.no = out.seq; }
    taken.add(b.no);
  }

  const hist = isObj(lib.history) ? lib.history : {};
  const seenEntry = new Set();
  out.history = {
    entries: (Array.isArray(hist.entries) ? hist.entries : [])
      .filter((e) => isObj(e) && safeId(e.id) && isoOr(e.date, null) && !seenEntry.has(e.id) && seenEntry.add(e.id))
      .slice(-1000)
      .map((e) => {
        const kind = e.kind === 'review' ? 'review' : 'milestone';
        const entry = { id: e.id, kind, date: isoOr(e.date, at), title: clip(e.title, 200), line: clip(e.line, 300), createdAt: isoOr(e.createdAt, at) };
        if (kind === 'review') {
          entry.bookId = typeof e.bookId === 'string' ? e.bookId : '';
          entry.shift = clip(e.shift, 300);
          entry.engine = e.engine === 'claude' ? 'claude' : 'self';
          entry.hash = clip(e.hash, 16);
        }
        return entry;
      })
      .filter((e) => e.kind !== 'review' || Object.hasOwn(out.books, e.bookId)),
    analyzed: {},
    summary: clip(hist.summary, 1000),
    checkedAt: isoOr(hist.checkedAt, null),
    updatedAt: stampOr(hist.updatedAt, at),
  };
  if (isObj(hist.analyzed)) {
    for (const [id, hash] of Object.entries(hist.analyzed)) {
      if (Object.hasOwn(out.books, id) && typeof hash === 'string') out.history.analyzed[id] = clip(hash, 16);
    }
  }

  const ins = isObj(lib.insight) ? lib.insight : {};
  out.insight = {
    by: ins.by === 'claude' ? 'claude' : clip(ins.by, 40),
    at: stampOr(ins.at, ''),
    lines: (Array.isArray(ins.lines) ? ins.lines : []).filter((l) => typeof l === 'string').map((l) => clip(l.trim(), 400).trim()).filter(Boolean).slice(0, 12),
  };
  return out;
}

// ── 이 기기의 보관함 ─────────────────────────────────────
/** 브라우저가 이 기기의 보관함을 마음대로 비우지 않게 청한다(이 기기의 기록·올리기 전 사진을 지키려는 것). 한 번만 청한다. */
let persistAsked = false;
function askPersist() {
  if (persistAsked) return;
  persistAsked = true;
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {}); } catch { /* 지원하지 않는 브라우저 */ }
}

// 같은 기기에 창이 둘 열려 있을 때, 한 창이 저장하면 다른 창이 그 사본을 다시 읽는다.
// (창마다 기록 전체를 쥐고 있어서, 모르는 채로 저장하면 서로의 수정을 지운다.)
let channel = null;
try { channel = new BroadcastChannel(DB_NAME); } catch { /* 없는 브라우저에서는 창 하나로만 쓴다 */ }
function announce(key) { if (channel) { try { channel.postMessage({ key }); } catch { /* 닫힌 채널 */ } } }
if (channel) {
  channel.onmessage = async (e) => {
    const key = e.data && e.data.key;
    if (!state.ready || key !== keyOf()) return;
    const stored = await kv.get(key).catch(() => null);
    if (!stored || keyOf() !== key) return;
    epoch += 1;
    state.lib = normalize(stored);
    emit('lib', { reason: 'sync' });
  };
}

async function persist(lib, key) {
  try {
    await kv.set(key, lib);
    announce(key);
    return true;
  } catch {
    if (key !== KEY.viewer) emit('warn', { message: '이 기기에 사본을 저장하지 못했습니다. 저장 공간을 확인해 주세요.' });
    return false;
  }
}

/** 사진 원본을 두는 키. 이 기기에만 적은 기록(local)의 사진은 따로 둔다. */
export const photoKey = (bookId, slot, mode = state.mode) => (mode === 'local' ? `local:${bookId}/${slot}` : `${bookId}/${slot}`);

export async function boot() {
  const token = lsGet(LS.token);
  const pref = lsGet(LS.mode);
  if (token) state.mode = 'owner';
  else if (pref === 'local' || pref === 'viewer') state.mode = pref;
  else {
    // 모드를 고른 적 없는 기기: 설정 없이 바로 기록한다(local).
    // 이 기기에 적은 것이 없고 공개된 기록을 받아 둔 적이 있을 때만 그 기록을 보여 준다(viewer).
    const seen = await kv.get(KEY.viewer).catch(() => null);
    state.mode = seen && !(await trialInfo()).changed ? 'viewer' : 'local';
  }
  const stored = await kv.get(keyOf()).catch(() => null);
  state.lib = normalize(stored || seedLibrary());
  state.ready = true;
  if (state.mode === 'owner' || pref === 'local') askPersist();
}

/**
 * 모드를 바꾼다.
 *   viewer : 마지막으로 받아 둔 공개 기록(없으면 첫 상태)을 보인다.
 *   local  : 이 기기에 적던 기록이 있으면 그것을, 없으면 지금 보이던 기록의 사본에서 시작한다.
 *   owner  : start가 있으면 그것에서, 없으면 이 기기에 두었던 기록 사본(없으면 지금 보이던 기록)에서 시작한다.
 * remember가 거짓이면 고른 것으로 치지 않는다(앱이 스스로 바꿀 때. 다음에 열 때 다시 정한다).
 */
export async function setMode(mode, { start = null, remember = true } = {}) {
  if (mode === state.mode && !start) return;
  let lib;
  if (mode === 'viewer') {
    lib = normalize((await kv.get(KEY.viewer).catch(() => null)) || seedLibrary());
  } else if (mode === 'local') {
    const mine = await kv.get(KEY.local);
    lib = normalize(mine || structuredClone(state.lib));
    if (!mine) await kv.set('local-base', lib.updatedAt);
    await kv.set(KEY.local, lib);
  } else {
    const mine = start || (await kv.get(KEY.owner));
    lib = normalize(structuredClone(mine || state.lib));
    await kv.set(KEY.owner, lib);
  }
  if (remember) lsSet(LS.mode, mode === 'owner' ? null : mode);
  if (mode !== 'viewer') askPersist();
  epoch += 1;
  state.lib = lib;
  state.mode = mode;
  emit('mode');
  emit('lib', { reason: 'mode' });
}

/** 이 기기에만 적은 기록(local 모드). changed: 첫 상태에서 무엇이든 고쳤는지. */
export async function trialInfo() {
  const lib = await kv.get(KEY.local).catch(() => null);
  if (!lib) return { exists: false, changed: false, lib: null };
  const base = await kv.get('local-base').catch(() => null);
  return { exists: true, changed: lib.updatedAt !== base, lib };
}

/** 이 기기에 적은 기록을 저장소의 첫 기록으로 삼을 때: local 모드의 사진을 연결한 기록의 자리로 옮긴다. */
export async function adoptTrialPhotos() {
  for (const key of await photoStore.keys()) {
    if (typeof key !== 'string' || !key.startsWith('local:')) continue;
    const rec = await photoStore.get(key);
    if (rec) await photoStore.set(key.slice('local:'.length), rec);
    await photoStore.del(key);
  }
}

/** 이 기기에만 적은 기록(local 모드)과 그 사진을 지운다. */
export async function dropTrial() {
  await kv.del(KEY.local);
  await kv.del('local-base');
  for (const key of await photoStore.keys()) {
    if (typeof key === 'string' && key.startsWith('local:')) await photoStore.del(key);
  }
}

/**
 * 기록을 바꾼다. fn 안에서 lib를 직접 고친다. fn이 false를 돌려주면 바뀐 것이 없다는 뜻이라 저장하지 않는다.
 * @returns {Promise<boolean>} 바뀌었는지
 */
export async function commit(fn, { silent = false, reason = '', fromSync = false } = {}) {
  if (!canEdit()) return false;
  const lib = state.lib;
  if (fn(lib) === false) return false;
  askPersist();
  lib.updatedAt = stampAfter(lib.updatedAt);
  lastReason = reason || lastReason;
  await persist(lib, keyOf());
  emit('lib', { silent, reason });
  if (afterCommit && !fromSync && state.mode === 'owner') afterCommit();
  return true;
}

/** 저장소에서 받은 기록으로 바꿔 끼운다(sync.js 전용). 맞추기가 스스로 끼우는 것(reason 'sync')이 아니면 세대를 올린다. */
export async function replaceLibrary(lib, { cacheKey = KEY.owner, reason = 'sync' } = {}) {
  if (reason !== 'sync') epoch += 1;
  state.lib = normalize(lib);
  await persist(state.lib, cacheKey);
  emit('lib', { reason });
}

// ── 읽기 전용 도우미 ─────────────────────────────────────
export const getBook = (id) => (state.lib && typeof id === 'string' && Object.hasOwn(state.lib.books, id) ? state.lib.books[id] : null);
const own = (lib, id) => (typeof id === 'string' && Object.hasOwn(lib.books, id) ? lib.books[id] : null);

export function listBooks(status) {
  const all = Object.values(state.lib.books).filter((b) => b.status === status);
  if (status === 'reading') return all.sort((a, b) => (a.no || 0) - (b.no || 0) || String(a.startedAt).localeCompare(String(b.startedAt)));
  if (status === 'done') return all.sort((a, b) => String(b.finishedAt).localeCompare(String(a.finishedAt)));
  return all.sort((a, b) => String(a.addedAt).localeCompare(String(b.addedAt)));
}

export const photoCount = (book) => PHOTO_SLOTS.filter((s) => book.photos && book.photos[s.key]).length;

export function percent(book) {
  if (!book.totalPages) return 0;
  if (book.page >= book.totalPages) return 100;
  return Math.max(0, Math.min(99, Math.floor((book.page / book.totalPages) * 100)));
}

/** 다 읽었는지(읽은 쪽이 총 쪽수에 닿았는지) */
export const isComplete = (book) => Boolean(book.totalPages) && book.page >= book.totalPages;

export const nextPage = (book) => (book.totalPages ? Math.min(book.totalPages, book.page + 1) : book.page + 1);

/** 읽기 시작에 모자란 것. 빈 배열이면 올릴 수 있다. */
export function missingToStart(book) {
  const miss = [];
  if (!book.totalPages) miss.push('총 쪽수');
  const n = photoCount(book);
  if (n < PHOTO_SLOTS.length) miss.push(`사진 ${PHOTO_SLOTS.length - n}장`);
  return miss;
}

export const readingFull = () => listBooks('reading').length >= MAX_READING;

export function hasReviewContent(book) {
  const r = book.review;
  if (!r) return false;
  const p = r.props || {};
  if ((p.oneLine || '').trim() || (p.before || '').trim() || (p.after || '').trim() || p.rating) return true;
  return (r.blocks || []).some((b) => !b.seed && ((b.text || '').trim() || (b.body || '').trim()));
}

// ── 기록을 바꾸는 동작 ───────────────────────────────────
// 모두 Promise<boolean>을 돌려준다: 실제로 바뀌었으면 true, 조건이 안 맞아 그대로면 false.
const touch = (book) => { book.updatedAt = stampAfter(book.updatedAt); };
const pagesOf = (v) => (Number.isInteger(v) && v >= 1 ? Math.min(MAX_PAGES, v) : null);

/** 책을 대기에 넣는다. @returns {Promise<string>} 책의 id(이미 있던 책이어도 그 id) */
export async function addBook(info) {
  const id = info.id || uid('b');
  await commit((lib) => {
    if (!safeId(id) || Object.hasOwn(lib.books, id)) return false;
    // 지웠던 책을 다시 넣는 것이면, 지운 표시보다 뒤의 시각을 붙여 되살린다.
    const at = stampAfter(lib.tombstones[id]);
    delete lib.tombstones[id];
    lib.books[id] = {
      id, no: null,
      title: clip(String(info.title || '').trim(), 200) || '제목 없음', author: clip(String(info.author || '').trim(), 120), publisher: clip(String(info.publisher || '').trim(), 120),
      tag: clip(String(info.tag || '').trim(), 40), rival: clip(String(info.rival || '').trim(), 200),
      totalPages: pagesOf(info.totalPages), status: 'queue',
      addedAt: at, startedAt: null, finishedAt: null, updatedAt: at,
      photos: {}, page: 0, logs: [], review: null,
    };
    return true;
  }, { reason: '책 추가' });
  return id;
}

export function updateBookInfo(id, patch) {
  return commit((lib) => {
    const b = own(lib, id);
    if (!b) return false;
    const max = { title: 200, author: 120, publisher: 120, tag: 40, rival: 200 };
    for (const k of Object.keys(max)) if (k in patch) b[k] = clip(String(patch[k] || '').trim(), max[k]);
    if ('totalPages' in patch) {
      const n = pagesOf(patch.totalPages);
      // 읽는 중이거나 읽은 책의 총 쪽수는 비울 수 없다(진척을 계산할 수 없게 된다).
      if (n || b.status === 'queue') {
        b.totalPages = n;
        if (n && (b.page > n || b.status === 'done')) b.page = n;
      }
    }
    if (!b.title) b.title = '제목 없음';
    touch(b);
    return true;
  }, { reason: '책 정보' });
}

export async function removeBook(id) {
  const mode = state.mode;
  const done = await commit((lib) => {
    const b = own(lib, id);
    if (!b) return false;
    delete lib.books[id];
    lib.tombstones[id] = stampAfter(b.updatedAt);
    const h = lib.history;
    const before = h.entries.length;
    h.entries = h.entries.filter((e) => e.bookId !== id);
    delete h.analyzed[id];
    if (h.entries.length !== before) h.updatedAt = stampAfter(h.updatedAt);
    return true;
  }, { reason: '책 삭제' });
  if (!done) return false;
  for (const s of PHOTO_SLOTS) await photoStore.del(photoKey(id, s.key, mode)).catch(() => {});
  // 저장소에 올린 사진은 다음 맞추기 때 지운다. 이 기기에만 기록할 때(local)는 저장소를 건드리지 않는다.
  if (mode === 'owner') await updatePendingDeletes((cur) => (cur.includes(id) ? cur : [...cur, id]));
  return true;
}

// 저장소에서 사진을 지울 책의 목록. 읽고 고쳐 쓰는 사이에 다른 수정이 끼어들지 않게 한 줄로 세운다.
let pendingChain = Promise.resolve();
export function updatePendingDeletes(fn) {
  const run = pendingChain.then(async () => {
    const cur = ((await kv.get('pending-deletes').catch(() => null)) || []).filter(safeId);
    const next = fn(cur);
    if (next !== cur) await kv.set('pending-deletes', next).catch(() => {});
    return next;
  });
  pendingChain = run.catch(() => {});
  return run;
}

export function startReading(id) {
  return commit((lib) => {
    const b = own(lib, id);
    if (!b || b.status === 'reading' || readingFull() || missingToStart(b).length) return false;
    b.status = 'reading';
    b.startedAt = b.startedAt || now();
    b.finishedAt = null;
    if (!b.no) { lib.seq += 1; b.no = lib.seq; }
    touch(b);
    return true;
  }, { reason: '읽기 시작' });
}

export function moveToQueue(id) {
  return commit((lib) => {
    const b = own(lib, id);
    if (!b || b.status === 'queue') return false;
    b.status = 'queue';
    b.finishedAt = null;
    touch(b);
    return true;
  }, { reason: '대기로' });
}

export function logProgress(id, page, memo) {
  return commit((lib) => {
    const b = own(lib, id);
    if (!b || !b.totalPages || !Number.isFinite(page)) return false;
    const from = b.page;
    b.page = Math.max(0, Math.min(b.totalPages, Math.round(page)));
    b.logs.push({ id: uid('l'), at: now(), from, page: b.page, memo: clip(String(memo || '').trim(), 2000) });
    touch(b);
    return true;
  }, { reason: '읽은 기록' });
}

export function undoLastLog(id) {
  return commit((lib) => {
    const b = own(lib, id);
    if (!b || !b.logs.length) return false;
    const last = b.logs.pop();
    b.page = Number.isFinite(last.from) ? last.from : (b.logs.length ? b.logs[b.logs.length - 1].page : 0);
    touch(b);
    return true;
  }, { reason: '기록 되돌림' });
}

export function finishBook(id) {
  return commit((lib) => {
    const b = own(lib, id);
    if (!b || b.status === 'done') return false;
    b.status = 'done';
    b.finishedAt = now();
    if (b.totalPages) b.page = b.totalPages;
    touch(b);
    return true;
  }, { reason: '완독' });
}

export function reopenBook(id) {
  return commit((lib) => {
    const b = own(lib, id);
    if (!b || b.status !== 'done' || readingFull()) return false;
    b.status = 'reading';
    b.finishedAt = null;
    touch(b);
    return true;
  }, { reason: '다시 읽는 중' });
}

export function setPhotoMeta(id, slot, meta) {
  return commit((lib) => {
    const b = own(lib, id);
    if (!b || !PHOTO_SLOTS.some((s) => s.key === slot)) return false;
    b.photos[slot] = meta;
    touch(b);
    return true;
  }, { reason: '사진' });
}

/** 사진이 저장소에 올라갔다고 적는다(sync.js 전용). 다시 맞추기를 부르지 않는다. */
export function markPhotoRemote(id, slot, v) {
  return commit((lib) => {
    const b = own(lib, id);
    const meta = b && b.photos[slot];
    if (!meta || meta.v !== v || meta.remote) return false;
    meta.remote = true;
    touch(b);
    return true;
  }, { silent: true, reason: '사진 반영', fromSync: true });
}

export function saveReview(id, review, { silent = true } = {}) {
  return commit((lib) => {
    const b = own(lib, id);
    if (!b) return false;
    const at = stampAfter(b.review && b.review.updatedAt);
    b.review = cleanReview(structuredClone(review), at);
    b.review.updatedAt = at;
    touch(b);
    return true;
  }, { silent, reason: '리뷰' });
}

export function saveHistory(mutator) {
  return commit((lib) => {
    if (mutator(lib.history, lib) === false) return false;
    lib.history.updatedAt = stampAfter(lib.history.updatedAt);
    return true;
  }, { reason: '연혁' });
}

/**
 * 이 기기에 둔 것을 지운다. 저장소의 기록은 그대로다.
 *   local 모드에서: 이 기기에만 적은 기록과 그 사진만 지운다(연결해 쓰던 사본은 건드리지 않는다).
 *   그 밖(연결한 기기 · 연결을 끊으며): 저장소 기록의 사본 · 받아 둔 공개 기록 · 그 사진 · 대기열을 지운다.
 *   이 기기에만 적은 기록(local)은 남긴다. 그것을 지우는 단추는 따로 있다.
 */
export async function wipeDevice() {
  const mode = state.mode;
  epoch += 1;                              // 돌고 있던 맞추기가 이 뒤로는 아무것도 올리지 않게 한다
  if (mode === 'local') await dropTrial();
  else {
    for (const key of [KEY.owner, KEY.viewer, 'pending-deletes']) await kv.del(key);
    for (const key of await photoStore.keys()) {
      if (!(typeof key === 'string' && key.startsWith('local:'))) await photoStore.del(key);
    }
  }
  epoch += 1;
  state.lib = normalize(seedLibrary());
  if (mode !== 'viewer') await persist(state.lib, keyOf(mode));
  if (mode === 'local') await kv.set('local-base', state.lib.updatedAt).catch(() => {});
  emit('lib', { reason: 'wipe' });
}
