// reading.js — 「읽는 중」 탭. 왼쪽은 책장(읽는 중·대기·읽은 책·인사이트), 오른쪽은 고른 책 한 권.
// 접은 화면에서는 고른 책이 화면 전체를 덮고, 펼친 화면에서는 두 단이 나란히 놓인다.

import { MAX_READING, PHOTO_SLOTS } from './config.js';
import { actionSheet, confirmDialog, fmtDate, fmtNum, h, icon, josa, layersSettled, openModal, toast } from './dom.js';
import { buildInsights } from './insight.js';
import { photoURL, pickImage, savePhoto } from './photos.js';
import { openReview } from './review.js';
import * as store from './store.js';

const drafts = new Map();        // bookId → { page, memo } : 아직 기록하지 않은 입력
let lastDetailId = null;

const setDraft = (id, patch) => drafts.set(id, { page: '', memo: '', ...(drafts.get(id) || {}), ...patch });
const noLabel = (book) => (book.no ? h('span', { class: 'no' }, `No. ${String(book.no).padStart(3, '0')}`) : h('span', { class: 'no no--none' }, '미등재'));
const pagesHelp = () => `총 쪽수는 1에서 ${fmtNum(store.MAX_PAGES)} 사이의 정수로 적어 주세요.`;
const fullHelp = () => `읽는 중은 ${MAX_READING}권까지입니다. 한 권을 끝내거나 대기로 내린 뒤 올리세요.`;

/** 입력칸의 쪽수. 빈칸이면 null, 받을 수 없는 값이면 NaN. */
function pagesIn(input) {
  const raw = input.value.trim();
  if (raw === '') return null;
  const v = Number(raw);
  return Number.isInteger(v) && v >= 1 && v <= store.MAX_PAGES ? v : NaN;
}

// ── 작은 부품 ────────────────────────────────────────────
/** 사진 한 장. 저장소에서 받는 사진은 내용을 읽을 수 있게(CORS) 청해, 기기에 담아 둘 수 있게 한다. 못 받으면 fallback을 놓는다. */
function photoImg(url, { alt = '', lazy = true, fallback }) {
  const img = h('img', { src: url, alt, crossorigin: 'anonymous', decoding: 'async', loading: lazy ? 'lazy' : null });
  img.addEventListener('error', () => { if (img.isConnected) img.replaceWith(fallback()); }, { once: true });
  return img;
}

function thumb(book) {
  const box = h('span', { class: 'thumb' });
  if (book.photos.front) {
    photoURL(book, 'front').then((url) => box.append(url ? photoImg(url, { fallback: () => icon('book', 18) }) : icon('book', 18)));
  } else {
    box.append(icon('book', 18));
  }
  return box;
}

/** 책배(책의 옆면) 모양 진척 막대. 읽은 쪽은 짙게, 다음에 볼 자리에 책갈피가 걸린다. */
export function edge(book, ticks = 44) {
  const p = book.totalPages ? Math.min(1, book.page / book.totalPages) : 0;
  const filled = Math.round(p * ticks);
  const pages = h('span', { class: 'edge-pages' });
  for (let i = 0; i < ticks; i += 1) pages.append(h('i', { class: i < filled ? 'is-read' : '' }));
  return h('span', { class: 'edge', role: 'img', 'aria-label': `전체 ${book.totalPages || 0}쪽 가운데 ${book.page}쪽까지 읽음`, style: { '--p': `${(p * 100).toFixed(2)}%` } },
    pages, h('span', { class: 'edge-ribbon' }));
}

/** 어디 볼 차례인지. 끝까지 읽었으면 그렇게 적는다. */
function nextMark(book, prefix) {
  if (store.isComplete(book)) return h('span', { class: 'next tnum' }, icon('check', 14), '끝까지 읽음');
  return h('span', { class: 'next tnum' }, icon('bookmark', 14), `${prefix}p.${store.nextPage(book)}`);
}

function stars(n) {
  const wrap = h('span', { class: 'stars', role: 'img', 'aria-label': `별점 ${n}점` });
  for (let i = 1; i <= 5; i += 1) wrap.append(h('span', { class: i <= n ? 'is-on' : '' }, icon('star', 14)));
  return wrap;
}

function statusChip(book) {
  if (book.status === 'reading') return h('span', { class: 'chip chip--ok' }, '읽는 중');
  if (book.status === 'done') return h('span', { class: 'chip' }, '완독');
  return h('span', { class: 'chip chip--wait' }, '대기');
}

