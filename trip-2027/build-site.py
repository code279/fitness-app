#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""site.html 의 숙소 섹션을 원장(data/stays.json)에서 다시 만든다.
   호스트 답장을 원장에 반영한 뒤 build.sh 를 돌리면 여기까지 따라온다."""
import io, json, os, re

HERE = os.path.dirname(os.path.abspath(__file__))
LED  = json.load(io.open(os.path.join(HERE, 'data/stays.json'), encoding='utf-8'))
STAY = {s['id']: s for s in LED['stays']}
META = LED['_meta']

# 카드마다 손으로 적는 한 줄 평 — 원장의 verdict 는 너무 길다
LINE = {
 4: '물은 다섯 가지가 전부 답변된 유일한 후보입니다. 짐은 11:30 이후 도착이면 직원이 실내로 옮겨줍니다.',
 7: '아홉 곳 중 가장 새 건물이고 신주쿠에 가장 가깝습니다. 다만 샤워가 1층에 하나뿐입니다.',
 9: '대피 준비가 가장 구체적입니다. 호스트가 1층 창고에 비상 식수와 간식을 상비합니다.',
 5: '오쿠보 쪽에서 유일하게 살아남았습니다. 도어투도어 12분은 아홉 곳 중 가장 짧습니다.',
 1: '남은 다섯 곳 중 유일하게 빈칸이 있습니다. 문의에 AI 봇이 답했고 직원 회신 대기 중입니다.',
}
OUT = {                       # 탈락 사유 한 줄
 6: '호스트가 “새로운 내진 기준을 충족하지 않음”이라고 직접 답했습니다. 제목은 “(신축)”인데 연도는 “잘 모르겠다”고 했습니다.',
 3: '호스트가 “건물은 리모델링한 오래된 숙소이므로 새로운 내진 기준을 충족하지 않습니다”라고 답했습니다.',
 2: '카부키초 인접 — 좁은 골목과 유흥가 밀집으로 지진 대피 조건이 가장 나쁜 유형입니다.',
 8: '요약은 “욕실 2개”인데 실제 샤워는 1개입니다. 평점 4.0에 후기 3개입니다.',
}

def man(n):                   # 1,234,567 → 123만
    return '%d만' % round(n / 10000)

def lic(s):
    L = s.get('license') or {}
    num = L.get('number')
    if not num:            return '허가 미확인'
    if num.upper().startswith('M13'):  return 'M13 민박 신고'
    m = re.search(r'\((20\d{2})\)', json.dumps(META['licenseSummary'], ensure_ascii=False))
    return '여관업 허가'

def facts(s):
    c, a = s['comfort'], s['access']
    f = []
    by = s.get('builtYear')
    if by: f.append('%d년 준공' % by)
    f.append(lic(s))
    if c.get('showers'): f.append('샤워 %d개' % c['showers'])
    if c.get('bedrooms'): f.append('침실 %d' % c['bedrooms'])
    if a.get('d2dMin'):  f.append('신주쿠 %d분' % a['d2dMin'])
    return f

def card(i, rank):
    s = STAY[i]
    top = 'plan top' if rank == 1 else 'plan'
    kick = '%d순위' % rank if rank else '탈락'
    url = s.get('sourceUrl')
    name = '%d번 · %s' % (i, s['area'])
    h3 = ('<a href="%s" target="_blank" rel="noopener">%s ↗</a>' % (url, name)) if url else name
    sh = META['shelters'].get(str(i))
    li = ['<li>%s</li>' % x for x in facts(s)]
    li.append('<li>★%.2f · 후기 %d</li>' % (s['trust']['rating'], s['trust']['reviews']))
    if sh: li.append('<li>일시집합장소 %s</li>' % sh)
    body = LINE.get(i) or OUT.get(i, '')
    price = '3박 %s · 1인 %s' % (man(s['price']['total3n']), man(s['price']['perPerson']))
    return ('  <div class="%s">\n'
            '    <div class="pk">%s</div>\n'
            '    <h3>%s</h3>\n'
            '    <div class="who">%s</div>\n'
            '    <ul>%s</ul>\n'
            '    <div class="cost">%s</div>\n'
            '  </div>') % (top, kick, h3, body, ''.join(li), price)

ranked = sorted((s for s in LED['stays'] if s['rank']), key=lambda s: s['rank'])
dropped = [s for s in LED['stays'] if not s['rank']]

html = ['<p class="sdesc">아홉 곳을 <b>안전성 &gt; 접근성 &gt; 편의성</b> 순으로 추렸습니다. 예산은 제약이 아니라 '
        '<b>가격은 순위에 넣지 않았습니다</b>. 일곱 곳 호스트에게 직접 물어 준공 연도·허가번호·샤워 개수·일시집합장소를 확인한 결과입니다. '
        '<a href="https://claude.ai/code/artifact/833571ab-ceab-4eb0-8013-4971068a8881" target="_blank" rel="noopener">전체 비교 보기 ↗</a></p>',
        '<div class="notice"><b>확인이 필요합니다 — 1/15 밤을 어떻게 쓰나요?</b> 이 페이지의 일정은 <b>도쿄 2박 + 하코네 료칸 1박</b>인데, '
        '숙소 후보는 전부 <b>도쿄 3박(1/14~1/17)</b> 기준으로 값을 매겼습니다. 료칸 1박이 살아 있으면 에어비앤비 1/15 밤은 빈방이 되고 '
        '<b>4번 기준 약 83만원</b>을 그냥 냅니다. 하코네를 당일치기로 돌리든, 도쿄 숙소를 2박으로 줄이든 둘 중 하나를 정해야 합니다.</div>',
        '<div class="plans">']
html += [card(s['id'], s['rank']) for s in ranked]
html.append('</div>')
html.append('<p class="sdesc" style="margin-top:26px">탈락 네 곳 — <b>3·6번은 호스트가 신내진기준 미충족을 직접 인정</b>했습니다.</p>')
html.append('<div class="plans">')
html += [card(s['id'], None) for s in dropped]
html.append('</div>')

p = os.path.join(HERE, 'site.html')
src = io.open(p, encoding='utf-8').read()
a = src.index('<!-- STAYS:BEGIN -->') + len('<!-- STAYS:BEGIN -->')
b = src.index('<!-- STAYS:END -->')
io.open(p, 'w', encoding='utf-8').write(src[:a] + '\n' + '\n'.join(html) + '\n' + src[b:])
print('숙소 섹션 생성 · 후보 %d + 탈락 %d' % (len(ranked), len(dropped)))
