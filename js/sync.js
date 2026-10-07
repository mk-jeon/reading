// sync.js — 저장소(GitHub)와 기록을 맞춘다.
// 기록의 정본은 저장소의 data 브랜치다: library.json 한 파일 + photos/<책>/<사진>-<판>.jpg
// 앱 코드는 main, 기록은 data로 나눠 두어, 기록을 올릴 때마다 사이트가 다시 빌드되지 않는다.
//
// 흐름: 받기 → 책 단위로 합치기(나중에 고친 쪽이 이긴다) → 달라졌으면 올리기 → 사진 올리기.
// 토큰은 이 기기의 localStorage에만 있고 api.github.com 으로만 나간다.
//
// 지키는 것
//   · 맞추는 도중에 기록이 통째로 바뀌면(모드 전환 · 사본 지우기 · 다른 창의 저장) 더 올리지 않고 그만둔다.
//   · 요청은 정해진 시간 안에 답이 없으면 끊는다. 끊기거나 겹치면 간격을 벌려 가며 다시 시도한다.
//   · 저장소의 기록이 깨져 있거나 이 앱보다 새 형식이면 덮어쓰지 않고 멈춘다.

import { kv, photoStore } from './db.js';
import { DATA_BRANCH, LIB_PATH, LS, PHOTO_SLOTS, SCHEMA, lsGet, lsSet, repoInfo } from './config.js';
import { seedLibrary } from './seed.js';
import {
  adoptTrialPhotos, dropTrial, emit, lastReason, libEpoch, markPhotoRemote, normalize, now, onCommit, photoKey,
  replaceLibrary, safeId, setMode, state, trialInfo, updatePendingDeletes, wipeDevice,
} from './store.js';

const API = 'https://api.github.com';
const { owner, repo } = repoInfo();
const REPO = `/repos/${owner}/${repo}`;
const TIMEOUT = 25000;                 // 요청 하나가 답 없이 매달려 있을 수 있는 시간(ms)
const UPLOAD_TIMEOUT = 60000;          // 사진 올리기
const RETRY = [15000, 60000, 300000];  // 끊기거나 겹쳤을 때 다시 시도하기까지의 간격

export class SyncError extends Error {
  constructor(message, kind = 'error') { super(message); this.kind = kind; }
}
class Conflict extends Error {}
class Stopped extends Error {}         // 맞추는 도중에 기록이 통째로 바뀌었다. 조용히 그만둔다.

// ── 인코딩 ───────────────────────────────────────────────
function utf8ToB64(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
function b64ToUtf8(b64) {
  const bin = atob(b64.replace(/\s/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}
function blobToB64(blob) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result).split(',')[1]);
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(blob);
  });
}

// ── GitHub API ───────────────────────────────────────────
export function timeoutSignal(ms) {
  if (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) return AbortSignal.timeout(ms);
  const c = new AbortController();
  setTimeout(() => c.abort(), ms);
  return c.signal;
}

