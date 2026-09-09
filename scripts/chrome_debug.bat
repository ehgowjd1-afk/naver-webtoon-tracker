@echo off
REM 성인 다운수 수집용 '진짜 크롬' 켜기 (계정 부담 최소화 방식)
REM 이 창으로 열린 크롬에서 네이버 로그인 + 19금 작품 '연령확인'을 사람이 직접 하세요.
REM (자동 로그인 아님 = 네이버 보호조치 위험 크게 낮음). 그 상태로 두고 collect_adult_pw.js --cdp 실행.
set CHROME=%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe
if not exist "%CHROME%" set CHROME=%PROGRAMFILES%\Google\Chrome\Application\chrome.exe
if not exist "%CHROME%" set CHROME=%PROGRAMFILES(x86)%\Google\Chrome\Application\chrome.exe
start "" "%CHROME%" --remote-debugging-port=9222 --user-data-dir="%~dp0.pw-realprofile" "https://series.naver.com/"
echo 크롬이 열렸어요. 네이버 로그인 + 19금 작품 연령확인을 직접 하신 뒤,
echo 그 크롬을 켜둔 채로 verify(수집)를 실행하세요.
