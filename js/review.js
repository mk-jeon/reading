// review.js — 완독한 책의 리뷰. 노션처럼 블록을 쌓아 쓴다.
// 모양(블록 종류, 색, 치수)은 heyman333/agent-notion-template-docs 의 template.html 을 따랐다.
//
// 한 블록은 한 줄짜리 입력칸(textarea)이다. 한글 입력기와 부딪히지 않도록,
// 줄바꿈·단축 입력은 키 이벤트가 아니라 입력이 끝난 값(input 이벤트)에서 처리한다.

import { actionSheet, autoGrow, fmtDate, h, icon, layersSettled, openModal } from './dom.js';
import { canEdit, emit, getBook, now, saveReview, uid } from './store.js';

const TYPES = [
  { key: 'p', label: '텍스트', hint: '' },
  { key: 'h1', label: '제목 1', hint: '#' },
  { key: 'h2', label: '제목 2', hint: '##' },
  { key: 'h3', label: '제목 3', hint: '###' },
  { key: 'bullet', label: '글머리 목록', hint: '-' },
  { key: 'number', label: '번호 목록', hint: '1.' },
  { key: 'todo', label: '할 일', hint: '[]' },
  { key: 'quote', label: '인용', hint: '>' },
  { key: 'callout', label: '콜아웃', hint: '' },
  { key: 'toggle', label: '토글', hint: '' },
  { key: 'divider', label: '구분선', hint: '---' },
];
const TONES = [
  { key: 'gray', label: '메모', icon: 'info' },
  { key: 'blue', label: '핵심', icon: 'bulb' },
  { key: 'green', label: '좋았던 점', icon: 'check-circle' },
  { key: 'yellow', label: '주의·반론', icon: 'alert' },
  { key: 'red', label: '경고', icon: 'stop' },
];
const PLACEHOLDER = { p: '글을 쓰거나 / 로 블록을 고릅니다', h1: '제목 1', h2: '제목 2', h3: '제목 3', bullet: '목록', number: '목록', todo: '할 일', quote: '인용', callout: '강조할 말', toggle: '토글 제목' };
const LISTY = new Set(['bullet', 'number', 'todo']);
const HEADING = new Set(['h1', 'h2', 'h3']);
const SHORTCUT = { '#': 'h1', '##': 'h2', '###': 'h3', '-': 'bullet', '*': 'bullet', '1.': 'number', '>': 'quote' };
const toneOf = (key) => TONES.find((t) => t.key === key) || TONES[0];
const typeLabel = (key) => (TYPES.find((t) => t.key === key) || TYPES[0]).label;

/** 처음 여는 리뷰의 틀. 제목만 미리 놓고 본문은 비워 둔다. */
export function blankReview() {
  const B = (type, text = '', extra = {}) => ({ id: uid('k'), type, text, ...extra });
  return {
    props: { rating: 0, oneLine: '', before: '', after: '', tags: [] },
    blocks: [
      B('h2', '왜 읽었나', { seed: true }), B('p', '', { ph: '이 책을 집어 든 이유' }),
      B('h2', '남은 문장', { seed: true }), B('quote', '', { ph: '옮겨 적고 싶은 한 문장' }),
      B('h2', '내 주장 하나와 가장 센 반론', { seed: true }),
      B('callout', '', { tone: 'blue', ph: '나는 ~라고 생각한다' }),
      B('callout', '', { tone: 'yellow', ph: '거기에 맞설 가장 센 반론' }),
      B('h2', '달라진 것', { seed: true }), B('p', '', { ph: '읽기 전과 지금, 생각이 바뀐 한 가지' }),
    ],
    updatedAt: now(),
  };
}

