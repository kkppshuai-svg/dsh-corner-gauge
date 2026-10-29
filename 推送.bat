@echo off
chcp 65001 >nul
setlocal
rem Push this repo to origin/main using the git bundled with DSH.
rem Git Credential Manager may open a browser/sign-in window on first use.

set "GIT=%USERPROFILE%\.dsh\tools\git\bin\git.exe"
if not exist "%GIT%" set "GIT=git"

cd /d "%~dp0"

echo ============================================
echo   push %CD%  --^>  origin/main
echo ============================================
echo.

"%GIT%" -c safe.directory="*" push origin main
set "CODE=%ERRORLEVEL%"

echo.
if not "%CODE%"=="0" (
  echo [FAILED] exit code %CODE%
  echo If a sign-in window appeared, finish it and run this again.
) else (
  echo [OK] pushed. https://github.com/kkppshuai-svg/dsh-corner-gauge
)
echo.
pause
