@echo off
REM 네이버웹툰 트래커 - 로컬 매일 수집 (작업 스케줄러에 이 파일을 매일 등록)
REM 1) 시리즈 검색연동 + 19금 다운수(쿠키) + 회차수 등   2) 성인 시리즈 다운수(브라우저 세션)
cd /d "%~dp0.."
set NODE_EXE=C:\Program Files\nodejs\node.exe
if not exist "%NODE_EXE%" set NODE_EXE=node
"%NODE_EXE%" scripts\collect_local.js --push >> scripts\local_last_run.log 2>&1
"%NODE_EXE%" scripts\collect_adult_pw.js --push >> scripts\local_last_run.log 2>&1
