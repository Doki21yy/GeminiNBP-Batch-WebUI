import asyncio
import base64
import io
import json
import os
import time
import uuid
import zipfile
from pathlib import Path
from typing import Any

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from PIL import Image
from pydantic import BaseModel, Field


ROOT = Path(__file__).resolve().parent
STATIC_DIR = ROOT / "static"
IS_VERCEL = bool(os.environ.get("VERCEL"))
OUTPUT_DIR = Path("/tmp/gemini_nbp_outputs") if IS_VERCEL else ROOT / "outputs"
CONFIG_PATH = ROOT / "config.json"
ENV_API_KEY = os.environ.get("ARK_API_KEY", "").strip()

ARK_MULTIMODAL_URL = "https://aidp.bytedance.net/api/modelhub/online/multimodal/crawl"
DEFAULT_MODEL = "gemini_nbp"
IMAGE_SIZE_ALIASES = {
    "1024x1024": "1K",
    "1024": "1K",
}

OUTPUT_DIR.mkdir(exist_ok=True)

app = FastAPI(title="Gemini NBP Batch WebUI")
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
app.mount("/outputs", StaticFiles(directory=OUTPUT_DIR), name="outputs")


@app.middleware("http")
async def no_store_cache(request, call_next):
    response = await call_next(request)
    if request.url.path == "/" or request.url.path.startswith("/static/"):
        response.headers["Cache-Control"] = "no-store"
    return response


class ApiKeyPayload(BaseModel):
    api_key: str = Field(min_length=1)


class GeneratePayload(BaseModel):
    prompts: list[str] = Field(min_length=1)
    model_name: str = DEFAULT_MODEL
    max_tokens: int = Field(default=4096, ge=256, le=65536)
    image_size: str = "default"
    aspect_ratio: str = "default"
    reference_images: list[str] = []
    reference_image_groups: list[list[str]] | None = None
    concurrency: int = Field(default=4, ge=1, le=20)


class DownloadItem(BaseModel):
    image_url: str
    filename: str | None = None


class DownloadPayload(BaseModel):
    image_urls: list[str] | None = None
    files: list[DownloadItem] | None = None


def _load_config() -> dict[str, Any]:
    if not CONFIG_PATH.exists():
        return {}
    try:
        return json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}


def _save_config(config: dict[str, Any]) -> None:
    CONFIG_PATH.write_text(json.dumps(config, ensure_ascii=False, indent=2), encoding="utf-8")


def _get_api_key() -> str:
    api_key = ENV_API_KEY or _load_config().get("api_key", "").strip()
    if not api_key:
        raise HTTPException(status_code=400, detail="API key is not set. For Vercel, set ARK_API_KEY in project environment variables.")
    return api_key


def _extract_images_from_response(data: dict[str, Any]) -> tuple[list[str], str, str]:
    images_b64: list[str] = []
    text_parts: list[str] = []
    choices = data.get("choices") or [{}]
    msg = choices[0].get("message", {})
    reasoning_text = msg.get("reasoning_content", "") or ""

    content = msg.get("content", "")
    if isinstance(content, list):
        for item in content:
            if item.get("type") == "image_url":
                url = item.get("image_url", {}).get("url", "")
                if url:
                    images_b64.append(url)
            elif item.get("type") == "text":
                text_parts.append(item.get("text", ""))
    elif isinstance(content, str):
        text_parts.append(content)

    for mc in msg.get("multimodal_contents", []):
        if mc.get("type") == "inline_data":
            inline_data = mc.get("inline_data", {})
            mime = inline_data.get("mime_type", "image/png")
            raw = inline_data.get("data", "")
            if raw:
                images_b64.append(f"data:{mime};base64,{raw}")
        elif mc.get("type") == "text" and not mc.get("thought"):
            text_parts.append(mc.get("text", ""))

    return images_b64, "\n".join(text_parts), reasoning_text


def _save_data_url(data_url: str, task_id: str, image_index: int) -> str:
    if data_url.startswith("data:"):
        header, encoded = data_url.split(",", 1)
        mime = header.split(";", 1)[0].replace("data:", "")
    else:
        encoded = data_url
        mime = "image/png"

    ext = {
        "image/jpeg": "jpg",
        "image/jpg": "jpg",
        "image/webp": "webp",
        "image/png": "png",
    }.get(mime, "png")
    file_name = f"{task_id}_{image_index}.{ext}"
    file_path = OUTPUT_DIR / file_name
    file_path.write_bytes(base64.b64decode(encoded))
    return f"/outputs/{file_name}"


