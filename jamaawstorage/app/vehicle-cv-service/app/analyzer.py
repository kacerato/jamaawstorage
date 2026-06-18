from __future__ import annotations

import time
from dataclasses import dataclass

import cv2
import numpy as np

from .schemas import AnalysisResponse


TOTAL_FUEL_BARS = 8


@dataclass(frozen=True)
class Roi:
    x1: float
    y1: float
    x2: float
    y2: float


# Calibrated from real Shineray TLux T30 2025 dashboard photos. These are
# normalized coordinates, so the same profile works at different resolutions.
FUEL_ROI = Roi(0.495, 0.510, 0.570, 0.540)
ODOMETER_ROI = Roi(0.556, 0.405, 0.590, 0.448)


SEVEN_SEGMENT_DIGITS = {
    (1, 1, 1, 0, 1, 1, 1): 0,
    (0, 0, 1, 0, 0, 1, 0): 1,
    (1, 0, 1, 1, 1, 0, 1): 2,
    (1, 0, 1, 1, 0, 1, 1): 3,
    (0, 1, 1, 1, 0, 1, 0): 4,
    (1, 1, 0, 1, 0, 1, 1): 5,
    (1, 1, 0, 1, 1, 1, 1): 6,
    (1, 0, 1, 0, 0, 1, 0): 7,
    (1, 1, 1, 1, 1, 1, 1): 8,
    (1, 1, 1, 1, 0, 1, 1): 9,
}


def decode_image(image_bytes: bytes) -> np.ndarray:
    encoded = np.frombuffer(image_bytes, dtype=np.uint8)
    image = cv2.imdecode(encoded, cv2.IMREAD_COLOR)
    if image is None or image.size == 0:
        raise ValueError("Nao foi possivel decodificar a imagem.")
    if image.shape[0] < 360 or image.shape[1] < 480:
        raise ValueError("A imagem e pequena demais para uma leitura confiavel do painel.")
    return image


def crop_normalized(image: np.ndarray, roi: Roi) -> np.ndarray:
    height, width = image.shape[:2]
    x1, x2 = int(width * roi.x1), int(width * roi.x2)
    y1, y2 = int(height * roi.y1), int(height * roi.y2)
    return image[max(0, y1):min(height, y2), max(0, x1):min(width, x2)]


def fuel_range(percent: int | None) -> str | None:
    if percent is None:
        return None
    if percent <= 12:
        return "reserva"
    if percent < 40:
        return "baixo"
    if percent < 65:
        return "meio"
    if percent < 90:
        return "alto"
    return "cheio"


def _aligned_components(binary: np.ndarray, image_height: int, image_width: int) -> list[tuple[int, int, int, int, int]]:
    count, _, stats, _ = cv2.connectedComponentsWithStats(binary)
    candidates: list[tuple[int, int, int, int, int]] = []
    for x, y, width, height, area in stats[1:count]:
        if not (0.007 * image_height <= height <= 0.025 * image_height):
            continue
        if not (0.003 * image_width <= width <= 0.012 * image_width):
            continue
        if area < 0.000025 * image_height * image_width:
            continue
        candidates.append((int(x), int(y), int(width), int(height), int(area)))
    return sorted(candidates, key=lambda component: component[0])


def read_fuel_bars(image: np.ndarray) -> tuple[int | None, float, list[str]]:
    height, width = image.shape[:2]
    crop = crop_normalized(image, FUEL_ROI)
    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)

    readings: list[int] = []
    component_sets: list[list[tuple[int, int, int, int, int]]] = []
    for threshold in (165, 175, 185):
        _, binary = cv2.threshold(gray, threshold, 255, cv2.THRESH_BINARY)
        components = _aligned_components(binary, height, width)
        component_sets.append(components)
        readings.append(len(components))

    diagnostics = [f"fuel-threshold-readings:{readings}"]
    valid_readings = [value for value in readings if 1 <= value <= TOTAL_FUEL_BARS]
    if not valid_readings:
        return None, 0.0, diagnostics + ["fuel-bars-not-found"]

    bars = max(set(valid_readings), key=valid_readings.count)
    agreement = valid_readings.count(bars) / len(valid_readings)
    representative = component_sets[readings.index(bars)]

    if len(representative) >= 2:
        centers = [x + component_width / 2 for x, _, component_width, _, _ in representative]
        gaps = np.diff(centers)
        spacing_score = max(0.0, 1.0 - float(np.std(gaps) / max(np.mean(gaps), 1.0)))
    else:
        spacing_score = 0.86

    confidence = min(0.99, 0.72 + agreement * 0.16 + spacing_score * 0.11)
    return bars, confidence, diagnostics


