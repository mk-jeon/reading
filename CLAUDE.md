# 독서 도감 — 프로젝트 규칙 (정본)

이 저장소를 고치는 사람과 에이전트는 이 문서를 먼저 읽는다. 코드와 이 문서가 어긋나면 고친 쪽이 이 문서도 함께 고친다.

## 0. 무엇인가

- 한 사람의 독서 기록 앱. GitHub Pages로 연다: https://mk-jeon.github.io/reading/
- 탭 셋: 나(`#/me`) · 읽는 중(`#/reading`, 책 한 권은 `#/reading/b/<id>`) · 히스토리(`#/history`)
- **공개 저장소다.** 다른 사람을 알아볼 수 있는 내용, 회사 자료, 토큰·키는 코드에도 기록에도 넣지 않는다.

## 1. 기술 스택 / 무의존성

- 빌드 없음. 순수 HTML · CSS · JS(ES 모듈). `main` 브랜치의 파일이 그대로 사이트다.
- 외부 라이브러리 · CDN 0건. 글꼴(Pretendard)도 `fonts/` 에 둔다: 늘 쓰는 글자를 담은 `subset`(약 0.3MB)과, 드문 한글 음절이 화면에 나올 때만 받는 `rest`(약 0.9MB).
- `tools/` 는 개발용이다(아이콘 · 글꼴 다시 만들기, 회귀 점검). 사이트는 `tools/` 없이 돈다.
- 파일은 UTF-8(BOM 없음).

## 2. 파일 인덱스

| 파일 | 맡은 일 |
|---|---|
| `index.html` | 껍데기. CSP와 메타만 있다. 화면은 전부 JS가 짓는다 |
| `css/tokens.css` | 색 · 글자 · 간격 · 움직임의 값. **색 리터럴이 허용되는 유일한 CSS** |
| `css/base.css` | 틀(상단 바 · 본문 · 탭 바)과 공용 부품(단추 · 칩 · 입력 · 겹침 창 · 토스트) |
| `css/views.css` | 세 탭의 배치. 접은 화면 한 단, 37.5rem 이상 두 단 |
| `css/notion.css` | 리뷰 문서(노션식 블록)의 읽기 · 쓰기 모양 |
| `js/app.js` | 시작점. 주소 해석, 탭 전환, 다시 그리기 |
| `js/config.js` | 고정값(브랜치 이름, 사진 넉 장의 정의, 한도) |
| `js/dom.js` | `h()` · 아이콘 · 겹침 창(`openModal` `confirmDialog` `actionSheet`) · `toast` |
| `js/db.js` | 이 기기의 보관함(IndexedDB): 기록 사본, 사진 원본 |
| `js/store.js` | 상태와 기록을 바꾸는 **유일한 통로**. 모드(viewer / owner / local) |
| `js/sync.js` | GitHub와 맞추기: 받기 → 합치기 → 올리기 → 사진 올리기 |
| `js/photos.js` | 찍기 · 고르기 · 줄이기 · 보여 줄 주소 |
| `js/me-data.js` `js/me.js` | 「나」 탭의 내용과 화면 |
| `js/reading.js` | 「읽는 중」 탭: 책장, 고른 책, 등록, 진척, 기록 |
| `js/review.js` | 리뷰 문서: 블록 편집기와 읽기 화면 |
| `js/history.js` | 「히스토리」 탭: 연혁, 새 리뷰 확인 |
| `js/analyze.js` | 새 리뷰만 읽는 증분 분석(§6) |
| `js/insight.js` | 책장에서 계산하는 인사이트 |
| `js/seed.js` | 기록이 없을 때의 첫 상태, 맞세워 읽을 짝 |
| `js/settings.js` | 설정 창 |
| `sw.js` `manifest.webmanifest` `icons/` | PWA. 파일을 더하거나 빼면 `sw.js` 의 `SHELL` 과 `VERSION` 을 함께 고친다 |

## 3. 기록(데이터)

- **정본은 `data` 브랜치**다: `library.json` 한 파일과 `photos/<bookId>/<front|back|toc|first>-<v>.jpg`.
  앱 코드(`main`)와 나눠 두어, 기록을 올려도 사이트가 다시 빌드되지 않는다.
- 사진 이름의 `<v>` 는 찍은 시각(판)이다. 한 번 올린 파일은 내용이 바뀌지 않으므로 기기에 담아 둔 사진이 묵지 않는다. 다시 찍으면 새 이름으로 올라가고, 책을 지우면 그 책의 폴더를 비운다.
- `data` 브랜치는 앱이 첫 저장 때 빈 뿌리에서 만든다. 손으로 만들 필요 없다.
- 이 기기에 두는 것은 사본 · 올릴 차례를 기다리는 사진 · 설정 · 토큰뿐이다. 토큰과 키는 `localStorage` 에만 있고 기록 파일에 들어가지 않는다.
- 저장소에서 받은 기록과 이 기기의 사본은 모두 `store.js` 의 `normalize()` 를 거친 뒤에만 화면과 저장으로 간다. id는 `SAFE_ID`(영문 · 숫자로 시작, 영문 · 숫자 · `_` · `-`, 64자 이내)만 받고, 모르는 칸과 어긋난 값은 버린다.
  **기록에 새 칸을 더하면 `normalize()` 에도 더한다.** 안 그러면 다음 맞추기에서 걸러져 사라진다.

