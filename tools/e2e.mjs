// e2e.mjs — 회귀 점검(개발용). 실제 브라우저로 주요 흐름을 끝까지 눌러 본다.
//   node tools/e2e.mjs [--shots <폴더>]        (playwright 가 설치된 환경에서)
//
// GitHub은 흉내 낸다(메모리 안의 가짜 저장소). 실제 저장소에는 아무것도 쓰지 않는다.
// 점검 항목: 구경 모드 / 이 기기에서만 써 보기(등록→사진 4장→진척→완독→리뷰→히스토리 분석) /
//           저장소 연결(브랜치 생성·사진 올리기·두 기기 합치기) / 펼친 화면 두 단 / 글자 그대로 넣기(XSS) /
//           어긋난 기록 걸러 내기 / 다른 사이트의 틀 안에서 열리지 않기 / 설치(PWA)와 연결 없이 열기.

import { createServer } from 'node:http';
import { access, readFile, readdir, mkdir, writeFile, mkdtemp } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const { chromium } = createRequire(import.meta.url)('playwright');
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const shotsDir = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;

// ── 작은 도구 ────────────────────────────────────────────
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? '  ok ' : 'FAIL '} ${name}${detail ? `  — ${detail}` : ''}`);
}
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };

function serve() {
  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([/\\])+/, '');
      const file = join(root, path === '' ? 'index.html' : path);
      if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
      try {
        const body = await readFile(file);
        res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' }).end(body);
      } catch { res.writeHead(404).end('not found'); }
    });
    server.listen(0, 'localhost', () => resolve(server));
  });
}

function crc32(buf) {
  let c; let crc = 0xffffffff;
  for (let n = 0; n < buf.length; n += 1) { c = (crc ^ buf[n]) & 0xff; for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; }
  return (crc ^ 0xffffffff) >>> 0;
}
/** 줄무늬가 있는 PNG 한 장(휴대폰 사진처럼 긴 변이 1600px을 넘게) */
function png(w, h, [r, g, b]) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y += 1) {
    const o = y * (w * 3 + 1);
    const dark = Math.floor(y / 40) % 2 === 0;
    for (let x = 0; x < w; x += 1) { raw[o + 1 + x * 3] = dark ? r : Math.min(255, r + 30); raw[o + 2 + x * 3] = dark ? g : Math.min(255, g + 30); raw[o + 3 + x * 3] = dark ? b : Math.min(255, b + 30); }
  }
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// ── 가짜 GitHub ──────────────────────────────────────────
// 진짜 토큰이 아니다. 모양만 맞춘 시험용 글자다.
const GOOD_TOKEN = 'github_pat_E2E0GOOD0TOKEN0000000000';
const BAD_TOKEN = 'github_pat_E2E0BAD0TOKEN00000000000';

function fakeGitHub() {
  const repo = { branch: false, files: new Map(), blobs: new Map(), calls: [], n: 0, failNextPut: 0 };
  const sha = () => { repo.n += 1; return `sha${String(repo.n).padStart(5, '0')}`; };
  const json = (route, status, body) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });

  async function api(route) {
    const req = route.request();
    const url = new URL(req.url());
    const method = req.method();
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    const path = decodeURIComponent(url.pathname.replace('/repos/mk-jeon/reading', ''));
    repo.calls.push(`${method} ${path}`);
    const auth = req.headers().authorization || '';
    if (auth && auth !== `Bearer ${GOOD_TOKEN}`) return json(route, 401, { message: 'Bad credentials' });
    const body = req.postData() ? JSON.parse(req.postData()) : null;

    if (path === '' && method === 'GET') return json(route, 200, { full_name: 'mk-jeon/reading', permissions: { push: true } });
    if (path === '/git/ref/heads/data') return repo.branch ? json(route, 200, { ref: 'refs/heads/data' }) : json(route, 404, { message: 'Not Found' });
    if (path === '/git/blobs' && method === 'POST') { const s = sha(); repo.blobs.set(s, body.content); return json(route, 201, { sha: s }); }
    if (path === '/git/trees' && method === 'POST') { const s = sha(); repo.blobs.set(s, body.tree); return json(route, 201, { sha: s }); }
    if (path === '/git/commits' && method === 'POST') { const s = sha(); repo.blobs.set(s, body.tree); return json(route, 201, { sha: s }); }
    if (path === '/git/refs' && method === 'POST') {
      const tree = repo.blobs.get(repo.blobs.get(body.sha));
      for (const t of tree) repo.files.set(t.path, { sha: t.sha, b64: Buffer.from(repo.blobs.get(t.sha), 'utf8').toString('base64') });
      repo.branch = true;
      return json(route, 201, { ref: body.ref });
    }
    if (path.startsWith('/contents/')) {
      const file = path.slice('/contents/'.length);
      if (method === 'GET') {
        if (!repo.branch) return json(route, 404, { message: 'No commit found for the ref data' });
        const hit = repo.files.get(file);
        if (hit) return json(route, 200, { path: file, sha: hit.sha, content: hit.b64 });
        const kids = [...repo.files.entries()].filter(([p]) => p.startsWith(`${file}/`)).map(([p, f]) => ({ type: 'file', name: p.split('/').pop(), path: p, sha: f.sha }));
        return kids.length ? json(route, 200, kids) : json(route, 404, { message: 'Not Found' });
      }
      if (method === 'PUT') {
        if (!repo.branch) return json(route, 404, { message: 'Branch data not found' });
        if (repo.failNextPut > 0 && file === 'library.json') { repo.failNextPut -= 1; return json(route, 409, { message: 'is at x but expected y' }); }
        const cur = repo.files.get(file);
        if (cur && cur.sha !== body.sha) return json(route, 409, { message: `${file} does not match` });
        if (!cur && body.sha) return json(route, 422, { message: 'sha given for a new file' });
        const s = sha();
        repo.files.set(file, { sha: s, b64: body.content });
        return json(route, cur ? 200 : 201, { content: { path: file, sha: s } });
      }
      if (method === 'DELETE') { repo.files.delete(file); return json(route, 200, {}); }
    }
    return json(route, 404, { message: `no mock for ${method} ${path}` });
  }

  async function raw(route) {
    const file = decodeURIComponent(new URL(route.request().url()).pathname.replace('/mk-jeon/reading/data/', ''));
    const hit = repo.files.get(file);
    if (!hit) return route.fulfill({ status: 404, headers: { 'access-control-allow-origin': '*' }, body: '404: Not Found' });
    return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'content-type': file.endsWith('.json') ? 'text/plain; charset=utf-8' : 'image/jpeg' }, body: Buffer.from(hit.b64, 'base64') });
  }
  const library = () => (repo.files.has('library.json') ? JSON.parse(Buffer.from(repo.files.get('library.json').b64, 'base64').toString('utf8')) : null);
  return { repo, api, raw, library };
}

// ── 화면 조작 도우미 ─────────────────────────────────────
async function newDevice(browser, base, gh, { width = 384, height = 854, scheme = 'light' } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, colorScheme: scheme, isMobile: true, hasTouch: true, serviceWorkers: 'block', locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
  await ctx.route('https://api.github.com/**', gh.api);
  await ctx.route('https://raw.githubusercontent.com/**', gh.raw);
  await ctx.route('https://api.anthropic.com/**', (r) => r.fulfill({ status: 500, body: '{}' }));
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/status of (404|401|409)/.test(m.text())) errors.push(`console: ${m.text()}`); });
  await page.goto(`${base}/`);
  await page.waitForSelector('.tabbar');
  await page.evaluate(() => document.fonts.ready);
  return { ctx, page, errors };
}
/** 조건이 참이 될 때까지 기다린다(가짜 저장소에 반영됐는지 볼 때 쓴다). */
async function until(fn, ms = 30000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 100)); }
  return false;
}
const pagesOf = (gh, title) => { const lib = gh.library(); const b = lib && Object.values(lib.books).find((x) => x.title === title); return b ? b.totalPages : undefined; };
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
async function shot(page, name) {
  if (!shotsDir) return;
  await mkdir(shotsDir, { recursive: true });
  await page.waitForTimeout(450);          // 열리는 움직임이 끝난 뒤에 찍는다
  await page.screenshot({ path: join(shotsDir, `${name}.png`) });
}
async function tab(page, label) { await page.click(`.tabbar >> text="${label}"`); await page.waitForTimeout(120); }
async function addPhoto(page, slotLabel, file) {
  await page.click(`button.plate:has-text("${slotLabel}")`);
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('.menu-item:has-text("사진에서 고르기")')]);
  await chooser.setFiles(file);
  await page.waitForSelector(`button.plate:has-text("${slotLabel}") img`, { timeout: 20000 });
}

// ── 점검 ─────────────────────────────────────────────────
const server = await serve();
const base = `http://localhost:${server.address().port}`;
const tmp = await mkdtemp(join(tmpdir(), 'dogam-e2e-'));
const photos = {};
for (const [name, color] of [['front', [30, 90, 110]], ['back', [190, 150, 90]], ['toc', [228, 228, 220]], ['first', [240, 238, 230]]]) {
  photos[name] = join(tmp, `${name}.png`);
  await writeFile(photos[name], png(1800, 2400, color));
}
const browser = await chromium.launch();
const gh = fakeGitHub();