// ── 책 정보 입력 창 ──────────────────────────────────────
function openBookForm(book = null) {
  const v = book || { title: '', author: '', publisher: '', tag: '', totalPages: '', rival: '' };
  const started = Boolean(book) && book.status !== 'queue';        // 읽는 중이거나 읽은 책
  const field = (id, label, attrs = {}, help = '') => {
    const input = h('input', { class: 'input', id, name: id, autocomplete: 'off', ...attrs });
    input.value = v[id] == null ? '' : String(v[id]);
    return { el: h('div', { class: 'field' }, h('label', { class: 'field-label', for: id }, label), input, help ? h('p', { class: 'field-help' }, help) : null), input };
  };
  const title = field('title', '제목', { required: true, autofocus: !book, maxlength: '200' });
  const author = field('author', '저자', { maxlength: '120' });
  const publisher = field('publisher', '출판사', { maxlength: '120' });
  const tag = field('tag', '분야', { list: 'tag-list', placeholder: '예: 철학', maxlength: '40' });
  const total = field('totalPages', '총 쪽수', { type: 'number', inputmode: 'numeric', min: '1', max: String(store.MAX_PAGES), class: 'input input--num' },
    started ? '읽기 시작한 책은 비울 수 없습니다.' : '읽기 시작 전에 필요합니다.');
  const rival = field('rival', '맞세워 읽을 책', { placeholder: '없으면 비워 둡니다', maxlength: '200' });
  const err = h('p', { class: 'field-error', role: 'alert' });
  const tags = h('datalist', { id: 'tag-list' }, ['인문·역사', '철학', '고전 철학', '인문 고전', '비즈니스', '경제', '과학', '심리', '소설', '에세이'].map((t) => h('option', { value: t })));

  let saving = false;                      // 두 번 눌러도 한 번만 저장한다
  const submit = async () => {
    if (saving) return false;
    const name = title.input.value.trim();
    const pages = pagesIn(total.input);
    if (!name) { err.textContent = '제목을 적어 주세요.'; title.input.focus(); return false; }
    if (Number.isNaN(pages)) { err.textContent = pagesHelp(); total.input.focus(); return false; }
    if (pages === null && started) { err.textContent = '읽기 시작한 책의 총 쪽수는 비울 수 없습니다.'; total.input.focus(); return false; }
    const info = { title: name, author: author.input.value, publisher: publisher.input.value, tag: tag.input.value, rival: rival.input.value, totalPages: pages };
    saving = true;
    try {
      if (book) { await store.updateBookInfo(book.id, info); toast('책 정보를 고쳤습니다.'); }
      else { await store.addBook(info); toast(`『${name}』${josa(name, '을', '를')} 대기에 넣었습니다.`); }
    } finally {
      saving = false;
    }
    return true;
  };
  for (const f of [title, total]) f.input.addEventListener('input', () => { err.textContent = ''; });
  const form = h('form', { class: 'form', novalidate: true, onsubmit: async (e) => { e.preventDefault(); if (await submit()) modal.close(); } },
    title.el, h('div', { class: 'field-row' }, author.el, publisher.el), h('div', { class: 'field-row' }, tag.el, total.el), rival.el, tags, err,
    // 입력칸에서 Enter를 누르면 저장되게 하는, 눈에 보이지 않는 단추
    h('button', { class: 'sr-only', type: 'submit', tabindex: '-1', 'aria-hidden': 'true' }, '저장'));
  const modal = openModal({
    title: book ? '책 정보 수정' : '책 추가',
    content: form,
    actions: [{ label: '취소', kind: 'quiet' }, { label: book ? '저장' : '대기에 넣기', kind: 'primary', onClick: submit }],
  });
}

// ── 사진 ─────────────────────────────────────────────────
async function takePhoto(bookId, slot, camera) {
  const file = await pickImage({ camera });
  if (!file) return;
  toast('사진을 줄여 저장하는 중입니다.', { id: 'photo', duration: 8000 });
  try {
    const bytes = await savePhoto(bookId, slot.key, file);
    toast(`${slot.label} 저장. ${Math.max(1, Math.round(bytes / 1024))}KB로 줄였습니다.`, { id: 'photo' });
  } catch (e) {
    toast(e.message || '사진을 저장하지 못했습니다.', { id: 'photo' });
  }
}