`library.json` (schema 1)

```
{ schema, updatedAt, seq,                 // seq: 마지막으로 붙인 도감 번호
  books: { <id>: { id, no, title, author, publisher, tag, rival, totalPages,
                   status: queue|reading|done, addedAt, startedAt, finishedAt, updatedAt,
                   photos: { <slot>: { v, w, h, bytes, remote } },      // v: 판(찍은 시각, ms). remote: 저장소에 올렸는지
                   page, logs: [ { id, at, from, page, memo } ],
                   review: { props: { rating, oneLine, before, after, tags[] },
                             blocks: [ { id, type, text, checked?, tone?, body?, seed?, ph? } ], updatedAt } } },
  tombstones: { <id>: 지운 시각 },
  history: { entries: [ { id, kind: milestone|review, bookId?, date, title, line, shift?, engine?, hash?, createdAt } ],
             analyzed: { <bookId>: 리뷰 지문 }, summary, checkedAt, updatedAt },
  insight: { by, at, lines[] } }
```

합치는 규칙(`sync.js` `mergeLibraries`): 책 단위로 `updatedAt` 이 늦은 쪽이 이긴다. 지운 책은 지운 시각이 그 책의 `updatedAt` 보다 늦으면 지워진 채로 남는다. 올릴 때 겹치면(409) 다시 받아 합친 뒤 올린다. 두 기기에서 따로 붙여 겹친 도감 번호는 먼저 읽기 시작한 책이 갖는다(`normalize()`).

저장소의 `library.json` 이 깨져 있으면(JSON이 아니면) 덮어쓰지 않고 멈춘다.

## 4. 하드 룰

1. **색은 `var(--*)` 만.** 색 리터럴은 `css/tokens.css` 에만 쓴다. 예외는 `manifest.webmanifest`, `index.html` 의 `theme-color`, `tools/build-icons.mjs` 뿐이다. 새 색은 라이트 · 다크 값을 함께 추가한다.
2. `!important` 금지.
3. **사용자가 쓴 글은 텍스트로만 넣는다.** `innerHTML` · `insertAdjacentHTML` 금지. `h()` 를 쓴다.
4. 브라우저 기본 `alert` · `confirm` · `prompt` 금지. `dom.js` 의 겹침 창과 `toast` 만 쓴다.
5. 죽은 단추 금지. 누를 수 없는 단추는 이유를 옆에 적는다.
6. 그림 문자(이모지) 금지. 아이콘은 `dom.js` 의 선 아이콘.
7. 글꼴은 `--font-sans` 하나. 외부 글꼴 주소를 더하지 않는다.
8. 기록을 바꾸는 코드는 `store.js` 의 함수를 거친다. 화면이 `state.lib` 를 직접 고치지 않는다.
9. 읽는 중은 5권까지. 사진 넉 장과 총 쪽수 없이는 읽는 중으로 올릴 수 없다.
10. 움직임의 easing은 `--ease` 하나, 길이는 `--t-1` `--t-2` `--t-3`. `prefers-reduced-motion` 을 지킨다.
11. 밖으로 나가는 주소는 셋뿐이다: `api.github.com`(토큰과 함께), `raw.githubusercontent.com`(공개된 기록과 사진 받기), `api.anthropic.com`(키를 넣었을 때만). 더하려면 `index.html` 의 CSP도 함께 고친다.
12. 토큰과 키는 `config.js` 의 `lsGet` `lsSet` 으로만 다루고, 주소(URL) · 기록 · 알림 글 · 콘솔에 넣지 않는다.
13. 알림(`toast`)은 화면 위쪽에 뜬다. 아래쪽은 시트와 주요 단추의 자리다.

## 5. 기능 인벤토리 (회귀 금지)

