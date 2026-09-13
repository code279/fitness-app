#!/usr/bin/env bash
# 원장(data/stays.json)에서 한 장 요약 HTML·PDF 를 다시 만들고, 세 페이지가
# 원장과 어긋나지 않는지 검증한다. 호스트 답장을 원장에 반영한 뒤 이걸 돌리면 된다.
#   사용법:  bash trip-2027/build.sh
set -euo pipefail
cd "$(dirname "$0")/.."
CHROME=/opt/pw-browsers/chromium-1194/chrome-linux/chrome

echo "── 1. 한 장 요약 생성 ──────────────────────────────"
python3 trip-2027/build-onepager.py

echo "── 2. PDF 렌더 ─────────────────────────────────────"
( cd trip-2027/onepager
  timeout 120 "$CHROME" --headless --disable-gpu --no-sandbox --hide-scrollbars \
    --no-pdf-header-footer --print-to-pdf=도쿄숙소_한장요약.pdf \
    --virtual-time-budget=8000 "file://$PWD/index.html" 2>&1 | grep -i written )

echo "── 3. 검증 ─────────────────────────────────────────"
python3 - <<'PY'
import io, re, json, sys
led = {s['id']: s for s in json.load(io.open('trip-2027/data/stays.json', encoding='utf-8'))['stays']}
bad = 0

# 표: 행마다 9칸, 강조는 1순위 열 하나
s = io.open('trip-2027/airbnb-compare.html', encoding='utf-8').read()
top = sorted((x for x in led.values() if x['rank']), key=lambda x: x['rank'])[0]['id']
cols = [1, 2, 3, 4, 5, 6, 7, 8, 9]                      # 표의 열 순서 = 숙소 번호 순
want = [cols.index(top)]
tb = s.split('<tbody>')[1].split('</tbody>')[0]
for row in re.findall(r'<tr>.*?</tr>', tb, re.S):
    tds = re.findall(r'<td([^>]*)>', row)
    if not tds:
        continue
    lab = re.search(r'<th[^>]*>(.*?)</th>', row, re.S).group(1)
    wins = [i for i, a in enumerate(tds) if 'win' in a]
    if len(tds) != 9 or wins != want:
        bad += 1
        print(f'  X 표 [{lab}] 칸 {len(tds)}개, 강조 {wins} (기대 {want})')

# 산점도: x=d2dMin, y=safety. 12분 동률 3곳은 겹침을 피해 좌우로 벌려 둔 값.
VIS = {6: 188, 5: 232, 3: 210}
sc = s.split('접근성 (오다큐 신주쿠역까지 도어투도어)')[1]
for m in re.finditer(r'<circle cx="(\d+)" cy="(\d+)"[^/]*/>\s*<text[^>]*>(\d)</text>', sc):
    x, y, i = int(m.group(1)), int(m.group(2)), int(m.group(3))
    st = led[i]
    ex = VIS.get(i, 160 + (st['access']['d2dMin'] - 11) * 50)
    ey = round(297 - 86.667 * (st['scores']['safety'] - 3))
    if x != ex or abs(y - ey) > 1:
        bad += 1
        print(f'  X 산점도 {i}번  x {x}/{ex}  y {y}/{ey}')

# 순위 카드 번호가 연속인지
ranks = re.findall(r'<div class="r">(.*?)</div>', s)
nrank = sum(1 for x in led.values() if x['rank'])
expect = [f'{n}순위' for n in range(1, nrank + 1)] + ['탈락'] * (len(led) - nrank)
if ranks != expect:
    bad += 1
    print(f'  X 순위 카드 {ranks}')

# 한 장 요약 카드 순서가 원장 순위와 같은지
op = io.open('trip-2027/onepager/index.html', encoding='utf-8').read()
got = [int(n) for n in re.findall(r'<img class="ph" src="img/(\d)\.jpg"', op)]
ranked = [x['id'] for x in sorted((x for x in led.values() if x['rank']), key=lambda x: x['rank'])]
exp = ranked + sorted(x['id'] for x in led.values() if not x['rank'])   # 탈락끼리는 순서가 없다
if got[:len(ranked)] != ranked or sorted(got[len(ranked):]) != sorted(exp[len(ranked):]):
    bad += 1
    print(f'  X 한 장 요약 순서 {got} (원장 {exp})')

# PDF 링크 주석
raw = io.open('trip-2027/onepager/도쿄숙소_한장요약.pdf', 'rb').read()
n = len(re.findall(rb'/Subtype\s*/Link', raw))
linked = sum(1 for x in led.values() if x.get('sourceUrl'))
if n < linked * 2:
    bad += 1
    print(f'  X PDF 링크 주석 {n}개 (리스팅 {linked}곳 × 2 + 꼬리말 기대)')

print('  ✓ 전부 일치' if not bad else f'  ⚠ {bad}건 어긋남')
sys.exit(1 if bad else 0)
PY

echo
echo "다음: Artifact 로 세 페이지 재배포 후 커밋"
echo "  compare  833571ab-ceab-4eb0-8013-4971068a8881"
echo "  6to9     177f8482-f5d5-43ad-95ac-3e749ab6c3a7"
echo "  onepager b9e4f86f-ab4c-4b34-ba23-fb7dcbaa6844"
echo "  messages a65691b7-07db-49ed-8941-6e3866ff055e"
