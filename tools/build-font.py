"""Pretendard Variable에서 이 앱이 쓰는 글자만 남긴 woff2를 만든다 (개발용, 배포본은 fonts/에 이미 있음).

  python3 tools/build-font.py <PretendardVariable.ttf> fonts/PretendardVariable.subset.woff2
  python3 tools/build-font.py <PretendardVariable.ttf> fonts/PretendardVariable.rest.woff2 --rest

기본: 기본 라틴·Latin-1, 한글 완성형 2,350자(KS X 1001), 호환 자모(입력 중 표시), 문장부호·화살표·도형 기호.
--rest: 위에서 빠진 나머지 한글 음절 8,822자(똠, 됬, 햏 같은 드문 글자). 화면에 그런 글자가 나올 때만 내려받는다.
굵기 축은 400~800만 남긴다. 그 밖의 글자(한자 등)는 기기 글꼴로 대체된다.
"""
import os
import sys

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

src, out = sys.argv[1:3]
rest = "--rest" in sys.argv[3:]

cps = set()
for hi in range(0xB0, 0xC9):                      # KS X 1001 한글 2,350자
    for lo in range(0xA1, 0xFF):
        try:
            cps.add(ord(bytes([hi, lo]).decode("euc-kr")))
        except UnicodeDecodeError:
            pass
common = set(cps)
cps |= set(range(0x20, 0x7F)) | set(range(0xA0, 0x100))
cps |= set(range(0x3131, 0x3164))                 # 호환 자모
cps |= set(range(0x2010, 0x2028)) | {0x2030, 0x2032, 0x2033, 0x203B, 0x20A9}
cps |= set(range(0x2190, 0x219A))                 # 화살표
cps |= set(range(0x3000, 0x3020))                 # 『』「」〈〉《》、。
cps |= set(range(0x2460, 0x2474))                 # ①..⑳
cps |= {0x2022, 0x25CF, 0x25CB, 0x25A0, 0x25A1, 0x25B2, 0x25BC, 0x25C6, 0x2605, 0x2606,
        0x2713, 0x2715, 0x2212, 0x221E, 0x2248, 0x2260, 0x2264, 0x2265, 0xFF5E}

if rest:
    cps = set(range(0xAC00, 0xD7A4)) - common       # 나머지 한글 음절

font = TTFont(src)
cmap = font.getBestCmap()
have = sorted(c for c in cps if c in cmap)

# 일부 글리프는 gvar 항목이 없어 서브셋 도중 KeyError가 난다. 빈 변형으로 채워 둔다.
gvar = font["gvar"]
for name in font.getGlyphOrder():
    if name not in gvar.variations:
        gvar.variations[name] = []

font = instancer.instantiateVariableFont(font, {"wght": (400, 800)})
gvar = font["gvar"]
for name in font.getGlyphOrder():
    if name not in gvar.variations:
        gvar.variations[name] = []

opts = subset.Options()
opts.flavor = "woff2"
opts.layout_features = ["kern", "calt", "ccmp", "locl", "rlig", "clig", "case", "tnum", "pnum", "mark", "mkmk"]
opts.name_IDs = [1, 2, 3, 4, 6]
opts.notdef_outline = True
opts.hinting = False
opts.drop_tables += ["DSIG", "meta"]
sub = subset.Subsetter(opts)
sub.populate(unicodes=have)
sub.subset(font)
font.flavor = "woff2"
font.save(out)
axis = font["fvar"].axes[0]
print(f"{len(have)} chars, {font['maxp'].numGlyphs} glyphs, wght {axis.minValue:g}-{axis.maxValue:g}, "
      f"{os.path.getsize(out) / 1024:.0f} KB -> {out}")
