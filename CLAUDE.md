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
| `js/app.js` | 시작점. 주소 해석, 탭 전환, 다시 그리기(그리다 실패해도 빈 화면으로 두지 않는다) |
| `js/config.js` | 고정값(브랜치 이름, 사진 넉 장의 정의, 한도)과 이 기기에 두는 것들의 이름 |
| `js/dom.js` | `h()` · 아이콘 · 겹침 창(`openModal` `confirmDialog` `actionSheet`) · `toast` · `josa` |
| `js/db.js` | 이 기기의 보관함(IndexedDB): 기록 사본, 줄인 사진 |
| `js/store.js` | 상태와 기록을 바꾸는 **유일한 통로**. 모드(viewer / owner / local), `normalize()` |
| `js/sync.js` | GitHub와 맞추기: 받기 → 합치기 → 올리기 → 사진 올리기. 연결 · 끊기 |
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

### 3.1 어디에 있나

- **정본은 `data` 브랜치**다: `library.json` 한 파일과 `photos/<bookId>/<front|back|toc|first>-<v>.jpg`.
  앱 코드(`main`)와 나눠 두어, 기록을 올려도 사이트가 다시 빌드되지 않는다.
- `data` 브랜치는 앱이 첫 저장 때 빈 뿌리에서 만든다. 손으로 만들 필요 없다.
- 사진 이름의 `<v>` 는 찍은 시각(판)이다. 한 번 올린 파일은 내용이 바뀌지 않는다. 다시 찍으면 새 이름으로 올리고 같은 칸의 옛 판은 지운다. 책을 지우면 그 책의 폴더를 비운다.
- 이 기기에 두는 것(이름에는 저장소 이름이 들어간다: IndexedDB `dogam-<repo>`, localStorage `dogam.<repo>.*`)

  | 칸 | 무엇 |
  |---|---|
  | kv `lib` | 기록 모드(owner)의 사본. 저장소와 맞춘다 |
  | kv `lib-local` · `local-base` | 써 보기 모드(local)의 연습장과, 연습을 시작한 시각 |
  | kv `viewer-cache` | 구경 모드(viewer)가 마지막으로 받은 공개 기록 |
  | kv `pending-deletes` | 저장소에서 사진을 지울 책의 id(다음 맞추기 때 지운다) |
  | photos `<bookId>/<slot>` | 줄인 사진. 써 보기 모드의 것은 `local:<bookId>/<slot>` |
  | localStorage | 토큰 · Claude 키 · 모드 · 화면 · 사진 보관 방식. **토큰과 키는 여기에만 있고 기록 파일에 들어가지 않는다** |

- **써 보기 모드의 기록은 진짜 기록에 섞지 않는다.** 저장소에 기록이 아직 없을 때만, 연결하면서 묻고 첫 기록으로 삼을 수 있다(`sync.js` `connect`).

### 3.2 모양

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

- 저장소에서 받은 기록과 이 기기의 사본은 모두 `store.js` 의 `normalize()` 를 거친 뒤에만 화면과 저장으로 간다.
  id는 영문 · 숫자로 시작하는 64자 이내의 `[A-Za-z0-9_-]` 만 받고(`safeId`), 모르는 칸과 어긋난 값은 버린다. 날짜는 모두 UTC ISO 한 가지 모양으로 맞춘다.
  **기록에 새 칸을 더하면 `normalize()` 에도 더한다.** 안 그러면 다음 맞추기에서 걸러져 사라진다.
  `normalize()` 는 두 번 거쳐도 결과가 같아야 한다(같지 않으면 맞출 때마다 다시 올린다).
- 형식을 바꾸면 `SCHEMA` 를 올린다. 저장소의 기록이 앱보다 새 형식이면 앱은 덮어쓰지 않고 멈춘다.

### 3.3 합치는 규칙 (`sync.js` `mergeLibraries`)

