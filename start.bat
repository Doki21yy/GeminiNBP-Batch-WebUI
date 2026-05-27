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
    echo [安装] 未检测到 Python，正在自动安装...
    echo.

    REM 优先使用 winget 安装
    where winget >nul 2>&1
    if not errorlevel 1 (
        echo 正在通过 winget 安装 Python，请稍候...
        winget install Python.Python.3.12 --silent --accept-source-agreements --accept-package-agreements
    ) else (
        echo 正在下载 Python 安装包...
        powershell -NoProfile -Command ^
            "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; ^
            $installer = Join-Path $env:TEMP 'python-installer.exe'; ^
            Invoke-WebRequest -Uri 'https://www.python.org/ftp/python/3.12.0/python-3.12.0-amd64.exe' -OutFile $installer; ^
            Start-Process -FilePath $installer -ArgumentList '/quiet InstallAllUsers=1 PrependPath=1' -Wait; ^
            Remove-Item $installer"
    )

    REM 刷新环境变量并重新检测
    for /f "tokens=2*" %%a in ('reg query "HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment" /v Path 2^>nul') do set "SystemPath=%%b"
    set "PATH=%SystemPath%;%PATH%"

    python --version >nul 2>&1
    if errorlevel 1 (
        echo.
        echo [错误] Python 安装失败，请手动安装后重试
        echo 下载地址: https://www.python.org/downloads/
        echo.
        pause
        exit /b 1
    )
    echo.
    echo [完成] Python 安装成功
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
powershell -NoProfile -Command "for($i=0; $i -lt 60; $i++){ try{ Invoke-WebRequest -Uri 'http://127.0.0.1:8000/api/key' -UseBasicParsing -TimeoutSec 1 | Out-Null; break } catch{}; Start-Sleep -Milliseconds 500; Write-Host -NoNewline '.' }; Write-Host ''"

echo.
echo [完成] 服务已就绪，正在打开浏览器...
explorer "http://127.0.0.1:8000"

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