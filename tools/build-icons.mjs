// build-icons.mjs — 앱 아이콘을 다시 만든다 (개발용. 배포본은 icons/ 에 이미 있다).
//   node tools/build-icons.mjs        (playwright 가 설치된 환경에서)
//
// 그림: 펼친 책 두 쪽. 읽은 왼쪽은 채워져 있고, 읽을 오른쪽은 비어 있다.
//       오른쪽 위에 책갈피가 걸려 있다. 다시 펼친 자리라는 뜻이다. 접었다 펴는 전화기의 모양이기도 하다.

import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// NODE_PATH 로 잡아 둔 playwright 도 찾도록 require 로 불러온다.
const { chromium } = createRequire(import.meta.url)('playwright');

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'icons');
const TEAL = '#0E626D';
const PAPER = '#F1F4F6';
const RIBBON = '#E3A75E';

/** corner: 바탕 모서리 반지름(0이면 꽉 찬 정사각형), scale: 그림 크기 배율 */
function svg({ corner = 0, scale = 1 } = {}) {
  const glyph = `
    <rect x="118" y="146" width="128" height="220" rx="18" fill="${PAPER}"/>
    <rect x="273" y="153" width="114" height="206" rx="11" fill="none" stroke="${PAPER}" stroke-width="14"/>
    <path d="M316 124h34v150l-17-19-17 19z" fill="${RIBBON}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="${corner}" fill="${TEAL}"/>
  <g transform="translate(256 256) scale(${scale}) translate(-256 -256)">${glyph}
  </g>
</svg>
`;
}

const targets = [
  { file: 'icon-192.png', size: 192, opts: { corner: 112, scale: 1.12 } },
  { file: 'icon-512.png', size: 512, opts: { corner: 112, scale: 1.12 } },
  { file: 'icon-maskable-192.png', size: 192, opts: { corner: 0, scale: 0.92 } },   // 안전 영역(가운데 80%) 안에 그림을 둔다
  { file: 'icon-maskable-512.png', size: 512, opts: { corner: 0, scale: 0.92 } },
  { file: 'apple-touch-icon.png', size: 180, opts: { corner: 0, scale: 1.04 } },
  { file: 'favicon-32.png', size: 32, opts: { corner: 112, scale: 1.2 } },
];

await mkdir(out, { recursive: true });
await writeFile(join(out, 'favicon.svg'), svg({ corner: 112, scale: 1.2 }));
await writeFile(join(out, 'icon.svg'), svg({ corner: 112, scale: 1.12 }));

const browser = await chromium.launch();
for (const t of targets) {
  const page = await browser.newPage({ viewport: { width: t.size, height: t.size }, deviceScaleFactor: 1 });
  await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:${t.size}px;height:${t.size}px}</style>${svg(t.opts)}`);
  await page.screenshot({ path: join(out, t.file), omitBackground: true });
  await page.close();
  console.log(t.file, `${t.size}px`);
}
await browser.close();