- 책: `updatedAt` 이 늦은 쪽이 통째로 이긴다. 시각이 같고 내용이 다르면, 어느 기기에서 합쳐도 같은 쪽이 남게 내용으로 정한다.
- 사진만은 칸마다 판(`v`)이 큰 쪽. 같은 판이면 `remote` 를 합친다(한쪽이라도 올렸으면 올린 것).
- 지운 책: 지운 시각이 그 책의 `updatedAt` 보다 늦거나 같으면 지워진 채로 남는다. 그 뒤에 고쳐졌으면 되살아나고, 지운 표시를 걷고, 사진의 `remote` 를 내려 다시 올리게 한다.
- 연혁의 줄: id마다 `createdAt` 이 늦은 쪽. 인사이트 메모: `at` 이 늦은 쪽.
- 고친 시각은 `stampAfter()` 로 찍는다: 지금 시각, 다만 앞선 값보다는 반드시 뒤. 하루 넘게 앞선 시각은 `normalize()` 가 지금으로 당긴다.
- 올릴 때 겹치면(409) 다시 받아 합친 뒤 올린다. 저장소의 `library.json` 이 깨져 있으면(JSON이 아니면) 덮어쓰지 않고 멈춘다.
- 맞추는 도중에 기록이 통째로 바뀌면(모드 전환 · 사본 지우기 · 다른 창의 저장) 그 맞추기는 더 올리지 않고 그만둔다(`libEpoch`).

## 4. 하드 룰

1. **색은 `var(--*)` 만.** 색 리터럴은 `css/tokens.css` 에만 쓴다. 예외는 `manifest.webmanifest`, `index.html` 의 `theme-color`, `tools/build-icons.mjs` 뿐이다. 새 색은 라이트 · 다크 값을 함께 추가한다.
2. `!important` 금지.
3. **사용자가 쓴 글은 텍스트로만 넣는다.** `innerHTML` · `insertAdjacentHTML` 금지. `h()` 를 쓴다. `h()` 는 `href` · `src` 에 이 사이트 안의 주소 · https · blob 만 받는다.
4. 브라우저 기본 `alert` · `confirm` · `prompt` 금지. `dom.js` 의 겹침 창과 `toast` 만 쓴다.
5. 죽은 단추 금지. 누를 수 없는 단추는 이유를 옆에 적는다.
6. 그림 문자(이모지) 금지. 아이콘은 `dom.js` 의 선 아이콘.
7. 글꼴은 `--font-sans` 하나. 외부 글꼴 주소를 더하지 않는다.
8. 기록을 바꾸는 코드는 `store.js` 의 함수를 거친다. 화면이 `state.lib` 를 직접 고치지 않는다. 바꾸는 함수는 실제로 바뀌었는지를 돌려주고, 화면은 그것을 보고 알린다.
9. 읽는 중은 5권까지. 사진 넉 장과 총 쪽수 없이는 읽는 중으로 올릴 수 없다. 읽기 시작한 책의 총 쪽수는 비울 수 없다.
10. 움직임의 easing은 `--ease` 하나, 길이는 `--t-1` `--t-2` `--t-3`. `prefers-reduced-motion` 을 지킨다.
11. 밖으로 나가는 주소는 셋뿐이다: `api.github.com`(토큰과 함께), `raw.githubusercontent.com`(공개된 기록과 사진 받기), `api.anthropic.com`(키를 넣었을 때만). 더하려면 `index.html` 의 CSP도 함께 고친다. 요청에는 시간 제한을 둔다(`timeoutSignal`).
12. 토큰과 키는 `config.js` 의 `lsGet` `lsSet` 으로만 다루고, 주소(URL) · 기록 · 알림 글 · 콘솔에 넣지 않는다.
13. 알림(`toast`)은 화면 위쪽에 뜬다. 아래쪽은 시트와 주요 단추의 자리다.
14. 누르는 자리는 40px 이상. 작게 보여야 하는 것(칩 · 블록 손잡이 · 체크 상자)은 `::after` 나 `label` 로 누르는 자리만 넓힌다.
15. 화면의 안내 글은 합쇼체(…습니다)로 쓴다. 「나」 탭의 본문, 연혁의 줄, README는 읽는 사람 자신의 목소리(평서체)다. 책 제목 뒤의 조사는 `josa()` 로 고른다.
16. 이 기기에 두는 것의 이름(IndexedDB · localStorage · 캐시)에는 저장소 이름이나 경로를 넣는다. 서비스 워커는 자기 이름으로 시작하는 캐시만 치운다.