async function gh(path, { method = 'GET', token, body, timeout = TIMEOUT } = {}) {
  try {
    return await fetch(API + path, {
      method,
      cache: 'no-store',
      signal: timeoutSignal(timeout),
      headers: {
        Accept: 'application/vnd.github+json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    const slow = e && (e.name === 'TimeoutError' || e.name === 'AbortError');
    throw new SyncError(slow ? 'GitHub의 답이 너무 늦습니다.' : '네트워크에 닿지 않습니다.', 'offline');
  }
}

/** 응답 본문(JSON)을 읽는다. 읽는 도중에 끊겨도 같은 종류의 오류로 돌려준다. */
async function body(res) {
  try { return await res.json(); } catch { throw new SyncError('GitHub의 답을 끝까지 받지 못했습니다.', 'offline'); }
}

async function fail(res, what) {
  let msg = '';
  try { msg = String((await res.json()).message || ''); } catch { /* 본문 없음 */ }
  if (res.status === 401) throw new SyncError('토큰이 틀렸거나 만료됐습니다. 설정에서 다시 넣어 주세요.', 'auth');
  if ((res.status === 403 || res.status === 429) && /rate limit|abuse|secondary/i.test(msg)) throw new SyncError('GitHub 요청 한도를 넘었습니다.', 'offline');
  if (res.status === 403) throw new SyncError('토큰에 이 저장소의 Contents 쓰기 권한이 없습니다.', 'auth');
  if (res.status === 404) throw new SyncError(`${what}: 저장소를 찾지 못했습니다. 토큰이 ${owner}/${repo} 를 볼 수 있는지 확인해 주세요.`, 'auth');
  if (res.status >= 500) throw new SyncError(`GitHub이 잠시 응답하지 못합니다 (${res.status}).`, 'offline');
  throw new SyncError(`${what}에 실패했습니다 (${res.status}). ${msg.slice(0, 200)}`.trim());
}

/** 사진 파일의 저장소 안 경로. 판(v)을 이름에 넣어, 한 번 올린 파일은 내용이 바뀌지 않게 한다(캐시가 묵지 않는다). */
const photoPath = (bookId, slot, v) => `photos/${encodeURIComponent(bookId)}/${slot}-${Math.round(Number(v) || 0)}.jpg`;

export function rawPhotoURL(bookId, slot, v) {
  return `https://raw.githubusercontent.com/${owner}/${repo}/${DATA_BRANCH}/${photoPath(bookId, slot, v)}`;
}

/** 토큰이 저장소를 읽을 수 있는지 본다. 쓰기 권한은 첫 올리기에서 드러난다. */
export async function verifyToken(token) {
  const res = await gh(REPO, { token });
  if (!res.ok) await fail(res, '저장소 확인');
  return true;
}

async function branchExists(token) {
  const res = await gh(`${REPO}/git/ref/heads/${DATA_BRANCH}`, { token });
  if (res.status === 404) return false;
  if (!res.ok) await fail(res, '브랜치 확인');
  return true;
}

async function pullLibrary(token) {
  const res = await gh(`${REPO}/contents/${LIB_PATH}?ref=${DATA_BRANCH}`, { token });
  if (res.status === 404) return null;
  if (!res.ok) await fail(res, '기록 받기');
  const j = await body(res);
  let b64 = j.content;
  if (!b64) {                                   // 1MB를 넘으면 본문이 비어 온다
    const blob = await gh(`${REPO}/git/blobs/${j.sha}`, { token });
    if (!blob.ok) await fail(blob, '기록 받기');
    b64 = (await body(blob)).content;
  }
  let lib;
  try { lib = JSON.parse(b64ToUtf8(b64)); } catch { throw new SyncError('저장소의 기록 파일(library.json)을 읽지 못했습니다. 형식이 깨져 있어, 덮어쓰지 않고 멈춥니다.'); }
  if (!lib || typeof lib !== 'object' || Array.isArray(lib)) throw new SyncError('저장소의 기록 파일(library.json)이 기록 모양이 아닙니다. 덮어쓰지 않고 멈춥니다.');
  if (Number.isFinite(lib.schema) && lib.schema > SCHEMA) throw new SyncError('저장소의 기록이 이 앱보다 새 형식입니다. 앱을 새로 고친 뒤 다시 맞춰 주세요. 덮어쓰지 않고 멈춥니다.');
  return { lib, sha: j.sha };
}

/** data 브랜치가 없을 때, 앱 코드와 섞이지 않는 빈 뿌리에서 새로 만든다. */
async function createDataBranch(token, text) {
  const post = async (path, payload, what) => {
    const res = await gh(`${REPO}${path}`, { method: 'POST', token, body: payload });
    if (res.status === 422 && path === '/git/refs') throw new Conflict();     // 그사이 다른 기기가 브랜치를 만들었다
    if (!res.ok) await fail(res, what);
    return body(res);
  };
  const blob = await post('/git/blobs', { content: text, encoding: 'utf-8' }, '기록 올리기');
  const tree = await post('/git/trees', { tree: [{ path: LIB_PATH, mode: '100644', type: 'blob', sha: blob.sha }] }, '기록 올리기');
  const commit = await post('/git/commits', { message: '기록 시작', tree: tree.sha, parents: [] }, '기록 올리기');
  await post('/git/refs', { ref: `refs/heads/${DATA_BRANCH}`, sha: commit.sha }, '기록 브랜치 만들기');
  return blob.sha;
}

async function pushLibrary(token, lib, sha, message) {
  const text = JSON.stringify(lib, null, 1);
  if (!sha && !(await branchExists(token))) return createDataBranch(token, text);
  const res = await gh(`${REPO}/contents/${LIB_PATH}`, {
    method: 'PUT', token,
    body: { message, content: utf8ToB64(text), branch: DATA_BRANCH, ...(sha ? { sha } : {}) },
  });
  if (res.status === 409) throw new Conflict();
  if (res.status === 422) {
    // sha가 맞지 않거나 빠졌다는 답이면 그사이 파일이 바뀐 것이다. 그 밖의 422는 겹침이 아니다.
    let msg = '';
    try { msg = String((await res.clone().json()).message || ''); } catch { /* 본문 없음 */ }
    if (/sha/i.test(msg)) throw new Conflict();
  }
  if (!res.ok) await fail(res, '기록 올리기');
  return (await body(res)).content.sha;
}

async function putPhoto(token, bookId, slot, v, blob) {
  const path = `${REPO}/contents/${photoPath(bookId, slot, v)}`;
  const head = await gh(`${path}?ref=${DATA_BRANCH}`, { token });
  if (head.ok) return;                          // 같은 판이 이미 올라가 있다(지난번에 올리고 표시만 못 남긴 경우)
  const res = await gh(path, {
    method: 'PUT', token, timeout: UPLOAD_TIMEOUT,
    body: { message: `사진: ${bookId} ${slot}`, content: await blobToB64(blob), branch: DATA_BRANCH },
  });
  if (res.status === 409) throw new Conflict();   // 다른 기기의 쓰기와 겹쳤다: 처음부터 다시 맞춘다
  if (res.status === 422) return;                 // 그사이 같은 이름의 파일이 생겼다(같은 판이므로 같은 사진이다)
  if (!res.ok) await fail(res, '사진 올리기');
}

async function listPhotoDir(token, bookId) {
  const dir = await gh(`${REPO}/contents/photos/${encodeURIComponent(bookId)}?ref=${DATA_BRANCH}`, { token });
  if (dir.status === 404) return [];
  if (!dir.ok) return null;
  const files = await dir.json().catch(() => null);
  if (!Array.isArray(files)) return null;
  return files.filter((f) => f && f.type === 'file' && typeof f.path === 'string' && typeof f.name === 'string' && f.path === `photos/${bookId}/${f.name}`);
}

async function deleteFile(token, file, message) {
  const res = await gh(`${REPO}/contents/${file.path.split('/').map(encodeURIComponent).join('/')}`, {
    method: 'DELETE', token, body: { message, sha: file.sha, branch: DATA_BRANCH },
  });
  return res.ok || res.status === 404;
}

/** 지운 책의 사진 폴더를 비운다. 전부 지웠으면(또는 원래 없으면) true. */
async function deleteRemotePhotos(token, bookId) {
  const files = await listPhotoDir(token, bookId);
  if (!files) return false;
  let all = true;
  for (const f of files) if (!(await deleteFile(token, f, `사진 삭제: ${bookId}`))) all = false;
  return all;
}

/** 다시 찍어 올린 뒤, 같은 칸의 옛 판을 저장소에서 지운다. 사진은 판이 큰 쪽으로만 합쳐지므로 옛 판을 가리키는 기록은 남지 않는다. */
async function dropOldVersions(token, bookId, slot, v) {
  const files = await listPhotoDir(token, bookId);
  if (!files) return;
  for (const f of files) {
    const m = f.name.match(/^([a-z]+)-(\d+)\.jpg$/);
    if (m && m[1] === slot && Number(m[2]) < v) await deleteFile(token, f, `사진 교체: ${bookId} ${slot}`);
  }
}

// ── 합치기 ───────────────────────────────────────────────
const later = (a, b) => (String(a || '') >= String(b || '') ? a : b);
const has = (o, k) => Boolean(o) && Object.hasOwn(o, k);

/** 키 순서에 흔들리지 않는 비교용 문자열 */
export function canonical(value) {
  return JSON.stringify(value, (key, v) => (v && typeof v === 'object' && !Array.isArray(v)
    ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, v[k]]))
    : v));
}

