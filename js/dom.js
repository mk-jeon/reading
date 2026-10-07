// dom.js — 화면을 짓는 도우미, 아이콘, 겹침 창(모달)·토스트.
// 규칙: 사용자가 쓴 글은 언제나 텍스트 노드로 넣는다(innerHTML 금지).
//       브라우저 기본 alert/confirm/prompt는 쓰지 않는다.

const BOOL_PROPS = new Set(['disabled', 'checked', 'hidden', 'required', 'readOnly', 'selected', 'open', 'multiple', 'autofocus']);

/** 속성에 넣어도 되는 주소인지: 이 사이트 안의 주소(#…, 상대 경로), https, blob 만 받는다. */
function safeURL(value) {
  const v = String(value).replace(/[\u0000-\u0020]+/g, '');
  return !/^[a-z][a-z0-9+.-]*:/i.test(v) || /^(https:|blob:)/i.test(v);
}

export function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k === 'style') { for (const [p, val] of Object.entries(v)) el.style.setProperty(p, String(val)); }
      else if (k === 'value') el.value = v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (BOOL_PROPS.has(k)) el[k] = Boolean(v);
      else if (k === 'for') el.htmlFor = v;
      else if ((k === 'href' || k === 'src') && !safeURL(v)) continue;      // 정해 둔 종류의 주소가 아니면 넣지 않는다
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  append(el, kids);
  return el;
}

export function append(el, kids) {
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false || kid === '') continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

export function clear(el) { el.replaceChildren(); return el; }

// ── 아이콘: 선 아이콘(획 1.75), 색은 currentColor ─────────────
const SVG_NS = 'http://www.w3.org/2000/svg';
const P = (d) => ['path', { d }];
const C = (cx, cy, r) => ['circle', { cx, cy, r }];
const ICONS = {
  user: [P('M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2'), C(12, 7, 4)],
  book: [P('M12 7v14'), P('M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z')],
  clock: [C(12, 12, 10), P('M12 6v6l4 2')],
  sliders: [P('M4 21v-7'), P('M4 10V3'), P('M12 21v-9'), P('M12 8V3'), P('M20 21v-5'), P('M20 12V3'), P('M2 14h4'), P('M10 8h4'), P('M18 16h4')],
  plus: [P('M5 12h14'), P('M12 5v14')],
  x: [P('M18 6 6 18'), P('m6 6 12 12')],
  check: [P('M20 6 9 17l-5-5')],
  'chevron-left': [P('m15 18-6-6 6-6')],
  'chevron-right': [P('m9 18 6-6-6-6')],
  'chevron-down': [P('m6 9 6 6 6-6')],
  camera: [P('M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z'), C(12, 13, 3)],
  image: [['rect', { x: 3, y: 3, width: 18, height: 18, rx: 2 }], C(9, 9, 2), P('m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21')],
  more: [C(5, 12, 1), C(12, 12, 1), C(19, 12, 1)],
  trash: [P('M3 6h18'), P('M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6'), P('M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2')],
  pencil: [P('M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z'), P('m15 5 4 4')],
  refresh: [P('M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8'), P('M21 3v5h-5'), P('M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16'), P('M8 16H3v5')],
  cloud: [P('M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z')],
  bookmark: [P('m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z')],
  star: [P('M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z')],
  'arrow-up': [P('m5 12 7-7 7 7'), P('M12 19V5')],
  'arrow-down': [P('M12 5v14'), P('m19 12-7 7-7-7')],
  'arrow-right': [P('M5 12h14'), P('m12 5 7 7-7 7')],
  bulb: [P('M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5'), P('M9 18h6'), P('M10 22h4')],
  info: [C(12, 12, 10), P('M12 16v-4'), P('M12 8h.01')],
  'check-circle': [P('M21.8 10A10 10 0 1 1 17 3.34'), P('m9 11 3 3L22 4')],
  alert: [P('m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3'), P('M12 9v4'), P('M12 17h.01')],
  stop: [P('M7.86 2h8.28L22 7.86v8.28L16.14 22H7.86L2 16.14V7.86L7.86 2z'), P('M12 8v4'), P('M12 16h.01')],
  download: [P('M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4'), P('M7 10l5 5 5-5'), P('M12 15V3')],
  eye: [P('M2.06 12.35a1 1 0 0 1 0-.7 10.75 10.75 0 0 1 19.88 0 1 1 0 0 1 0 .7 10.75 10.75 0 0 1-19.88 0'), C(12, 12, 3)],
  sun: [C(12, 12, 4), P('M12 2v2'), P('M12 20v2'), P('m4.93 4.93 1.41 1.41'), P('m17.66 17.66 1.41 1.41'), P('M2 12h2'), P('M20 12h2'), P('m6.34 17.66-1.41 1.41'), P('m19.07 4.93-1.41 1.41')],
  moon: [P('M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z')],
};