## 5. 기능 인벤토리 (회귀 금지)

- 나: 큰 제목, No. 000, 잘하는 것 6 · 부족해 보이는 것 6(해 볼 것과 짝) · 권하는 책 8(대기에 담기)
- 읽는 중: 읽는 중 n/5 카드(도감 번호 · 진척 % · 책배 막대와 책갈피 · 다음 볼 쪽 · 마지막 메모), 대기, 읽은 책, 인사이트
- 책 한 권: 표본 사진 넉 장(앞표지 · 뒤표지 · 목차 · 본문 첫 장, 줄여서 보관), 총 쪽수, 읽기 시작, 읽은 쪽 기록과 메모, 읽은 기록, 완독, 정보 수정, 대기로 내리기, 지우기
- 100%가 되면 완독을 묻고 리뷰 편집기를 연다. 「아직」을 골라도 「완독으로 옮기기」 단추가 남는다. 리뷰는 속성(별점 · 한 줄 · 읽기 전 · 읽은 뒤 · 키워드)과 블록(텍스트 · 제목 1~3 · 글머리 · 번호 · 할 일 · 인용 · 콜아웃 5색 · 토글 · 구분선)
- 리뷰 편집기: `#` `##` `###` `-` `*` `1.` `[]` `>` `---` `/`, Enter로 나누기, 맨 앞 Backspace로 합치기, 여러 줄 붙여 넣기. 화면이 가려지거나 닫힐 때도 저장한다
- 히스토리: 해마다 묶은 연혁(재개 · 읽기 시작 · 완독), 새 리뷰 확인(받기 → 새 리뷰만 분석 → 결과 한 줄), 지금까지의 숫자와 흐름
- 모드: 구경 / 기록(토큰) / 이 기기에서만 써 보기. 상단 표지에 저장 상태(접은 화면의 책 화면에도). 연결 끊기(사본도 지우기 선택)
- 접은 화면에서는 고른 책이 화면 전체, 펼친 화면에서는 책장과 나란히. 기기의 뒤로 가기가 겹침 창과 책 화면을 닫는다
- PWA: 설치, 연결 없이 열기, 밝게 · 어둡게
- 지키는 것: 다른 사이트의 틀(iframe) 안에서는 열리지 않는다. 단추를 연달아 눌러도 한 번만 적힌다. 사진이 아닌 파일과 60MB를 넘는 파일은 받지 않는다. 같은 기기에 창이 둘 열려 있어도 서로의 수정을 지우지 않는다

## 6. 히스토리 분석 규약 (증분 스냅샷)

- 리뷰마다 지문을 만든다(`analyze.js` `reviewHash`, FNV-1a). `history.analyzed[bookId]` 와 같으면 이미 읽은 리뷰라 건너뛴다. **지난 리뷰 본문은 다시 읽지 않는다.**
- 이전 흐름은 `history.summary`(3문장 이내)로만 넘긴다.
- 읽는 방법
  - `self`: 토큰 없이. 「한 줄」(없으면 본문의 첫 문장)과 「읽기 전 → 읽은 뒤」(없으면 본문의 「달라진 것」)를 옮긴다. 손대지 않은 틀 제목은 읽지 않는다.
  - `claude`: 설정에 Claude API 키가 있을 때. 새 리뷰와 이전 요약만, 여섯 건씩 나눠 보낸다. 답이 끊기거나 모양이 어긋나면 `self` 로 대신한다.
- 분석하는 사이에 리뷰가 바뀌면 그 리뷰는 이번에 적지 않고 다음에 다시 읽는다.
- Claude 세션에서 직접 분석할 때도 같은 규약을 따른다: `data` 브랜치의 `library.json` 을 받아, 지문이 다른 완독 리뷰만 읽고, `history.entries` 에 `{ id: "h-<bookId>", kind: "review", bookId, date, title, line, shift, engine: "claude", hash, createdAt }` 를 더하거나 바꾸고, `analyzed[bookId] = hash`, `summary` 갱신, `history.updatedAt` 과 `updatedAt` 을 지금 시각(UTC ISO, `...Z`)으로 고쳐 `data` 브랜치에 올린다. `insight` 메모도 이때 고쳐 쓸 수 있다(`at` 도 UTC ISO).

