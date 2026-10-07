// store.js — 앱의 상태와 기록(library)을 바꾸는 유일한 통로.
// 화면은 여기의 함수로만 기록을 바꾸고, 바뀌면 subscribe()로 알림을 받는다.
//
// 모드
//   viewer : 구경. 저장소에 공개된 기록을 읽기만 한다.
//   owner  : 기록. 이 기기에 사본을 두고 저장소(data 브랜치)와 맞춘다.
//   local  : 이 기기에서만 써 보기. 저장소로 올라가지 않는다.

import { kv, photoStore } from './db.js';
import { seedLibrary } from './seed.js';
import { LS, lsGet, lsSet, MAX_READING, PHOTO_SLOTS, SCHEMA } from './config.js';

export const state = {
  mode: 'viewer',
  lib: null,
  sync: { status: 'idle', error: null, lastAt: null },
  ready: false,
};

const subs = new Set();
let afterCommit = null;                    // sync.js가 건다: 기록이 바뀌면 올릴 차례를 잡는다
export let lastReason = '';

export function subscribe(fn) { subs.add(fn); return () => subs.delete(fn); }
export function emit(type, detail = {}) { for (const fn of [...subs]) fn(type, detail); }
export function onCommit(fn) { afterCommit = fn; }

export const canEdit = () => state.mode !== 'viewer';
// 책·블록·연혁 줄의 id로 받아들이는 모양. 저장소 경로와 선택자에 쓰이므로 좁게 잡는다.
export const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
export const now = () => new Date().toISOString();
export const uid = (prefix = 'b') => `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

// ── 읽어 들인 기록 다듬기 ────────────────────────────────
const clip = (v, n) => (typeof v === 'string' || typeof v === 'number' ? String(v) : '').slice(0, n);
const isObj = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const dateOr = (v, fallback) => (typeof v === 'string' && v.length <= 40 && !Number.isNaN(new Date(v).getTime()) ? v : fallback);
const intIn = (v, min, max, fallback) => (Number.isFinite(v) ? Math.max(min, Math.min(max, Math.round(v))) : fallback);

export const MAX_PAGES = 20000;
const BLOCK_TYPES = new Set(['p', 'h1', 'h2', 'h3', 'bullet', 'number', 'todo', 'quote', 'callout', 'toggle', 'divider']);
const TONES = new Set(['gray', 'blue', 'green', 'yellow', 'red']);
const STATUSES = new Set(['queue', 'reading', 'done']);

function cleanReview(r, fallbackAt) {
  if (!isObj(r)) return null;
  const p = isObj(r.props) ? r.props : {};
  const seen = new Set();
  const blocks = (Array.isArray(r.blocks) ? r.blocks : []).filter(isObj).slice(0, 400).map((k) => {
    let id = typeof k.id === 'string' && SAFE_ID.test(k.id) && !seen.has(k.id) ? k.id : uid('k');
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
      tags: (Array.isArray(p.tags) ? p.tags : []).filter((t) => typeof t === 'string' && t.trim()).slice(0, 8).map((t) => clip(t.trim(), 40)),
    },
    blocks,
    updatedAt: dateOr(r.updatedAt, fallbackAt),
  };
}

function cleanPhotos(photos) {
  const out = {};
  if (!isObj(photos)) return out;
  for (const { key } of PHOTO_SLOTS) {
    const m = photos[key];
    if (!isObj(m) || !Number.isFinite(m.v) || m.v <= 0) continue;
    out[key] = { v: Math.round(m.v), w: intIn(m.w, 0, 20000, 0), h: intIn(m.h, 0, 20000, 0), bytes: intIn(m.bytes, 0, 50 * 1024 * 1024, 0), remote: m.remote === true };
  }
  return out;
}

/**
 * 빠진 칸을 채우고 모양이 어긋난 값을 걸러, 옛 기록이나 손으로 고친 기록도 읽히게 한다.
 * 저장소에서 받은 기록과 이 기기의 사본은 모두 여기를 거친 뒤에만 화면과 저장으로 간다.
 */
export function normalize(lib) {
  if (!isObj(lib)) return seedLibrary();
  const at = dateOr(lib.updatedAt, now());
  const out = { schema: SCHEMA, updatedAt: at, seq: intIn(lib.seq, 0, 1e6, 0), books: {}, tombstones: {} };

  if (isObj(lib.tombstones)) {
    for (const [id, when] of Object.entries(lib.tombstones)) {
      if (SAFE_ID.test(id) && dateOr(when, null)) out.tombstones[id] = when;
    }
  }

  if (isObj(lib.books)) {
    for (const [id, b] of Object.entries(lib.books)) {
      if (!SAFE_ID.test(id) || !isObj(b)) continue;
      const totalPages = Number.isFinite(b.totalPages) && b.totalPages >= 1 ? Math.min(MAX_PAGES, Math.round(b.totalPages)) : null;
      const addedAt = dateOr(b.addedAt, at);
      const status = STATUSES.has(b.status) ? b.status : 'queue';
      const page = intIn(b.page, 0, totalPages || MAX_PAGES, 0);
      out.books[id] = {
        id,
        no: Number.isInteger(b.no) && b.no > 0 ? b.no : null,
        title: clip(b.title, 200).trim() || '제목 없음',
        author: clip(b.author, 120), publisher: clip(b.publisher, 120), tag: clip(b.tag, 40), rival: clip(b.rival, 200),
        totalPages, status,
        addedAt,
        startedAt: dateOr(b.startedAt, null),
        finishedAt: dateOr(b.finishedAt, null),
        updatedAt: dateOr(b.updatedAt, addedAt),
        photos: cleanPhotos(b.photos),
        page,
        logs: (Array.isArray(b.logs) ? b.logs : []).filter((l) => isObj(l) && Number.isFinite(l.page)).slice(-2000).map((l) => ({
          id: SAFE_ID.test(String(l.id || '')) ? String(l.id) : uid('l'),
          at: dateOr(l.at, addedAt), from: intIn(l.from, 0, MAX_PAGES, 0), page: intIn(l.page, 0, MAX_PAGES, 0), memo: clip(l.memo, 2000),
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
      .filter((e) => isObj(e) && typeof e.id === 'string' && SAFE_ID.test(e.id) && dateOr(e.date, null) && !seenEntry.has(e.id) && seenEntry.add(e.id))
      .slice(-1000)
      .map((e) => {
        const kind = e.kind === 'review' ? 'review' : 'milestone';
        const entry = { id: e.id, kind, date: e.date, title: clip(e.title, 200), line: clip(e.line, 300), createdAt: dateOr(e.createdAt, at) };
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
    checkedAt: dateOr(hist.checkedAt, null),
    updatedAt: dateOr(hist.updatedAt, at),
  };
  if (isObj(hist.analyzed)) {
    for (const [id, hash] of Object.entries(hist.analyzed)) {
      if (Object.hasOwn(out.books, id) && typeof hash === 'string') out.history.analyzed[id] = clip(hash, 16);
    }
  }

  const ins = isObj(lib.insight) ? lib.insight : {};
  out.insight = {
    by: ins.by === 'claude' ? 'claude' : clip(ins.by, 40),
    at: dateOr(ins.at, ''),
    lines: (Array.isArray(ins.lines) ? ins.lines : []).filter((l) => typeof l === 'string' && l.trim()).slice(0, 12).map((l) => clip(l, 400)),
  };
  return out;
}

/** 이 기기의 보관함이 쓸 수 있는 상태가 아니면(사생활 보호 창 등) 창을 닫을 때 기록이 사라진다. */
function askPersist() {
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {}); } catch { /* 지원하지 않는 브라우저 */ }
}

export async function boot() {
  const token = lsGet(LS.token);
  state.mode = token ? 'owner' : (lsGet(LS.mode) === 'local' ? 'local' : 'viewer');
  const stored = await kv.get(state.mode === 'viewer' ? 'viewer-cache' : 'lib');
  state.lib = normalize(stored || seedLibrary());
  state.ready = true;
  if (state.mode !== 'viewer') askPersist();
}

/** 모드를 바꾼다. 구경에서 기록으로 넘어갈 때는 지금 보이던 기록을 이 기기의 출발점으로 삼는다. */
export async function setMode(mode) {
  if (mode === state.mode) return;
  if (mode === 'viewer') {
    lsSet(LS.mode, null);
  } else {
    const mine = await kv.get('lib');
    state.lib = normalize(mine || structuredClone(state.lib));
    await kv.set('lib', state.lib);
    lsSet(LS.mode, mode === 'local' ? 'local' : null);
    askPersist();
  }
  state.mode = mode;
  emit('mode');
  emit('lib', { reason: 'mode' });
}

/** 기록을 바꾼다. fn 안에서 lib를 직접 고친다. */
export async function commit(fn, { silent = false, reason = '', fromSync = false } = {}) {
  if (!canEdit()) return false;
  fn(state.lib);
  state.lib.updatedAt = now();
  lastReason = reason || lastReason;
  try {
    await kv.set('lib', state.lib);
  } catch {
    emit('warn', { message: '이 기기에 사본을 저장하지 못했습니다. 저장 공간을 확인해 주세요.' });
  }
  emit('lib', { silent, reason });
  if (afterCommit && !fromSync) afterCommit();
  return true;
}

/** 저장소에서 받아 합친 기록으로 바꿔 끼운다(sync.js 전용). */
export async function replaceLibrary(lib, { cacheKey = 'lib', reason = 'sync' } = {}) {
  state.lib = normalize(lib);
  try {
    await kv.set(cacheKey, state.lib);
  } catch {
    if (cacheKey === 'lib') emit('warn', { message: '이 기기에 사본을 저장하지 못했습니다. 저장 공간을 확인해 주세요.' });
  }
  emit('lib', { reason });
}

// ── 읽기 전용 도우미 ─────────────────────────────────────
export const getBook = (id) => (state.lib && typeof id === 'string' && Object.hasOwn(state.lib.books, id) ? state.lib.books[id] : null);

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
const touch = (book) => { book.updatedAt = now(); };

export function addBook(info) {
  const id = info.id || uid('b');
  return commit((lib) => {
    if (!SAFE_ID.test(id) || Object.hasOwn(lib.books, id)) return;
    delete lib.tombstones[id];
    lib.books[id] = {
      id, no: null,
      title: clip(info.title.trim(), 200), author: clip((info.author || '').trim(), 120), publisher: clip((info.publisher || '').trim(), 120),
      tag: clip((info.tag || '').trim(), 40), rival: clip((info.rival || '').trim(), 200),
      totalPages: Number.isInteger(info.totalPages) && info.totalPages >= 1 ? Math.min(MAX_PAGES, info.totalPages) : null, status: 'queue',
      addedAt: now(), startedAt: null, finishedAt: null, updatedAt: now(),
      photos: {}, page: 0, logs: [], review: null,
    };
  }, { reason: '책 추가' }).then(() => id);
}

export function updateBookInfo(id, patch) {
  return commit((lib) => {
    const b = lib.books[id];
    if (!b) return;
    const max = { title: 200, author: 120, publisher: 120, tag: 40, rival: 200 };
    for (const k of Object.keys(max)) if (k in patch) b[k] = clip(String(patch[k] || '').trim(), max[k]);
    if ('totalPages' in patch) {
      b.totalPages = Number.isInteger(patch.totalPages) && patch.totalPages >= 1 ? Math.min(MAX_PAGES, patch.totalPages) : null;
      if (b.totalPages && b.page > b.totalPages) b.page = b.totalPages;
    }
    if (!b.title) b.title = '제목 없음';
    touch(b);
  }, { reason: '책 정보' });
}

export async function removeBook(id) {
  await commit((lib) => {
    if (!lib.books[id]) return;
    delete lib.books[id];
    lib.tombstones[id] = now();
    const h = lib.history;
    const before = h.entries.length;
    h.entries = h.entries.filter((e) => e.bookId !== id);
    delete h.analyzed[id];
    if (h.entries.length !== before) h.updatedAt = now();
  }, { reason: '책 삭제' });
  for (const s of PHOTO_SLOTS) await photoStore.del(`${id}/${s.key}`);
  const pend = (await kv.get('pending-deletes')) || [];
  if (!pend.includes(id)) { pend.push(id); await kv.set('pending-deletes', pend); }
}

export function startReading(id) {
  return commit((lib) => {
    const b = lib.books[id];
    if (!b || b.status === 'reading' || readingFull() || missingToStart(b).length) return;
    b.status = 'reading';
    b.startedAt = b.startedAt || now();
    b.finishedAt = null;
    if (!b.no) { lib.seq += 1; b.no = lib.seq; }
    touch(b);
  }, { reason: '읽기 시작' });
}

export function moveToQueue(id) {
  return commit((lib) => {
    const b = lib.books[id];
    if (!b) return;
    b.status = 'queue';
    touch(b);
  }, { reason: '대기로' });
}

export function logProgress(id, page, memo) {
  return commit((lib) => {
    const b = lib.books[id];
    if (!b) return;
    const from = b.page;
    b.page = Math.max(0, Math.min(b.totalPages || page, Math.round(page)));
    b.logs.push({ id: uid('l'), at: now(), from, page: b.page, memo: clip((memo || '').trim(), 2000) });
    touch(b);
  }, { reason: '읽은 기록' });
}

export function undoLastLog(id) {
  return commit((lib) => {
    const b = lib.books[id];
    if (!b || !b.logs.length) return;
    const last = b.logs.pop();
    b.page = Number.isFinite(last.from) ? last.from : (b.logs.length ? b.logs[b.logs.length - 1].page : 0);
    touch(b);
  }, { reason: '기록 되돌림' });
}

export function finishBook(id) {
  return commit((lib) => {
    const b = lib.books[id];
    if (!b) return;
    b.status = 'done';
    b.finishedAt = now();
    if (b.totalPages) b.page = b.totalPages;
    touch(b);
  }, { reason: '완독' });
}

export function reopenBook(id) {
  return commit((lib) => {
    const b = lib.books[id];
    if (!b || readingFull()) return;
    b.status = 'reading';
    b.finishedAt = null;
    touch(b);
  }, { reason: '다시 읽는 중' });
}

export function setPhotoMeta(id, slot, meta) {
  return commit((lib) => {
    const b = lib.books[id];
    if (!b) return;
    b.photos[slot] = meta;
    touch(b);
  }, { reason: '사진' });
}

/** 사진이 저장소에 올라갔다고 적는다(sync.js 전용). 다시 맞추기를 부르지 않는다. */
export function markPhotoRemote(id, slot, v) {
  return commit((lib) => {
    const b = lib.books[id];
    const meta = b && b.photos[slot];
    if (!meta || meta.v !== v) return;
    meta.remote = true;
    touch(b);
  }, { silent: true, reason: '사진 반영', fromSync: true });
}

export function saveReview(id, review, { silent = true } = {}) {
  return commit((lib) => {
    const b = lib.books[id];
    if (!b) return;
    b.review = cleanReview(structuredClone(review), now());
    b.review.updatedAt = now();
    touch(b);
  }, { silent, reason: '리뷰' });
}

export function saveHistory(mutator) {
  return commit((lib) => { mutator(lib.history, lib); lib.history.updatedAt = now(); }, { reason: '연혁' });
}

/** 이 기기의 기록 사본과 사진을 지운다. 저장소의 기록은 그대로다. */
export async function wipeDevice() {
  await kv.clear();
  await photoStore.clear();
  state.lib = normalize(seedLibrary());
  if (state.mode !== 'viewer') await kv.set('lib', state.lib);
  emit('lib', { reason: 'wipe' });
}
