from __future__ import annotations

from pydantic import BaseModel, Field, HttpUrl


class AnalyzeUrlRequest(BaseModel):
    image_url: HttpUrl
    event_type: str = Field(default="pickup", pattern="^(pickup|return|fuel)$")


class AnalysisResponse(BaseModel):
    odometerKm: int | None
    fuelLevelPercent: int | None
    fuelLevelRange: str | None
    fuelBarsFilled: int | None
    fuelBarsTotal: int | None
    fuelLiters: float | None = None
    fuelAmount: float | None = None
    stationName: str | None = None
    ocrText: str | None
    confidence: float
    needsReview: bool
    summary: str
    method: str
    qrPayload: str | None = None
    timingsMs: dict[str, float]
    diagnostics: list[str]
