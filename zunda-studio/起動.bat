@echo off
chcp 65001 > nul
rem zunda-studio を起動する。ダブルクリックで使う。
rem   起動.bat       ... ビルドして起動する(ふだんはこれ)
rem   起動.bat dev   ... 開発モードで起動する(画面の変更がすぐ反映される)
setlocal
cd /d "%~dp0"
title zunda-studio

rem ---- Node.js があるか ----
where node > nul 2> nul
if errorlevel 1 goto no_node
for /f "tokens=1 delims=." %%v in ('node -v') do set "NODE_MAJOR=%%v"
set "NODE_MAJOR=%NODE_MAJOR:v=%"
if %NODE_MAJOR% LSS 22 goto old_node

rem ---- 部品(node_modules)の用意 ----
rem package-lock.json が変わったとき(初回・更新後)だけ入れ直す。
set "LOCK_HASH="
for /f "delims=" %%h in ('certutil -hashfile package-lock.json SHA256 ^| findstr /v ":"') do if not defined LOCK_HASH set "LOCK_HASH=%%h"
if not defined LOCK_HASH set "LOCK_HASH=unknown"
set "LOCK_HASH=%LOCK_HASH: =%"
set "SAVED_HASH="
if exist "node_modules\.zunda-lock-hash" set /p SAVED_HASH=<"node_modules\.zunda-lock-hash"
if not exist "node_modules" goto install
if not "%LOCK_HASH%"=="%SAVED_HASH%" goto install
goto check_electron

:install
echo.
echo 必要な部品を入れています。初回は数分かかります…
call npm ci
if errorlevel 1 goto install_failed
> "node_modules\.zunda-lock-hash" echo %LOCK_HASH%

:check_electron
rem ---- Electron 本体 ----
rem Electron は npm ci だけでは本体をダウンロードしないことがあるので、無ければ取ってくる。
if exist "node_modules\electron\path.txt" goto run
echo.
echo Electron 本体をダウンロードしています。初回は少し時間がかかります…
call node "node_modules\electron\install.js"
if errorlevel 1 goto electron_failed
if not exist "node_modules\electron\path.txt" goto electron_failed

:run
echo.
if /i "%~1"=="dev" goto dev
echo zunda-studio を起動します。この黒い画面を閉じるとアプリも終了します。
call npm run start
if errorlevel 1 goto run_failed
goto end

:dev
echo 開発モードで起動します。この黒い画面を閉じるとアプリも終了します。
call npm run dev
if errorlevel 1 goto run_failed
goto end

:no_node
echo.
echo Node.js が見つかりません。
echo https://nodejs.org/ から LTS 版 [22 以上] を入れてから、もう一度この起動.bat を開いてください。
goto failed

:old_node
echo.
echo Node.js のバージョンが古いです [今は %NODE_MAJOR%]。22 以上を https://nodejs.org/ から入れてください。
goto failed

:install_failed
echo.
echo 部品を入れられませんでした。ネットにつながっているか確かめて、もう一度開いてください。
goto failed

:electron_failed
echo.
echo Electron 本体をダウンロードできませんでした。ネットにつながっているか確かめて、もう一度開いてください。
goto failed

:run_failed
echo.
echo 起動できませんでした。上に出ているメッセージを確かめてください。
goto failed

:failed
echo.
pause
exit /b 1

:end
endlocal
