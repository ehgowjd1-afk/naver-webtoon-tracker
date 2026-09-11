@echo off
REM 성인 다운수 수집 (진짜 크롬에 붙어서) - chrome_debug 크롬 켜고 로그인+연령확인 먼저!
REM 성인 웹툰 전체를 오늘 아직 안 했으면 수집, 이미 했으면 자동 스킵.
cd /d "%~dp0.."
set NODE_EXE=C:\Program Files\nodejs\node.exe
if not exist "%NODE_EXE%" set NODE_EXE=node
"%NODE_EXE%" scripts\collect_adult_pw.js --cdp --push --max=1000
echo.
echo 끝났습니다. 이 창을 닫아도 됩니다.
pause
