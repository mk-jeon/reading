// me.js — 「나」 탭. 도감의 첫 항목(No. 000)은 읽는 사람 자신이다.

import { ME } from './me-data.js';
import { fmtDate, h, icon, josa, toast } from './dom.js';
import { addBook, canEdit, state } from './store.js';

function point(item) {
  return h('div', { class: 'point' },
    h('h3', null, h('span', { class: 'idx' }, item.no), item.title),
    h('p', null, item.text));
}

function recItem(it) {
  const titles = new Set(Object.values(state.lib.books).map((b) => b.title));
  const owned = titles.has(it.title);
  let action = null;
  if (owned) action = h('span', { class: 'chip chip--ok' }, '책장에 있음');
  else if (canEdit()) {
    action = h('button', {
      class: 'btn btn--sm', type: 'button',
      onclick: async () => {
        await addBook({ id: it.id, title: it.title, author: it.author, publisher: it.publisher, tag: it.tag });
        toast(`『${it.title}』${josa(it.title, '을', '를')} 대기에 담았습니다.`);
      },
    }, icon('plus', 16), '대기에 담기');
  }
  return h('li', { class: 'rec' },
    h('div', { class: 'rec-main' },
      h('h4', null, it.title, it.first ? h('span', { class: 'rec-first' }, '먼저 한 권') : null),
      h('p', { class: 'rec-by' }, [it.author, it.publisher, it.tag].filter(Boolean).join(' | ')),
      h('p', { class: 'rec-why' }, it.why)),
    action);
}

export function renderMe(root) {
  const hero = h('header', { class: 'hero' },
    h('p', { class: 'hero-label' }, h('span', { class: 'no' }, 'No. 000'), h('span', null, '나')),
    h('h1', { class: 'hero-title' }, ME.motto[0], h('br'), ME.motto[1]),
    h('p', { class: 'hero-date tnum' }, `${fmtDate(ME.reopenedAt)} 다시 펼침`));

  const portrait = h('section', { class: 'portrait' },
    h('h2', { class: 'thesis' }, ME.thesis[0], h('br'), ME.thesis[1]),
    h('div', { class: 'glance' }, ME.glance.map((g) => h('div', null, h('b', null, g.key), h('p', null, g.text)))),
    h('p', { class: 'note' }, ME.basis));

  const have = h('section', { class: 'sec', id: 'have' },
    h('div', { class: 'sec-head sec-head--have' },
      h('h2', { class: 'sec-title' }, h('span', { class: 'mark mark--full', 'aria-hidden': 'true' }), '잘하는 것'),
      h('p', { class: 'sec-cap' }, '글에 근거가 많은 쪽')),
    h('ol', { class: 'items items--have' }, ME.have.map((it) => h('li', null, point(it)))));

  const lack = h('section', { class: 'sec', id: 'lack' },
    h('div', { class: 'sec-head sec-head--lack' },
      h('h2', { class: 'sec-title' }, h('span', { class: 'mark mark--hollow', 'aria-hidden': 'true' }), '부족해 보이는 것'),
      h('p', { class: 'sec-cap' }, '글에 근거가 적거나 비어 있는 쪽. 화살표는 해 볼 것.')),
    h('ol', { class: 'items items--lack' }, ME.lack.map((it) => h('li', { class: 'row' },
      point(it),
      h('p', { class: 'do' }, h('span', { class: 'do-arrow', 'aria-hidden': 'true' }, icon('arrow-right', 16)), h('span', null, it.todo))))));

  const recs = h('section', { class: 'sec', id: 'recs' },
    h('div', { class: 'sec-head' },
      h('h2', { class: 'sec-title' }, '권하는 책'),
      h('p', { class: 'sec-cap' }, '자서전과 수필은 뺐다. 써 둔 문장에 맞춰 둘씩 묶었다.')),
    h('div', { class: 'rec-groups' }, ME.books.map((g) => h('div', { class: 'rec-group' },
      h('p', { class: 'rec-q' }, h('b', null, g.group), h('span', null, `“${g.quote}”`)),
      h('ul', { class: 'rec-list' }, g.items.map(recItem))))));

  root.replaceChildren(h('div', { class: 'me' }, hero, portrait, have, lack, recs));
}
