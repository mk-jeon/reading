// analyze.js — 새로 쓴 리뷰만 읽어 연혁에 한 줄씩 더한다(증분 스냅샷).
//
// 규약
//   · 리뷰마다 지문(hash)을 만든다. history.analyzed[bookId]와 같으면 이미 읽은 것이라 건너뛴다.
//   · 그래서 리뷰가 100개여도, 한 번에 읽는 것은 새로 쓰거나 고친 것뿐이다.
//   · 이전 흐름은 history.summary(몇 문장)로만 넘긴다. 지난 리뷰 본문은 다시 보내지 않는다.
//
// 읽는 방법은 둘이다.
//   self   : 토큰 없이. 리뷰 머리의 「한 줄」과 「읽기 전 → 읽은 뒤」(없으면 본문의 「달라진 것」)를 옮긴다.
//   claude : 설정에 Claude API 키가 있을 때. 새 리뷰와 이전 요약만 보내 한 줄과 변화를 받아 온다.
//            실패하면 self로 대신하고 그 사실을 알린다.

import { CLAUDE_MODEL, LS, lsGet } from './config.js';
import { hasReviewContent, now, saveHistory, state } from './store.js';
import { timeoutSignal } from './sync.js';

const HEADING = new Set(['h1', 'h2', 'h3']);
const BATCH = 6;                          // Claude에 한 번에 보내는 리뷰 수

/** 사람이 쓴 블록만. 구분선과, 손대지 않은 틀 제목(왜 읽었나 · 남은 문장 …)은 뺀다. */
function written(review) {
  return ((review && review.blocks) || []).filter((b) => b.type !== 'divider' && !b.seed && ((b.text || '').trim() || (b.body || '').trim()));
}

export function reviewText(review) {
  const lines = [];
  for (const b of written(review)) {
    const text = (b.text || '').trim();
    if (text) lines.push(b.type === 'quote' ? `"${text}"` : text);
    if ((b.body || '').trim()) lines.push(b.body.trim());
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

const clip = (text, n) => { const t = (typeof text === 'string' ? text : '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

/** 본문에서 '달라진 것' 제목 아래에 쓴 글 */
function shiftSection(review) {
  const blocks = (review && review.blocks) || [];
  const at = blocks.findIndex((b) => HEADING.has(b.type) && (b.text || '').trim() === '달라진 것');
  if (at < 0) return '';
  const out = [];
  for (let i = at + 1; i < blocks.length && !HEADING.has(blocks[i].type); i += 1) {
    if ((blocks[i].text || '').trim()) out.push(blocks[i].text.trim());
  }
  return out.join(' ');
}

export function selfRead(book) {
  const p = (book.review && book.review.props) || {};
  // 한 줄: 직접 쓴 「한 줄」, 없으면 본문에서 제목이 아닌 첫 문장.
  const first = written(book.review).find((b) => !HEADING.has(b.type) && (b.text || '').trim());
  const text = first ? first.text.trim() : '';
  const sentence = text.match(/^.*?[.!?。](?=\s|$)/);
  const line = clip(p.oneLine, 90) || clip(sentence ? sentence[0] : text, 90) || '리뷰를 남겼다.';
  const before = clip(p.before, 60);
  const after = clip(p.after, 60);
  const shift = before && after ? `${before} → ${after}` : (after || clip(shiftSection(book.review), 140));
  return { line, shift };
}

function selfSummary(lib) {
  const done = Object.values(lib.books).filter((b) => b.status === 'done');
  const tags = new Map();
  for (const b of done) for (const t of ((b.review && b.review.props && b.review.props.tags) || [])) tags.set(t, (tags.get(t) || 0) + 1);
  const top = [...tags.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([t]) => t);
  return top.length ? `완독 ${done.length}권. 리뷰에 자주 붙인 키워드는 ${top.join(', ')}.` : `완독 ${done.length}권.`;
}

/** 리뷰 몇 건을 Claude에 보내 한 줄과 변화를 받아 온다. 받은 값은 글자로만 쓰고, 모양이 어긋나면 버린다. */
async function claudeRead(books, lib, key, previousSummary) {
  const recent = lib.history.entries.filter((e) => e.kind === 'review').slice(-3)
    .map((e) => ({ date: e.date, title: e.title, line: e.line, shift: e.shift || '' }));
  const payload = {
    previous_summary: previousSummary || '',
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

  let res;
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: timeoutSignal(60000),
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: lsGet(LS.claudeModel) || CLAUDE_MODEL,
        max_tokens: Math.min(2400, 400 + 300 * books.length),
        system,
        messages: [{ role: 'user', content: JSON.stringify(payload) }],
      }),
    });
  } catch (e) {
    throw new Error(e && (e.name === 'TimeoutError' || e.name === 'AbortError') ? '답이 너무 늦습니다' : '네트워크에 닿지 않습니다');
  }
  if (!res.ok) {
    let msg = '';
    try { msg = String((await res.json()).error.message || ''); } catch { /* 본문 없음 */ }
    throw new Error(`Claude API ${res.status}${msg ? `: ${msg.slice(0, 160)}` : ''}`);
  }
  const data = await res.json();
  if (data.stop_reason === 'max_tokens') throw new Error('답이 중간에 끊겼습니다');
  const text = (Array.isArray(data.content) ? data.content : []).filter((c) => c && c.type === 'text' && typeof c.text === 'string').map((c) => c.text).join('');
  let json;
  try { json = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)); } catch { throw new Error('답이 약속한 모양이 아닙니다'); }
  const byId = new Map();
  for (const e of (Array.isArray(json.entries) ? json.entries : [])) {
    if (e && typeof e.id === 'string' && typeof e.line === 'string' && e.line.trim()) byId.set(e.id, { line: clip(e.line, 120), shift: clip(e.shift, 140) });
  }
  return { byId, summary: clip(json.summary, 400) };
}