function choosePhoto(bookId, slot) {
  actionSheet({
    title: `${slot.label} 사진`,
    note: slot.hint,
    items: [
      { label: '카메라로 찍기', icon: 'camera', onSelect: () => takePhoto(bookId, slot, true) },
      { label: '사진에서 고르기', icon: 'image', onSelect: () => takePhoto(bookId, slot, false) },
    ],
  });
}

async function openLightbox(bookId, slot) {
  const book = store.getBook(bookId);
  if (!book) return;
  const url = await photoURL(book, slot.key);
  const body = h('div', { class: 'lightbox' }, url
    ? photoImg(url, { alt: `${book.title} ${slot.label}`, lazy: false, fallback: () => h('p', null, '사진을 받지 못했습니다. 연결을 확인해 주세요.') })
    : h('p', null, store.canEdit() ? '이 사진은 찍은 기기에만 있습니다. 여기서 다시 찍을 수 있습니다.' : '이 사진은 찍은 기기에만 있습니다.'));
  const actions = [{ label: '닫기', kind: store.canEdit() ? 'quiet' : 'primary' }];
  if (store.canEdit()) {
    actions.push({ label: '다시 찍기', kind: 'primary', onClick: async (m) => { m.close(); await layersSettled(); choosePhoto(bookId, slot); return false; } });
  }
  openModal({ title: slot.label, content: body, actions });
}

function plates(book) {
  return h('div', { class: 'plates' }, PHOTO_SLOTS.map((slot, i) => {
    const has = Boolean(book.photos[slot.key]);
    const frame = h('span', { class: 'plate-frame' });
    if (has) {
      photoURL(book, slot.key).then((url) => frame.append(url
        ? photoImg(url, { fallback: () => h('span', { class: 'plate-miss' }, '받지 못함') })
        : h('span', { class: 'plate-miss' }, '다른 기기에 있음')));
    } else {
      frame.append(icon('camera', 20));
    }
    const label = h('span', { class: 'plate-label' }, h('b', { class: 'tnum' }, String(i + 1)), slot.label);
    if (!has && !store.canEdit()) return h('div', { class: 'plate plate--empty' }, frame, label);
    return h('button', {
      class: `plate${has ? '' : ' plate--empty'}`, type: 'button',
      'aria-label': `${slot.label} ${has ? '크게 보기' : '사진 넣기'}`,
      onclick: () => (has ? openLightbox(book.id, slot) : choosePhoto(book.id, slot)),
    }, frame, label);
  }));
}