/** 둘 가운데 나중에 고친 쪽. 시각이 같은데 내용이 다르면, 어느 기기에서나 같은 쪽이 골라지게 내용으로 정한다. */
function newer(x, y, stampOf) {
  const sx = String(stampOf(x) || '');
  const sy = String(stampOf(y) || '');
  if (sx !== sy) return sx > sy ? x : y;
  return canonical(x) >= canonical(y) ? x : y;
}

/** 사진은 칸마다 판(v)이 큰 쪽이 이긴다. 같은 판이면 '올렸다'는 표시를 합친다. */
function mergePhotos(x, y) {
  const out = {};
  for (const { key } of PHOTO_SLOTS) {
    const a = x && x[key];
    const b = y && y[key];
    if (a && b) out[key] = a.v === b.v ? { ...a, remote: Boolean(a.remote || b.remote) } : (a.v > b.v ? a : b);
    else if (a || b) out[key] = a || b;
  }
  return out;
}

/**
 * 두 기록을 합친다. 둘 다 normalize()를 거친 것이어야 한다.
 *   · 책: 나중에 고친 쪽(updatedAt). 사진만은 칸마다 판이 큰 쪽.
 *   · 지운 책: 지운 시각이 그 책을 고친 시각보다 늦거나 같으면 지워진 채로. 그 뒤에 고쳐졌으면 되살아난다.
 *   · 연혁의 줄: id마다 나중에 만든 쪽.
 */
