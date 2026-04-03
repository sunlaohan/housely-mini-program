import os
import tempfile
from pathlib import Path
from typing import Any

import httpx
from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel


APP_SECRET = os.getenv("WORKER_BEARER_TOKEN", "")
MINERU_API_URL = os.getenv("MINERU_API_URL", "").rstrip("/")
MINERU_API_TOKEN = os.getenv("MINERU_API_TOKEN", "")

app = FastAPI(title="Housely MinerU Worker")


class ParseRequest(BaseModel):
    taskId: str
    userId: str
    provider: str = "MinerU"
    sourceName: str
    sourceType: str
    sourceFileId: str
    sourceCloudPath: str = ""
    fileUrl: str


def extract_markdown(payload: Any) -> str:
    if isinstance(payload, dict):
        for key in ("markdown", "md", "content", "text"):
            value = payload.get(key)
            if isinstance(value, str) and value.strip():
                return value

        for value in payload.values():
            nested = extract_markdown(value)
            if nested:
                return nested

    if isinstance(payload, list):
        for item in payload:
            nested = extract_markdown(item)
            if nested:
                return nested

    return ""


async def download_file(file_url: str, output_path: Path) -> None:
    async with httpx.AsyncClient(timeout=120.0, follow_redirects=True) as client:
      response = await client.get(file_url)
      response.raise_for_status()
      output_path.write_bytes(response.content)


async def call_mineru_api(file_path: Path) -> dict[str, Any]:
    if not MINERU_API_URL:
        raise HTTPException(status_code=500, detail="MINERU_API_URL 未配置，暂时无法调用真实 MinerU")

    headers = {}
    if MINERU_API_TOKEN:
        headers["Authorization"] = f"Bearer {MINERU_API_TOKEN}"

    async with httpx.AsyncClient(timeout=300.0, follow_redirects=True) as client:
        with file_path.open("rb") as file_obj:
            files = {
                "file": (file_path.name, file_obj, "application/octet-stream")
            }
            response = await client.post(f"{MINERU_API_URL}/file_parse", headers=headers, files=files)

        response.raise_for_status()
        return response.json()


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/parse")
async def parse_document(payload: ParseRequest, authorization: str | None = Header(default=None)) -> dict[str, Any]:
    if APP_SECRET and authorization != f"Bearer {APP_SECRET}":
        raise HTTPException(status_code=401, detail="未授权的请求")

    suffix = Path(payload.sourceName).suffix or ".bin"
    with tempfile.TemporaryDirectory(prefix="housely-mineru-") as temp_dir:
        temp_path = Path(temp_dir) / f"input{suffix}"
        await download_file(payload.fileUrl, temp_path)
        mineru_result = await call_mineru_api(temp_path)

    markdown = extract_markdown(mineru_result)
    if not markdown.strip():
        raise HTTPException(status_code=502, detail="MinerU 返回成功，但未提取到 Markdown 内容")

    return {
        "ok": True,
        "markdown": markdown,
        "rawJson": mineru_result,
        "summary": "已通过 MinerU 完成 OCR 识别"
    }
