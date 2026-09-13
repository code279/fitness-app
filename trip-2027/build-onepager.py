#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""trip-2027/data/stays.json 을 읽어 A4 가로 한 장 요약(onepager/index.html)을 만든다.
수치는 전부 원장에서 가져오고, 카드 문장 두 줄만 아래 NOTES 에서 손으로 관리한다."""
import json, io, os, html, re

BASE = os.path.dirname(os.path.abspath(__file__))
d = json.load(io.open(os.path.join(BASE, 'data/stays.json'), encoding='utf-8'))
S = {s['id']: s for s in d['stays']}
trip = d['_meta']['trip']

# 카드마다 핵심 두 줄 (+ 는 강점, - 는 약점)
NOTES = {
 4: [('+', '★4.99 · 후기 207 · 슈퍼호스트 7년 · “조용함” 37회'),
     ('+', '짐 실내 보관 · 메인 주방 · 대피소 주소 확보 — 빈칸 없음')],
 9: [('+', '★4.99 · 후기 203 · 상위 1% · 짐 보관 · 무료 주차'),
     ('+', '대피소 도보 100m 학교 · 1층에 비상 식수·간식 상비'),
     ('-', '도어투도어 21분 · 엘리베이터 없음(호스트 확인)')],
 7: [('+', '하츠다이 셋 중 가장 가깝고 침대 6개가 전부 실제 침대'),
     ('-', '샤워 1개(1층·확정) · “신축”인데 호스트는 “리노베이션 완료”')],
 6: [('+', '침실 6개 = 여섯 명 전원 1인 1실. 아홉 곳 중 유일'),
     ('-', '저지대 목조밀집 · M13 민박 · 준공 연도 미확인')],
 5: [('+', '2006년 준공 + 2024.12 리노베이션 · 대피소 도보 1분'),
     ('+', '샤워 2 · 화장실 2 · 세면대 3 · 도어투도어 12분'),
     ('-', '저지대 · 토요일 밤 소음 · 2·3층은 바닥 매트리스')],
 1: [('+', '301호+401호 묶음이라 호실마다 샤워가 하나씩 있다'),
     ('-', 'AI 봇이 “찾을 수 없다” 답변 · 직원 회신 대기 중')],
 3: [('+', '샤워 2 + 화장실 2 · 신오쿠보 도보 3분 · 슈퍼호스트 9년'),
     ('-', '좁은 골목 · 외부 철제 계단 · 침실 수와 6인 가격 미확인')],
 8: [('-', '요약은 “욕실 2개”인데 실제 샤워는 1개'),
     ('-', '평점 4.0 · 후기 3개 · 정원 8명/10명 표기 불일치')],
 2: [('-', '카부키초 인접 — 지진 대피 조건으로 가장 나쁜 유형'),
     ('-', '야간 치안 아홉 곳 중 최하 · 평점 4.42')],
}
AREA = {4:'시부야구 하츠다이 · 98㎡', 9:'시부야구 혼마치 2초메', 7:'시부야구 하츠다이 1초메',
        6:'신주쿠구 오쿠보 · 저택 통째', 5:'신주쿠구 신오쿠보 북쪽', 1:'오쿠보 · 새틀라이트 호텔',
        3:'신주쿠구 햐쿠닌초', 8:'시부야구 혼마치 서쪽', 2:'신오쿠보 · 카부키초 인접'}
ORDER = [4, 9, 7, 5, 6, 1, 3, 8, 2]


def chips(s):
    """허가 · 샤워 · 침실 · 도어투도어 네 칸. (등급, 글자)"""
    lic = s.get('license') or {}
    num = lic.get('number')
    if num and num.upper().startswith('M13'):          # 民泊 신고번호는 M13으로 시작
        c1 = ('mid', 'M13 민박 신고')
    elif num:                                           # 그 밖의 번호는 여관업 허가
        m = re.search(r'\((20\d{2})년\)', lic.get('issuedEra') or '')
        c1 = ('ok', '여관업 허가 ' + m.group(1) if m else '여관업 허가')
    else:
        c1 = ('no', '허가 없음')

    sh = s['comfort'].get('showers')
    c2 = ('no', '샤워 %d개' % sh) if sh == 1 else (('ok', '샤워 %d개' % sh) if sh else ('dim', '샤워 ?'))

    bd = s['comfort'].get('bedrooms')
    c3 = ('ok', '침실 6 · 1인 1실') if bd == 6 and s['comfort'].get('wholeUnit') else \
         (('plain', '침실 %d' % bd) if bd else ('dim', '침실 ?'))

    by = s.get('builtYear')
    c0 = ('ok', '%d년 준공' % by) if by else None

    d2d = s['access'].get('d2dMin')
    if d2d is None:      c4 = ('dim', '동선 ?')
    elif d2d <= 13:      c4 = ('ok', '%d분' % d2d)
    elif d2d >= 20:      c4 = ('no', '%d분' % d2d)
    else:                c4 = ('plain', '%d분' % d2d)
    return ([c0] if c0 else []) + [c1, c2, c3, c4]


cards = []
for i, sid in enumerate(ORDER):
    s = S[sid]
    out = s['rank'] is None
    cls = 'c win' if s['rank'] == 1 else ('c out' if out else 'c')
    rank = '탈락' if out else '%d순위' % s['rank']
    ch = ''.join('<span class="ch %s">%s</span>' % (k, html.escape(t)) for k, t in chips(s))
    url = s.get('sourceUrl')                       # 2·8번(탈락)은 원문 링크가 없다
    img = f'<img class="ph" src="img/{sid}.jpg" alt="{sid}번 숙소 사진">'
    if url:
        img = f'<a class="phl" href="{html.escape(url)}" target="_blank" rel="noopener">{img}</a>'
        nm = (f'<a class="nm lk" href="{html.escape(url)}" target="_blank" rel="noopener">'
              f'{sid}번<span class="ext">↗</span></a>')
    else:
        nm = f'<span class="nm">{sid}번</span>'  
    li = ''.join('<li class="%s"><i>%s</i>%s</li>' % ('g' if k == '+' else 'b', '✓' if k == '+' else '!', html.escape(t))
                 for k, t in NOTES[sid])
    cards.append(f'''  <div class="{cls}">
    {img}
    <div class="pr">{s['price']['total3n']//10000}만</div>
    <div class="bd">
      <div class="tp"><span class="rk">{rank}</span>{nm}
        <span class="loc">{html.escape(AREA[sid])}</span></div>
      <div class="chips">{ch}</div>
      <ul>{li}</ul>
    </div>
  </div>''')

HTML = f'''<!doctype html>
<html lang="ko"><head><meta charset="utf-8">
<title>도쿄 숙소 아홉 곳 한 장 요약</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;700;900&display=swap">
<style>
:root{{--bg:#FFFFFF;--ink:#111418;--gray:#5A6472;--gray2:#828C99;--line:#DCE0E6;
  --pt:#1F6FEB;--pt-w:#E9F1FE;--ok:#0B7A52;--ok-w:#E2F4EC;--mid:#8A6A08;--mid-w:#FBF1D8;
  --warn:#B32B1C;--warn-w:#FCEBE8;}}
*{{box-sizing:border-box;margin:0;padding:0;}}
html,body{{background:#8A9099;font-family:"Noto Sans KR","Noto Sans CJK KR","Apple SD Gothic Neo",sans-serif;
  -webkit-font-smoothing:antialiased;font-variant-numeric:tabular-nums;}}
@page{{size:A4 landscape;margin:0;}}
.page{{width:1123px;height:794px;background:var(--bg);color:var(--ink);
  display:flex;flex-direction:column;overflow:hidden;}}
.fit{{transform-origin:top left;}}

.hd{{flex:0 0 auto;display:flex;align-items:flex-end;justify-content:space-between;gap:16px;
  padding:12px 18px 9px;border-bottom:3px solid var(--ink);}}
.hd h1{{font-size:28px;font-weight:900;letter-spacing:-.04em;line-height:1;}}
.hd h1 span{{color:var(--pt);}}
.hd .sub{{font-size:13px;font-weight:700;color:var(--gray);letter-spacing:-.02em;line-height:1.4;text-align:right;}}
.hd .sub b{{color:var(--ink);}}

.grid{{flex:1 1 auto;display:grid;grid-template-columns:repeat(3,1fr);grid-template-rows:repeat(3,1fr);}}
.c{{border-right:1px solid var(--line);border-bottom:1px solid var(--line);
  display:flex;flex-direction:column;overflow:hidden;position:relative;}}
.c:nth-child(3n){{border-right:0;}} .c:nth-child(n+7){{border-bottom:0;}}
.c.win{{background:var(--pt-w);}} .c.out{{background:var(--warn-w);}}

.ph{{flex:0 0 auto;height:84px;width:100%;object-fit:cover;display:block;border-bottom:1px solid var(--line);}}
.bd{{flex:1 1 auto;padding:7px 12px 6px;display:flex;flex-direction:column;gap:5px;}}
.tp{{display:flex;align-items:baseline;gap:6px;flex-wrap:wrap;}}
.rk{{flex:0 0 auto;font-size:12.5px;font-weight:900;letter-spacing:-.03em;
  padding:2px 7px;border-radius:5px;background:var(--ink);color:#fff;}}
.c.win .rk{{background:var(--pt);}} .c.out .rk{{background:var(--warn);}}
.nm{{font-size:19px;font-weight:900;letter-spacing:-.04em;color:inherit;text-decoration:none;}}
a.nm.lk{{color:var(--pt);}}
a.nm.lk:hover{{text-decoration:underline;}}
.ext{{font-size:12px;font-weight:700;margin-left:2px;vertical-align:2px;}}
.phl{{display:block;flex:0 0 auto;line-height:0;}}
.foot-lk{{color:var(--pt);text-decoration:none;font-weight:900;}}
.foot-lk:hover{{text-decoration:underline;}}
.loc{{font-size:12.5px;font-weight:700;color:var(--gray);letter-spacing:-.03em;}}

.chips{{display:flex;flex-wrap:wrap;gap:4px;}}
.ch{{font-size:11.5px;font-weight:900;letter-spacing:-.03em;padding:2px 6px;border-radius:4px;
  background:#EDF0F3;color:var(--gray);white-space:nowrap;}}
.ch.ok{{background:var(--ok-w);color:var(--ok);}}
.ch.mid{{background:var(--mid-w);color:var(--mid);}}
.ch.no{{background:var(--warn-w);color:var(--warn);}}
.ch.dim{{background:#EDF0F3;color:var(--gray2);}}

ul{{list-style:none;display:flex;flex-direction:column;gap:3px;}}
li{{font-size:13.5px;font-weight:700;letter-spacing:-.035em;line-height:1.25;
  display:flex;align-items:baseline;gap:5px;color:var(--gray);}}
li i{{flex:0 0 auto;width:13px;height:13px;border-radius:3px;font-style:normal;font-size:9px;
  font-weight:900;color:#fff;display:grid;place-items:center;transform:translateY(1px);}}
li.g i{{background:var(--ok);}} li.b i{{background:var(--warn);}}
li.g{{color:#0B7A52;}} li.b{{color:var(--warn);}}

.pr{{position:absolute;right:0;top:84px;background:var(--ink);color:#fff;font-size:12.5px;
  font-weight:900;letter-spacing:-.02em;padding:2px 7px;border-bottom-left-radius:7px;}}
.c.win .pr{{background:var(--pt);}}

.ft{{flex:0 0 auto;display:flex;align-items:center;gap:12px;padding:8px 18px;
  border-top:3px solid var(--ink);font-size:12.5px;font-weight:700;letter-spacing:-.035em;color:var(--gray);}}
.ft b{{color:var(--ink);}} .ft .k{{flex:0 0 auto;background:var(--ink);color:#fff;padding:2px 8px;
  border-radius:5px;font-size:12px;font-weight:900;}}
.ft .r{{margin-left:auto;flex:0 0 auto;}}
@media print{{html,body{{background:#fff;}} .fit{{transform:none !important;}}}}
</style></head><body>

<div class="page fit" id="pg">
<div class="hd">
  <h1>도쿄 숙소 아홉 곳 — <span>안전성 · 접근성 · 편의성</span></h1>
  <div class="sub">{trip['checkIn'].replace('-','.')}~{trip['checkOut'][-2:]} · {trip['nights']}박 · 남자 {trip['party']['count']}명 · 예산 제약 없음<br>
    기준점 <b>오다큐 신주쿠역</b>(1/15 하코네 로망스카 출발) · 가격은 순위에 반영 안 함</div>
</div>

<div class="grid">
{chr(10).join(cards)}
</div>

<div class="ft">
  <span class="k">결론</span>
  <span><b>4번은 물은 다섯 가지가 전부 답변돼 빈칸이 없습니다.</b> 준공 2019년 · 짐 실내 보관 · 메인 주방 · 대피소 주소까지 확보.</span>
  <span class="r"><b>남은 확인</b> ① 7번 원 건물 건축 연도 ② 1번 직원 회신 ③ 3·6번 허가·구성
    &nbsp;·&nbsp; <a class="foot-lk" href="https://claude.ai/code/artifact/833571ab-ceab-4eb0-8013-4971068a8881" target="_blank" rel="noopener">전체 비교 ↗</a></span>
</div>
</div>

<script>
(function(){{
  var pg=document.getElementById("pg");
  function fit(){{var s=Math.min(window.innerWidth/1123,1);
    pg.style.transform="scale("+s+")";document.body.style.height=(794*s)+"px";}}
  fit();window.addEventListener("resize",fit);
  window.addEventListener("beforeprint",function(){{pg.style.transform="none";document.body.style.height="";}});
  window.addEventListener("afterprint",fit);
}})();
</script>
</body></html>
'''
io.open(os.path.join(BASE, 'onepager/index.html'), 'w', encoding='utf-8').write(HTML)
print('생성 완료 · 카드', len(cards), '장 · 순서', ORDER)