export function mergeLibraries(a, b) {
  const out = { schema: SCHEMA, updatedAt: later(a.updatedAt, b.updatedAt), seq: Math.max(a.seq || 0, b.seq || 0), books: {}, tombstones: {} };
  const tomb = {};
  for (const src of [a.tombstones || {}, b.tombstones || {}]) {
    for (const [id, at] of Object.entries(src)) if (safeId(id)) tomb[id] = later(tomb[id], at);
  }
  for (const id of new Set([...Object.keys(a.books || {}), ...Object.keys(b.books || {})])) {
    if (!safeId(id)) continue;
    const x = has(a.books, id) ? a.books[id] : null;
    const y = has(b.books, id) ? b.books[id] : null;
    const base = !x ? y : !y ? x : newer(x, y, (k) => k.updatedAt);
    const gone = has(tomb, id) ? tomb[id] : null;
    if (gone && String(gone) >= String(base.updatedAt || '')) continue;
    const pick = { ...base, photos: mergePhotos(x && x.photos, y && y.photos) };
    if (gone) {
      // 지운 뒤에 다른 기기에서 고쳐 되살아난 책. 지운 표시를 걷고, 저장소의 사진은 이미 지워졌을 수 있으므로
      // '올렸다'는 표시를 내려 사진을 갖고 있는 기기가 다시 올리게 한다.
      delete tomb[id];
      pick.photos = Object.fromEntries(Object.entries(pick.photos).map(([k, m]) => [k, { ...m, remote: false }]));
    }
    out.books[id] = pick;
  }
  out.tombstones = tomb;

  const ha = a.history || {};
  const hb = b.history || {};
  const hNew = newer(ha, hb, (h) => h.updatedAt);
  const hOld = hNew === ha ? hb : ha;
  const byId = new Map();
  for (const e of [...(hOld.entries || []), ...(hNew.entries || [])]) {
    if (!e || !safeId(e.id)) continue;
    const prev = byId.get(e.id);
    byId.set(e.id, prev ? newer(prev, e, (k) => k.createdAt) : e);
  }
  out.history = {
    entries: [...byId.values()].filter((e) => e.kind !== 'review' || has(out.books, e.bookId)),
    analyzed: Object.fromEntries(Object.entries({ ...(hOld.analyzed || {}), ...(hNew.analyzed || {}) }).filter(([id]) => has(out.books, id))),
    summary: hNew.summary || hOld.summary || '',
    checkedAt: later(ha.checkedAt, hb.checkedAt) || null,
    updatedAt: later(ha.updatedAt, hb.updatedAt),
  };
  out.insight = newer(a.insight || {}, b.insight || {}, (i) => i.at);
  return out;
}