// ── 고른 책: 상태별 패널 ─────────────────────────────────
function startPanel(book) {
  const n = store.photoCount(book);
  const full = store.readingFull();
  const editable = store.canEdit();
  const mark = (ok) => h('span', { class: 'check-mark', 'aria-hidden': 'true' }, ok ? icon('check', 14) : null);
  const photosLi = h('li', { class: n === PHOTO_SLOTS.length ? 'is-done' : '' }, mark(n === PHOTO_SLOTS.length), `사진 ${n} / ${PHOTO_SLOTS.length}`);
  const pagesLi = h('li');
  const note = h('p', { class: 'note', id: 'start-note' });
  const pagesInput = h('input', { class: 'input input--num', id: 'start-pages', type: 'number', inputmode: 'numeric', min: '1', max: String(store.MAX_PAGES), placeholder: '예: 636', 'aria-describedby': 'start-note' });
  pagesInput.value = book.totalPages ? String(book.totalPages) : '';
  const start = h('button', { class: 'btn btn--primary btn--block', type: 'button' }, '읽기 시작');

  // 쪽수를 치는 동안에는 화면을 다시 짓지 않고, 이 패널 안에서만 표시를 고친다(입력칸의 포커스를 지키려는 것).
  const paint = () => {
    const typed = editable ? pagesIn(pagesInput) : book.totalPages;
    const pages = Number.isInteger(typed) ? typed : null;
    const miss = [];
    if (!pages) miss.push('총 쪽수');
    if (n < PHOTO_SLOTS.length) miss.push(`사진 ${PHOTO_SLOTS.length - n}장`);
    pagesLi.className = pages ? 'is-done' : '';
    pagesLi.replaceChildren(mark(Boolean(pages)), pages ? `총 ${fmtNum(pages)}쪽` : '총 쪽수');
    start.disabled = miss.length > 0 || full;
    if (!editable) note.textContent = '아직 도감에 올리지 않은 책입니다.';
    else if (Number.isNaN(typed)) note.textContent = pagesHelp();
    else if (miss.length) note.textContent = `남은 것: ${miss.join(', ')}.`;
    else if (full) note.textContent = fullHelp();
    else note.textContent = book.no ? '갖춰졌습니다. 다시 읽는 중으로 올릴 수 있습니다.' : '갖춰졌습니다. 올리면 도감 번호가 붙습니다.';
  };
  pagesInput.addEventListener('input', paint);
  pagesInput.addEventListener('change', async () => {
    const typed = pagesIn(pagesInput);
    if (Number.isNaN(typed)) {              // 받을 수 없는 값: 적혀 있던 값으로 되돌린다
      toast(pagesHelp(), { id: 'pages' });
      pagesInput.value = book.totalPages ? String(book.totalPages) : '';
      paint();
      return;
    }
    const cur = store.getBook(book.id);
    if (cur && cur.totalPages !== typed) await store.updateBookInfo(book.id, { totalPages: typed });
  });
  start.addEventListener('click', async () => {
    const typed = pagesIn(pagesInput);
    if (!Number.isInteger(typed)) return;
    const cur = store.getBook(book.id);
    if (cur && cur.totalPages !== typed) await store.updateBookInfo(book.id, { totalPages: typed });
    const ok = await store.startReading(book.id);
    toast(ok ? `『${book.title}』${josa(book.title, '을', '를')} 읽는 중으로 올렸습니다.` : '읽는 중으로 올리지 못했습니다. 사진 넉 장과 총 쪽수, 읽는 중인 책 수를 확인해 주세요.');
  });
  paint();

  const kids = [h('h3', { class: 'panel-title' }, '도감에 올리기'), h('ul', { class: 'checks' }, photosLi, pagesLi)];
  if (editable) kids.push(h('div', { class: 'field' }, h('label', { class: 'field-label', for: 'start-pages' }, '총 쪽수'), pagesInput), start);
  kids.push(note);
  if (editable && n < PHOTO_SLOTS.length) kids.push(h('p', { class: 'note' }, '목차는 길어도 한 쪽만, 본문 첫 장은 프롤로그 말고 본문이 시작되는 쪽을 찍습니다.'));
  return h('section', { class: 'panel' }, kids);
}

/** 완독으로 옮기고 리뷰 편집기를 연다. ask가 참이면 먼저 묻는다. */
async function finishAndReview(bookId, { ask = true } = {}) {
  await layersSettled();
  if (ask) {
    const yes = await confirmDialog({ title: '끝까지 읽었습니다', message: '완독으로 옮기고, 책 전체에 대한 생각을 적어 볼까요?', confirmLabel: '완독으로 옮기기', cancelLabel: '아직' });
    if (!yes) return;
  }
  await store.finishBook(bookId);
  await layersSettled();
  openReview(bookId, { edit: true });
}

