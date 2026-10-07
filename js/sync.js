// sync.js — 저장소(GitHub)와 기록을 맞춘다.
// 기록의 정본은 저장소의 data 브랜치다: library.json 한 파일 + photos/<책>/<사진>.jpg
// 앱 코드는 main, 기록은 data로 나눠 두어, 기록을 올릴 때마다 사이트가 다시 빌드되지 않는다.
//
// 흐름: 받기 → 책 단위로 합치기(나중에 고친 쪽이 이긴다) → 달라졌으면 올리기 → 사진 올리기.
// 토큰은 이 기기의 localStorage에만 있고 api.github.com 으로만 나간다.

import { kv, photoStore } from './db.js';
import { DATA_BRANCH, LIB_PATH, LS, PHOTO_SLOTS, lsGet, lsSet, repoInfo } from './config.js';
import { emit, lastReason, markPhotoRemote, normalize, now, onCommit, replaceLibrary, SAFE_ID, setMode, state } from './store.js';

const API = 'https://api.github.com';
const { owner, repo } = repoInfo();
const REPO = `/repos/${owner}/${repo}`;

export class SyncError extends Error {
  constructor(message, kind = 'error') { super(message); this.kind = kind; }
}
class Conflict extends Error {}

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
async function gh(path, { method = 'GET', token, body } = {}) {
  let res;
  try {
    res = await fetch(API + path, {
      method,
      cache: 'no-store',
      headers: {
        Accept: 'application/vnd.github+json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new SyncError('네트워크에 닿지 않습니다.', 'offline');
  }
  return res;
}

async function fail(res, what) {
  let msg = '';
  try { msg = (await res.json()).message || ''; } catch { /* 본문 없음 */ }
  if (res.status === 401) throw new SyncError('토큰이 틀렸거나 만료됐습니다. 설정에서 다시 넣어 주세요.', 'auth');
  if (res.status === 403 && /rate limit/i.test(msg)) throw new SyncError('GitHub 요청 한도를 넘었습니다. 잠시 뒤 다시 시도합니다.', 'offline');
  if (res.status === 403) throw new SyncError('토큰에 이 저장소의 Contents 쓰기 권한이 없습니다.', 'auth');
  if (res.status === 404) throw new SyncError(`${what}: 저장소를 찾지 못했습니다. 토큰이 ${owner}/${repo} 를 볼 수 있는지 확인해 주세요.`, 'auth');
  throw new SyncError(`${what}에 실패했습니다 (${res.status}). ${msg}`.trim());
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
  const j = await res.json();
  let b64 = j.content;
  if (!b64) {                                   // 1MB를 넘으면 본문이 비어 온다
    const blob = await gh(`${REPO}/git/blobs/${j.sha}`, { token });
    if (!blob.ok) await fail(blob, '기록 받기');
    b64 = (await blob.json()).content;
  }
  let lib;
  try { lib = JSON.parse(b64ToUtf8(b64)); } catch { throw new SyncError('저장소의 기록 파일(library.json)을 읽지 못했습니다. 형식이 깨져 있어, 덮어쓰지 않고 멈춥니다.'); }
  if (!lib || typeof lib !== 'object' || Array.isArray(lib)) throw new SyncError('저장소의 기록 파일(library.json)이 기록 모양이 아닙니다. 덮어쓰지 않고 멈춥니다.');
  return { lib, sha: j.sha };
}

/** data 브랜치가 없을 때, 앱 코드와 섞이지 않는 빈 뿌리에서 새로 만든다. */
async function createDataBranch(token, text) {
  const post = async (path, body, what) => {
    const res = await gh(`${REPO}${path}`, { method: 'POST', token, body });
    if (!res.ok) await fail(res, what);
    return res.json();
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
  if (res.status === 409 || res.status === 422) throw new Conflict();
  if (!res.ok) await fail(res, '기록 올리기');
  return (await res.json()).content.sha;
}

async function putPhoto(token, bookId, slot, v, blob) {
  const path = `${REPO}/contents/${photoPath(bookId, slot, v)}`;
  const head = await gh(`${path}?ref=${DATA_BRANCH}`, { token });
  if (head.ok) return;                          // 같은 판이 이미 올라가 있다(지난번에 올리고 표시만 못 남긴 경우)
  const res = await gh(path, {
    method: 'PUT', token,
    body: { message: `사진: ${bookId} ${slot}`, content: await blobToB64(blob), branch: DATA_BRANCH },
  });
  if (!res.ok) await fail(res, '사진 올리기');
}

/** 지운 책의 사진 폴더를 비운다. 전부 지웠으면(또는 원래 없으면) true. */
async function deleteRemotePhotos(token, bookId) {
  const dir = await gh(`${REPO}/contents/photos/${encodeURIComponent(bookId)}?ref=${DATA_BRANCH}`, { token });
  if (dir.status === 404) return true;
  if (!dir.ok) return false;
  const files = await dir.json();
  if (!Array.isArray(files)) return false;
  let all = true;
  for (const f of files) {
    if (!f || f.type !== 'file' || typeof f.path !== 'string' || !f.path.startsWith(`photos/${bookId}/`)) continue;
    const res = await gh(`${REPO}/contents/${f.path.split('/').map(encodeURIComponent).join('/')}`, {
      method: 'DELETE', token, body: { message: `사진 삭제: ${bookId}`, sha: f.sha, branch: DATA_BRANCH },
    });
    if (!res.ok && res.status !== 404) all = false;
  }
  return all;
}

// ── 합치기 ───────────────────────────────────────────────
const later = (a, b) => (String(a || '') >= String(b || '') ? a : b);

/** 두 기록을 책 단위로 합친다. 같은 책은 나중에 고친 쪽, 지운 책은 지운 시각이 더 늦으면 지워진 채로. */
export function mergeLibraries(a, b) {
  const newer = String(a.updatedAt || '') >= String(b.updatedAt || '') ? a : b;
  const out = { schema: newer.schema, updatedAt: later(a.updatedAt, b.updatedAt), seq: Math.max(a.seq || 0, b.seq || 0), books: {}, tombstones: {} };
  for (const src of [a.tombstones || {}, b.tombstones || {}]) {
    for (const [id, at] of Object.entries(src)) out.tombstones[id] = later(out.tombstones[id], at);
  }
  for (const id of new Set([...Object.keys(a.books || {}), ...Object.keys(b.books || {})])) {
    if (!SAFE_ID.test(id)) continue;
    const x = a.books[id];
    const y = b.books[id];
    const pick = !x ? y : !y ? x : (String(x.updatedAt || '') >= String(y.updatedAt || '') ? x : y);
    const gone = out.tombstones[id];
    if (gone && String(gone) >= String(pick.updatedAt || '')) continue;
    out.books[id] = pick;
  }
  const ha = a.history || { entries: [], analyzed: {} };
  const hb = b.history || { entries: [], analyzed: {} };
  const hNew = String(ha.updatedAt || '') >= String(hb.updatedAt || '') ? ha : hb;
  const hOld = hNew === ha ? hb : ha;
  const byId = new Map();
  for (const e of [...(hOld.entries || []), ...(hNew.entries || [])]) byId.set(e.id, e);     // 같은 id는 새 쪽이 덮는다
  out.history = {
    entries: [...byId.values()].filter((e) => !e.bookId || out.books[e.bookId]),
    analyzed: { ...(hOld.analyzed || {}), ...(hNew.analyzed || {}) },
    summary: hNew.summary || hOld.summary || '',
    checkedAt: later(ha.checkedAt, hb.checkedAt) || null,
    updatedAt: later(ha.updatedAt, hb.updatedAt),
  };
  const ia = a.insight || {};
  const ib = b.insight || {};
  out.insight = String(ia.at || '') >= String(ib.at || '') ? ia : ib;
  return out;
}

/** 키 순서에 흔들리지 않는 비교용 문자열 */
export function canonical(value) {
  return JSON.stringify(value, (key, v) => (v && typeof v === 'object' && !Array.isArray(v)
    ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, v[k]]))
    : v));
}

// ── 맞추기 ───────────────────────────────────────────────
let timer = null;
let running = false;
let again = false;

function setStatus(status, extra = {}) {
  state.sync = { ...state.sync, status, error: null, ...extra };
  emit('sync');
}

export function scheduleSync(delay = 2500, { quiet = false } = {}) {
  if (state.mode !== 'owner') return;
  if (!quiet && state.sync.status !== 'syncing') setStatus('pending');
  clearTimeout(timer);
  timer = setTimeout(() => { syncNow(); }, delay);
}

async function syncOnce() {
  const token = lsGet(LS.token);
  const remote = await pullLibrary(token);
  let sha = remote ? remote.sha : null;
  const mine = canonical(state.lib);
  const merged = normalize(remote ? mergeLibraries(state.lib, normalize(remote.lib)) : state.lib);
  if (canonical(merged) !== mine) await replaceLibrary(merged);
  if (!remote || canonical(merged) !== canonical(normalize(remote.lib))) {
    sha = await pushLibrary(token, merged, sha, `기록: ${lastReason || '갱신'}`);
  }

  // 지운 책의 사진을 저장소에서도 지운다. 못 지운 것은 남겨 두었다가 다음에 다시 시도한다.
  // 그사이 다른 기기에서 되살아난 책(합친 기록에 남아 있는 책)의 사진은 건드리지 않는다.
  const dels = ((await kv.get('pending-deletes')) || []).filter((id) => typeof id === 'string' && SAFE_ID.test(id));
  if (dels.length) {
    const left = [];
    for (const id of dels) {
      if (Object.hasOwn(state.lib.books, id)) continue;
      if (!(await deleteRemotePhotos(token, id))) left.push(id);
    }
    await kv.set('pending-deletes', left);
  }

  // 아직 올리지 않은 사진
  if (lsGet(LS.photosRemote, '1') !== '0') {
    let flagged = false;
    for (const book of Object.values(state.lib.books)) {
      for (const slot of PHOTO_SLOTS) {
        const meta = book.photos[slot.key];
        if (!meta || meta.remote) continue;
        const rec = await photoStore.get(`${book.id}/${slot.key}`);
        if (!rec || !rec.blob || rec.v !== meta.v) continue;
        await putPhoto(token, book.id, slot.key, meta.v, rec.blob);
        await markPhotoRemote(book.id, slot.key, meta.v);
        flagged = true;
      }
    }
    if (flagged) await pushLibrary(token, state.lib, sha, '기록: 사진 반영');
  }
}

export async function syncNow() {
  if (state.mode !== 'owner') return false;
  if (running) { again = true; return false; }
  running = true;
  clearTimeout(timer);
  setStatus('syncing');
  let ok = false;
  try {
    for (let attempt = 0; ; attempt += 1) {
      try { await syncOnce(); break; } catch (e) { if (!(e instanceof Conflict) || attempt >= 2) throw e; }
    }
    setStatus('saved', { lastAt: now() });
    ok = true;
  } catch (e) {
    if (e instanceof SyncError && e.kind === 'offline') setStatus('offline', { error: e.message });
    else setStatus('error', { error: e instanceof Conflict ? '다른 기기의 기록과 겹쳤습니다. 다시 시도합니다.' : (e.message || '알 수 없는 오류') });
  } finally {
    running = false;
    if (again) { again = false; scheduleSync(600); }
  }
  return ok;
}

/** 구경 모드: 공개된 기록을 받아 보여 준다. */
export async function refreshViewer() {
  if (state.mode !== 'viewer') return false;
  try {
    const res = await fetch(`https://raw.githubusercontent.com/${owner}/${repo}/${DATA_BRANCH}/${LIB_PATH}?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return false;
    await replaceLibrary(await res.json(), { cacheKey: 'viewer-cache', reason: 'viewer' });
    return true;
  } catch {
    return false;
  }
}

export async function connect(token) {
  await verifyToken(token);
  lsSet(LS.token, token);
  await setMode('owner');
  return syncNow();
}

export async function disconnect() {
  lsSet(LS.token, null);
  clearTimeout(timer);
  await setMode('viewer');
  state.sync = { status: 'idle', error: null, lastAt: null };
  emit('sync');
  await refreshViewer();
}

export function initSync() {
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
}