// ── 맞추기 ───────────────────────────────────────────────
let timer = null;
let retryTimer = null;
let running = false;
let again = false;
let fails = 0;

function setStatus(status, extra = {}) {
  if (state.mode !== 'owner') return;
  state.sync = { ...state.sync, status, error: null, ...extra };
  emit('sync');
}

export function scheduleSync(delay = 2500, { quiet = false } = {}) {
  if (state.mode !== 'owner') return;
  if (!quiet && state.sync.status !== 'syncing') setStatus('pending');
  clearTimeout(timer);
  timer = setTimeout(() => { syncNow(); }, delay);
}

async function syncOnce(token) {
  const epoch = libEpoch();
  // 받거나 올리는 사이에 모드가 바뀌었거나, 기록이 통째로 바뀌었거나, 토큰이 바뀌었으면 여기서 그만둔다.
  const alive = () => { if (state.mode !== 'owner' || libEpoch() !== epoch || lsGet(LS.token) !== token) throw new Stopped(); };

  const remote = await pullLibrary(token);
  alive();
  let sha = remote ? remote.sha : null;
  const theirs = remote ? normalize(remote.lib) : null;
  const mine = canonical(state.lib);
  const merged = normalize(theirs ? mergeLibraries(state.lib, theirs) : state.lib);
  const mergedText = canonical(merged);
  if (mergedText !== mine) await replaceLibrary(merged);
  alive();
  if (!theirs || mergedText !== canonical(theirs)) {
    sha = await pushLibrary(token, merged, sha, `기록: ${lastReason || '갱신'}`);
    alive();
  }

  // 지운 책의 사진을 저장소에서도 지운다. 못 지운 것은 남겨 두었다가 다음에 다시 시도한다.
  // 그사이 다른 기기에서 되살아난 책(합친 기록에 남아 있는 책)의 사진은 건드리지 않는다.
  const dels = await updatePendingDeletes((cur) => cur);
  if (dels.length) {
    const done = [];
    for (const id of dels) {
      alive();
      if (has(state.lib.books, id) || (await deleteRemotePhotos(token, id))) done.push(id);
    }
    await updatePendingDeletes((cur) => cur.filter((id) => !done.includes(id)));
    alive();
  }

  // 아직 올리지 않은 사진
  if (lsGet(LS.photosRemote, '1') !== '0') {
    let flagged = false;
    for (const id of Object.keys(state.lib.books)) {
      for (const slot of PHOTO_SLOTS) {
        const book = has(state.lib.books, id) ? state.lib.books[id] : null;     // 매번 지금의 기록에서 다시 읽는다
        const meta = book && book.photos[slot.key];
        if (!meta || meta.remote) continue;
        const rec = await photoStore.get(photoKey(id, slot.key, 'owner'));
        alive();
        if (!rec || !rec.blob || rec.v !== meta.v) continue;
        await putPhoto(token, id, slot.key, meta.v, rec.blob);
        alive();
        if (await markPhotoRemote(id, slot.key, meta.v)) flagged = true;
        await dropOldVersions(token, id, slot.key, meta.v);
        alive();
      }
    }
    if (flagged) {
      alive();                                   // 여기까지 왔으면 state.lib는 방금 합친 기록에 이 기기의 수정만 더해진 것이다
      sha = await pushLibrary(token, state.lib, sha, '기록: 사진 반영');
    }
  }
}

