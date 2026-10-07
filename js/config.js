// config.js — 앱 전체가 함께 쓰는 고정값.

export const APP_NAME = '독서 도감';
export const APP_VERSION = '0.2.0';

export const DATA_BRANCH = 'data';        // 기록(library.json, photos/)은 이 브랜치에만 쌓는다
export const LIB_PATH = 'library.json';
export const SCHEMA = 1;
export const MAX_READING = 5;             // 읽는 중은 다섯 권까지

// 책 한 권을 올릴 때 반드시 찍는 사진 넉 장
export const PHOTO_SLOTS = [
  { key: 'front', label: '앞표지', hint: '책의 앞면' },
  { key: 'back', label: '뒤표지', hint: '책의 뒷면' },
  { key: 'toc', label: '목차', hint: '길어도 한 쪽만' },
  { key: 'first', label: '본문 첫 장', hint: '프롤로그 말고 본문이 시작되는 쪽' },
];

export const PHOTO_MAX_EDGE = 1600;       // 긴 변(px)
export const PHOTO_TARGET_BYTES = 340 * 1024;

export const CLAUDE_MODEL = 'claude-haiku-4-5-20251001';

// 저장소 주소: <owner>.github.io/<repo>/ 에서 읽고, 아니면 기본값을 쓴다.
export function repoInfo() {
  const host = location.hostname.match(/^([a-z0-9-]+)\.github\.io$/i);
  const first = location.pathname.split('/').filter(Boolean)[0];
  if (host && first) return { owner: host[1], repo: first };
  return { owner: 'mk-jeon', repo: 'reading' };
}

// 이 기기에 두는 것들의 이름. <owner>.github.io 아래의 다른 페이지나 이 앱의 다른 사본과 섞이지 않게 저장소 이름을 붙인다.
const NS = repoInfo().repo.toLowerCase().replace(/[^a-z0-9_-]/g, '') || 'reading';
export const DB_NAME = `dogam-${NS}`;
export const LS = {
  token: `dogam.${NS}.ghToken`,
  claudeKey: `dogam.${NS}.claudeKey`,
  mode: `dogam.${NS}.mode`,
  theme: `dogam.${NS}.theme`,
  photosRemote: `dogam.${NS}.photosRemote`,
  claudeModel: `dogam.${NS}.claudeModel`,
};

export function lsGet(key, fallback = null) {
  try { const v = localStorage.getItem(key); return v == null ? fallback : v; } catch { return fallback; }
}
export function lsSet(key, value) {
  try { if (value == null) localStorage.removeItem(key); else localStorage.setItem(key, String(value)); } catch { /* 저장 불가(사생활 보호 모드 등) */ }
}
