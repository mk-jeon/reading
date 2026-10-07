// history.js — 「히스토리」 탭. 언제 무엇을 읽었고 생각이 어떻게 움직였는지를 연혁처럼 한 줄씩 적는다.
// 「새 리뷰 확인」은 저장소에서 최신 기록을 받은 뒤, 아직 읽지 않은 리뷰만 골라 분석한다(analyze.js).

import { analyzeDelta, pendingReviews, reviewHash } from './analyze.js';
import { fmtDate, fmtNum, h, icon } from './dom.js';
import { canEdit, hasReviewContent, state } from './store.js';
import { refreshViewer, syncNow } from './sync.js';

let busy = false;
let lastResult = null;       // 마지막 확인 결과(탭을 떠났다 와도 보이게)

const wait = (ms) => new Promise((res) => setTimeout(res, ms));

/** 기록에서 연혁의 줄을 만든다. 시작·완독은 책에서, 한 줄 요약은 분석 스냅샷에서 가져온다. */
function timeline(lib) {
  const rows = [];
  const reviewed = new Map(lib.history.entries.filter((e) => e.kind === 'review').map((e) => [e.bookId, e]));
  for (const e of lib.history.entries) {
    if (e.kind === 'milestone') rows.push({ at: e.date, order: 0, kind: 'milestone', title: e.title, line: e.line });
  }
  for (const b of Object.values(lib.books)) {
    if (b.startedAt) rows.push({ at: b.startedAt, order: 1, kind: 'start', title: `『${b.title}』 읽기 시작`, bookId: b.id });
    if (b.status === 'done' && b.finishedAt) {
      const e = reviewed.get(b.id);
      const fresh = e && e.hash === reviewHash(b);
      let wait_ = '';
      if (!hasReviewContent(b)) wait_ = '리뷰 전';
      else if (!fresh) wait_ = e ? '고친 리뷰 확인 전' : '새 리뷰 확인 전';
      rows.push({ at: b.finishedAt, order: 2, kind: 'done', title: `『${b.title}』 완독`, line: e ? e.line : '', shift: e ? e.shift : '', engine: e ? e.engine : '', pending: wait_, bookId: b.id });
    }
  }
  return rows.sort((a, b) => String(b.at).localeCompare(String(a.at)) || b.order - a.order);
}

function loader() {
  return h('div', { class: 'flip', role: 'status' },
    h('span', { class: 'flip-book', 'aria-hidden': 'true' }, h('i', { class: 'flip-left' }), h('i', { class: 'flip-right' }), h('i', { class: 'flip-page' })),
    h('span', null, '새로 쓴 리뷰가 있는지 넘겨 보는 중입니다.'));
}

function resultLine(r) {
  if (!r) return null;
  if (r.viewer) {
    if (!r.fetched) return h('p', { class: 'hist-result' }, '공개된 기록을 받지 못했습니다. 아직 올린 기록이 없거나 연결이 끊겨 있습니다.');
    return h('p', { class: 'hist-result' }, r.pending
      ? `공개된 기록을 새로 받았습니다. 확인하지 않은 리뷰가 ${r.pending}건 있습니다. 분석은 기록 모드에서 할 수 있습니다.`
      : '공개된 기록을 새로 받았습니다. 새로 읽을 리뷰는 없습니다.');
  }
  if (r.error) return h('p', { class: 'hist-result is-bad' }, r.error);
  const parts = [];
  if (r.added) parts.push(`새 리뷰 ${r.added}건을 읽어 연혁에 더했습니다.`);
  else parts.push('새로 읽을 리뷰가 없습니다.');
  if (r.skipped) parts.push(`이미 읽은 ${r.skipped}건은 다시 읽지 않았습니다.`);
  if (r.added) parts.push(r.engine === 'claude' ? 'Claude가 새 리뷰와 이전 요약만 받아 분석했습니다.' : '직접 쓴 한 줄과 읽기 전·후로 채웠습니다.');
  if (r.note) parts.push(r.note);
  return h('p', { class: 'hist-result' }, parts.join(' '));
}

async function runCheck(rerender) {
  if (busy) return;
  busy = true;
  lastResult = null;
  rerender();
  const started = performance.now();
  let result;
  try {
    let fetched = false;
    if (state.mode === 'owner') await syncNow();
    else if (state.mode === 'viewer') fetched = await refreshViewer();
    if (canEdit()) result = await analyzeDelta();
    else result = { viewer: true, fetched, pending: pendingReviews(state.lib).length };
  } catch (e) {
    result = { error: `확인하지 못했습니다. ${e.message || ''}`.trim() };
  }
  const rest = 1400 - (performance.now() - started);       // 무엇을 하는지 읽을 틈
  if (rest > 0) await wait(rest);
  busy = false;
  lastResult = result;
  rerender();
}