def _normalize_reference_image(data_url: str) -> str:
    if not data_url:
        return data_url

    if data_url.startswith("data:"):
        _, encoded = data_url.split(",", 1)
    else:
        encoded = data_url

    raw = base64.b64decode(encoded)
    image = Image.open(io.BytesIO(raw))
    if image.mode not in ("RGB", "RGBA"):
        image = image.convert("RGB")

    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    png_b64 = base64.b64encode(buffer.getvalue()).decode("ascii")
    return f"data:image/png;base64,{png_b64}"


def _normalize_reference_groups(groups: list[list[str]]) -> list[list[str]]:
    normalized_groups: list[list[str]] = []
    for group in groups:
        normalized_groups.append([_normalize_reference_image(image) for image in group if image])
    return normalized_groups


def _normalize_image_size(image_size: str) -> str:
    return IMAGE_SIZE_ALIASES.get(image_size, image_size)


def _resolve_output_file(image_url: str) -> Path:
    if not image_url.startswith("/outputs/"):
        raise HTTPException(status_code=400, detail=f"Unsupported image url: {image_url}")

    candidate = (OUTPUT_DIR / image_url.replace("/outputs/", "", 1)).resolve()
    output_root = OUTPUT_DIR.resolve()
    if output_root not in candidate.parents:
        raise HTTPException(status_code=400, detail=f"Invalid output path: {image_url}")
    if not candidate.exists() or not candidate.is_file():
        raise HTTPException(status_code=404, detail=f"Image not found: {image_url}")
    return candidate


def _safe_download_name(name: str | None, fallback: str) -> str:
    raw = (name or fallback).strip()
    raw = raw.replace("\\", "_").replace("/", "_").replace(":", "_")
    safe = "".join(char for char in raw if char.isprintable() and char not in '<>"|?*')
    safe = safe.strip(" .")
    return safe or fallback


def _zip_name_for_item(index: int, file_path: Path, requested_name: str | None, used_names: set[str]) -> str:
    fallback = f"{index:03d}_{file_path.name}"
    safe_name = _safe_download_name(requested_name, fallback)
    source_ext = file_path.suffix or ".png"
    safe_path = Path(safe_name)
    if not safe_path.suffix:
        safe_name = f"{safe_name}{source_ext}"

    candidate = safe_name
    counter = 2
    while candidate in used_names:
        stem = Path(safe_name).stem
        suffix = Path(safe_name).suffix
        candidate = f"{stem}_{counter}{suffix}"
        counter += 1
    used_names.add(candidate)
    return candidate


def _download_items(payload: DownloadPayload) -> list[DownloadItem]:
    if payload.files:
        return payload.files
    if payload.image_urls:
        return [DownloadItem(image_url=url) for url in payload.image_urls]
    raise HTTPException(status_code=400, detail="No images to download.")


def _build_zip(items: list[DownloadItem]) -> io.BytesIO:
    buffer = io.BytesIO()
    seen: set[Path] = set()
    used_names: set[str] = set()
    with zipfile.ZipFile(buffer, mode="w", compression=zipfile.ZIP_DEFLATED) as archive:
        for index, item in enumerate(items, start=1):
            file_path = _resolve_output_file(item.image_url)
            if file_path in seen:
                continue
            seen.add(file_path)
            archive.write(file_path, arcname=_zip_name_for_item(index, file_path, item.filename, used_names))
    buffer.seek(0)
    return buffer


