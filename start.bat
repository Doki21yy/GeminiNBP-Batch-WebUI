@echo off
chcp 65001 >nul 2>&1
title Gemini NBP Batch WebUI

echo =============================================
echo   Gemini NBP Batch WebUI 一键启动
echo =============================================
echo.

REM 检查Python
python --version >nul 2>&1
if errorlevel 1 (
    echo [错误] 未检测到 Python，请先安装 Python 3.9+
    echo 下载地址: https://www.python.org/downloads/
    pause
    exit /b 1
)

REM 获取脚本所在目录
set "SCRIPT_DIR=%~dp0"
cd /d "%SCRIPT_DIR%"

REM 检查pip
echo [1/4] 检查 pip...
python -m pip --version >nul 2>&1
if errorlevel 1 (
    echo [错误] pip 不可用，请重新安装 Python
    pause
    exit /b 1
)

REM 安装依赖
echo [2/4] 安装依赖包...
python -m pip install -r requirements.txt --quiet
if errorlevel 1 (
    echo [错误] 依赖安装失败，请检查网络
    pause
    exit /b 1
)
echo [完成] 依赖安装成功

REM 启动服务
echo [3/4] 启动服务...
start "Gemini NBP Server" python -m uvicorn server:app --host 127.0.0.1 --port 8000

REM 等待服务启动
echo [4/4] 打开浏览器...
timeout /t 3 >nul
start http://127.0.0.1:8000

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