function stats(lib) {
  const books = Object.values(lib.books);
  const done = books.filter((b) => b.status === 'done');
  const reading = books.filter((b) => b.status === 'reading');
  const pages = books.reduce((n, b) => n + (b.page || 0), 0);
  const tags = new Map();
  for (const b of done) for (const t of ((b.review && b.review.props && b.review.props.tags) || [])) tags.set(t, (tags.get(t) || 0) + 1);
  const top = [...tags.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  const cell = (label, value) => h('div', { class: 'stat' }, h('span', { class: 'stat-key' }, label), h('strong', { class: 'stat-val tnum' }, value));
  return h('section', { class: 'sec' },
    h('div', { class: 'sec-head' }, h('h2', { class: 'sec-title' }, '지금까지'), h('p', { class: 'sec-cap' }, '기록에서 센 숫자와, 분석이 남긴 흐름')),
    h('div', { class: 'stats' }, cell('완독', `${done.length}권`), cell('읽는 중', `${reading.length}권`), cell('넘긴 쪽', fmtNum(pages))),
    lib.history.summary ? h('p', { class: 'flow' }, lib.history.summary) : h('p', { class: 'note' }, '리뷰가 쌓이면 여기에 흐름이 몇 문장으로 적힙니다.'),
    top.length ? h('div', { class: 'ntags' }, top.map(([t, n]) => h('span', { class: 'tag' }, `${t} ${n}`))) : null);
}

export function renderHistory(root) {
  const lib = state.lib;
  const rerender = () => { if (root.isConnected && root.dataset.view === 'history') renderHistory(root); };
  const rows = timeline(lib);
  const pending = pendingReviews(lib).length;

  const groups = [];
  for (const r of rows) {
    const year = String(new Date(r.at).getFullYear());
    let g = groups[groups.length - 1];
    if (!g || g.year !== year) { g = { year, rows: [] }; groups.push(g); }
    g.rows.push(r);
  }

  const check = h('div', { class: 'hist-check' },
    h('button', { class: 'btn btn--primary', type: 'button', disabled: busy, onclick: () => runCheck(rerender) }, icon('refresh', 18), '새 리뷰 확인'),
    h('p', { class: 'note' },
      pending ? `확인 전인 리뷰 ${pending}건. ` : '',
      lib.history.checkedAt ? `마지막 확인 ${fmtDate(lib.history.checkedAt)}` : '아직 확인한 적이 없습니다.'));

  const list = groups.length
    ? h('div', { class: 'tl' }, groups.map((g) => h('section', { class: 'tl-year' },
      h('h3', { class: 'tl-yearno tnum' }, g.year),
      h('ol', { class: 'tl-rows' }, g.rows.map((r) => h('li', { class: `tl-row tl-row--${r.kind}` },
        h('span', { class: 'tl-date tnum' }, fmtDate(r.at, { year: false })),
        h('div', { class: 'tl-body' },
          r.bookId ? h('a', { class: 'tl-title', href: `#/reading/b/${r.bookId}` }, r.title) : h('p', { class: 'tl-title' }, r.title),
          r.line ? h('p', { class: 'tl-line' }, r.line) : null,
          r.shift ? h('p', { class: 'tl-shift' }, h('b', null, '달라진 것'), r.shift) : null,
          r.engine || r.pending ? h('p', { class: 'tl-tags' },
            r.engine ? h('span', { class: 'tag' }, r.engine === 'claude' ? 'Claude 분석' : '직접 쓴 한 줄') : null,
            r.pending ? h('span', { class: 'chip chip--wait' }, r.pending) : null) : null)))))))
    : h('p', { class: 'note' }, '아직 적힌 줄이 없습니다.');

  const main = h('section', { class: 'sec' },
    h('div', { class: 'sec-head' }, h('h2', { class: 'sec-title' }, '히스토리'), h('p', { class: 'sec-cap' }, '언제 무엇을 읽었고, 생각이 어떻게 움직였는지 한 줄씩.')),
    check,
    busy ? loader() : resultLine(lastResult),
    list);

  root.replaceChildren(h('div', { class: 'hist' }, main, stats(lib)));
}
