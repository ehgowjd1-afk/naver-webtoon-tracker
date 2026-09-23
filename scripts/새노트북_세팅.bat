@echo off
chcp 65001 >nul
setlocal
echo ============================================
echo   네이버웹툰 트래커 - 새 노트북 세팅 (한 번만)
echo ============================================
echo.

REM winget 있는지 확인
where winget >nul 2>nul
if errorlevel 1 (
  echo [주의] winget(윈도우 패키지 관리자)이 없습니다.
  echo   Node.js(https://nodejs.org LTS) 와 Git(https://git-scm.com) 을 직접 설치한 뒤
  echo   이 파일을 다시 실행하세요.
  echo.
  pause
  exit /b
)

set NEEDREOPEN=0
where node >nul 2>nul || (echo [설치] Node.js 설치 중... & winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements & set NEEDREOPEN=1)
where git  >nul 2>nul || (echo [설치] Git 설치 중...     & winget install -e --id Git.Git            --accept-source-agreements --accept-package-agreements & set NEEDREOPEN=1)
where gh   >nul 2>nul || (echo [설치] GitHub CLI 설치 중... & winget install -e --id GitHub.cli       --accept-source-agreements --accept-package-agreements & set NEEDREOPEN=1)

if "%NEEDREOPEN%"=="1" (
  echo.
  echo *** 프로그램 설치가 끝났습니다. ***
  echo *** 이 창을 닫고, 이 파일(새노트북_세팅.bat)을 한 번 더 더블클릭하세요. ***
  echo     (새로 설치한 걸 인식하려면 창을 다시 열어야 합니다)
  echo.
  pause
  exit /b
)

set DEST=%USERPROFILE%\Desktop\naver-webtoon-tracker
echo.
if not exist "%DEST%" (
  echo [1/3] 저장소 내려받는 중...
  git clone https://github.com/ehgowjd1-afk/naver-webtoon-tracker.git "%DEST%"
) else (
  echo [1/3] 저장소 이미 있음 - 최신으로 업데이트
  git -C "%DEST%" pull
)

echo [2/3] 필요한 패키지 설치 중...
cd /d "%DEST%"
call npm install

echo.
echo [3/3] 깃허브 로그인 (수집 결과를 사이트에 올리기 위해 필요)
echo    잠시 뒤 안내가 나오면: GitHub.com  ->  HTTPS  ->  Login with a web browser  선택
echo    화면의 코드를 복사해 브라우저에서 로그인하세요.
echo.
pause
gh auth login

echo.
echo ============================================
echo   세팅 완료! 이제 매일 아래 2개만 순서대로 더블클릭:
echo.
echo   1) %DEST%\scripts\chrome_debug.bat
echo        - 열린 크롬에서 네이버 로그인 + 19금 작품 연령확인
echo   2) %DEST%\scripts\collect_adult_cdp.bat
echo        - 성인 수집 (자동으로 사이트 반영)
echo ============================================
echo.
echo (이 폴더: %DEST%\scripts )
pause
