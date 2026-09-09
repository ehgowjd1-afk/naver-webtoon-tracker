@echo off
REM 성인 시리즈 다운수 자동수집 - 최초 1회 로그인 (더블클릭해서 실행)
REM 크롬 창이 열리면 네이버 로그인 + 성인 웹툰 하나 열어 '성인 인증'까지 하고, 이 검은 창에서 Enter.
cd /d "%~dp0.."
set NODE_EXE=C:\Program Files\nodejs\node.exe
if not exist "%NODE_EXE%" set NODE_EXE=node
"%NODE_EXE%" scripts\collect_adult_pw.js --login
echo.
echo 끝났습니다. 이 창을 닫아도 됩니다.
pause