/**
 * 새 리뷰만 읽어 연혁에 반영한다.
 * @returns {Promise<{ added: number, skipped: number, engine: 'self'|'claude'|'none', note: string }>}
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

  // 읽기 시작할 때의 지문. 분석하는 사이에 리뷰가 바뀌면 그 리뷰는 이번에 적지 않고 다음에 다시 읽는다.
  const hashes = new Map(targets.map((b) => [b.id, reviewHash(b)]));
  const results = new Map();             // bookId → { line, shift, engine }
  let summary = '';
  let note = '';
  const key = lsGet(LS.claudeKey);
  if (key) {
    try {
      let prev = lib.history.summary || '';
      for (let i = 0; i < targets.length; i += BATCH) {
        const chunk = targets.slice(i, i + BATCH);
        const out = await claudeRead(chunk, lib, key, prev);
        for (const b of chunk) { const got = out.byId.get(b.id); if (got) results.set(b.id, { ...got, engine: 'claude' }); }
        if (out.summary) { prev = out.summary; summary = out.summary; }
      }
    } catch (e) {
      note = `Claude 분석에 실패해 ${results.size ? '나머지는 ' : ''}직접 쓴 한 줄로 채웠습니다. (${clip(e && e.message, 200) || '알 수 없는 오류'})`;
    }
  }
  for (const b of targets) if (!results.has(b.id)) results.set(b.id, { ...selfRead(b), engine: 'self' });
  const usedClaude = [...results.values()].some((r) => r.engine === 'claude');

  let added = 0;
  await saveHistory((h, l) => {
    for (const [id, got] of results) {
      const book = Object.hasOwn(l.books, id) ? l.books[id] : null;
      if (!book || reviewHash(book) !== hashes.get(id)) continue;
      const entry = {
        id: `h-${id}`, kind: 'review', bookId: id,
        date: book.finishedAt || now(), title: book.title,
        line: got.line, shift: got.shift || '',
        engine: got.engine, hash: hashes.get(id), createdAt: now(),
      };
      const i = h.entries.findIndex((e) => e.id === entry.id);
      if (i >= 0) h.entries[i] = entry; else h.entries.push(entry);
      h.analyzed[id] = entry.hash;
      added += 1;
    }
    // 흐름 요약: Claude가 새로 써 주었으면 그것을, 키 없이 쓰는 중이면 숫자로 만든 한 줄을 적는다.
    // 키가 있는데 이번에 실패한 것이면, 앞서 받아 둔 요약을 지우지 않는다.
    if (usedClaude && summary) h.summary = summary;
    else if (!key || !h.summary) h.summary = selfSummary(l);
    h.checkedAt = now();
  });
  return { added, skipped, engine: usedClaude ? 'claude' : 'self', note };
}
