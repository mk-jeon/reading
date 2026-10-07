// photos.js — 사진을 찍거나 고르고, 줄여서 보관하고, 보여 줄 주소를 돌려준다.
// 원본은 받지 않는다. 긴 변 1600px 이하의 JPEG로 줄여, 장당 대략 0.3MB 안쪽으로 맞춘다.

import { photoStore } from './db.js';
import { PHOTO_MAX_EDGE, PHOTO_TARGET_BYTES } from './config.js';
import { h } from './dom.js';
import { rawPhotoURL } from './sync.js';
import { getBook, photoKey, setPhotoMeta } from './store.js';

/** 카메라(camera=true) 또는 사진 보관함에서 한 장을 받는다. 취소하면 null. */
export function pickImage({ camera }) {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept: 'image/*', class: 'sr-only', tabindex: '-1', 'aria-hidden': 'true' });
    if (camera) input.setAttribute('capture', 'environment');
    let settled = false;
    const finish = (file) => { if (settled) return; settled = true; input.remove(); resolve(file || null); };
    input.addEventListener('change', () => finish(input.files && input.files[0]));
    input.addEventListener('cancel', () => finish(null));
    document.body.append(input);
    input.click();
  });
}

async function decode(file) {
  if ('createImageBitmap' in window) {
    try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { /* 아래 방식으로 다시 */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function draw(source, edge) {
  const sw = source.width || source.naturalWidth;
  const sh = source.height || source.naturalHeight;
  const scale = Math.min(1, edge / Math.max(sw, sh));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(sw * scale));
  canvas.height = Math.max(1, Math.round(sh * scale));
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

const toJpeg = (canvas, q) => new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', q));

/** 사진을 줄인다. 목표 용량을 넘으면 화질을 낮추고, 그래도 넘으면 한 번 더 작게 그린다. */
export async function compressImage(file) {
  if (!file || !/^image\//.test(file.type || '')) throw new Error('사진 파일만 넣을 수 있습니다.');
  if (file.size > 60 * 1024 * 1024) throw new Error('사진이 너무 큽니다(60MB 초과). 일반 화질로 다시 찍어 주세요.');
  let source;
  try { source = await decode(file); } catch { throw new Error('사진을 읽지 못했습니다. 다른 사진으로 해 보세요.'); }
  let best = null;
  for (const edge of [PHOTO_MAX_EDGE, 1280]) {
    const canvas = draw(source, edge);
    for (const q of [0.82, 0.74, 0.66, 0.58, 0.5]) {
      const blob = await toJpeg(canvas, q);
      if (!blob) continue;
      best = { blob, width: canvas.width, height: canvas.height };
      if (blob.size <= PHOTO_TARGET_BYTES) break;
    }
    if (best && best.blob.size <= PHOTO_TARGET_BYTES) break;
  }
  if (source.close) source.close();
  if (!best) throw new Error('사진을 읽지 못했습니다. 다른 사진으로 해 보세요.');
  return best;
}

const urls = new Map();     // 사진 키 → { v, url }

export async function savePhoto(bookId, slot, file) {
  const { blob, width, height } = await compressImage(file);
  const key = photoKey(bookId, slot);
  // 판(v)은 찍은 시각이다. 다만 앞선 판보다는 반드시 크게 잡는다(기기 시계가 늦어도 새로 찍은 쪽이 이기게).
  const book = getBook(bookId);
  const prev = book && book.photos[slot] ? book.photos[slot].v : 0;
  const v = Math.max(Date.now(), prev + 1);
  await photoStore.set(key, { v, blob });
  const old = urls.get(key);
  if (old) { URL.revokeObjectURL(old.url); urls.delete(key); }
  if (!(await setPhotoMeta(bookId, slot, { v, w: width, h: height, bytes: blob.size, remote: false }))) {
    await photoStore.del(key).catch(() => {});
    throw new Error('사진을 넣을 책을 찾지 못했습니다.');
  }
  return blob.size;
}

/** 보여 줄 주소. 이 기기에 있으면 그것을, 없으면 저장소에 올라간 것을 쓴다. 둘 다 없으면 null. */
export async function photoURL(book, slot) {
  const meta = book.photos && book.photos[slot];
  if (!meta) return null;
  const key = photoKey(book.id, slot);
  const cached = urls.get(key);
  if (cached && cached.v === meta.v) return cached.url;
  const rec = await photoStore.get(key).catch(() => null);
  // 기록이 가리키는 판과 같은 사본만 쓴다. 다른 기기에서 다시 찍었으면(판이 다르면) 저장소 것을 쓴다.
  if (rec && rec.blob && rec.v === meta.v) {
    if (cached) URL.revokeObjectURL(cached.url);
    const url = URL.createObjectURL(rec.blob);
    urls.set(key, { v: meta.v, url });
    return url;
  }
  return meta.remote ? rawPhotoURL(book.id, slot, meta.v) : null;
}
