@echo off
chcp 65001 >nul
echo ============================================
echo   일반 웹툰 수동 수집 (클라우드 실행)
echo ============================================
echo.
echo 일반 웹툰은 GitHub 클라우드에서 도는 거라, PC가 아니라
echo 클라우드에 "지금 수집해" 요청만 보냅니다.
echo.

REM gh 로그인 확인
gh auth status >nul 2>nul
if errorlevel 1 (
  echo [실패] 깃허브 로그인이 안 돼 있습니다.
  echo   먼저 '새노트북_세팅.bat' 을 실행했는지 확인하거나, cmd에서 'gh auth login' 을 해주세요.
  echo.
  pause
  exit /b
)

echo 클라우드 수집을 요청합니다...
gh workflow run collect.yml -R ehgowjd1-afk/naver-webtoon-tracker
if errorlevel 1 (
  echo.
  echo [실패] 요청이 안 됐어요. 인터넷/로그인 상태를 확인하세요.
  pause
  exit /b
)

echo.
echo 요청 완료! 약 35분 뒤 수집이 끝납니다.
echo (성공하면 저장소에 "auto: 랭킹 자동수집 (오늘날짜)" 커밋이 생깁니다)
echo.
echo 잠시 뒤 실행 상태를 보여드릴게요...
timeout /t 6 >nul
gh run list --workflow=collect.yml --limit 3 -R ehgowjd1-afk/naver-webtoon-tracker
echo.
echo (status가 completed/success 로 바뀌면 끝. in_progress면 도는 중)
pause
