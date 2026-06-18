from __future__ import annotations

import ipaddress
import os
import re
import socket
from urllib.parse import urlparse

import httpx
import cv2
from fastapi import Depends, FastAPI, File, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response

from .analyzer import analyze_image
from .schemas import AnalysisResponse, AnalyzeUrlRequest


MAX_IMAGE_BYTES = int(os.getenv("MAX_IMAGE_BYTES", str(12 * 1024 * 1024)))
ALLOWED_IMAGE_HOSTS = {
    host.strip().lower()
    for host in os.getenv("ALLOWED_IMAGE_HOSTS", "").split(",")
    if host.strip()
}
CORS_ORIGINS = [
    origin.strip()
    for origin in os.getenv("CORS_ORIGINS", "").split(",")
    if origin.strip()
]
SERVICE_TOKEN = os.getenv("VEHICLE_CV_SERVICE_TOKEN", "").strip()

app = FastAPI(title="Jamaaw Vehicle CV", version="1.0.0")
if CORS_ORIGINS:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=CORS_ORIGINS,
        allow_methods=["POST", "GET"],
        allow_headers=["Content-Type", "Authorization"],
    )


def require_service_token(authorization: str | None = Header(default=None)) -> None:
    if not SERVICE_TOKEN:
        return
    if authorization != f"Bearer {SERVICE_TOKEN}":
        raise HTTPException(status_code=401, detail="Token de servico invalido.")


def _validate_remote_url(value: str) -> str:
    parsed = urlparse(value)
    if parsed.scheme != "https" or not parsed.hostname:
        raise HTTPException(status_code=400, detail="A imagem remota deve usar HTTPS.")

    hostname = parsed.hostname.lower()
    if ALLOWED_IMAGE_HOSTS and hostname not in ALLOWED_IMAGE_HOSTS:
        raise HTTPException(status_code=400, detail="Host da imagem nao autorizado.")

    try:
        addresses = socket.getaddrinfo(hostname, parsed.port or 443, type=socket.SOCK_STREAM)
    except socket.gaierror as error:
        raise HTTPException(status_code=400, detail="Host da imagem nao encontrado.") from error
    for address in addresses:
        ip = ipaddress.ip_address(address[4][0])
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved:
            raise HTTPException(status_code=400, detail="Endereco da imagem nao autorizado.")
    return value


async def _download_image(url: str) -> bytes:
    safe_url = _validate_remote_url(url)
    try:
        async with httpx.AsyncClient(timeout=8.0, follow_redirects=False) as client:
            async with client.stream("GET", safe_url, headers={"Accept": "image/*"}) as response:
                response.raise_for_status()
                content_type = response.headers.get("content-type", "")
                if not content_type.startswith("image/"):
                    raise HTTPException(status_code=400, detail="A URL nao retornou uma imagem.")
                chunks = bytearray()
                async for chunk in response.aiter_bytes():
                    chunks.extend(chunk)
                    if len(chunks) > MAX_IMAGE_BYTES:
                        raise HTTPException(status_code=413, detail="Imagem maior que o limite permitido.")
                return bytes(chunks)
    except HTTPException:
        raise
    except httpx.HTTPError as error:
        raise HTTPException(status_code=502, detail="Nao foi possivel baixar a imagem.") from error


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "engine": "opencv"}


@app.get("/v1/markers/{vehicle_code}.png", dependencies=[Depends(require_service_token)])
def vehicle_marker(vehicle_code: str) -> Response:
    normalized = vehicle_code.strip().upper()
    if not re.fullmatch(r"[A-Z0-9_-]{3,40}", normalized):
        raise HTTPException(status_code=400, detail="Codigo do veiculo invalido.")
    payload = f"jamaaw:vehicle:{normalized}"
    marker = cv2.QRCodeEncoder_create().encode(payload)
    marker = cv2.copyMakeBorder(marker, 4, 4, 4, 4, cv2.BORDER_CONSTANT, value=255)
    marker = cv2.resize(marker, (740, 740), interpolation=cv2.INTER_NEAREST)
    ok, encoded = cv2.imencode(".png", marker)
    if not ok:
        raise HTTPException(status_code=500, detail="Nao foi possivel gerar o marcador.")
    return Response(
        content=encoded.tobytes(),
        media_type="image/png",
        headers={"Content-Disposition": f'inline; filename="{normalized}-marker.png"'},
    )


@app.post("/v1/analyze", response_model=AnalysisResponse, dependencies=[Depends(require_service_token)])
async def analyze_url(request: AnalyzeUrlRequest) -> AnalysisResponse:
    image_bytes = await _download_image(str(request.image_url))
    try:
        return analyze_image(image_bytes)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


@app.post("/v1/analyze/upload", response_model=AnalysisResponse, dependencies=[Depends(require_service_token)])
async def analyze_upload(file: UploadFile = File(...)) -> AnalysisResponse:
    if not (file.content_type or "").startswith("image/"):
        raise HTTPException(status_code=400, detail="Envie um arquivo de imagem.")
    image_bytes = await file.read(MAX_IMAGE_BYTES + 1)
    if len(image_bytes) > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail="Imagem maior que o limite permitido.")
    try:
        return analyze_image(image_bytes)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