def _row_bands(binary: np.ndarray) -> list[tuple[int, int]]:
    rows = np.where((binary > 0).sum(axis=1) > 0)[0]
    if len(rows) == 0:
        return []

    raw: list[list[int]] = []
    start = previous = int(rows[0])
    for row in rows[1:]:
        row = int(row)
        if row > previous + 1:
            raw.append([start, previous])
            start = row
        previous = row
    raw.append([start, previous])

    merged: list[list[int]] = []
    for start, end in raw:
        if merged and start - merged[-1][1] <= 3:
            merged[-1][1] = end
        else:
            merged.append([start, end])
    return [(start, end) for start, end in merged]


def _column_runs(binary: np.ndarray) -> list[tuple[int, int]]:
    columns = np.where((binary > 0).sum(axis=0) > 0)[0]
    if len(columns) == 0:
        return []
    runs: list[tuple[int, int]] = []
    start = previous = int(columns[0])
    for column in columns[1:]:
        column = int(column)
        if column > previous + 1:
            runs.append((start, previous))
            start = column
        previous = column
    runs.append((start, previous))
    return runs


def _split_touching_digits(binary: np.ndarray, runs: list[tuple[int, int]]) -> list[tuple[int, int]]:
    """Split a narrow digit 1 touching the following seven-segment glyph.

    In the lower-resolution sample, antialiasing bridges the right edge of the
    digit 1 to the top segment of the following 0. The projection valley is
    still visible even though there is no completely empty column.
    """
    projection = (binary > 0).sum(axis=0)
    line_height = max(binary.shape[0], 1)
    result: list[tuple[int, int]] = []
    for start, end in runs:
        run_width = end - start + 1
        if run_width / line_height <= 1.10:
            result.append((start, end))
            continue

        search_start = start + max(2, int(run_width * 0.18))
        search_end = start + max(3, int(run_width * 0.45))
        if search_end <= search_start:
            result.append((start, end))
            continue
        valley = search_start + int(np.argmin(projection[search_start:search_end + 1]))
        if projection[valley] <= max(3, int(projection[start:end + 1].max() * 0.35)):
            result.extend(((start, valley), (valley + 1, end)))
        else:
            result.append((start, end))
    return result


def _segment_pattern(glyph: np.ndarray) -> tuple[int, int, int, int, int, int, int]:
    resized = cv2.resize(glyph, (36, 60), interpolation=cv2.INTER_NEAREST)
    occupied = resized > 0
    regions = (
        occupied[2:10, 8:28],
        occupied[8:27, 1:10],
        occupied[8:27, 26:35],
        occupied[25:35, 8:28],
        occupied[33:52, 1:10],
        occupied[33:52, 26:35],
        occupied[50:59, 8:28],
    )
    return tuple(int(region.mean() >= 0.10) for region in regions)  # type: ignore[return-value]


def _closest_digit(pattern: tuple[int, ...]) -> tuple[int | None, float]:
    best_digit: int | None = None
    best_distance = 8
    for expected, digit in SEVEN_SEGMENT_DIGITS.items():
        distance = sum(left != right for left, right in zip(pattern, expected))
        if distance < best_distance:
            best_digit = digit
            best_distance = distance
    confidence = max(0.0, 1.0 - best_distance / 3.0)
    return (best_digit if best_distance <= 2 else None), confidence