/** **굵게** 와 `코드` 만 꾸민다. 나머지는 글자 그대로. */
function inline(text) {
  const out = [];
  const re = /(\*\*[^*\n]+\*\*|`[^`\n]+`)/g;
  let last = 0;
  let m = re.exec(text);
  while (m) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(m[0].startsWith('**') ? h('strong', null, m[0].slice(2, -2)) : h('code', null, m[0].slice(1, -1)));
    last = m.index + m[0].length;
    m = re.exec(text);
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const filled = (b) => b.type === 'divider' || Boolean((b.text || '').trim()) || Boolean((b.body || '').trim());

/** 읽기 화면에 내보낼 블록. 빈 블록과, 아래에 아무것도 쓰지 않은 틀 제목은 뺀다. */
function visibleBlocks(blocks) {
  return blocks.filter((b, i) => {
    if (!filled(b)) return false;
    if (!(b.seed && HEADING.has(b.type))) return true;
    for (let j = i + 1; j < blocks.length; j += 1) {
      if (HEADING.has(blocks[j].type)) return false;
      if (filled(blocks[j]) && blocks[j].type !== 'divider') return true;
    }
    return false;
  });
}

function readBlocks(blocks, onTodo) {
  const out = [];
  let list = null;
  let listType = '';
  const flush = () => { if (list) out.push(list); list = null; listType = ''; };
  for (const b of visibleBlocks(blocks)) {
    if (LISTY.has(b.type)) {
      if (listType !== b.type) {
        flush();
        list = h(b.type === 'number' ? 'ol' : 'ul', { class: b.type === 'todo' ? 'todo' : null });
        listType = b.type;
      }
      if (b.type === 'todo') {
        const li = h('li', { class: b.checked ? 'done' : null });
        li.append(h('input', { type: 'checkbox', checked: b.checked, disabled: !onTodo, 'aria-label': b.text, onchange: (e) => { li.classList.toggle('done', e.target.checked); onTodo(b, e.target.checked); } }), h('span', null, inline(b.text)));
        list.append(li);
      } else {
        list.append(h('li', null, inline(b.text)));
      }
      continue;
    }
    flush();
    if (b.type === 'h1') out.push(h('h2', null, inline(b.text)));
    else if (b.type === 'h2') out.push(h('h3', null, inline(b.text)));
    else if (b.type === 'h3') out.push(h('h4', null, inline(b.text)));
    else if (b.type === 'quote') out.push(h('blockquote', null, inline(b.text)));
    else if (b.type === 'divider') out.push(h('hr'));
    else if (b.type === 'callout') {
      const tone = toneOf(b.tone);
      out.push(h('div', { class: `callout callout-${tone.key}` }, h('span', { class: 'callout-icon', title: tone.label }, icon(tone.icon, 18)), h('div', null, inline(b.text))));
    } else if (b.type === 'toggle') {
      out.push(h('details', null, h('summary', null, inline(b.text || '토글')), (b.body || '').split('\n').filter((l) => l.trim()).map((l) => h('p', null, inline(l)))));
    } else out.push(h('p', null, inline(b.text)));
  }
  flush();
  return out;
}

function starsView(n) {
  const wrap = h('span', { class: 'stars', role: 'img', 'aria-label': `별점 ${n}점` });
  for (let i = 1; i <= 5; i += 1) wrap.append(h('span', { class: i <= n ? 'is-on' : '' }, icon('star', 16)));
  return wrap;
}

// ── 편집기 ───────────────────────────────────────────────
function blockEditor(review, touched) {
  const wrap = h('div', { class: 'nedit' });
  const blocks = review.blocks;
  const indexOf = (id) => blocks.findIndex((b) => b.id === id);

  // 블록을 다시 그린 바로 그 자리에서 포커스를 옮긴다. 한 박자라도 늦으면 그 사이에 친 글자가 사라지고,
  // 휴대폰에서는 화면 키보드가 내려갔다 올라온다.
  const focusBlock = (id, pos = 'end') => {
    const ta = wrap.querySelector(`[data-id="${CSS.escape(id)}"] [data-main]`);
    if (!ta) return;
    ta.focus();
    const n = pos === 'start' ? 0 : pos === 'end' ? ta.value.length : Math.min(pos, ta.value.length);
    try { ta.setSelectionRange(n, n); } catch { /* 선택 범위를 못 잡는 입력칸 */ }
  };

  const paint = (focusId, pos) => {
    let n = 0;
    wrap.replaceChildren(...blocks.map((b) => { n = b.type === 'number' ? n + 1 : 0; return row(b, n); }),
      h('button', { class: 'nb-add', type: 'button', onclick: () => { const nb = { id: uid('k'), type: 'p', text: '' }; blocks.push(nb); paint(nb.id); touched(); } }, icon('plus', 16), '블록 추가'));
    if (focusId) focusBlock(focusId, pos);
  };

  const convert = (b, type) => {
    b.type = type;
    delete b.seed;
    if (type !== 'todo') delete b.checked; else b.checked = Boolean(b.checked);
    if (type !== 'callout') delete b.tone; else b.tone = b.tone || 'gray';
    if (type !== 'toggle') delete b.body;
    if (type === 'divider') {
      b.text = '';
      const i = indexOf(b.id);
      if (i === blocks.length - 1) blocks.push({ id: uid('k'), type: 'p', text: '' });
      paint(blocks[i + 1].id, 'start');
    } else {
      paint(b.id);
    }
    touched();
  };

  const typeMenu = (b) => actionSheet({
    title: '블록 고르기',
    items: TYPES.map((t) => ({ label: t.label, hint: t.hint, onSelect: () => convert(b, t.key) })),
  });
  const toneMenu = (b) => actionSheet({
    title: '콜아웃 색',
    items: TONES.map((t) => ({ label: t.label, icon: t.icon, onSelect: () => { b.tone = t.key; paint(b.id); touched(); } })),
  });
  const blockMenu = (b) => {
    const i = indexOf(b.id);
    actionSheet({
      title: typeLabel(b.type),
      items: [
        { label: '종류 바꾸기', onSelect: async () => { await layersSettled(); typeMenu(b); } },
        b.type === 'callout' ? { label: '색 바꾸기', onSelect: async () => { await layersSettled(); toneMenu(b); } } : null,
        i > 0 ? { label: '위로 옮기기', icon: 'arrow-up', onSelect: () => { blocks.splice(i - 1, 0, blocks.splice(i, 1)[0]); paint(b.id); touched(); } } : null,
        i < blocks.length - 1 ? { label: '아래로 옮기기', icon: 'arrow-down', onSelect: () => { blocks.splice(i + 1, 0, blocks.splice(i, 1)[0]); paint(b.id); touched(); } } : null,
        { label: '아래에 블록 추가', icon: 'plus', onSelect: () => { const nb = { id: uid('k'), type: 'p', text: '' }; blocks.splice(i + 1, 0, nb); paint(nb.id); touched(); } },
        { label: '블록 지우기', icon: 'trash', danger: true, onSelect: () => {
          blocks.splice(i, 1);
          if (!blocks.length) blocks.push({ id: uid('k'), type: 'p', text: '' });
          paint(blocks[Math.max(0, i - 1)].id);
          touched();
        } },
      ],
    });
  };

  /** 줄 맨 앞에서 지우기: 꾸밈을 벗기고, 이미 텍스트면 윗줄에 붙인다. 처리했으면 true. */
  const backspaceAtStart = (b) => {
    const i = indexOf(b.id);
    if (b.type !== 'p') { convert(b, 'p'); focusBlock(b.id, 'start'); return true; }
    if (i <= 0) return false;
    const prev = blocks[i - 1];
    if (prev.type === 'divider') { blocks.splice(i - 1, 1); paint(b.id, 'start'); touched(); return true; }
    const at = (prev.text || '').length;
    prev.text = (prev.text || '') + (b.text || '');
    blocks.splice(i, 1);
    paint(prev.id, at);
    touched();
    return true;
  };

  const onInput = (b, ta, composing) => {
    const v = ta.value;
    if (composing) { b.text = v; touched(); return; }

    if (v.includes('\n')) {                               // 줄바꿈 → 블록 나누기
      const parts = v.split('\n');
      const i = indexOf(b.id);
      const listy = LISTY.has(b.type);
      if (listy && parts.every((t) => t === '')) { convert(b, 'p'); focusBlock(b.id, 'start'); return; }   // 빈 목록에서 Enter: 목록 끝
      b.text = parts[0];
      const rest = parts.slice(1).map((t) => ({ id: uid('k'), type: listy ? b.type : 'p', text: t, ...(b.type === 'todo' ? { checked: false } : {}) }));
      blocks.splice(i + 1, 0, ...rest);
      paint(rest[rest.length - 1].id, parts.length === 2 ? 'start' : 'end');
      touched();
      return;
    }

    if (b.type === 'p') {                                  // 단축 입력
      if (v === '---') {
        b.type = 'divider'; b.text = '';
        const i = indexOf(b.id);
        if (i === blocks.length - 1) blocks.push({ id: uid('k'), type: 'p', text: '' });
        paint(blocks[i + 1].id, 'start'); touched(); return;
      }
      if (v === '/') { b.text = ''; ta.value = ''; typeMenu(b); touched(); return; }
      const m = v.match(/^(#{1,3}|[-*]|1\.|\[ ?\]|>) ([\s\S]*)$/);
      if (m) {
        const caret = Math.max(0, ta.selectionStart - (m[1].length + 1));
        b.text = m[2];
        b.type = SHORTCUT[m[1]] || 'todo';
        if (b.type === 'todo') b.checked = false;
        paint(b.id, caret);
        touched();
        return;
      }
    }
    b.text = v;
    if (b.seed) delete b.seed;
    touched();
  };

  const onKey = (b, ta, e) => {
    if (e.isComposing || e.keyCode === 229) return;
    const atStart = ta.selectionStart === 0 && ta.selectionEnd === 0;
    if (e.key === 'Backspace' && atStart) { if (backspaceAtStart(b)) e.preventDefault(); return; }
    const i = indexOf(b.id);
    if (e.key === 'ArrowUp' && atStart) {
      const prev = blocks.slice(0, i).reverse().find((x) => x.type !== 'divider');
      if (prev) { e.preventDefault(); focusBlock(prev.id, 'end'); }
    } else if (e.key === 'ArrowDown' && ta.selectionStart === ta.value.length) {
      const next = blocks.slice(i + 1).find((x) => x.type !== 'divider');
      if (next) { e.preventDefault(); focusBlock(next.id, 'start'); }
    }
  };

  function row(b, number) {
    const tone = b.type === 'callout' ? ` nb-tone-${toneOf(b.tone).key}` : '';
    const el = h('div', { class: `nb nb--${b.type}${tone}${b.checked ? ' is-done' : ''}`, dataset: { id: b.id } },
      h('button', { class: 'nb-handle', type: 'button', 'aria-label': `${typeLabel(b.type)} 블록 메뉴`, onclick: () => blockMenu(b) }, icon('more', 16)));
    if (b.type === 'divider') { el.append(h('span', { class: 'nb-rule' }, h('hr'))); return el; }

    if (b.type === 'bullet') el.append(h('span', { class: 'nb-mark', 'aria-hidden': 'true' }, '•'));
    if (b.type === 'number') el.append(h('span', { class: 'nb-mark tnum', 'aria-hidden': 'true' }, `${number}.`));
    if (b.type === 'todo') el.append(h('input', { class: 'nb-check', type: 'checkbox', checked: Boolean(b.checked), 'aria-label': '끝냄', onchange: (e) => { b.checked = e.target.checked; el.classList.toggle('is-done', b.checked); touched(); } }));
    if (b.type === 'callout') el.append(h('button', { class: 'nb-tone', type: 'button', 'aria-label': `콜아웃 색: ${toneOf(b.tone).label}`, onclick: () => toneMenu(b) }, icon(toneOf(b.tone).icon, 18)));

    const ta = h('textarea', { class: 'nb-text', rows: '1', 'data-main': '', maxlength: '4000', placeholder: b.ph || PLACEHOLDER[b.type] || '', 'aria-label': typeLabel(b.type), autocapitalize: 'off' });
    ta.value = b.text || '';
    autoGrow(ta);
    ta.addEventListener('input', (e) => onInput(b, ta, e.isComposing));
    ta.addEventListener('compositionend', () => onInput(b, ta, false));
    ta.addEventListener('keydown', (e) => onKey(b, ta, e));
    ta.addEventListener('beforeinput', (e) => {
      // 화면 키보드는 keydown 대신 이것만 보내는 경우가 있다.
      if (e.inputType === 'deleteContentBackward' && !e.isComposing && ta.selectionStart === 0 && ta.selectionEnd === 0 && backspaceAtStart(b)) e.preventDefault();
    });
    if (b.type === 'toggle') {
      const body = h('textarea', { class: 'nb-body', rows: '2', maxlength: '4000', placeholder: '펼치면 보이는 내용', 'aria-label': '토글 내용' });
      body.value = b.body || '';
      autoGrow(body);
      body.addEventListener('input', () => { b.body = body.value; touched(); });
      el.append(h('span', { class: 'nb-stack' }, ta, body));
    } else {
      el.append(ta);
    }
    return el;
  }

  paint();
  return wrap;
}

function propsEditor(review, touched) {
  const p = review.props;
  const starBtns = [];
  const paintStars = () => starBtns.forEach((b, i) => { b.classList.toggle('is-on', i < p.rating); b.setAttribute('aria-pressed', String(i < p.rating)); });
  for (let i = 1; i <= 5; i += 1) {
    starBtns.push(h('button', { class: 'star-btn', type: 'button', 'aria-label': `별점 ${i}점`, onclick: () => { p.rating = p.rating === i ? 0 : i; paintStars(); touched(); } }, icon('star', 22)));
  }
  paintStars();
  const text = (id, value, set, placeholder, multi = false) => {
    const el = h(multi ? 'textarea' : 'input', { class: 'nprop-input', id, placeholder, rows: multi ? '1' : null, maxlength: '400', autocomplete: 'off' });
    el.value = value || '';
    if (multi) autoGrow(el);
    el.addEventListener('input', () => { set(multi ? el.value : el.value.replace(/\n/g, ' ')); touched(); });
    return el;
  };
  const rowOf = (label, control, forId) => h('div', { class: 'nprop' }, forId ? h('label', { class: 'nprop-key', for: forId }, label) : h('span', { class: 'nprop-key' }, label), h('div', { class: 'nprop-val' }, control));
  return h('div', { class: 'nprops' },
    rowOf('별점', h('span', { class: 'star-row' }, starBtns)),
    rowOf('한 줄', text('rv-line', p.oneLine, (v) => { p.oneLine = v; }, '이 책을 한 문장으로', true), 'rv-line'),
    rowOf('읽기 전', text('rv-before', p.before, (v) => { p.before = v; }, '읽기 전에 하던 생각', true), 'rv-before'),
    rowOf('읽은 뒤', text('rv-after', p.after, (v) => { p.after = v; }, '지금 하는 생각', true), 'rv-after'),
    rowOf('키워드', text('rv-tags', (p.tags || []).join(', '), (v) => { p.tags = v.split(',').map((t) => t.trim()).filter(Boolean).slice(0, 8); }, '쉼표로 나눠 적습니다'), 'rv-tags'));
}

function propsView(review) {
  const p = review.props || {};
  const rows = [];
  const add = (label, node) => rows.push(h('div', { class: 'nprop' }, h('span', { class: 'nprop-key' }, label), h('div', { class: 'nprop-val' }, node)));
  if (p.rating) add('별점', starsView(p.rating));
  if ((p.oneLine || '').trim()) add('한 줄', p.oneLine);
  if ((p.before || '').trim()) add('읽기 전', p.before);
  if ((p.after || '').trim()) add('읽은 뒤', p.after);
  if ((p.tags || []).length) add('키워드', h('span', { class: 'ntags' }, p.tags.map((t) => h('span', { class: 'ntag' }, t))));
  return rows.length ? h('div', { class: 'nprops' }, rows) : null;
}

/** 리뷰 화면을 연다. edit=true면 편집 상태로 시작한다(기록 모드에서만). */
export function openReview(bookId, { edit = false } = {}) {
  const book = getBook(bookId);
  if (!book) return;
  const review = structuredClone(book.review || blankReview());
  review.props = { rating: 0, oneLine: '', before: '', after: '', tags: [], ...(review.props || {}) };
  review.blocks = Array.isArray(review.blocks) && review.blocks.length ? review.blocks : blankReview().blocks;
  let editing = edit && canEdit();
  let dirty = false;
  let timer = null;

  const status = h('span', { class: 'ndoc-status', 'aria-live': 'polite' });
  const toggle = h('button', { class: 'btn btn--sm', type: 'button' });
  const doc = h('article', { class: 'ndoc' });

  const save = async () => {
    clearTimeout(timer);
    if (!dirty) return;
    dirty = false;
    await saveReview(bookId, review);
    status.textContent = '저장됨';
  };
  const touched = () => {
    dirty = true;
    status.textContent = '쓰는 중';
    clearTimeout(timer);
    timer = setTimeout(save, 900);
  };

  const header = () => [
    h('div', { class: 'ndoc-icon', 'aria-hidden': 'true' }, icon('book', 30)),
    h('h1', null, book.title),
    h('p', { class: 'ndoc-meta' },
      book.tag ? h('span', { class: 'ntag' }, book.tag) : null,
      book.finishedAt ? h('span', { class: 'tnum' }, `${fmtDate(book.finishedAt)} 완독`) : null,
      book.author ? h('span', null, book.author) : null),
    h('hr'),
  ];

  const paint = () => {
    toggle.textContent = editing ? '완료' : '편집';
    doc.classList.toggle('is-editing', editing);
    if (editing) {
      doc.replaceChildren(...header(), propsEditor(review, touched), blockEditor(review, touched));
    } else {
      const body = readBlocks(review.blocks, canEdit() ? (b, checked) => { b.checked = checked; touched(); } : null);
      const props = propsView(review);
      doc.replaceChildren(...header(), props, ...(body.length || props ? body : [h('p', { class: 'ndoc-empty' }, canEdit() ? '아직 쓴 것이 없습니다. 편집을 눌러 시작하세요.' : '아직 쓴 것이 없습니다.')]));
    }
  };
  toggle.addEventListener('click', async () => {
    if (editing) await save();
    editing = !editing;
    paint();
    doc.scrollIntoView({ block: 'start' });
  });

  openModal({
    title: '리뷰',
    page: true,
    cls: 'dialog--doc',
    content: doc,
    headExtra: canEdit() ? h('div', { class: 'dialog-tools' }, status, toggle) : null,
    onClose: () => { save().then(() => emit('lib', { reason: 'review' })); },
  });
  paint();
}