async def _call_ark(
    client: httpx.AsyncClient,
    payload: GeneratePayload,
    prompt: str,
    api_key: str,
    task_index: int,
    reference_images: list[str],
) -> dict[str, Any]:
    task_id = f"{int(time.time())}_{task_index}_{uuid.uuid4().hex[:8]}"
    user_content: list[dict[str, Any]] = [{"type": "text", "text": prompt}]
    normalized_reference_images = _normalize_reference_groups([reference_images])[0]
    for image in normalized_reference_images:
        user_content.append({"type": "image_url", "image_url": {"url": image}})

    body: dict[str, Any] = {
        "stream": False,
        "model": payload.model_name,
        "max_tokens": payload.max_tokens,
        "messages": [{"role": "user", "content": user_content}],
        "response_modalities": ["TEXT", "IMAGE"],
    }

    image_config: dict[str, str] = {}
    image_size = _normalize_image_size(payload.image_size)
    if image_size != "default":
        image_config["imageSize"] = image_size
    if payload.aspect_ratio != "default":
        image_config["aspectRatio"] = payload.aspect_ratio
    if image_config:
        body["generationConfig"] = {
            "responseModalities": ["IMAGE"],
            "imageConfig": image_config,
        }

    try:
        response = await client.post(
            f"{ARK_MULTIMODAL_URL}?ak={api_key}",
            headers={"Content-Type": "application/json"},
            json=body,
        )
        response.raise_for_status()
        data = response.json()
        images_b64, text_response, reasoning = _extract_images_from_response(data)
        image_urls = [_save_data_url(img, task_id, idx) for idx, img in enumerate(images_b64)]
        return {
            "id": task_id,
            "index": task_index,
            "status": "success",
            "prompt": prompt,
            "image_urls": image_urls,
            "text": text_response,
            "reasoning": reasoning,
            "debug": {
                "model": payload.model_name,
                "image_size": image_size,
                "aspect_ratio": payload.aspect_ratio,
                "images_returned": len(image_urls),
                "reference_images": len(normalized_reference_images),
            },
            "request_debug": {
                "generation_config": body.get("generationConfig", {}),
                "reference_images": len(normalized_reference_images),
                "content_items": len(user_content),
            },
        }
    except httpx.HTTPStatusError as exc:
        detail = exc.response.text
        return {
            "id": task_id,
            "index": task_index,
            "status": "error",
            "prompt": prompt,
            "error": f"HTTP {exc.response.status_code}: {detail}",
            "request_debug": {
                "generation_config": body.get("generationConfig", {}),
                "reference_images": len(normalized_reference_images),
                "content_items": len(user_content),
            },
        }
    except Exception as exc:
        return {
            "id": task_id,
            "index": task_index,
            "status": "error",
            "prompt": prompt,
            "error": str(exc),
            "request_debug": {
                "generation_config": body.get("generationConfig", {}),
                "reference_images": len(normalized_reference_images),
                "content_items": len(user_content),
            },
        }


@app.get("/")
async def index() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/api/key")
async def api_key_status() -> dict[str, bool]:
    return {
        "configured": bool(_get_api_key()),
        "source": "env" if ENV_API_KEY else "local_file",
        "vercel": IS_VERCEL,
    }


@app.post("/api/key")
async def set_api_key(payload: ApiKeyPayload) -> dict[str, bool]:
    if IS_VERCEL:
        raise HTTPException(status_code=400, detail="Vercel deployment uses ARK_API_KEY environment variable. Please set it in Vercel project settings.")
    config = _load_config()
    config["api_key"] = payload.api_key.strip()
    _save_config(config)
    return {"configured": True}


@app.post("/api/generate")
async def generate(payload: GeneratePayload) -> dict[str, Any]:
    prompts = [prompt.strip() for prompt in payload.prompts if prompt.strip()]
    if not prompts:
        raise HTTPException(status_code=400, detail="At least one prompt is required.")

    if payload.reference_image_groups is not None and len(payload.reference_image_groups) != len(prompts):
        raise HTTPException(status_code=400, detail="reference_image_groups must match prompt count.")

    api_key = _get_api_key()
    semaphore = asyncio.Semaphore(payload.concurrency)

    async with httpx.AsyncClient(timeout=httpx.Timeout(180.0)) as client:
        async def run_one(index: int, prompt: str) -> dict[str, Any]:
            reference_images = (
                payload.reference_image_groups[index]
                if payload.reference_image_groups is not None
                else payload.reference_images
            )
            async with semaphore:
                return await _call_ark(client, payload, prompt, api_key, index, reference_images)

        results = await asyncio.gather(*(run_one(index, prompt) for index, prompt in enumerate(prompts)))

    return {
        "total": len(results),
        "success": sum(1 for item in results if item["status"] == "success"),
        "failed": sum(1 for item in results if item["status"] == "error"),
        "results": sorted(results, key=lambda item: item["index"]),
    }


@app.post("/api/download")
async def download(payload: DownloadPayload) -> StreamingResponse:
    archive = _build_zip(_download_items(payload))
    file_name = f"gemini_nbp_results_{time.strftime('%Y%m%d_%H%M%S')}.zip"
    return StreamingResponse(
        archive,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{file_name}"'},
    )