def read_odometer(image: np.ndarray) -> tuple[int | None, float, list[str]]:
    crop = crop_normalized(image, ODOMETER_ROI)
    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
    _, binary = cv2.threshold(gray, 170, 255, cv2.THRESH_BINARY)
    height = image.shape[0]

    bands = _row_bands(binary)
    odo_band = next((band for band in bands if band[1] - band[0] + 1 >= 0.010 * height), None)
    if odo_band is None:
        return None, 0.0, ["odometer-row-not-found"]

    digits_line = binary[odo_band[0]:odo_band[1] + 1]
    runs = _split_touching_digits(digits_line, _column_runs(digits_line))
    # The value is right-aligned. Remove small left-side artifacts and keep only
    # plausible seven-segment glyphs.
    plausible = [(start, end) for start, end in runs if end - start + 1 >= 2]
    if not plausible:
        return None, 0.0, [f"odometer-column-runs:{runs}"]

    digits: list[int] = []
    confidences: list[float] = []
    line_height = digits_line.shape[0]
    for start, end in plausible:
        glyph = digits_line[:, start:end + 1]
        aspect = glyph.shape[1] / max(line_height, 1)
        if aspect <= 0.42:
            digits.append(1)
            confidences.append(0.96)
            continue
        pattern = _segment_pattern(glyph)
        digit, confidence = _closest_digit(pattern)
        if digit is None:
            return None, 0.0, [f"odometer-unrecognized-pattern:{pattern}", f"odometer-column-runs:{runs}"]
        digits.append(digit)
        confidences.append(confidence)

    if not digits or len(digits) > 7:
        return None, 0.0, [f"odometer-invalid-digit-count:{len(digits)}"]

    value = int("".join(str(digit) for digit in digits))
    confidence = min(confidences) if confidences else 0.0
    return value, confidence, [f"odometer-digits:{digits}"]


def read_qr(image: np.ndarray) -> str | None:
    detector = cv2.QRCodeDetector()
    payload, points, _ = detector.detectAndDecode(image)
    if not payload or points is None:
        return None
    return payload.strip() or None


def analyze_image(image_bytes: bytes) -> AnalysisResponse:
    started = time.perf_counter()
    image = decode_image(image_bytes)
    decoded_at = time.perf_counter()

    bars, fuel_confidence, fuel_diagnostics = read_fuel_bars(image)
    fuel_at = time.perf_counter()
    odometer, odometer_confidence, odometer_diagnostics = read_odometer(image)
    odometer_at = time.perf_counter()
    qr_payload = read_qr(image)
    finished = time.perf_counter()

    fuel_percent = round((bars / TOTAL_FUEL_BARS) * 100) if bars is not None else None
    available_confidences = [
        confidence
        for value, confidence in ((bars, fuel_confidence), (odometer, odometer_confidence))
        if value is not None
    ]
    confidence = min(available_confidences) if available_confidences else 0.0
    needs_review = bars is None or odometer is None or confidence < 0.80

    readable = []
    if odometer is not None:
        readable.append(f"ODO {odometer} km")
    if bars is not None:
        readable.append(f"combustivel {bars}/{TOTAL_FUEL_BARS} ({fuel_percent}%)")
    summary = "Leitura local: " + (", ".join(readable) if readable else "painel nao reconhecido") + "."

    timings = {
        "decode": round((decoded_at - started) * 1000, 2),
        "fuel": round((fuel_at - decoded_at) * 1000, 2),
        "odometer": round((odometer_at - fuel_at) * 1000, 2),
        "qr": round((finished - odometer_at) * 1000, 2),
        "total": round((finished - started) * 1000, 2),
    }

    return AnalysisResponse(
        odometerKm=odometer,
        fuelLevelPercent=fuel_percent,
        fuelLevelRange=fuel_range(fuel_percent),
        fuelBarsFilled=bars,
        fuelBarsTotal=TOTAL_FUEL_BARS if bars is not None else None,
        ocrText=f"ODO {odometer}" if odometer is not None else None,
        confidence=round(confidence, 4),
        needsReview=needs_review,
        summary=summary,
        method="opencv-shineray-tlux-t30",
        qrPayload=qr_payload,
        timingsMs=timings,
        diagnostics=fuel_diagnostics + odometer_diagnostics,
    )