function progressPanel(book, ctx) {
  const d = drafts.get(book.id) || { page: '', memo: '' };
  const kids = [h('h3', { class: 'panel-title' }, '어디까지 읽었나')];

  if (!book.totalPages) {                   // 손으로 고친 기록 등에서 총 쪽수가 빠진 경우
    kids.push(h('p', { class: 'note' }, '총 쪽수가 비어 있어 진척을 계산할 수 없습니다.'));
    if (store.canEdit()) kids.push(h('button', { class: 'btn btn--block', type: 'button', onclick: () => openBookForm(store.getBook(book.id)) }, '총 쪽수 적기'));
    return h('section', { class: 'panel' }, kids);
  }

  const complete = store.isComplete(book);
  kids.push(
    h('div', { class: 'prog-top' },
      h('strong', { class: 'prog-pct tnum' }, `${store.percent(book)}%`),
      h('div', { class: 'prog-nums' },
        h('span', { class: 'tnum' }, `${fmtNum(book.page)} / ${fmtNum(book.totalPages)}쪽`),
        nextMark(book, '다음 볼 차례 '))),
    edge(book, 56));

  if (store.canEdit()) {
    if (complete) {
      kids.push(
        h('button', { class: 'btn btn--primary btn--block', type: 'button', onclick: () => finishAndReview(book.id, { ask: false }) }, '완독으로 옮기기'),
        h('p', { class: 'note' }, '끝까지 읽었습니다. 완독으로 옮기면 책 전체에 대한 생각을 적을 수 있습니다.'));
    }
    const page = h('input', { class: 'input input--num', id: 'log-page', type: 'number', inputmode: 'numeric', min: '0', max: String(book.totalPages), placeholder: String(book.page), 'aria-describedby': 'log-err' });
    page.value = d.page;
    const memo = h('textarea', { class: 'textarea', id: 'log-memo', rows: '3', maxlength: '2000', placeholder: '마지막에 읽은 문장이나, 여기까지의 요약' });
    memo.value = d.memo;
    const err = h('p', { class: 'field-error', id: 'log-err', role: 'alert' });
    page.addEventListener('input', () => { err.textContent = ''; setDraft(book.id, { page: page.value }); });
    memo.addEventListener('input', () => { err.textContent = ''; setDraft(book.id, { memo: memo.value }); });
    const bump = (step) => h('button', { class: 'btn btn--sm', type: 'button', onclick: () => {
      const cur = store.getBook(book.id) || book;
      const base = page.value.trim() === '' ? cur.page : Number(page.value);
      page.value = String(Math.min(cur.totalPages, (Number.isFinite(base) ? base : cur.page) + step));
      err.textContent = '';
      setDraft(book.id, { page: page.value });
    } }, `+${step}쪽`);
    let saving = false;                    // 두 번 눌러도 한 줄만 적는다
    kids.push(h('form', {
      class: 'form', novalidate: true,
      onsubmit: async (e) => {
        e.preventDefault();
        if (saving) return;
        // 이 화면이 그려진 뒤에 다른 기기의 기록이 들어왔을 수 있으므로, 지금의 책에서 다시 읽는다.
        const cur = store.getBook(book.id);
        if (!cur || cur.status !== 'reading' || !cur.totalPages) return;
        const raw = page.value.trim();
        const to = raw === '' ? cur.page : Number(raw);
        if (!Number.isInteger(to) || to < 0) { err.textContent = '쪽수는 0 이상의 정수로 적어 주세요.'; page.focus(); return; }
        if (to > cur.totalPages) { err.textContent = `이 책은 ${fmtNum(cur.totalPages)}쪽까지입니다.`; page.focus(); return; }
        if (to === cur.page && !memo.value.trim()) { err.textContent = '쪽수나 메모 가운데 하나는 적어 주세요.'; page.focus(); return; }
        saving = true;
        const was = cur.page;
        // 적는 순간 화면이 다시 그려지므로, 쓰던 값은 그 전에 비운다. 적지 못했으면 되돌려 놓는다.
        const draft = drafts.get(book.id);
        drafts.delete(book.id);
        let ok = false;
        try {
          ok = await store.logProgress(book.id, to, memo.value);
        } finally {
          saving = false;
        }
        if (!ok) { if (draft) drafts.set(book.id, draft); toast('적지 못했습니다. 다시 시도해 주세요.'); return; }
        toast(to < was ? `p.${to}${josa(String(to), '으로', '로')} 되돌려 적었습니다.` : `p.${to}까지 적었습니다.`);
        if (to >= cur.totalPages && was < cur.totalPages) finishAndReview(book.id);
      },
    },
    h('div', { class: 'field' },
      h('label', { class: 'field-label', for: 'log-page' }, '읽은 쪽'),
      h('div', { class: 'pagebox' }, page, h('span', { class: 'tnum' }, `/ ${fmtNum(book.totalPages)}`)),
      h('div', { class: 'bumps' }, bump(10), bump(20), bump(30))),
    h('div', { class: 'field' }, h('label', { class: 'field-label', for: 'log-memo' }, '메모'), memo),
    err,
    h('button', { class: `btn btn--block${complete ? '' : ' btn--primary'}`, type: 'submit' }, '기록')));
  }
  return h('section', { class: 'panel' }, kids);
}

