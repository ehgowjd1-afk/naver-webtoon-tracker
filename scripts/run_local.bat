@echo off
REM 네이버웹툰 트래커 - 로컬 매일 수집 (작업 스케줄러에 이 파일을 매일 등록)
REM 1) 시리즈 검색연동 + 19금 다운수(쿠키) + 회차수 등   2) 성인 시리즈 다운수(브라우저 세션)
cd /d "%~dp0.."
set NODE_EXE=C:\Program Files\nodejs\node.exe
if not exist "%NODE_EXE%" set NODE_EXE=node
"%NODE_EXE%" scripts\collect_local.js --push >> scripts\local_last_run.log 2>&1
REM 성인 다운수: 켜둔 디버그 크롬(chrome_debug.bat로 로그인+연령확인)에 붙어 매일 '전체' 갱신.
REM 크롬이 꺼져있거나 세션 만료면 자동 스킵(에러 아님). 보호조치 뜨면 --max를 줄이세요.
"%NODE_EXE%" scripts\collect_adult_pw.js --cdp --push --max=1000 >> scripts\local_last_run.log 2>&1
