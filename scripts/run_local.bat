@echo off
REM 네이버웹툰 트래커 - 로컬 매일 수집 (작업 스케줄러에 이 파일을 매일 등록)
REM 1) 시리즈 검색연동 + 19금 다운수(쿠키) + 회차수 등   2) 성인 시리즈 다운수(브라우저 세션)
cd /d "%~dp0.."
set NODE_EXE=C:\Program Files\nodejs\node.exe
if not exist "%NODE_EXE%" set NODE_EXE=node
"%NODE_EXE%" scripts\collect_local.js --push >> scripts\local_last_run.log 2>&1
REM 성인 다운수는 별도 작업('웹툰 성인수집 재시도')이 하루 여러번 시도(연령확인되면 그때 수집·이미했으면 스킵).
REM 노션에 매출순 상위 300개 그날 데이터 추가(누적). 노션 설정(.notion.json) 없으면 자동 스킵.
"%NODE_EXE%" scripts\notion_sync.js --top=300 >> scripts\local_last_run.log 2>&1
