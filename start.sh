#!/bin/bash

echo "============================================="
echo "  Gemini NBP Batch WebUI 一键启动 (macOS)"
echo "============================================="
echo ""

# 检查Python
if ! command -v python3 &> /dev/null; then
    echo "[错误] 未检测到 Python 3，请先安装"
    echo "下载地址: https://www.python.org/downloads/"
    exit 1
fi

# 获取脚本所在目录
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# 检查pip
echo "[1/4] 检查 pip..."
if ! python3 -m pip --version &> /dev/null; then
    echo "[错误] pip 不可用，请重新安装 Python"
    exit 1
fi

# 安装依赖
echo "[2/4] 安装依赖包..."
python3 -m pip install -r requirements.txt -q
if [ $? -ne 0 ]; then
    echo "[错误] 依赖安装失败，请检查网络"
    exit 1
fi
echo "[完成] 依赖安装成功"

# 启动服务
echo "[3/4] 启动服务..."
osascript -e 'tell app "Terminal" to do script "cd '\''"'"$SCRIPT_DIR"'\'' && python3 -m uvicorn server:app --host 127.0.0.1 --port 8000"' > /dev/null 2>&1

echo "[4/4] 打开浏览器..."
sleep 2
open http://127.0.0.1:8000

echo ""
echo "============================================="
echo "  服务已启动，请勿关闭 Terminal 窗口"
echo "  访问地址: http://127.0.0.1:8000"
echo "============================================="