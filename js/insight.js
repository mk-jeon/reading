// insight.js — 책장을 보고 적는 몇 줄. 전부 기록에서 계산한다(토큰을 쓰지 않는다).

import { ME } from './me-data.js';
import { RIVALS } from './seed.js';
import { fmtDate, fmtNum, josa } from './dom.js';

const DAY = 86400000;

function shelfLine(books) {
  const count = new Map();
  for (const b of books) { const t = b.tag || '분야 미정'; count.set(t, (count.get(t) || 0) + 1); }
  const parts = [...count.entries()].sort((a, b) => b[1] - a[1]).map(([t, n]) => `${t} ${n}`);
  return `책장에 ${books.length}권. ${parts.join(', ')}.`;
}

/** 읽는 중인 책의 속도와 끝나는 날 어림 */
function paceLines(reading) {
  const out = [];
  for (const b of reading) {
    if (!b.totalPages || !b.startedAt || b.page <= 0 || b.page >= b.totalPages) continue;
    const days = Math.max(1, Math.ceil((Date.now() - new Date(b.startedAt).getTime()) / DAY));
    const perDay = b.page / days;
    if (perDay <= 0) continue;
    const left = Math.ceil((b.totalPages - b.page) / perDay);
    const eta = new Date(Date.now() + left * DAY).toISOString();
    out.push(`『${b.title}』${josa(b.title, '은', '는')} 하루 평균 ${fmtNum(Math.max(1, Math.round(perDay)))}쪽. 이 속도면 ${fmtDate(eta)}쯤 끝난다.`);
  }
  return out;
}

function rivalLines(books) {
  const titles = new Set(books.map((b) => b.title));
  const out = [];
  for (const r of RIVALS) {
    if (titles.has(r.a) && !titles.has(r.b)) out.push(`『${r.a}』${josa(r.a, '과', '와')} 맞세워 읽을 책은 『${r.b}』. ${r.axis}.`);
    else if (titles.has(r.b) && !titles.has(r.a)) out.push(`『${r.b}』${josa(r.b, '과', '와')} 맞세워 읽을 책은 『${r.a}』. ${r.axis}.`);
  }
  return out.slice(0, 2);
}

function recommendLine(books) {
  const titles = new Set(books.map((b) => b.title));
  const rest = ME.books.flatMap((g) => g.items).filter((it) => !titles.has(it.title));
  if (!rest.length) return null;
  const pick = rest.find((it) => it.first) || rest[0];
  return `권하는 책 가운데 아직 책장에 없는 것: 『${pick.title}』. ${pick.why}`;
}

/** @returns {{ lines: string[], memo: { by: string, at: string, lines: string[] } }} */
export function buildInsights(lib) {
  const books = Object.values(lib.books);
  const reading = books.filter((b) => b.status === 'reading');
  const done = books.filter((b) => b.status === 'done');
  const lines = [];
  if (books.length) lines.push(shelfLine(books));
  if (done.length) lines.push(`완독 ${done.length}권, 넘긴 쪽수는 모두 ${fmtNum(books.reduce((n, b) => n + (b.page || 0), 0))}쪽.`);
  lines.push(...paceLines(reading));
  if (reading.length >= 3) lines.push(`읽는 중이 ${reading.length}권이다. 두 권으로 줄이면 한 권이 끝나는 날이 앞당겨진다.`);
  lines.push(...rivalLines(books));
  const rec = recommendLine(books);
  if (rec) lines.push(rec);
  return { lines, memo: lib.insight };
}