export function icon(name, size = 20) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  const attrs = { viewBox: '0 0 24 24', width: size, height: size, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.75, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', focusable: 'false' };
  for (const [k, v] of Object.entries(attrs)) svg.setAttribute(k, v);
  for (const [tag, a] of ICONS[name] || []) {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(a)) node.setAttribute(k, v);
    svg.append(node);
  }
  return svg;
}

// ── 겹침 창 ────────────────────────────────────────────────
const stack = [];
let layerRoot = null;
let toastRoot = null;
let lockCount = 0;
let pendingPops = 0;          // 코드가 부른 history.back() 가운데 아직 popstate가 오지 않은 수
let popWaiters = [];

function roots() {
  if (!layerRoot) {
    layerRoot = h('div', { id: 'layers' });
    toastRoot = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' });
    document.body.append(layerRoot, toastRoot);
    // 기기의 뒤로 가기는 맨 위 창을 닫는다.
    window.addEventListener('popstate', () => {
      if (pendingPops > 0) {
        pendingPops -= 1;
        if (!pendingPops) { const w = popWaiters; popWaiters = []; w.forEach((fn) => fn()); }
        return;
      }
      const top = stack[stack.length - 1];
      if (top) top.close(undefined, { fromHistory: true });
    });
  }
}

/** 창을 닫으며 부른 history.back()이 끝난 뒤에 풀린다. 주소(해시)를 바꾸기 전에 기다린다. */
export function layersSettled() {
  if (!pendingPops) return Promise.resolve();
  return new Promise((res) => {
    popWaiters.push(res);
    setTimeout(res, 400);       // popstate가 오지 않는 환경을 위한 안전판
  });
}

function focusables(root) {
  return [...root.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])')]
    .filter((el) => el.offsetParent !== null || el === document.activeElement);
}

export function isLayerOpen() { return stack.length > 0; }

/**
 * 겹침 창을 연다. ESC·바깥 누르기·뒤로 가기로 닫히고, 포커스를 가두었다가 닫을 때 되돌린다.
 * @returns {{ close: (result?: any) => void, el: HTMLElement, body: HTMLElement, closed: Promise<any> }}
 */
export function openModal({ title, content, actions = [], page = false, dismissible = true, onClose, labelHidden = false, headExtra = null, cls = '' }) {
  roots();
  const opener = document.activeElement;
  const titleId = `dlg-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  let resolveClosed;
  const closed = new Promise((res) => { resolveClosed = res; });
  let done = false;

  const body = h('div', { class: 'dialog-body' }, content);
  const closeBtn = h('button', { class: 'icon-btn', type: 'button', 'aria-label': '닫기', onclick: () => api.close() }, icon(page ? 'chevron-left' : 'x'));
  const titleEl = h('h2', { class: labelHidden ? 'sr-only' : 'dialog-title', id: titleId }, title);
  const head = page
    ? h('div', { class: 'dialog-head' }, h('div', { class: 'dialog-headline' }, closeBtn, titleEl), headExtra)
    : h('div', { class: 'dialog-head' }, titleEl, dismissible ? closeBtn : null);
  const foot = actions.length
    ? h('div', { class: 'dialog-foot' }, actions.map((a) => h('button', {
      class: `btn ${a.kind === 'primary' ? 'btn--primary' : a.kind === 'danger' ? 'btn--danger' : a.kind === 'quiet' ? 'btn--quiet' : ''}`.trim(),
      type: 'button', disabled: a.disabled, dataset: a.id ? { action: a.id } : undefined,
      onclick: async (e) => {
        const btn = e.currentTarget;
        if (!a.onClick) { api.close(a.value); return; }
        btn.disabled = true;
        try { const keep = await a.onClick(api); if (keep !== false) api.close(a.value); } finally { btn.disabled = false; }
      },
    }, a.label)))
    : null;
  const dialog = h('div', { class: `dialog${page ? ' dialog--page' : ''}${cls ? ` ${cls}` : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId, tabindex: '-1' }, head, body, foot);
  const layer = h('div', { class: `layer${page ? ' layer--page' : ''}` }, dialog);

  layer.addEventListener('mousedown', (e) => { if (e.target === layer && dismissible) api.close(); });
  dialog.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && dismissible && stack[stack.length - 1] === api) { e.stopPropagation(); api.close(); return; }
    if (e.key !== 'Tab') return;
    const f = focusables(dialog);
    if (!f.length) { e.preventDefault(); return; }
    const first = f[0];
    const last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });

  const api = {
    el: dialog, body, foot, closed,
    close(result, { fromHistory = false } = {}) {
      if (done) return;
      done = true;
      const i = stack.indexOf(api);
      if (i >= 0) stack.splice(i, 1);
      layer.remove();
      lockCount = Math.max(0, lockCount - 1);
      if (!lockCount) document.documentElement.classList.remove('is-locked');
      if (!fromHistory && history.state && history.state.dlg === titleId) { pendingPops += 1; history.back(); }
      if (opener && document.contains(opener) && typeof opener.focus === 'function') opener.focus({ preventScroll: true });
      if (onClose) onClose(result);
      resolveClosed(result);
    },
  };

  stack.push(api);
  lockCount += 1;
  document.documentElement.classList.add('is-locked');
  history.pushState({ dlg: titleId }, '');
  layerRoot.append(layer);
  const target = dialog.querySelector('[autofocus]') || (page ? dialog : focusables(body)[0]) || dialog;
  target.focus({ preventScroll: true });
  return api;
}