function logPanel(book) {
  const logs = [...book.logs].reverse();
  const kids = [h('h3', { class: 'panel-title' }, '읽은 기록', h('span', { class: 'count tnum' }, String(logs.length)))];
  if (!logs.length) {
    kids.push(h('p', { class: 'note' }, '아직 기록이 없습니다.'));
  } else {
    kids.push(h('ol', { class: 'logs' }, logs.map((l) => {
      const from = Number.isFinite(l.from) ? l.from : 0;
      const delta = l.page - from;
      return h('li', { class: 'log' },
        h('span', { class: 'log-date tnum' }, fmtDate(l.at, { year: false })),
        h('div', { class: 'log-body' },
          h('p', { class: 'log-pages tnum' }, `p.${from} → ${l.page}`, delta ? h('span', null, ` ${delta > 0 ? '+' : ''}${delta}쪽`) : null),
          l.memo ? h('p', { class: 'log-memo' }, l.memo) : null));
    })));
    if (store.canEdit() && book.status === 'reading') {
      kids.push(h('button', { class: 'btn btn--sm btn--quiet', type: 'button', onclick: async () => {
        const yes = await confirmDialog({ title: '마지막 기록 지우기', message: '가장 최근 기록 한 줄을 지우고, 읽은 쪽을 그 전으로 되돌립니다.', confirmLabel: '지우기', danger: true });
        if (yes && (await store.undoLastLog(book.id))) toast('마지막 기록을 지웠습니다.');
      } }, '마지막 기록 지우기'));
    }
  }
  return h('section', { class: 'panel' }, kids);
}

function donePanel(book) {
  const has = store.hasReviewContent(book);
  const p = (book.review && book.review.props) || {};
  const kids = [
    h('h3', { class: 'panel-title' }, '완독'),
    h('div', { class: 'done-top' }, h('span', { class: 'tnum' }, `${fmtDate(book.finishedAt)} 완독`), p.rating ? stars(p.rating) : null),
  ];
  if (has) kids.push(h('p', { class: 'done-line' }, p.oneLine || '전체 생각을 적어 두었습니다.'));
  else kids.push(h('p', { class: 'note' }, '아직 전체 생각을 적지 않았습니다.'));
  if (has || store.canEdit()) {
    kids.push(h('button', { class: 'btn btn--primary btn--block', type: 'button', onclick: () => openReview(book.id, { edit: !has }) }, has ? '리뷰 읽기' : '리뷰 쓰기'));
  }
  return h('section', { class: 'panel' }, kids);
}

function moreMenu(book, ctx) {
  const items = [{ label: '책 정보 수정', icon: 'pencil', onSelect: async () => { await layersSettled(); openBookForm(store.getBook(book.id)); } }];
  if (book.status === 'reading') {
    items.push({ label: '완독으로 옮기기', icon: 'check', onSelect: () => finishAndReview(book.id, { ask: false }) });
    items.push({ label: '대기로 내리기', icon: 'arrow-down', onSelect: async () => { if (await store.moveToQueue(book.id)) toast('대기로 내렸습니다. 읽은 쪽과 기록은 그대로 있습니다.'); } });
  }
  if (book.status === 'done') {
    // 읽는 중이 꽉 찼으면 누를 수 없는 이유를 옆에 적어 둔다.
    items.push({
      label: '다시 읽는 중으로', icon: 'arrow-up', hint: store.readingFull() ? `읽는 중 ${MAX_READING}권이 찼음` : '',
      onSelect: async () => {
        if (store.readingFull()) { toast(fullHelp()); return; }
        toast((await store.reopenBook(book.id)) ? '읽는 중으로 옮겼습니다.' : '옮기지 못했습니다.');
      },
    });
  }
  items.push({ label: '책 지우기', icon: 'trash', danger: true, onSelect: async () => {
    await layersSettled();
    const yes = await confirmDialog({ title: '책 지우기', message: `『${book.title}』의 기록과 사진을 모두 지웁니다. 되돌릴 수 없습니다.`, confirmLabel: '지우기', danger: true });
    if (!yes) return;
    await layersSettled();
    ctx.go('#/reading');
    if (await store.removeBook(book.id)) toast('지웠습니다.');
  } });
  actionSheet({ title: book.title, items });
}