export async function syncNow() {
  if (state.mode !== 'owner') return false;
  if (running) { again = true; return false; }
  const token = lsGet(LS.token);
  if (!token) return false;
  running = true;
  clearTimeout(timer);
  clearTimeout(retryTimer);
  setStatus('syncing');
  let ok = false;
  try {
    for (let attempt = 0; ; attempt += 1) {
      try { await syncOnce(token); break; } catch (e) { if (!(e instanceof Conflict) || attempt >= 2) throw e; }
    }
    fails = 0;
    setStatus('saved', { lastAt: now() });
    ok = true;
  } catch (e) {
    if (e instanceof Stopped) {
      again = state.mode === 'owner';             // 아직 기록 모드면(사본 지우기 · 다른 창의 저장) 처음부터 다시 맞춘다
    } else if (state.mode === 'owner') {
      const retry = e instanceof Conflict || (e instanceof SyncError && e.kind === 'offline');
      const wait = retry ? RETRY[Math.min(fails, RETRY.length - 1)] : 0;
      fails += 1;
      const tail = wait ? ` ${wait >= 60000 ? `${Math.round(wait / 60000)}분` : `${Math.round(wait / 1000)}초`} 뒤에 다시 시도합니다.` : '';
      if (e instanceof SyncError && e.kind === 'offline') setStatus('offline', { error: e.message + tail });
      else setStatus('error', { error: (e instanceof Conflict ? '다른 기기의 기록과 계속 겹칩니다.' : (e.message || '알 수 없는 오류')) + tail });
      if (wait) retryTimer = setTimeout(() => { syncNow(); }, wait);
    }
  } finally {
    running = false;
    if (again) { again = false; scheduleSync(600, { quiet: true }); }
  }
  return ok;
}

/** 구경 모드: 공개된 기록을 받아 보여 준다. */
export async function refreshViewer() {
  if (state.mode !== 'viewer') return false;
  state.fetching = true;
  let shown = false;
  try {
    const res = await fetch(`https://raw.githubusercontent.com/${owner}/${repo}/${DATA_BRANCH}/${LIB_PATH}?t=${Date.now()}`, { cache: 'no-store', signal: timeoutSignal(TIMEOUT) });
    if (!res.ok) return false;
    const json = await res.json();
    if (!json || typeof json !== 'object' || Array.isArray(json)) return false;
    if (state.mode !== 'viewer') return false;    // 받는 사이에 기록 모드로 바뀌었다: 끼워 넣지 않는다
    state.fetching = false;
    await replaceLibrary(json, { cacheKey: 'viewer-cache', reason: 'viewer' });
    shown = true;
    return true;
  } catch {
    return false;
  } finally {
    state.fetching = false;
    if (!shown && state.mode === 'viewer') emit('lib', { reason: 'viewer' });
  }
}

/**
 * 모드를 고른 적 없는 기기가 열렸을 때 한 번: 공개된 기록이 이미 있고 이 기기에 적은 것이 없으면 그 기록을 보여 준다(구경).
 * 공개된 기록이 없으면 그대로 이 기기에 기록한다. busy()가 참이면(창이 열려 있거나 입력 중) 이번에는 바꾸지 않는다.
 */
async function followPublic(busy) {
  const auto = () => state.mode === 'local' && !lsGet(LS.mode) && !lsGet(LS.token);
  if (!auto()) return;
  state.fetching = true;
  let json = null;
  try {
    const res = await fetch(`https://raw.githubusercontent.com/${owner}/${repo}/${DATA_BRANCH}/${LIB_PATH}?t=${Date.now()}`, { cache: 'no-store', signal: timeoutSignal(TIMEOUT) });
    if (res.ok) json = await res.json();
  } catch { /* 연결이 없으면 이 기기의 기록으로 계속한다 */ }
  state.fetching = false;
  try {
    const found = Boolean(json) && typeof json === 'object' && !Array.isArray(json);
    if (found && auto() && !busy() && !(await trialInfo()).changed && auto() && !busy()) {
      await setMode('viewer', { remember: false });
      await replaceLibrary(json, { cacheKey: 'viewer-cache', reason: 'viewer' });
      return;
    }
  } catch { /* 보관함을 못 쓰면 그대로 둔다 */ }
  emit('lib', { reason: 'viewer' });
}

