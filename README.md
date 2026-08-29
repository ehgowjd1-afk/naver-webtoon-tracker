# 네이버웹툰 · 시리즈 랭킹 트래커

네이버웹툰과 네이버 시리즈의 랭킹을 한곳에서 보는 사이트.

- **사이트**: https://ehgowjd1-afk.github.io/naver-webtoon-tracker/
- 정적 사이트 (`docs/`, GitHub Pages · `main:/docs`) — 바닐라 HTML/CSS/JS
- 순위를 누르면 썸네일·작가 등 **작품 상세**가 뜨고 네이버 원본으로 이동

## 수집하는 랭킹
| 소스 | 내용 | 수집 |
|---|---|---|
| **앱 주간** | 「이번 주 웹툰 랭킹」 전체 100 / 여성 50 / 남성 50 (순위변동·연속·신작·성별 온도차) | **수동** (앱 스샷) |
| **요일별** | 월~일 + 매일+ 인기순 | 자동 |
| **장르** | 무협/사극·판타지·액션·드라마·순정·감성·일상·개그·스릴러·스포츠 TOP25 | 자동 |
| **시리즈** | 네이버 시리즈 웹툰 일간·주간·월간 TOP100 (순위변동) | 자동 |

## 왜 앱 주간만 수동인가
「이번 주 웹툰 랭킹」은 **앱 전용**이라 자동 스크래핑이 안 됩니다 (게이트웨이 HMAC 인증 + SSL 인증서 고정).
나머지(요일별·장르·시리즈)는 공개 API/페이지라 **GitHub Actions가 매일 자동 수집**합니다 (`.github/workflows/collect.yml`, `scripts/collect.js`).

## 매주 「앱 주간」 업데이트
1. 앱 「이번 주 웹툰 랭킹」에서 전체(100)/여성(50)/남성(50) 스크롤 캡처
2. `docs/data/YYYY-MM-DD.json` 추가 (`2026-08-30.json` 형식 참고)
   - `{ "date","charts": { "전체":[…],"여성":[…],"남성":[…] } }`, 각 항목 `{ "r","t","a","m","s","b" }`
3. `docs/data/index.json` 의 `weeks`·`latest` 갱신 → 커밋·푸시
4. 프론트(css/js) 수정 시 `index.html` 의 `?v=N` 을 올릴 것 (Pages 캐시 회피)

## 자동 수집 수동 실행
`gh workflow run collect.yml` (또는 GitHub Actions 탭에서 Run workflow)

## 데이터 파일
- `docs/data/index.json` — 앱 주간 주차 목록
- `docs/data/YYYY-MM-DD.json` — 앱 주간 주차별 스냅샷
- `docs/data/weekday.json` · `genre.json` · `series.json` — 자동 수집분
- `docs/data/lookup.json` — 작품명 → titleId·썸네일 (앱 주간 상세 매칭용)