function detail(book, ctx) {
  const bar = h('div', { class: 'detail-bar' },
    h('a', { class: 'icon-btn detail-back', href: '#/reading', 'aria-label': '책장으로' }, icon('chevron-left')),
    h('div', { class: 'detail-tags' }, noLabel(book), statusChip(book)),
    // 접은 화면에서는 이 화면이 상단 바를 덮으므로, 저장 상태를 여기에도 둔다(글은 app.js가 채운다).
    store.canEdit() ? h('button', { class: 'chip js-sync-chip', type: 'button', onclick: () => ctx.openSettings() }) : null,
    store.canEdit() ? h('button', { class: 'icon-btn', type: 'button', 'aria-label': '더 보기', onclick: () => moreMenu(book, ctx) }, icon('more')) : null);
  const by = [book.author, book.publisher, book.tag].filter(Boolean);
  const head = h('header', { class: 'detail-head' },
    h('h2', { class: 'detail-title' }, book.title),
    by.length ? h('p', { class: 'byline' }, by.map((t) => h('span', null, t))) : null,
    book.rival ? h('p', { class: 'rival' }, h('span', null, '맞세워 읽기'), h('b', null, book.rival)) : null);

  const body = [bar, head, h('section', { class: 'panel panel--plates' }, h('h3', { class: 'panel-title' }, '표본 사진', h('span', { class: 'count tnum' }, `${store.photoCount(book)} / ${PHOTO_SLOTS.length}`)), plates(book))];
  if (book.status === 'queue') body.push(startPanel(book));
  if (book.status === 'reading') body.push(progressPanel(book, ctx));
  if (book.status === 'done') body.push(donePanel(book));
  if (book.status !== 'queue' || book.logs.length) body.push(logPanel(book));
  return h('article', { class: 'detail', 'aria-label': book.title }, body);
}

// ── 책장 ─────────────────────────────────────────────────
function readingCard(book, route) {
  const last = [...book.logs].reverse().find((l) => l.memo);
  return h('a', { class: `rcard${route.bookId === book.id ? ' is-current' : ''}`, href: `#/reading/b/${book.id}` },
    h('span', { class: 'rcard-top' },
      thumb(book),
      h('span', { class: 'rcard-info' },
        h('span', { class: 'rcard-meta' }, noLabel(book), h('strong', { class: 'rcard-pct tnum' }, `${store.percent(book)}%`)),
        h('span', { class: 'rcard-title' }, book.title),
        h('span', { class: 'rcard-by' }, book.author))),
    edge(book),
    h('span', { class: 'rcard-nums' },
      h('span', { class: 'tnum' }, `${fmtNum(book.page)} / ${fmtNum(book.totalPages)}쪽`),
      nextMark(book, '다음 ')),
    last ? h('span', { class: 'rcard-memo' }, last.memo) : null);
}

function shelfRow(book, route, trailing) {
  return h('li', null, h('a', { class: `srow${route.bookId === book.id ? ' is-current' : ''}`, href: `#/reading/b/${book.id}` },
    h('span', { class: 'srow-main' }, h('span', { class: 'srow-title' }, book.title), h('span', { class: 'srow-by' }, book.author)),
    trailing, h('span', { class: 'srow-go', 'aria-hidden': 'true' }, icon('chevron-right', 16))));
}

function modeBanner(ctx) {
  if (store.state.mode === 'viewer') {
    return h('div', { class: 'banner' },
      h('span', null, h('b', null, '구경 중입니다. '), '공개된 기록을 보고 있습니다.'),
      h('button', { class: 'btn btn--sm', type: 'button', onclick: () => ctx.openSettings() }, '기록 모드 켜기'));
  }
  if (store.state.mode === 'local') {
    return h('div', { class: 'banner' },
      h('span', null, h('b', null, '써 보는 중입니다. '), '여기서 적는 것은 이 기기에만 남고, 저장소의 기록과 섞이지 않습니다.'),
      h('button', { class: 'btn btn--sm', type: 'button', onclick: () => ctx.openSettings() }, '저장소에 연결'));
  }
  return null;
}

