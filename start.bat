@echo off
chcp 65001 >nul 2>&1
title Gemini NBP Batch WebUI

echo =============================================
echo   Gemini NBP Batch WebUI 一键启动
echo =============================================
echo.

REM 获取脚本所在目录
set "SCRIPT_DIR=%~dp0"
cd /d "%SCRIPT_DIR%"

REM 检查Python
echo [检查] 正在检测 Python...
python --version >nul 2>&1
if errorlevel 1 (
    echo.
    echo [错误] 未检测到 Python，请先安装 Python 3.9+
    echo 下载地址: https://www.python.org/downloads/
    echo.
    pause
    exit /b 1
)
echo [OK] Python 已找到

REM 检查pip
echo.
echo [检查] 正在检测 pip...
python -m pip --version >nul 2>&1
if errorlevel 1 (
    echo.
    echo [错误] pip 不可用，请重新安装 Python
    echo.
    pause
    exit /b 1
)
echo [OK] pip 已找到

REM 安装依赖
echo.
echo [安装] 正在安装依赖包...
python -m pip install -r requirements.txt --quiet
if errorlevel 1 (
    echo.
    echo [错误] 依赖安装失败，请检查网络
    echo.
    pause
    exit /b 1
)
echo [完成] 依赖安装成功

REM 启动服务
echo.
echo [启动] 正在启动服务...
start "Gemini NBP Server" cmd /c "python -m uvicorn server:app --host 127.0.0.1 --port 8000"

REM 等待服务就绪
echo.
echo [等待] 等待服务启动（最多30秒）...
powershell -NoProfile -Command ^
    "do { Start-Sleep -Milliseconds 500; Write-Host -NoNewline '.' } while (-not (Try { (Invoke-WebRequest -Uri 'http://127.0.0.1:8000/api/key' -UseBasicParsing -TimeoutSec 2).StatusCode -eq 200 } Catch { $false })); Write-Host ''; Write-Host '[完成] 服务已就绪，正在打开浏览器...'; Start-Process 'http://127.0.0.1:8000'"

echo.
echo =============================================
echo   服务已启动，请勿关闭此窗口
echo   访问地址: http://127.0.0.1:8000
echo   按任意键停止服务...
echo =============================================
pause >nul

REM 关闭uvicorn进程
taskkill /fi "WINDOWTITLE eq Gemini NBP Server*" /f >nul 2>&1
exit /b 0