export function confirmDialog({ title, message, confirmLabel = '확인', cancelLabel = '취소', danger = false }) {
  return new Promise((resolve) => {
    let answered = false;
    openModal({
      title,
      content: h('p', null, message),
      actions: [
        { label: cancelLabel, kind: 'quiet', value: false },
        { label: confirmLabel, kind: danger ? 'danger' : 'primary', value: true },
      ],
      onClose: (v) => { if (!answered) { answered = true; resolve(v === true); } },
    });
  });
}

/** 고르는 목록(시트). items: [{ label, icon, danger, hint, onSelect }], note: 목록 위의 한 줄 안내 */
export function actionSheet({ title, items, note = '' }) {
  const m = openModal({
    title,
    content: h('div', { class: 'menu' }, note ? h('p', { class: 'note' }, note) : null, items.filter(Boolean).map((it) => h('button', {
      class: `menu-item${it.danger ? ' menu-item--danger' : ''}`, type: 'button',
      onclick: () => { m.close(); it.onSelect(); },
    }, it.icon ? icon(it.icon) : null, it.label, it.hint ? h('small', null, it.hint) : null))),
  });
  return m;
}

/** 잠깐 뜨는 알림. 같은 id의 알림은 새것으로 바뀐다(진행 중 → 결과). 한 번에 두 개까지만 보인다. */
export function toast(message, { duration = 2800, id = '', actionLabel, onAction } = {}) {
  roots();
  if (id) for (const old of toastRoot.querySelectorAll(`[data-id="${CSS.escape(id)}"]`)) old.remove();
  for (const old of [...toastRoot.children]) if (old.firstChild && old.firstChild.textContent === String(message)) old.remove();   // 같은 글을 겹쳐 띄우지 않는다
  const el = h('div', { class: 'toast', dataset: id ? { id } : undefined }, h('span', null, message),
    actionLabel ? h('button', { type: 'button', onclick: () => { el.remove(); onAction(); } }, actionLabel) : null);
  toastRoot.append(el);
  while (toastRoot.children.length > 2) toastRoot.firstChild.remove();
  setTimeout(() => el.remove(), duration);
}

// ── 자잘한 도우미 ─────────────────────────────────────────
export function fmtDate(iso, { year = true } = {}) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return year ? `${d.getFullYear()}.${mm}.${dd}` : `${mm}.${dd}`;
}

export function fmtNum(n) { return Number(n || 0).toLocaleString('ko-KR'); }

export function autoGrow(textarea) {
  const fit = () => { textarea.style.height = 'auto'; textarea.style.height = `${textarea.scrollHeight}px`; };
  textarea.addEventListener('input', fit);
  requestAnimationFrame(fit);
  return fit;
}

/**
 * 받침에 따라 조사를 고른다. josa('사피엔스', '은', '는') → '는', josa('40', '으로', '로') → '으로'
 *   · 끝에 붙은 괄호·문장부호는 건너뛰고 그 앞 글자를 본다: '총, 균, 쇠 (상)' → '상'
 *   · '(으)로'는 ㄹ 받침 뒤에서 '로'다: '서울로', '7로'
 *   · 읽는 법을 알 수 없는 글자(로마자 등)로 끝나면 두 가지를 함께 적는다: 'Zero to One을(를)'
 */
export function josa(word, withFinal, withoutFinal) {
  const text = String(word).replace(/[\s\p{P}\p{S}]+$/u, '');
  const ch = text.slice(-1);
  const code = ch ? ch.charCodeAt(0) : NaN;
  const ro = withFinal === '으로';
  if (code >= 0xac00 && code <= 0xd7a3) {
    const jong = (code - 0xac00) % 28;
    if (!jong) return withoutFinal;
    return ro && jong === 8 ? withoutFinal : withFinal;
  }
  if (/[0-9]/.test(ch)) {                 // 숫자는 읽는 소리로: 영 일 이 삼 사 오 육 칠 팔 구
    if (ro) return '036'.includes(ch) ? withFinal : withoutFinal;
    return '013678'.includes(ch) ? withFinal : withoutFinal;
  }
  return ro ? '(으)로' : `${withFinal}(${withoutFinal})`;
}
