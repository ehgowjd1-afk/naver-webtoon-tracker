@echo off
REM 성인 수집 재시도(스케줄러 전용, 창 안 뜸). 하루 여러번 실행되며, 연령확인 되면 그때 수집·이미했으면 스킵.
cd /d "%~dp0.."
set NODE_EXE=C:\Program Files\nodejs\node.exe
if not exist "%NODE_EXE%" set NODE_EXE=node
"%NODE_EXE%" scripts\collect_adult_pw.js --cdp --push --max=1000 >> scripts\local_last_run.log 2>&1
