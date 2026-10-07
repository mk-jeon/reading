// app.js — 시작점. 틀(상단 바·탭 바)을 짓고, 주소(#/me, #/reading, #/reading/b/<id>, #/history)에 맞는 화면을 그린다.

import { APP_NAME } from './config.js';
import { h, icon, toast } from './dom.js';
import { renderHistory } from './history.js';
import { renderMe } from './me.js';
import { leaveReading, renderReading } from './reading.js';
import { applyTheme, initInstall, openSettings } from './settings.js';
import { storageReady } from './db.js';
import { boot, canEdit, state, subscribe } from './store.js';
import { initSync } from './sync.js';

const TABS = [
  { key: 'me', label: '나', icon: 'user' },
  { key: 'reading', label: '읽는 중', icon: 'book' },
  { key: 'history', label: '히스토리', icon: 'clock' },
];
const VIEWS = { me: renderMe, reading: renderReading, history: renderHistory };

let main = null;
let chip = null;
let tabLinks = [];
let route = { tab: 'me', bookId: null };
let stale = false;
let cameFromShelf = false;       // 책장에서 눌러 들어온 상세인지(뒤로 가기 단추의 동작을 정한다)

function parseRoute() {
  const parts = location.hash.replace(/^#\/?/, '').split('/');
  const tab = TABS.some((t) => t.key === parts[0]) ? parts[0] : 'me';
  let bookId = null;
  if (tab === 'reading' && parts[1] === 'b' && parts[2]) {
    try { bookId = decodeURIComponent(parts[2]); } catch { bookId = null; }
  }
  return { tab, bookId };
}

const ctx = {
  openSettings,
  go(hash) { location.hash = hash; },
};

function render() {
  stale = false;
  if (route.tab !== 'reading') leaveReading();
  main.dataset.view = route.tab;
  VIEWS[route.tab](main, route, ctx);
  for (const a of tabLinks) {
    const on = a.dataset.tab === route.tab;
    a.classList.toggle('is-active', on);
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  }
  document.title = route.tab === 'me' ? APP_NAME : `${TABS.find((t) => t.key === route.tab).label} | ${APP_NAME}`;
}

function paintChip() {
  const s = state.sync;
  let text = '구경 중';
  let cls = 'chip';
  if (state.mode === 'local') { text = '이 기기에만'; cls = 'chip chip--wait'; }
  else if (state.mode === 'owner') {
    text = { saved: '저장됨', idle: '연결됨', syncing: '올리는 중', pending: '저장 대기', offline: '오프라인', error: '저장 오류' }[s.status] || '연결됨';
    cls = s.status === 'error' ? 'chip chip--bad' : (s.status === 'pending' || s.status === 'offline') ? 'chip chip--wait' : s.status === 'syncing' ? 'chip' : 'chip chip--ok';
  }
  chip.className = cls;
  chip.textContent = text;
  chip.setAttribute('aria-label', `저장 상태: ${text}. 설정 열기`);
}

const typing = () => main.contains(document.activeElement) && /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName);

function onRoute() {
  const prev = route;
  route = parseRoute();
  if (route.tab === 'reading' && route.bookId && !(prev.tab === 'reading' && prev.bookId)) cameFromShelf = prev.tab === 'reading';
  if (!route.bookId) cameFromShelf = false;
  render();
  if (prev.tab !== route.tab) { window.scrollTo(0, 0); main.focus({ preventScroll: true }); }
}

function shell() {
  chip = h('button', { class: 'chip', type: 'button', onclick: () => openSettings() });
  main = h('main', { class: 'main', id: 'main', tabindex: '-1' });
  tabLinks = TABS.map((t) => h('a', { class: 'tab', href: `#/${t.key}`, dataset: { tab: t.key } }, icon(t.icon, 22), h('span', null, t.label)));

  // 책장↔책 사이의 이동이 뒤로 가기 기록을 어지럽히지 않게 한다.
  main.addEventListener('click', (e) => {
    const a = e.target.closest('a[href^="#/reading"]');
    if (!a || e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey) return;
    const href = a.getAttribute('href');
    if (a.classList.contains('detail-back')) {
      e.preventDefault();
      if (cameFromShelf) history.back(); else location.replace(href);
    } else if (route.tab === 'reading' && route.bookId && href.startsWith('#/reading/b/')) {
      e.preventDefault();
      if (href !== location.hash) location.replace(href);
    }
  });
  main.addEventListener('focusout', () => setTimeout(() => { if (stale && !typing()) render(); }, 0));

  document.getElementById('app').replaceChildren(
    h('header', { class: 'topbar' },
      h('a', { class: 'brand', href: '#/me' }, h('img', { class: 'brand-mark', src: 'icons/favicon.svg', alt: '', width: '24', height: '24' }), APP_NAME),
      h('div', { class: 'topbar-actions' }, chip, h('button', { class: 'icon-btn', type: 'button', 'aria-label': '설정', onclick: () => openSettings() }, icon('sliders')))),
    main,
    h('nav', { class: 'tabbar', 'aria-label': '탭' }, tabLinks));
}

async function start() {
  // 다른 사이트가 이 화면을 틀(iframe)에 넣어 누르게 만드는 것을 막는다. (Pages는 응답 헤더를 못 바꾼다.)
  if (window.top !== window.self) {
    document.getElementById('app').replaceChildren(h('main', { class: 'main' }, h('p', { class: 'note' }, '이 페이지는 다른 사이트 안에서는 열리지 않습니다.')));
    return;
  }
  applyTheme();
  initInstall();
  await boot();
  shell();
  route = parseRoute();
  render();
  paintChip();

  subscribe((type, detail) => {
    if (type === 'sync' || type === 'mode') paintChip();
    if (type === 'warn') toast(detail.message, { id: 'warn', duration: 5000 });
    if (type !== 'lib' || detail.silent) return;
    // 입력하는 도중에 저장소에서 받은 기록이 끼어들면, 손을 뗀 뒤에 다시 그린다.
    if (typing() && (detail.reason === 'sync' || detail.reason === 'viewer')) { stale = true; return; }
    render();
  });
  window.addEventListener('hashchange', onRoute);
  initSync();
  storageReady().then((ok) => {
    if (!ok && canEdit()) toast('이 브라우저에서는 기기 보관함을 쓸 수 없습니다. 창을 닫으면 올리지 않은 기록이 사라집니다.', { id: 'warn', duration: 8000 });
  });

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('sw.js').catch(() => { /* 설치 없이도 동작한다 */ });
  }
}

start();