- 나: 큰 제목, No. 000, 잘하는 것 6 · 부족해 보이는 것 6(해 볼 것과 짝) · 권하는 책 8(대기에 담기)
- 읽는 중: 읽는 중 n/5 카드(도감 번호 · 진척 % · 책배 막대와 책갈피 · 다음 볼 쪽 · 마지막 메모), 대기, 읽은 책, 인사이트
- 책 한 권: 표본 사진 넉 장(앞표지 · 뒤표지 · 목차 · 본문 첫 장, 줄여서 보관), 총 쪽수, 읽기 시작, 읽은 쪽 기록과 메모, 읽은 기록, 완독, 정보 수정, 대기로 내리기, 지우기
- 100%가 되면 완독을 묻고 리뷰 편집기를 연다. 리뷰는 속성(별점 · 한 줄 · 읽기 전 · 읽은 뒤 · 키워드)과 블록(텍스트 · 제목 1~3 · 글머리 · 번호 · 할 일 · 인용 · 콜아웃 5색 · 토글 · 구분선)
- 히스토리: 해마다 묶은 연혁(재개 · 읽기 시작 · 완독), 새 리뷰 확인(받기 → 새 리뷰만 분석 → 결과 한 줄), 지금까지의 숫자와 흐름
- 모드: 구경 / 기록(토큰) / 이 기기에서만. 상단 표지에 저장 상태
- 접은 화면에서는 고른 책이 화면 전체, 펼친 화면에서는 책장과 나란히. 기기의 뒤로 가기가 겹침 창과 책 화면을 닫는다
- PWA: 설치, 연결 없이 열기, 밝게 · 어둡게
- 지키는 것: 다른 사이트의 틀(iframe) 안에서는 열리지 않는다. 단추를 연달아 눌러도 한 번만 적힌다. 사진이 아닌 파일과 60MB를 넘는 파일은 받지 않는다

## 6. 히스토리 분석 규약 (증분 스냅샷)

- 리뷰마다 지문을 만든다(`analyze.js` `reviewHash`, FNV-1a). `history.analyzed[bookId]` 와 같으면 이미 읽은 리뷰라 건너뛴다. **지난 리뷰 본문은 다시 읽지 않는다.**
- 이전 흐름은 `history.summary`(3문장 이내)로만 넘긴다.
- 읽는 방법
  - `self`: 토큰 없이. 리뷰 머리의 「한 줄」과 「읽기 전 → 읽은 뒤」를 옮긴다.
  - `claude`: 설정에 Claude API 키가 있을 때. 새 리뷰와 이전 요약만 보낸다. 실패하면 `self` 로 대신한다.
- Claude 세션에서 직접 분석할 때도 같은 규약을 따른다: `data` 브랜치의 `library.json` 을 받아, 지문이 다른 완독 리뷰만 읽고, `history.entries` 에 `{ id: "h-<bookId>", kind: "review", bookId, date, title, line, shift, engine: "claude", hash, createdAt }` 를 더하거나 바꾸고, `analyzed[bookId] = hash`, `summary` 갱신, `history.updatedAt` 과 `updatedAt` 을 지금으로 고쳐 `data` 브랜치에 올린다. `insight` 메모도 이때 고쳐 쓸 수 있다.

## 7. 검증 게이트 (수정 후 필수)

1. `for f in js/*.js sw.js; do node --check "$f"; done`
2. `node tools/e2e.mjs` 가 전부 통과한다(구경 · 써 보기 · 저장소 연결 · 펼친 화면 · 글자 그대로 넣기 · 어긋난 기록 · 틀 안에서 열기 · 설치와 연결 없이 열기). playwright가 있어야 한다. GitHub은 흉내 낸 것이라 실제 저장소에는 쓰지 않는다.
3. 색 게이트: `grep -nE '#[0-9a-fA-F]{3,8}\b|rgba?\(' css/base.css css/views.css css/notion.css js/*.js` 가 0건.
4. 접은 화면(폭 384px)과 펼친 화면(폭 700px), 밝게 · 어둡게를 눈으로 본다. `node tools/e2e.mjs --shots <폴더>` 가 화면을 남긴다.
5. 파일을 더하거나 뺐으면 `sw.js` 의 `SHELL` · `VERSION` 과 이 문서의 §2를 고쳤는지 본다. 배포한 뒤에 파일을 고쳤으면 `VERSION` 과 `config.js` 의 `APP_VERSION` 을 올린다.
6. 금지 패턴: `grep -nE 'innerHTML|insertAdjacentHTML|!important|\b(alert|confirm|prompt)\(' js/*.js css/*.css` 에서 주석 말고는 0건.

## 8. 알고 두는 한계 (수용한 위험)

- 기록 모드의 토큰은 이 기기의 `localStorage` 에 평문으로 있다. 서버가 없는 구조라 다른 방법이 없다. 그래서 토큰은 이 저장소 하나, Contents 권한 하나로만 만든다. 같은 주소(`<owner>.github.io`) 아래의 다른 페이지가 이 값을 읽을 수 있으므로, 그 주소에는 믿는 페이지만 올린다.
- 저장소가 공개라서 `data` 브랜치의 기록과 사진은 누구나 볼 수 있고, 지워도 git 이력에는 남는다.
- 구경 모드가 받는 기록은 GitHub의 캐시 때문에 최대 5분쯤 늦을 수 있다.
- 한 책을 두 기기에서 서로 맞추지 않은 채 고치면, 책 단위로 나중에 고친 쪽만 남는다.
- Claude API를 브라우저에서 바로 부르는 분석(`claude`)은 실제 키로 확인하지 못했다. 실패하면 `self` 로 채운다.
