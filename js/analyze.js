// analyze.js — 새로 쓴 리뷰만 읽어 연혁에 한 줄씩 더한다(증분 스냅샷).
//
// 규약
//   · 리뷰마다 지문(hash)을 만든다. history.analyzed[bookId]와 같으면 이미 읽은 것이라 건너뛴다.
//   · 그래서 리뷰가 100개여도, 한 번에 읽는 것은 새로 쓰거나 고친 것뿐이다.
//   · 이전 흐름은 history.summary(몇 문장)로만 넘긴다. 지난 리뷰 본문은 다시 보내지 않는다.
//
// 읽는 방법은 둘이다.
//   self   : 토큰 없이. 리뷰 머리의 「한 줄」과 「읽기 전 → 읽은 뒤」를 그대로 옮긴다.
//   claude : 설정에 Claude API 키가 있을 때. 새 리뷰와 이전 요약만 보내 한 줄과 변화를 받아 온다.
//            실패하면 self로 대신하고 그 사실을 알린다.

import { CLAUDE_MODEL, LS, lsGet } from './config.js';
import { hasReviewContent, now, saveHistory, state } from './store.js';

export function reviewText(review) {
  if (!review) return '';
  const lines = [];
  for (const b of review.blocks || []) {
    if (b.type === 'divider') continue;
    if (b.text && b.text.trim()) lines.push(b.type === 'quote' ? `"${b.text.trim()}"` : b.text.trim());
    if (b.body && b.body.trim()) lines.push(b.body.trim());
  }
  return lines.join('\n');
}

/** FNV-1a. 바뀌었는지만 가리면 되므로 암호학적 해시는 쓰지 않는다. */
function fnv(text) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

export function reviewHash(book) {
  const r = book.review || {};
  const p = r.props || {};
  return fnv([p.rating || 0, p.oneLine || '', p.before || '', p.after || '', (p.tags || []).join(','), reviewText(r)].join('␟'));
}

/** 아직 읽지 않았거나, 읽은 뒤에 고쳐진 리뷰 */
export function pendingReviews(lib) {
  return Object.values(lib.books)
    .filter((b) => b.status === 'done' && hasReviewContent(b) && lib.history.analyzed[b.id] !== reviewHash(b))
    .sort((a, b) => String(a.finishedAt).localeCompare(String(b.finishedAt)));
}

const clip = (text, n) => { const t = (text || '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

function selfRead(book) {
  const p = (book.review && book.review.props) || {};
  const body = reviewText(book.review);
  const first = body.split('\n')[0] || '';
  const sentence = first.match(/^.*?[.!?。](?=\s|$)/);
  const line = clip(p.oneLine, 90) || clip(sentence ? sentence[0] : first, 90) || '리뷰를 남겼다.';
  const before = clip(p.before, 60);
  const after = clip(p.after, 60);
  const shift = before && after ? `${before} → ${after}` : after;
  return { line, shift };
}

function selfSummary(lib) {
  const done = Object.values(lib.books).filter((b) => b.status === 'done');
  const tags = new Map();
  for (const b of done) for (const t of ((b.review && b.review.props && b.review.props.tags) || [])) tags.set(t, (tags.get(t) || 0) + 1);
  const top = [...tags.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([t]) => t);
  return top.length ? `완독 ${done.length}권. 리뷰에 자주 붙인 키워드는 ${top.join(', ')}.` : `완독 ${done.length}권.`;
}

async function claudeRead(books, lib, key) {
  const recent = lib.history.entries.filter((e) => e.kind === 'review').slice(-3)
    .map((e) => ({ date: e.date, title: e.title, line: e.line, shift: e.shift || '' }));
  const payload = {
    previous_summary: lib.history.summary || '',
    recent_entries: recent,
    new_reviews: books.map((b) => {
      const p = b.review.props || {};
      return {
        id: b.id, title: b.title, author: b.author, finished: (b.finishedAt || '').slice(0, 10),
        rating: p.rating || 0, one_line: p.oneLine || '', before: p.before || '', after: p.after || '',
        tags: p.tags || [], body: clip(reviewText(b.review), 2400),
      };
    }),
  };
  const system = [
    '당신은 한 사람의 독서 리뷰를 읽고 생각의 변화를 추적하는 기록자다.',
    '한국어로, 아래 JSON 하나만 출력한다. 다른 글은 쓰지 않는다.',
    '{"entries":[{"id":"리뷰의 id","line":"이 책에서 무엇을 남겼는지 한 문장(45자 안팎, 평서문)","shift":"이전 기록과 견주어 생각이나 태도가 달라진 점 한 문장. 보이지 않으면 빈 문자열"}],"summary":"지금까지의 흐름. 이전 요약을 이어받아 3문장 이내로 갱신"}',
    '리뷰에 없는 내용을 지어내지 않는다. 판단하기 어려우면 shift는 비운다. 칭찬이나 조언은 쓰지 않는다.',
  ].join('\n');

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: lsGet(LS.claudeModel) || CLAUDE_MODEL,
      max_tokens: 900,
      system,
      messages: [{ role: 'user', content: JSON.stringify(payload) }],
    }),
  });
  if (!res.ok) {
    let msg = '';
    try { msg = (await res.json()).error.message; } catch { /* 본문 없음 */ }
    throw new Error(`Claude API ${res.status}${msg ? `: ${msg}` : ''}`);
  }
  const data = await res.json();
  const text = (data.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('');
  const json = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
  const byId = new Map((json.entries || []).map((e) => [e.id, e]));
  return {
    read: (book) => {
      const e = byId.get(book.id);
      return e && typeof e.line === 'string' && e.line.trim() ? { line: clip(e.line, 120), shift: clip(e.shift, 140) } : null;
    },
    summary: typeof json.summary === 'string' ? clip(json.summary, 400) : '',
    usage: data.usage || null,
  };
}

/**
 * 새 리뷰만 읽어 연혁에 반영한다.
 * @returns {{ added: number, skipped: number, engine: 'self'|'claude'|'none', note: string }}
 */
export async function analyzeDelta() {
  const lib = state.lib;
  const targets = pendingReviews(lib);
  const reviewed = Object.values(lib.books).filter((b) => b.status === 'done' && hasReviewContent(b)).length;
  const skipped = reviewed - targets.length;
  if (!targets.length) {
    await saveHistory((h) => { h.checkedAt = now(); });
    return { added: 0, skipped, engine: 'none', note: '' };
  }

  let engine = 'self';
  let note = '';
  let ai = null;
  const key = lsGet(LS.claudeKey);
  if (key) {
    try { ai = await claudeRead(targets, lib, key); engine = 'claude'; } catch (e) { note = `Claude 분석에 실패해 직접 쓴 한 줄로 채웠습니다. (${e.message})`; }
  }

  await saveHistory((h, l) => {
    for (const book of targets) {
      const got = (ai && ai.read(book)) || selfRead(book);
      const entry = {
        id: `h-${book.id}`, kind: 'review', bookId: book.id,
        date: book.finishedAt || now(), title: book.title,
        line: got.line, shift: got.shift || '',
        engine: ai && ai.read(book) ? 'claude' : 'self',
        hash: reviewHash(book), createdAt: now(),
      };
      const i = h.entries.findIndex((e) => e.id === entry.id);
      if (i >= 0) h.entries[i] = entry; else h.entries.push(entry);
      h.analyzed[book.id] = entry.hash;
    }
    h.summary = (ai && ai.summary) || selfSummary(l);
    h.checkedAt = now();
  });
  return { added: targets.length, skipped, engine, note };
}
