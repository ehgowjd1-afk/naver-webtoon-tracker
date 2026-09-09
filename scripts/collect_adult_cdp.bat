@echo off
REM 성인 다운수 수집 (진짜 크롬에 붙어서 천천히 조금씩) - chrome_debug.bat로 크롬 켜고 로그인+연령확인 먼저!
REM 한 번에 최대 30개만 천천히 수집합니다. 며칠에 나눠 여러 번 실행하면 전체가 채워져요.
cd /d "%~dp0.."
set NODE_EXE=C:\Program Files\nodejs\node.exe
if not exist "%NODE_EXE%" set NODE_EXE=node
"%NODE_EXE%" scripts\collect_adult_pw.js --cdp --push --max=30
echo.
echo 끝났습니다. 이 창을 닫아도 됩니다.
pause