function shelf(route, ctx) {
  const reading = store.listBooks('reading');
  const queue = store.listBooks('queue');
  const done = store.listBooks('done');
  const { lines, memo } = buildInsights(store.state.lib);
  const editable = store.canEdit();

  let emptyHint = '대기에 있는 책 가운데 다음에 읽을 책이 여기로 올라옵니다.';
  if (editable) emptyHint = queue.length ? '아래 대기에서 한 권을 골라, 사진 넉 장을 찍고 읽기 시작하세요.' : '책을 추가한 뒤, 사진 넉 장을 찍고 읽기 시작하세요.';

  const readingSec = h('section', { class: 'sec' },
    h('div', { class: 'sec-head' },
      h('div', { class: 'sec-row' },
        h('h2', { class: 'sec-title' }, '읽는 중', h('span', { class: 'count' }, `${reading.length} / ${MAX_READING}`)),
        editable ? h('button', { class: 'btn btn--sm', type: 'button', onclick: () => openBookForm() }, icon('plus', 16), '책 추가') : null),
      h('p', { class: 'sec-cap' }, '사진 넉 장을 찍어 올린 책만 여기에 놓입니다.')),
    reading.length
      ? h('ul', { class: 'rcards' }, reading.map((b) => h('li', null, readingCard(b, route))))
      : h('div', { class: 'empty' }, h('p', { class: 'empty-title' }, '읽는 중인 책이 없습니다'), h('p', null, emptyHint)));

  const queueSec = h('section', { class: 'sec' },
    h('div', { class: 'sec-head' }, h('h2', { class: 'sec-title' }, '대기', h('span', { class: 'count' }, String(queue.length)))),
    queue.length
      ? h('ul', { class: 'srows' }, queue.map((b) => {
        const n = store.photoCount(b);
        return shelfRow(b, route, n ? h('span', { class: 'chip chip--wait' }, `사진 ${n}/${PHOTO_SLOTS.length}`) : null);
      }))
      : h('p', { class: 'note' }, '대기 중인 책이 없습니다.'));

  const doneSec = h('section', { class: 'sec' },
    h('div', { class: 'sec-head' }, h('h2', { class: 'sec-title' }, '읽은 책', h('span', { class: 'count' }, String(done.length)))),
    done.length
      ? h('ul', { class: 'srows' }, done.map((b) => shelfRow(b, route, h('span', { class: 'srow-meta' },
        h('span', { class: 'tnum' }, fmtDate(b.finishedAt)),
        store.hasReviewContent(b) ? (b.review.props.rating ? stars(b.review.props.rating) : h('span', { class: 'chip chip--ok' }, '리뷰')) : h('span', { class: 'chip chip--wait' }, '리뷰 전')))))
      : h('p', { class: 'note' }, '끝까지 읽은 책이 여기에 쌓입니다.'));

  const insightSec = h('section', { class: 'sec' },
    h('div', { class: 'sec-head' }, h('h2', { class: 'sec-title' }, '인사이트'), h('p', { class: 'sec-cap' }, '책장과 기록에서 계산한 몇 줄입니다.')),
    lines.length ? h('ul', { class: 'insights' }, lines.map((l) => h('li', null, l))) : h('p', { class: 'note' }, '책이 놓이면 여기에 몇 줄이 적힙니다.'),
    memo.lines.length ? h('div', { class: 'memo' },
      h('p', { class: 'memo-by' }, `${memo.by === 'claude' ? 'Claude가 적어 둔 메모' : '메모'}${memo.at ? ` ${fmtDate(memo.at)}` : ''}`),
      h('ul', { class: 'insights' }, memo.lines.map((l) => h('li', null, l)))) : null);

  return h('div', { class: 'pane-list' }, modeBanner(ctx), readingSec, queueSec, doneSec, insightSec);
}

export function renderReading(root, route, ctx) {
  const book = route.bookId ? store.getBook(route.bookId) : null;
  const prev = root.querySelector('.pane-detail');
  const keepScroll = prev && lastDetailId === route.bookId ? prev.scrollTop : 0;

  let right;
  if (book) right = detail(book, ctx);
  else if (route.bookId) {
    // 구경 모드에서 책 주소로 바로 들어오면, 공개된 기록을 받기 전에는 그 책이 아직 없다.
    right = h('div', { class: 'detail-miss' },
      h('a', { class: 'icon-btn detail-back', href: '#/reading', 'aria-label': '책장으로' }, icon('chevron-left')),
      store.state.fetching
        ? h('div', { class: 'empty', role: 'status' }, h('p', { class: 'empty-title' }, '기록을 받는 중입니다'), h('p', null, '공개된 기록에서 이 책을 찾고 있습니다.'))
        : h('div', { class: 'empty' }, h('p', { class: 'empty-title' }, '책장에 없는 책입니다'), h('p', null, '지워졌거나, 아직 올라오지 않은 책입니다.'), h('a', { class: 'btn btn--sm', href: '#/reading' }, '책장으로')));
  } else right = h('div', { class: 'detail-none' }, icon('book', 28), h('p', null, '책을 고르면 여기에 펼쳐집니다.'));

  const pane = h('div', { class: `pane-detail${route.bookId && !lastDetailId ? ' is-entering' : ''}` }, right);
  root.replaceChildren(h('div', { class: 'panes', dataset: { detail: route.bookId ? 'open' : 'closed' } }, shelf(route, ctx), pane));
  document.documentElement.classList.toggle('has-detail', Boolean(route.bookId));
  pane.scrollTop = keepScroll;
  lastDetailId = route.bookId || null;
}

export function leaveReading() {
  document.documentElement.classList.remove('has-detail');
}