/**
 * 연결하기 전에 알아 둘 것: 저장소에 기록이 이미 있는지, 이 기기에 적은 기록이 있는지.
 * 토큰이 틀렸으면 여기서 오류가 난다.
 */
export async function probeConnect(token) {
  await verifyToken(token);
  const remote = await pullLibrary(token);
  const trial = await trialInfo();
  const mine = await kv.get('lib').catch(() => null);
  // 이 기기에 적은 기록을 첫 기록으로 삼을 수 있는 것은, 저장소에 기록이 없고 연결해 쓰던 사본도 없을 때뿐이다.
  return { remoteExists: Boolean(remote), trialChanged: trial.changed, canAdopt: !remote && !mine && trial.changed };
}

/**
 * 토큰으로 저장소에 연결한다. 이 기기에만 적은 기록(local)은 저장소의 기록에 섞지 않는다.
 * 다만 저장소에 기록이 아직 없고(연결해 쓰던 사본도 없고) adoptTrial이 참이면, 이 기기의 기록을 첫 기록으로 삼는다.
 * @returns {Promise<{ ok: boolean, remoteExists: boolean, trial: 'adopted'|'kept'|'none' }>}
 */
export async function connect(token, { adoptTrial = false } = {}) {
  await verifyToken(token);
  const remote = await pullLibrary(token);       // 저장소의 기록이 깨져 있으면 여기서 멈춘다(토큰도 저장하지 않는다)
  const trial = await trialInfo();
  const mine = await kv.get('lib').catch(() => null);
  let start;
  let used = trial.changed ? 'kept' : 'none';
  if (remote) start = mine || remote.lib;
  else if (adoptTrial && trial.exists && !mine) { start = trial.lib; used = 'adopted'; }
  else start = mine || seedLibrary();

  lsSet(LS.token, token);
  try {
    if (used === 'adopted') await adoptTrialPhotos();
    await setMode('owner', { start });
  } catch {
    lsSet(LS.token, null);
    throw new SyncError('이 기기의 보관함을 쓸 수 없어 연결하지 못했습니다. 사생활 보호 창이 아닌지 확인해 주세요.');
  }
  if (used === 'adopted') await dropTrial().catch(() => {});
  const ok = await syncNow();
  return { ok, remoteExists: Boolean(remote), trial: used };
}

/** 연결을 끊는다. wipe가 참이면 이 기기에 둔 사본과 사진도 지운다. */
export async function disconnect({ wipe = false } = {}) {
  lsSet(LS.token, null);
  lsSet(LS.claudeKey, null);
  clearTimeout(timer);
  clearTimeout(retryTimer);
  fails = 0;
  await setMode('viewer');
  if (wipe) await wipeDevice();
  state.sync = { status: 'idle', error: null, lastAt: null };
  emit('sync');
  await refreshViewer();
}

export function initSync({ busy = () => false } = {}) {
  onCommit(() => scheduleSync());
  window.addEventListener('online', () => { if (state.mode === 'owner') scheduleSync(300, { quiet: true }); });
  // 다른 기기에서 고친 기록을 받아 오도록, 화면으로 돌아올 때마다 한 번 맞춘다.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (state.mode === 'owner' && state.sync.status !== 'syncing') scheduleSync(300, { quiet: true });
    else if (state.mode === 'viewer') refreshViewer();
  });
  if (state.mode === 'owner') syncNow();
  else if (state.mode === 'viewer') refreshViewer();
  else followPublic(busy);
}