try {
  // 1) 구경 모드 ------------------------------------------------
  console.log('\n[1] 구경 모드');
  const v = await newDevice(browser, base, gh);
  check('나 탭이 첫 화면이고 큰 제목이 보인다', (await v.page.textContent('.hero-title')).includes('독서를 다시 시작해 본다'));
  check('가로로 넘치지 않는다', (await overflow(v.page)) === 0);
  await shot(v.page, '01-cover-me');
  await tab(v.page, '읽는 중');
  check('대기에 다섯 권이 있다', (await v.page.locator('.srow').count()) === 5);
  check('구경 모드에서는 책 추가 단추가 없다', (await v.page.locator('button:has-text("책 추가")').count()) === 0);
  await v.page.click('.srow >> text="사피엔스"');
  await v.page.waitForSelector('.detail-title');
  check('구경 모드의 빈 사진 칸은 누를 수 없다', (await v.page.locator('button.plate').count()) === 0 && (await v.page.locator('.plate').count()) === 4);
  await v.page.click('.detail-back');
  await tab(v.page, '히스토리');
  check('연혁 첫 줄(독서 재개)이 있다', (await v.page.textContent('.tl')).includes('독서 재개'));
  check('구경 모드: 오류 없음', v.errors.length === 0, v.errors.join(' | '));
  await v.ctx.close();

  // 2) 이 기기에서만 써 보기 ------------------------------------
  console.log('\n[2] 이 기기에서만 써 보기: 등록 → 사진 4장 → 진척 → 완독 → 리뷰 → 히스토리');
  const a = await newDevice(browser, base, gh);
  const p = a.page;
  const fontHits = { rest: 0 };
  p.on('request', (r) => { if (r.url().endsWith('PretendardVariable.rest.woff2')) fontHits.rest += 1; });
  await p.click('button[aria-label="설정"]');
  await shot(p, '11-cover-settings');
  await p.click('text=토큰 없이 이 기기에서만 써 보기');
  await p.click('.dialog button[aria-label="닫기"]');
  check('상단 표지가 「이 기기에만」으로 바뀐다', (await p.textContent('.topbar .chip')) === '이 기기에만');
  await tab(p, '읽는 중');
  await p.click('.srow >> text="사피엔스"');
  await p.waitForSelector('.detail-title');
  check('사진과 쪽수가 없으면 읽기 시작이 잠겨 있다', await p.isDisabled('button:has-text("읽기 시작")'));
  await p.fill('#start-pages', '636');
  await p.dispatchEvent('#start-pages', 'change');
  await p.waitForSelector('.checks li.is-done:has-text("총 636쪽")');
  for (const [label, key] of [['앞표지', 'front'], ['뒤표지', 'back'], ['목차', 'toc']]) await addPhoto(p, label, photos[key]);
  check('사진 세 장으로는 아직 잠겨 있다', await p.isDisabled('button:has-text("읽기 시작")'));
  await addPhoto(p, '본문 첫 장', photos.first);
  check('사진 넉 장이 차면 읽기 시작이 열린다', !(await p.isDisabled('button:has-text("읽기 시작")')));
  const sizes = await p.evaluate(async () => {
    const db = await new Promise((res) => { const r = indexedDB.open('dogam'); r.onsuccess = () => res(r.result); });
    const all = await new Promise((res) => { const r = db.transaction('photos').objectStore('photos').getAll(); r.onsuccess = () => res(r.result); });
    return all.map((x) => ({ bytes: x.blob.size, type: x.blob.type }));
  });
  check('사진은 JPEG로 줄여 장당 340KB 안쪽으로 보관한다', sizes.length === 4 && sizes.every((s) => s.type === 'image/jpeg' && s.bytes <= 340 * 1024), JSON.stringify(sizes.map((s) => Math.round(s.bytes / 1024))));
  await shot(p, '02-cover-register');
  await p.click('button:has-text("읽기 시작")');
  await p.waitForSelector('.prog-pct');
  check('올리면 도감 번호 No. 001이 붙는다', (await p.textContent('.detail-tags')).includes('No. 001'));

  await p.fill('#log-page', '120');
  await p.fill('#log-memo', '인지혁명: 허구를 함께 믿는 능력이 협력을 키웠다.');
  await p.click('button:has-text("기록")');
  await p.waitForSelector('.log');
  check('진척도가 18%로 계산된다 (120/636)', (await p.textContent('.prog-pct')) === '18%');
  check('다음 볼 차례가 p.121로 표시된다', (await p.textContent('.prog-nums')).includes('p.121'));
  await p.fill('#log-page', '700');
  await p.click('button:has-text("기록")');
  check('총 쪽수를 넘는 값은 막는다', (await p.textContent('#log-err')).includes('636쪽까지'));
  await shot(p, '03-cover-progress');
  await p.click('.detail-back');
  await p.waitForSelector('.rcard');
  check('책장 카드에 진척도와 마지막 메모가 보인다', (await p.textContent('.rcard')).includes('18%') && (await p.textContent('.rcard-memo')).includes('인지혁명'));
  await shot(p, '04-cover-shelf');

  await p.click('.rcard');
  await p.fill('#log-page', '636');
  await p.fill('#log-memo', '끝.');
  await p.click('button:has-text("기록")');
  await p.click('.dialog button:has-text("완독으로 옮기기")');
  await p.waitForSelector('.ndoc.is-editing');
  check('100%가 되면 완독을 묻고 리뷰 편집기가 열린다', true);
  await p.click('button[aria-label="별점 4점"]');
  await p.fill('#rv-line', '역사는 사실의 목록이 아니라 믿음의 목록이다.');
  await p.fill('#rv-before', '역사는 사실을 쌓는 일이라고 생각했다');
  await p.fill('#rv-after', '무엇을 함께 믿느냐가 사실만큼 세상을 움직인다');
  await p.fill('#rv-tags', '인류사, 허구, 협력');
  const firstP = p.locator('.nb--p .nb-text').first();
  await firstP.click();
  await firstP.pressSequentially('- 큰 지도를 먼저 보고 싶었다');
  check('「- 」로 시작하면 글머리 목록이 된다', (await p.locator('.nb--bullet').count()) === 1);
  await p.keyboard.press('Enter');
  await p.keyboard.type('총균쇠와 맞세워 읽을 생각');
  check('Enter로 블록이 나뉘고 목록이 이어진다', (await p.locator('.nb--bullet').count()) === 2);
  await p.locator('.nb--quote .nb-text').fill('우리는 이야기를 믿는 동물이다');
  await p.locator('.nb--callout .nb-text').nth(0).fill('나는 허구가 협력의 조건이라고 생각한다');
  await p.locator('.nb--callout .nb-text').nth(1).fill('반론: 협력은 허구 이전에 친족과 호혜로도 설명된다');
  await shot(p, '05-cover-review-edit');
  await p.click('.dialog-tools button:has-text("완료")');
  await p.waitForSelector('.ndoc:not(.is-editing) blockquote');
  const doc = await p.textContent('.ndoc');
  check('읽기 화면에 쓴 내용이 노션식 블록으로 보인다', doc.includes('우리는 이야기를 믿는 동물이다') && (await p.locator('.ndoc .callout').count()) === 2 && (await p.locator('.ndoc ul li').count()) === 2);
  check('아무것도 쓰지 않은 틀 제목(달라진 것)은 읽기 화면에서 빠진다', !doc.includes('달라진 것'));
  await shot(p, '06-cover-review-read');
  await p.click('.dialog--page button[aria-label="닫기"]');
  await p.waitForSelector('.done-line');
  check('완독 패널에 한 줄이 보인다', (await p.textContent('.done-line')).includes('믿음의 목록'));

  await p.click('.detail-back');
  await tab(p, '히스토리');
  check('분석 전에는 「새 리뷰 확인 전」으로 표시된다', (await p.textContent('.tl')).includes('새 리뷰 확인 전'));
  await p.click('button:has-text("새 리뷰 확인")');
  await p.waitForSelector('.flip');
  check('확인하는 동안 책장 넘기는 표시가 나온다', true);
  await p.waitForSelector('.hist-result', { timeout: 8000 });
  const r1 = await p.textContent('.hist-result');
  check('새 리뷰 1건만 읽어 연혁에 더한다', r1.includes('새 리뷰 1건'), r1);
  check('연혁에 한 줄과 읽기 전 → 읽은 뒤가 적힌다', (await p.textContent('.tl')).includes('믿음의 목록') && (await p.textContent('.tl-shift')).includes('→'));
  await shot(p, '07-cover-history');
  await p.click('button:has-text("새 리뷰 확인")');
  await p.waitForSelector('.flip');
  await p.waitForSelector('.hist-result', { timeout: 8000 });
  const r2 = await p.textContent('.hist-result');
  check('다시 누르면 이미 읽은 리뷰는 건너뛴다', r2.includes('새로 읽을 리뷰가 없습니다') && r2.includes('1건은 다시 읽지 않았습니다'), r2);

  await p.reload();
  await p.waitForSelector('.tabbar');
  await tab(p, '읽는 중');
  check('새로 고쳐도 기록이 남아 있다', (await p.locator('.srow:has-text("사피엔스")').count()) === 1 && (await p.textContent('.pane-list')).includes('읽은 책'));

  // 드문 한글 음절이 나올 때만 나머지 글꼴을 받는다
  const restBefore = fontHits.rest;
  await p.click('button:has-text("책 추가")');
  await p.fill('#title', '똠얌꿍 햏자');
  await p.click('.dialog-foot button:has-text("대기에 넣기")');
  await p.waitForSelector('.srow:has-text("똠얌꿍")');
  await until(() => fontHits.rest > restBefore, 8000);
  check('드문 한글 음절이 나올 때만 나머지 글꼴(rest)을 받는다', restBefore === 0 && fontHits.rest === 1 && (await p.evaluate(async () => { await document.fonts.ready; return document.fonts.check('16px "Pretendard Variable Rest"', '똠'); })), `전 ${restBefore}, 후 ${fontHits.rest}`);

  // 글자 그대로 넣기
  await p.click('button:has-text("책 추가")');
  await p.fill('#title', '<img src=x onerror="window.__xss=1"> 시험');
  await p.fill('#author', '"><script>window.__xss=1</script>');
  await p.click('.dialog-foot button:has-text("대기에 넣기")');
  await p.waitForSelector('.srow:has-text("시험")');
  check('제목에 넣은 태그는 글자 그대로 보이고 실행되지 않는다', (await p.evaluate(() => window.__xss)) === undefined && (await p.locator('.srow img').count()) === 0);
  check('써 보기 흐름: 오류 없음', a.errors.length === 0, a.errors.join(' | '));

  // 3) 저장소 연결 ---------------------------------------------
  console.log('\n[3] 저장소 연결: 브랜치 만들기 → 사진 올리기 → 다른 기기에서 이어 보기 → 겹친 수정 합치기');
  await p.click('button[aria-label="설정"]');
  await p.fill('#gh-token', 'not a token');
  await p.click('.settings button[type="submit"]');
  check('토큰 모양이 아닌 글자는 보내지 않고 거절한다', (await p.textContent('.settings .field-error')).includes('토큰 모양이 아닙니다') && !gh.repo.calls.length);
  await p.fill('#gh-token', BAD_TOKEN);
  await p.click('.settings button[type="submit"]');
  await p.waitForSelector('.settings .field-error:has-text("토큰이 틀렸거나")');
  check('틀린 토큰은 이유와 함께 거절된다', (await p.textContent('.settings')).includes('토큰이 틀렸거나'));
  await p.fill('#gh-token', GOOD_TOKEN);
  await p.click('.settings button[type="submit"]');
  await p.waitForFunction(() => document.querySelector('.topbar .chip').textContent === '저장됨', null, { timeout: 30000 });
  check('연결하면 상단 표지가 「저장됨」이 된다', true);
  check('기록 브랜치를 빈 뿌리에서 새로 만든다', gh.repo.calls.includes('POST /git/refs') && gh.repo.branch);
  const lib1 = gh.library();
  const sap = Object.values(lib1.books).find((b) => b.title === '사피엔스');
  check('저장소의 기록에 완독한 책과 리뷰가 들어 있다', sap && sap.status === 'done' && sap.review.props.rating === 4);
  check('사진 넉 장이 판 번호가 붙은 이름으로 저장소에 올라가고 올린 표시가 남는다', ['front', 'back', 'toc', 'first'].every((k) => gh.repo.files.has(`photos/${sap.id}/${k}-${sap.photos[k].v}.jpg`) && sap.photos[k].remote === true));
  check('토큰은 기록 파일에도, 저장소의 어느 파일에도 들어가지 않는다', ![...gh.repo.files.values()].some((f) => Buffer.from(f.b64, 'base64').toString('utf8').includes(GOOD_TOKEN)));
  const stored = await p.evaluate(async () => {
    const db = await new Promise((res) => { const r = indexedDB.open('dogam'); r.onsuccess = () => res(r.result); });
    const lib = await new Promise((res) => { const r = db.transaction('kv').objectStore('kv').getAll(); r.onsuccess = () => res(r.result); });
    return { ls: Object.keys(localStorage).sort(), idb: JSON.stringify(lib) };
  });
  check('토큰은 이 기기의 localStorage 한 곳에만 있다', stored.ls.includes('dogam.ghToken') && !stored.idb.includes(GOOD_TOKEN), stored.ls.join(', '));
  await p.click('.dialog button[aria-label="닫기"]');

  const b = await newDevice(browser, base, gh, { width: 700, height: 780 });
  const q = b.page;
  await tab(q, '읽는 중');
  await q.waitForSelector('.srow:has-text("사피엔스")');
  check('다른 기기(구경 모드)에서 공개된 기록이 보인다', (await q.textContent('.topbar .chip')) === '구경 중');
  await q.click('.srow:has-text("사피엔스")');
  await q.waitForSelector('.plate img');
  check('다른 기기에서는 저장소에 올린 사진을 받아 보여 준다', (await q.getAttribute('.plate img', 'src')).includes('raw.githubusercontent.com'));
  const cols = await q.evaluate(() => getComputedStyle(document.querySelector('.panes')).gridTemplateColumns.split(' ').length);
  const detailPos = await q.evaluate(() => getComputedStyle(document.querySelector('.pane-detail')).position);
  check('펼친 화면에서는 책장과 고른 책이 두 단으로 나란하다', cols === 2 && detailPos === 'sticky');
  check('펼친 화면: 가로로 넘치지 않는다', (await overflow(q)) === 0);
  await shot(q, '08-open-reading');
  await q.click('button:has-text("리뷰 읽기")');
  await q.waitForSelector('.ndoc blockquote');
  check('구경 모드에서는 리뷰에 편집 단추가 없다', (await q.locator('.dialog-tools').count()) === 0);
  await shot(q, '09-open-review');
  await q.click('.dialog--page button[aria-label="닫기"]');

  await tab(q, '나');
  await shot(q, '12-open-me');
  await q.evaluate(() => document.querySelector('#lack').scrollIntoView());
  await shot(q, '13-open-me-lack');
  await tab(q, '히스토리');
  await shot(q, '14-open-history');
  await tab(q, '읽는 중');

  // 두 번째 기기도 연결하고, 두 기기에서 서로 다른 책을 고친다
  await q.click('button[aria-label="설정"]');
  await q.fill('#gh-token', GOOD_TOKEN);
  await q.click('.settings button[type="submit"]');
  await q.waitForFunction(() => document.querySelector('.topbar .chip').textContent === '저장됨', null, { timeout: 30000 });
  await q.click('.dialog button[aria-label="닫기"]');
  await q.click('.srow:has-text("총균쇠")');
  await q.fill('#start-pages', '784');
  await q.dispatchEvent('#start-pages', 'change');
  await until(() => pagesOf(gh, '총균쇠') === 784);

  gh.repo.failNextPut = 1;                                   // 올리는 순간 한 번 겹치게 한다
  await tab(p, '읽는 중');
  await p.click('.srow:has-text("퇴사준비생의 도쿄")');
  await p.fill('#start-pages', '340');
  await p.dispatchEvent('#start-pages', 'change');
  await until(() => pagesOf(gh, '퇴사준비생의 도쿄') === 340);
  const lib2 = gh.library();
  const pages = Object.fromEntries(Object.values(lib2.books).map((x) => [x.title, x.totalPages]));
  check('두 기기의 수정이 겹쳐도 둘 다 남는다', pages['총균쇠'] === 784 && pages['퇴사준비생의 도쿄'] === 340, JSON.stringify({ 총균쇠: pages['총균쇠'], 도쿄: pages['퇴사준비생의 도쿄'] }));
  check('연결 흐름: 오류 없음', a.errors.length === 0 && b.errors.length === 0, [...a.errors, ...b.errors].join(' | '));

  // 사진을 다시 찍으면 새 판이 새 이름으로 올라간다
  await p.click('.detail-back');
  await p.click('.srow:has-text("사피엔스")');
  await p.click('button.plate:has-text("앞표지")');
  await p.click('.dialog button:has-text("다시 찍기")');
  const [again] = await Promise.all([p.waitForEvent('filechooser'), p.click('.menu-item:has-text("사진에서 고르기")')]);
  await again.setFiles(photos.back);
  const newer = () => { const x = Object.values(gh.library().books).find((y) => y.title === '사피엔스'); return x && x.photos.front; };
  await until(() => { const m = newer(); return m && m.v !== sap.photos.front.v && m.remote === true && gh.repo.files.has(`photos/${sap.id}/front-${m.v}.jpg`); });
  check('다시 찍은 사진은 새 판 이름으로 올라간다', newer().v !== sap.photos.front.v && gh.repo.files.has(`photos/${sap.id}/front-${newer().v}.jpg`));

  // 기록을 두 번 눌러도 한 줄만 적힌다
  await p.click('.detail-back');
  await p.click('.srow:has-text("퇴사준비생의 도쿄")');
  for (const [label, key] of [['앞표지', 'front'], ['뒤표지', 'back'], ['목차', 'toc'], ['본문 첫 장', 'first']]) await addPhoto(p, label, photos[key]);
  await p.click('button:has-text("읽기 시작")');
  await p.waitForSelector('#log-page');
  await p.fill('#log-page', '40');
  await p.evaluate(() => { const f = document.querySelector('#log-page').form; f.requestSubmit(); f.requestSubmit(); });
  await p.waitForSelector('.log');
  await p.waitForTimeout(300);
  check('기록을 연달아 두 번 눌러도 한 줄만 적힌다', (await p.locator('.log').count()) === 1);

  // 책을 지우면 저장소의 사진도 지운다
  await p.click('.detail-back');
  await p.click('.srow:has-text("사피엔스")');
  await p.click('button[aria-label="더 보기"]');
  await p.click('.menu-item:has-text("책 지우기")');
  await p.click('.dialog button:has-text("지우기")');
  await until(() => !Object.values(gh.library().books).some((x) => x.title === '사피엔스') && ![...gh.repo.files.keys()].some((k) => k.startsWith(`photos/${sap.id}/`)));
  check('책을 지우면 저장소의 사진과 연혁 줄도 지워진다', ![...gh.repo.files.keys()].some((k) => k.startsWith(`photos/${sap.id}/`)) && !gh.library().history.entries.some((e) => e.bookId === sap.id));

  // 어두운 화면
  const d = await newDevice(browser, base, gh, { scheme: 'dark' });
  check('어두운 화면에서 바탕과 글자색이 바뀐다', (await d.page.evaluate(() => getComputedStyle(document.body).backgroundColor)) === 'rgb(14, 20, 24)');
  await shot(d.page, '10-cover-dark');
  await d.page.evaluate(() => document.querySelector('#lack').scrollIntoView());
  await shot(d.page, '15-cover-dark-lack');
  await tab(d.page, '읽는 중');
  await shot(d.page, '16-cover-dark-reading');
  await d.ctx.close();
  await a.ctx.close();
  await b.ctx.close();

  // 4) 어긋난 기록 · 틀 안에서 열기 --------------------------------
  console.log('\n[4] 어긋난 기록 걸러 내기 · 다른 사이트의 틀 안에서 열리지 않기');
  const junk = {
    schema: 99, updatedAt: 'not a date', seq: 'x',
    books: {
      'ok-1': { title: '<b>굵게</b>', totalPages: 300.4, page: 9999, status: 'reading', no: 2, startedAt: '2026-10-01T00:00:00Z', photos: { front: { v: 5, remote: 'yes' }, evil: { v: 1 } },
        logs: [{ page: 10, memo: 12 }, 'x', { page: 'NaN' }],
        review: { props: { rating: 99, tags: 'no', oneLine: { a: 1 } }, blocks: [{ id: 'k1', type: 'script', text: 5 }, { id: 'k1', type: 'todo', text: 'x', checked: 'y' }, null, { type: 'callout', tone: 'pink', text: 'c' }] } },
      'ok-2': { title: '둘', status: 'reading', no: 2, startedAt: '2026-10-02T00:00:00Z' },
      '../../etc': { title: '경로' }, '__proto__x': { title: '밑줄' }, 'a b': { title: '빈칸' }, bad: 'string',
    },
    tombstones: { '../x': '2026-01-01T00:00:00Z', gone: 'never' },
    history: { entries: [{ id: 'h1', date: '2026-10-01', title: 't', kind: 'weird' }, { id: 'h-x', kind: 'review', bookId: 'missing', date: '2026-10-01' }, { id: 'h1', date: '2026-10-02' }, { id: 'no-date' }, 7], analyzed: { missing: 'abc', 'ok-1': 5 }, summary: 9 },
    insight: { by: {}, lines: ['한 줄', 3, ''] },
  };
  gh.repo.files.set('library.json', { sha: 'junk', b64: Buffer.from(JSON.stringify(junk), 'utf8').toString('base64') });
  const j = await newDevice(browser, base, gh);
  await tab(j.page, '읽는 중');
  await j.page.waitForSelector('.rcard');
  const shape = await j.page.evaluate(async () => {
    const { state, normalize } = await import('./js/store.js');
    const lib = state.lib;
    const b = lib.books['ok-1'];
    const once = JSON.stringify(normalize(structuredClone(lib)));
    return {
      ids: Object.keys(lib.books).sort(), schema: lib.schema, seq: lib.seq, nos: [lib.books['ok-1'].no, lib.books['ok-2'].no],
      pages: [b.totalPages, b.page], photos: Object.keys(b.photos), remote: b.photos.front && b.photos.front.remote,
      logs: b.logs.length, memo: b.logs[0] && b.logs[0].memo, rating: b.review.props.rating, tags: b.review.props.tags,
      blocks: b.review.blocks.map((k) => `${k.type}:${typeof k.text}`), blockIds: new Set(b.review.blocks.map((k) => k.id)).size,
      tomb: Object.keys(lib.tombstones), entries: lib.history.entries.map((e) => `${e.id}:${e.kind}`), analyzed: Object.keys(lib.history.analyzed),
      summary: lib.history.summary, insight: lib.insight.lines, stable: once === JSON.stringify(normalize(JSON.parse(once))),
    };
  });
  check('모양이 어긋난 id의 책은 받아들이지 않는다', JSON.stringify(shape.ids) === JSON.stringify(['ok-1', 'ok-2']), shape.ids.join(', '));
  check('쪽수·사진·기록·리뷰의 어긋난 값이 걸러진다', shape.pages[0] === 300 && shape.pages[1] === 300 && JSON.stringify(shape.photos) === '["front"]' && shape.remote === false && shape.logs === 1 && shape.memo === '12' && shape.rating === 5 && shape.tags.length === 0, JSON.stringify(shape));
  check('모르는 블록은 텍스트가 되고 겹친 id는 새로 받는다', JSON.stringify(shape.blocks) === JSON.stringify(['p:string', 'todo:string', 'callout:string']) && shape.blockIds === 3);
  check('겹친 도감 번호는 나중에 시작한 쪽이 새 번호를 받는다', shape.nos[0] === 2 && shape.nos[1] === 3 && shape.seq === 3, JSON.stringify(shape.nos));
  check('연혁·지움 표시·분석 지문의 어긋난 줄이 걸러진다', JSON.stringify(shape.entries) === JSON.stringify(['h1:milestone']) && shape.tomb.length === 0 && shape.analyzed.length === 0 && shape.summary === '9' && shape.insight.length === 1, JSON.stringify(shape.entries));
  check('다듬기는 두 번 해도 결과가 같다(되풀이 올리기 없음)', shape.stable);
  await j.page.click('.rcard >> nth=0');
  await j.page.waitForSelector('.detail-title');
  check('어긋난 기록으로도 화면이 깨지지 않는다', (await j.page.textContent('.detail-title')) === '<b>굵게</b>' && j.errors.length === 0, j.errors.join(' | '));
  await j.ctx.close();
  gh.repo.files.delete('library.json');

  const f = await browser.newContext({ viewport: { width: 384, height: 854 }, serviceWorkers: 'block' });
  await f.route('https://api.github.com/**', gh.api);
  await f.route('https://raw.githubusercontent.com/**', gh.raw);
  await f.route(`${base}/framer.html`, (r) => r.fulfill({ status: 200, contentType: 'text/html', body: `<!doctype html><iframe src="${base}/" width="380" height="800"></iframe>` }));
  const fp = await f.newPage();
  await fp.goto(`${base}/framer.html`);
  const inner = fp.frameLocator('iframe');
  await inner.locator('.note:has-text("다른 사이트")').waitFor();
  check('다른 사이트의 틀(iframe) 안에서는 열리지 않는다', (await inner.locator('.tabbar').count()) === 0 && (await inner.locator('#app').textContent()).includes('다른 사이트 안에서는 열리지 않습니다'));
  await f.close();

  // 5) 설치(PWA)와 연결 없이 열기 ---------------------------------
  console.log('\n[5] 설치(PWA) · 연결 없이 열기');
  const swText = await readFile(join(root, 'sw.js'), 'utf8');
  const shellAt = swText.indexOf('const SHELL = [');
  const shell = [...swText.slice(shellAt, swText.indexOf('];', shellAt)).matchAll(/'([^']+)'/g)].map((m) => m[1]).filter((x) => x !== './');
  const missing = [];
  for (const rel of shell) { try { await access(join(root, rel)); } catch { missing.push(rel); } }
  const need = [...(await readdir(join(root, 'js'))).map((x) => `js/${x}`), ...(await readdir(join(root, 'css'))).map((x) => `css/${x}`)].filter((x) => !shell.includes(x));
  check('담아 둘 파일 목록(SHELL)에 빠지거나 없는 파일이 없다', !missing.length && !need.length, [...missing.map((x) => `없음 ${x}`), ...need.map((x) => `빠짐 ${x}`)].join(', '));
  const manifest = JSON.parse(await readFile(join(root, 'manifest.webmanifest'), 'utf8'));
  const iconsOk = [];
  for (const ic of manifest.icons) {
    const buf = await readFile(join(root, ic.src));
    iconsOk.push(`${buf.readUInt32BE(16)}x${buf.readUInt32BE(20)}` === ic.sizes);
  }
  check('매니페스트의 아이콘이 적힌 크기 그대로 있다(192·512, 마스커블 포함)', iconsOk.every(Boolean) && manifest.icons.some((i) => i.purpose === 'maskable' && i.sizes === '512x512') && manifest.display === 'standalone');

  const profile = await mkdtemp(join(tmpdir(), 'dogam-pwa-'));
  const pw = await chromium.launchPersistentContext(profile, { viewport: { width: 384, height: 854 }, locale: 'ko-KR' });
  await pw.route('https://api.github.com/**', gh.api);
  await pw.route('https://raw.githubusercontent.com/**', gh.raw);
  const pp = pw.pages()[0] || await pw.newPage();
  const perr = [];
  pp.on('pageerror', (e) => perr.push(e.message));
  await pp.goto(`${base}/`);
  await pp.waitForSelector('.tabbar');
  const ready = await pp.evaluate(async () => { const reg = await navigator.serviceWorker.ready; return Boolean(reg.active); });
  check('서비스 워커가 등록되고 켜진다', ready);
  await pp.reload();
  await pp.waitForSelector('.tabbar');
  check('다시 열면 서비스 워커가 화면을 맡는다', await pp.evaluate(() => Boolean(navigator.serviceWorker.controller)));
  const cdp = await pw.newCDPSession(pp);
  const mf = await cdp.send('Page.getAppManifest');
  check('브라우저가 매니페스트를 오류 없이 읽는다', mf.url.endsWith('manifest.webmanifest') && mf.errors.length === 0, JSON.stringify(mf.errors));
  const inst = await cdp.send('Page.getInstallabilityErrors');
  check('설치를 막는 오류가 없다', inst.installabilityErrors.length === 0, JSON.stringify(inst.installabilityErrors));
  await pw.setOffline(true);
  await pp.reload();
  await pp.waitForSelector('.tabbar');
  await pp.click('.tabbar >> text="읽는 중"');
  await pp.waitForSelector('.srow');
  const offlineFont = await pp.evaluate(async () => { await document.fonts.ready; return document.fonts.check('16px "Pretendard Variable"'); });
  check('연결이 없어도 앱이 열리고 글꼴이 그대로다', (await pp.locator('.srow').count()) >= 1 && offlineFont && perr.length === 0, perr.join(' | '));
  await shot(pp, '17-cover-offline');
  await pw.setOffline(false);
  await pw.close();
} catch (e) {
  check('점검이 끝까지 돌았다', false, e.message.split('\n')[0]);
} finally {
  await browser.close();
  server.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length} / ${results.length} 통과${failed.length ? `, 실패 ${failed.length}` : ''}`);
process.exit(failed.length ? 1 : 0);