## 7. 검증 게이트 (수정 후 필수)

1. `for f in js/*.js sw.js; do node --check "$f"; done`
2. `node tools/e2e.mjs` 가 전부 통과한다(구경 · 써 보기 · 저장소 연결 · 펼친 화면 · 글자 그대로 넣기 · 어긋난 기록 · 합치기 규칙 · 틀 안에서 열기 · 설치와 연결 없이 열기). playwright가 있어야 하고 3분쯤 걸린다. GitHub은 흉내 낸 것이라 실제 저장소에는 쓰지 않는다.
3. 색 게이트: `grep -nE '#[0-9a-fA-F]{3,8}\b|rgba?\(' css/base.css css/views.css css/notion.css js/*.js` 가 0건.
4. 접은 화면(폭 384px)과 펼친 화면(폭 700px), 밝게 · 어둡게를 눈으로 본다. `node tools/e2e.mjs --shots <폴더>` 가 화면을 남긴다.
5. 파일을 더하거나 뺐으면 `sw.js` 의 `SHELL` · `VERSION` 과 이 문서의 §2를 고쳤는지 본다. 배포한 뒤에 파일을 고쳤으면 `VERSION` 과 `config.js` 의 `APP_VERSION` 을 올린다.
6. 금지 패턴: `grep -nE 'innerHTML|insertAdjacentHTML|!important|(^|[^.A-Za-z])(alert|confirm|prompt)\(' js/*.js css/*.css` 에서 주석 말고는 0건.
7. 인증 · 맞추기 · 저장 규칙(`store.js` `sync.js`)이나 전역 틀 · 토큰(`tokens.css` `base.css`)을 건드렸으면, 만든 쪽이 아닌 검토자가 한 번 더 본다.

## 8. 알고 두는 한계 (수용한 위험)

- **기록 모드의 토큰은 이 기기의 `localStorage` 에 평문으로 있다.** 서버가 없는 구조라 다른 방법이 없다. 그래서 토큰은 이 저장소 하나, Contents 권한 하나로만 만든다.
  이 토큰은 `data` 브랜치뿐 아니라 사이트의 코드(`main`)도 고칠 수 있다. 같은 주소(`<owner>.github.io`) 아래의 다른 페이지, 브라우저 확장, 빌린 기기에서 토큰이 새면 사이트 자체가 바뀔 수 있다.
  줄이는 방법: `main` 에 "병합 전 pull request 필수" 규칙(ruleset, 우회 없음)을 걸거나, 기록을 다른 저장소로 옮기고 토큰을 그쪽으로만 낸다. 둘 다 아직 하지 않았다.
- 저장소가 공개라서 `data` 브랜치의 기록과 사진은 누구나 볼 수 있고, 지워도 git 이력에는 남는다. 맞출 때마다 공개 커밋이 생긴다.
- 구경 모드가 받는 기록은 GitHub의 캐시 때문에 최대 5분쯤 늦을 수 있다.
- 한 책을 두 기기에서 서로 맞추지 않은 채 고치면, 책 단위로 나중에 고친 쪽만 남는다(사진은 칸마다).
- 사본 지우기 · 책 지우기를 한 기기에만 있던 사진(아직 올리지 않았거나 「이 기기에만」)은 되찾을 수 없다.
- 리뷰의 블록 하나는 한 줄이다(Shift+Enter로 블록 안에서 줄을 바꿀 수 없다. 토글의 본문만 여러 줄).
- Claude API를 브라우저에서 바로 부르는 분석(`claude`)과 실제 GitHub API에 쓰는 흐름은 흉내 낸 서버로만 확인했다.
- Chromium에서만 확인했다(Safari · Firefox 미확인).
