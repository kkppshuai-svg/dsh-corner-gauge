@echo off
chcp 65001 >nul
setlocal
echo ============================================
echo   dsh-corner-gauge  部署到 DSH profile
echo ============================================
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\deploy.ps1" %*
set "CODE=%ERRORLEVEL%"
echo.
if not "%CODE%"=="0" (
  echo [失败] 退出码 %CODE%，请把上面的报错发我。
) else (
  echo [完成] 回到浏览器窗口按 Ctrl+R 刷新即可看到跑车彩蛋。
)
echo.
pause
