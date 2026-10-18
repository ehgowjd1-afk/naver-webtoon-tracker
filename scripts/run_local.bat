@echo off
REM 네이버웹툰 트래커 - 로컬 매일 수집 (작업 스케줄러에 이 파일을 매일 등록)
REM 1) 시리즈 검색연동 + 19금 다운수(쿠키) + 회차수 등   2) 성인 시리즈 다운수(브라우저 세션)
cd /d "%~dp0.."
set NODE_EXE=C:\Program Files\nodejs\node.exe
if not exist "%NODE_EXE%" set NODE_EXE=node
"%NODE_EXE%" scripts\collect_local.js --push >> scripts\local_last_run.log 2>&1
REM 앱 장르 주간랭킹 100위(USB 연결한 안드로이드 폰 화면 읽기). 폰 없거나 잠겨 있으면 자동 스킵, 이번 주 다 받았으면 스킵.
"%NODE_EXE%" scripts\collect_app_phone.js --push >> scripts\local_last_run.log 2>&1
REM 앱 요일별 인기순(전체·매일+·월~일, 폰 화면) — 사이트 '요일별 > 앱'. 오늘 이미 받았으면 스킵.
"%NODE_EXE%" scripts\collect_app_weekday.js --push >> scripts\local_last_run.log 2>&1
REM 성인 다운수는 별도 작업('웹툰 성인수집 재시도')이 하루 여러번 시도(연령확인되면 그때 수집·이미했으면 스킵).
REM 노션에 매출순 상위 300개 그날 데이터 추가(누적). 노션 설정(.notion.json) 없으면 자동 스킵.
REM ※ 2026-10-07 사용자 요청으로 노션 동기화 중지. 다시 켜려면 아래 줄 앞의 "REM " 지우기.
REM "%NODE_EXE%" scripts\notion_sync.js --top=300 >> scripts\local_last_run.log 2>&1
