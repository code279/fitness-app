# 육룡이 투표 추리 — 배포용

클로드 로그인 없이 **링크만으로** 누구나 들어가는 버전입니다.

## 구조

```
netlify-game/
├─ index.html      게임 화면 전체 (수정 불필요)
├─ config.js       ← 여기 두 줄만 채우면 됩니다
├─ supabase.sql    Supabase에 붙여넣을 SQL
├─ netlify.toml    Netlify 설정
└─ _headers        보안 헤더
```

**데이터가 흐르는 방식**

```
여섯 명의 폰  ──►  Netlify (화면)  ──►  Supabase (데이터)
                      정적 파일          표 하나 + 잠금 규칙
```

Netlify는 화면만 보여주고, 예측·자백 데이터는 전부 Supabase에 쌓입니다.
둘 다 무료 요금제로 충분합니다.

## 순서

1. Supabase 프로젝트 만들기 → `supabase.sql` 붙여넣고 실행
2. Settings → API 에서 주소·키 복사 → `config.js`에 붙여넣기
3. 이 폴더를 통째로 Netlify에 드래그

## 게임 공정성

`supabase.sql`의 트리거가 **한 번 제출한 예측·자백을 데이터베이스 차원에서 잠급니다.**
화면에서만 막는 게 아니라 서버가 거부합니다.

## 보안 수준

친목용입니다. 링크를 아는 사람은 누구나 읽고 쓸 수 있습니다.
민감한 정보는 넣지 마세요.
