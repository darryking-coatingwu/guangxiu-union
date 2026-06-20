@echo off
chcp 65001 > nul
cd /d "%~dp0"
echo ========================================
echo    One-time fix - overwrite remote with local
echo ========================================
echo.
echo This makes your local files the official version
echo and pushes them to GitHub, replacing the old web upload.
echo.

if exist ".git\index.lock" del /F /Q ".git\index.lock"

git add -A
git commit -m "deploy" 2>nul
git push -u origin main --force

echo.
if %errorlevel%==0 (
  echo ========================================
  echo  SUCCESS - remote now matches your local files
  echo  Next: enable GitHub Pages once, then site is live:
  echo  https://darryking-coatingwu.github.io/guangxiu-union/
  echo ========================================
) else (
  echo ========================================
  echo  ERROR - screenshot the messages above and send to Claude
  echo ========================================
)
echo.
pause
