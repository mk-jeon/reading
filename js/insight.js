// insight.js — 책장을 보고 적는 몇 줄. 전부 기록에서 계산한다(토큰을 쓰지 않는다).

import { ME } from './me-data.js';
import { RIVALS } from './seed.js';
import { fmtDate, fmtNum, josa } from './dom.js';

const DAY = 86400000;

function shelfLine(books) {
  const count = new Map();
  for (const b of books) { const t = b.tag || '분야 미정'; count.set(t, (count.get(t) || 0) + 1); }
  const parts = [...count.entries()].sort((a, b) => b[1] - a[1]).map(([t, n]) => `${t} ${n}`);
  return `책장에 ${books.length}권이 있습니다. ${parts.join(', ')}.`;
}

/** 읽는 중인 책의 속도와 끝나는 날 어림 */
function paceLines(reading) {
  const out = [];
  for (const b of reading) {
    if (!b.totalPages || !b.startedAt || b.page <= 0 || b.page >= b.totalPages) continue;
    const started = new Date(b.startedAt).getTime();
    if (!Number.isFinite(started) || started > Date.now()) continue;
    const days = Math.max(1, Math.ceil((Date.now() - started) / DAY));
    const perDay = b.page / days;
    const left = Math.ceil((b.totalPages - b.page) / perDay);
    if (!(perDay > 0) || !Number.isFinite(left) || left > 3650) continue;      // 너무 먼 날짜는 적지 않는다
    const eta = new Date(Date.now() + left * DAY).toISOString();
    out.push(`『${b.title}』${josa(b.title, '은', '는')} 하루 평균 ${fmtNum(Math.max(1, Math.round(perDay)))}쪽입니다. 이 속도면 ${fmtDate(eta)}쯤 끝납니다.`);
  }
  return out;
}

function rivalLines(books) {
  const titles = new Set(books.map((b) => b.title));
  const out = [];
  for (const r of RIVALS) {
    if (titles.has(r.a) && !titles.has(r.b)) out.push(`『${r.a}』${josa(r.a, '과', '와')} 맞세워 읽을 책은 『${r.b}』입니다. 쟁점은 「${r.axis}」입니다.`);
    else if (titles.has(r.b) && !titles.has(r.a)) out.push(`『${r.b}』${josa(r.b, '과', '와')} 맞세워 읽을 책은 『${r.a}』입니다. 쟁점은 「${r.axis}」입니다.`);
  }
  return out.slice(0, 2);
}

function recommendLine(books) {
  const titles = new Set(books.map((b) => b.title));
  const rest = ME.books.flatMap((g) => g.items).filter((it) => !titles.has(it.title));
  if (!rest.length) return null;
  const pick = rest.find((it) => it.first) || rest[0];
  return `권하는 책 가운데 아직 책장에 없는 것은 『${pick.title}』입니다.`;
}

/** @returns {{ lines: string[], memo: { by: string, at: string, lines: string[] } }} */
export function buildInsights(lib) {
  const books = Object.values(lib.books);
  const reading = books.filter((b) => b.status === 'reading');
  const done = books.filter((b) => b.status === 'done');
  const lines = [];
  // 한 줄이 계산에서 어긋나도 나머지 줄과 화면은 그대로 나오게 한다.
  const add = (make) => { try { const out = make(); for (const l of [].concat(out || [])) if (l) lines.push(l); } catch { /* 이 줄은 건너뛴다 */ } };
  add(() => (books.length ? shelfLine(books) : null));
  add(() => (done.length ? `완독은 ${done.length}권, 넘긴 쪽수는 모두 ${fmtNum(books.reduce((n, b) => n + (b.page || 0), 0))}쪽입니다.` : null));
  add(() => paceLines(reading));
  add(() => (reading.length >= 3 ? `읽는 중이 ${reading.length}권입니다. 두 권으로 줄이면 한 권이 끝나는 날이 앞당겨집니다.` : null));
  add(() => rivalLines(books));
  add(() => recommendLine(books));
  return { lines, memo: lib.insight };
}
