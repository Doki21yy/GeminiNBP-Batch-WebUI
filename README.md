# Gemini NBP Batch WebUI

本地批量生图小工具，直接调用 Gemini NBP Ark multimodal API，不走 ComfyUI 队列。

## 启动

双击 `start.command`。脚本会自动创建本地 `.venv`、安装依赖、启动服务并打开浏览器。

也可以手动执行：

```bash
cd GeminiNBP-Batch-WebUI
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python -m uvicorn server:app --host 127.0.0.1 --port 7869
```

打开：

```text
http://127.0.0.1:7869
```

## 使用

- 点击页面右上角「设置 API Key」保存 Ark API Key。
- Prompt 支持每行一个任务。
- 如果只写一行 prompt，可以用「批量数量」复制成多任务。
- 「并发数」控制同时请求 API 的数量。
- 尺寸使用接口支持的 `1K`、`2K`、`4K`；旧的 `1024x1024` 会在后端自动映射为 `1K`。
- 生成结果会保存到 `outputs/`。
- `config.json` 会保存本地 API Key，不会提交到 Git。

## Vercel 部署

1. 导入这个 GitHub 仓库到 Vercel。
2. 在 Vercel 项目 `Settings -> Environment Variables` 添加：
   - `ARK_API_KEY` = 你的 Ark API Key
3. 直接触发部署，不需要额外 Build Command。

说明：
- 项目已包含 `vercel.json` 和 `api/index.py`，会自动走 Python Serverless Function。
- Vercel 环境下支持两种方式：
  - 在 Vercel 配置全局 `ARK_API_KEY`（全员共用）。
  - 每个同事在网页右上角“设置 API Key”，仅保存到各自浏览器 `localStorage`，请求时按用户自己的 key 提交。
