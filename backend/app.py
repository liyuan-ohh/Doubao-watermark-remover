import re
import uuid
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import cv2
import httpx
import numpy as np
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel


MAX_IMAGE_BYTES = 15 * 1024 * 1024
MAX_PIXELS = 25_000_000
MAX_HTML_BYTES = 2 * 1024 * 1024
OUTPUT_DIR = Path(__file__).parent / "outputs"
OUTPUT_DIR.mkdir(exist_ok=True)

app = FastAPI(title="豆包去水印")
app.mount("/files", StaticFiles(directory=OUTPUT_DIR), name="files")

class ShareText(BaseModel):
    text: str


def _doubao_url(text: str) -> str:
    match = re.search(r"https?://[^\s<>\"']+", text)
    if not match:
        raise HTTPException(400, "请粘贴有效的豆包分享链接")
    url = match.group(0).rstrip(".,，。!?！？）)]}")
    _validate_doubao_url(url)
    return url


def _validate_doubao_url(url: str) -> None:
    parsed = urlparse(url)
    host = (parsed.hostname or "").lower()
    if (
        parsed.scheme != "https"
        or parsed.username
        or parsed.password
        or parsed.port not in (None, 443)
        or not (host == "doubao.com" or host.endswith(".doubao.com"))
        or not (
            parsed.path.startswith("/thread/")
            or parsed.path in ("/video-sharing", "/video-sharing/")
        )
    ):
        raise HTTPException(400, "仅支持豆包 thread 或 video-sharing 分享链接")


async def _no_watermark_url(client: httpx.AsyncClient, share_url: str) -> str:
    try:
        response = await client.get(
            "https://api.bugpk.com/api/dbvideos", params={"url": share_url}
        )
        response.raise_for_status()
    except httpx.TimeoutException as exc:
        raise HTTPException(504, "无水印解析服务请求超时，请重试") from exc
    except httpx.HTTPError as exc:
        raise HTTPException(502, "无水印解析服务暂时不可用") from exc
    try:
        if len(response.content) > MAX_HTML_BYTES:
            raise HTTPException(502, "无水印解析服务响应异常")
        payload = response.json()
        video_url = payload["data"]["url"]
        if not isinstance(video_url, str):
            raise HTTPException(502, "无水印解析服务返回异常")
        parsed = urlparse(video_url)
        if (
            payload.get("code") != 200
            or parsed.scheme != "https"
            or not parsed.hostname
            or parsed.username
            or parsed.password
            or parsed.port not in (None, 443)
            or parse_qs(parsed.query).get("lr") != ["unwatermarked"]
            or "video_gen_watermark" in video_url.lower()
        ):
            raise HTTPException(502, "当前链接未取得可信的无水印视频")
        return video_url
    except HTTPException:
        raise
    except (KeyError, TypeError, ValueError) as exc:
        raise HTTPException(502, "无水印解析服务返回异常") from exc


@app.post("/api/video/parse")
async def parse_video(body: ShareText) -> dict:
    url = _doubao_url(body.text.strip())
    timeout = httpx.Timeout(10, connect=5)
    async with httpx.AsyncClient(timeout=timeout, follow_redirects=False) as client:
        return {"url": await _no_watermark_url(client, url)}


def _supported_image(data: bytes) -> bool:
    return (
        data.startswith(b"\xff\xd8\xff")
        or data.startswith(b"\x89PNG\r\n\x1a\n")
        or (len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP")
    )


@app.post("/api/image/inpaint")
async def inpaint_image(
    image: UploadFile = File(...),
    x: int = Form(...),
    y: int = Form(...),
    width: int = Form(...),
    height: int = Form(...),
) -> dict:
    data = await image.read(MAX_IMAGE_BYTES + 1)
    if len(data) > MAX_IMAGE_BYTES:
        raise HTTPException(413, "图片不能超过 15MB")
    if not _supported_image(data):
        raise HTTPException(415, "仅支持 JPEG、PNG 或 WebP 图片")

    source = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
    if source is None:
        raise HTTPException(400, "图片已损坏或无法读取")
    image_height, image_width = source.shape[:2]
    if image_width * image_height > MAX_PIXELS:
        raise HTTPException(413, "图片不能超过 2500 万像素")
    if width < 8 or height < 8:
        raise HTTPException(400, "框选区域至少需要 8×8 像素")
    if x < 0 or y < 0 or x + width > image_width or y + height > image_height:
        raise HTTPException(400, "框选区域超出图片范围")

    mask = np.zeros((image_height, image_width), dtype=np.uint8)
    mask[y : y + height, x : x + width] = 255
    result = cv2.inpaint(source, mask, 3, cv2.INPAINT_TELEA)
    filename = f"{uuid.uuid4().hex}.png"
    output = OUTPUT_DIR / filename
    try:
        encoded, png = cv2.imencode(".png", result)
    except cv2.error as exc:
        raise HTTPException(500, "结果图片编码失败，请重试") from exc
    if not encoded:
        raise HTTPException(500, "结果图片编码失败，请重试")
    try:
        output.write_bytes(png.tobytes())
    except OSError as exc:
        raise HTTPException(500, "结果图片保存失败，请检查目录权限") from exc
    return {"url": f"/files/{filename}", "width": image_width, "height": image_height}
