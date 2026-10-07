// seed.js — 기록이 아직 없을 때의 첫 상태. 책장에 있거나 읽으려는 다섯 권을 대기에 둔다.
// id를 고정해 두어, 여러 기기에서 각각 시작해도 같은 책으로 합쳐진다.

import { SCHEMA } from './config.js';

const T0 = '2026-10-07T00:00:00.000Z';

function queued(id, title, author, publisher, tag, rival = '') {
  return {
    id, no: null, title, author, publisher, tag, rival,
    totalPages: null, status: 'queue',
    addedAt: T0, startedAt: null, finishedAt: null, updatedAt: T0,
    photos: {}, page: 0, logs: [], review: null,
  };
}

export function seedLibrary() {
  const books = [
    queued('seed-sapiens', '사피엔스', '유발 하라리', '김영사', '인문·역사', '총균쇠'),
    queued('seed-ggs', '총균쇠', '재레드 다이아몬드', '김영사', '인문·역사', '국가는 왜 실패하는가'),
    queued('seed-tokyo', '퇴사준비생의 도쿄', '이동진 외', '더퀘스트', '비즈니스'),
    queued('seed-london', '퇴사준비생의 런던', '이동진 외', '트래블코드', '비즈니스'),
    queued('seed-onelife', '한 번뿐인 인생은 어떻게 살아야 하는가', '박찬위', '하이스트', '에세이'),
  ];
  return {
    schema: SCHEMA,
    updatedAt: T0,
    seq: 0,
    books: Object.fromEntries(books.map((b) => [b.id, b])),
    tombstones: {},
    history: {
      entries: [
        { id: 'h-restart', kind: 'milestone', date: '2026-10-07', title: '독서 재개', line: '나를 돌보는 의미에서 다시 시작했다. 도감을 열었다.', createdAt: T0 },
      ],
      analyzed: {},
      summary: '',
      checkedAt: null,
      updatedAt: T0,
    },
    insight: {
      by: 'claude',
      at: '2026-10-07',
      lines: [
        '대기 다섯 권은 세 갈래입니다. 큰 역사(사피엔스, 총균쇠), 일을 보는 눈(퇴사준비생의 도쿄·런던), 사는 법(한 번뿐인 인생은 어떻게 살아야 하는가).',
        '세 갈래 모두 넓게 묻는 책입니다. 한 주장을 끝까지 따라가는 경험은 사피엔스나 총균쇠가 맡습니다.',
        '다섯 권을 한꺼번에 돌리기보다 두 줄이 낫습니다. 논증이 이어지는 책 한 권, 꼭지가 독립된 책 한 권.',
      ],
    },
  };
}

// 맞세워 읽을 짝. 책장에 한쪽이 있으면 다른 쪽을 권한다.
export const RIVALS = [
  { a: '총균쇠', b: '국가는 왜 실패하는가', axis: '지리냐 제도냐' },
  { a: '사피엔스', b: '모든 것의 새벽', axis: '인류사를 한 줄로 그릴 수 있느냐' },
  { a: '정의란 무엇인가', b: '정의론', axis: '옳음이 좋음에 앞서느냐' },
  { a: '정의론', b: '아나키에서 유토피아로', axis: '평등이냐 자유냐' },
];
