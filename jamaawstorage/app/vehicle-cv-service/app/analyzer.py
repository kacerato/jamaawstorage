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


# Coordinates below are relative to the LCD itself, never to the whole photo.
# This is important: a phone photo may be tilted, cropped or contain a lot of
# dashboard reflection, while the geometry inside the LCD remains stable.
# The ODO row is the upper numeric row. Keeping TRIP outside this crop prevents
# its decimal glyphs and separator line from being merged into the odometer.
ODO_ROI = Roi(0.52, 0.06, 0.97, 0.36)
FUEL_ROI = Roi(0.06, 0.52, 0.94, 0.92)


SEVEN_SEGMENT_DIGITS = {
    (1, 1, 1, 0, 1, 1, 1): 0, (0, 0, 1, 0, 0, 1, 0): 1,
    (1, 0, 1, 1, 1, 0, 1): 2, (1, 0, 1, 1, 0, 1, 1): 3,
    (0, 1, 1, 1, 0, 1, 0): 4, (1, 1, 0, 1, 0, 1, 1): 5,
    (1, 1, 0, 1, 1, 1, 1): 6, (1, 0, 1, 0, 0, 1, 0): 7,
    (1, 1, 1, 1, 1, 1, 1): 8, (1, 1, 1, 1, 0, 1, 1): 9,
}


def decode_image(image_bytes: bytes) -> np.ndarray:
    image = cv2.imdecode(np.frombuffer(image_bytes, dtype=np.uint8), cv2.IMREAD_COLOR)
    if image is None or image.size == 0:
        raise ValueError("Nao foi possivel decodificar a imagem.")
    if image.shape[0] < 360 or image.shape[1] < 480:
        raise ValueError("A imagem e pequena demais para uma leitura confiavel do painel.")
    return image


def crop_normalized(image: np.ndarray, roi: Roi) -> np.ndarray:
    height, width = image.shape[:2]
    return image[max(0, int(height * roi.y1)):min(height, int(height * roi.y2)),
                 max(0, int(width * roi.x1)):min(width, int(width * roi.x2))]


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


def _dashboard_circles(image: np.ndarray) -> tuple[float, float, float] | None:
    """Find the two large instrument dials and infer the LCD's safe envelope."""
    # Hough on the original 3K/4K photo can exceed the proxy timeout. Detect on
    # a bounded working copy and map the result back to original coordinates.
    height, width = image.shape[:2]
    scale = min(1.0, 900 / max(height, width))
    working = cv2.resize(image, (round(width * scale), round(height * scale))) if scale < 1 else image
    gray = cv2.cvtColor(working, cv2.COLOR_BGR2GRAY)
    gray = cv2.GaussianBlur(gray, (7, 7), 1.4)
    minimum = max(26, int(min(working.shape[:2]) * 0.09))
    maximum = int(min(working.shape[:2]) * 0.42)
    circles = cv2.HoughCircles(gray, cv2.HOUGH_GRADIENT, dp=1.2, minDist=minimum * 2,
                               param1=100, param2=38, minRadius=minimum, maxRadius=maximum)
    if circles is None:
        return None
    # Gauge rings are roughly 3-4 radii apart. Restricting candidates to this
    # physical relationship eliminates dashboard reflections and the large
    # outer trim arcs that Hough also sees as circles.
    found = [item for item in circles[0]
             if .12 * min(working.shape[:2]) <= item[2] <= .30 * min(working.shape[:2])
             and item[1] >= .35 * working.shape[0]]
    choices: list[tuple[float, float, float, float]] = []
    for index, left in enumerate(found):
        for right in found[index + 1:]:
            if left[0] > right[0]:
                left, right = right, left
            radius = (float(left[2]) + float(right[2])) / 2
            horizontal = float(right[0] - left[0])
            if horizontal < radius * 2.8 or horizontal > radius * 5.0 or abs(float(left[1] - right[1])) > radius * .35:
                continue
            if not .62 <= float(left[2] / right[2]) <= 1.62:
                continue
            # Prefer the expected gauge separation ratio, not the largest
            # possible ring pair.
            ratio_score = 1.0 - abs(horizontal / radius - 3.55) / 1.45 - abs(float(left[1] - right[1])) / radius
            choices.append((ratio_score + min(radius / 1000, .5), (float(left[0]) + float(right[0])) / 2,
                            (float(left[1]) + float(right[1])) / 2, radius))
    if not choices:
        return None
    _, center_x, center_y, radius = max(choices, key=lambda item: item[0])
    return center_x / scale, center_y / scale, radius / scale


def _screen_from_dials(image: np.ndarray) -> tuple[np.ndarray, list[str]] | tuple[None, list[str]]:
    dials = _dashboard_circles(image)
    if dials is None:
        return None, ["lcd-dials-not-found"]
    center_x, center_y, radius = dials
    # For this panel the LCD is centered between the two gauge rings and its
    # centre sits about .65 radius above theirs. This is a geometric relation,
    # so it is stable across the close, wide and inclined examples.
    x1, x2 = int(center_x - radius * .62), int(center_x + radius * .62)
    y1, y2 = int(center_y - radius * 1.36), int(center_y + radius * .08)
    height, width = image.shape[:2]
    x1, x2 = max(0, x1), min(width, x2)
    y1, y2 = max(0, y1), min(height, y2)
    screen = image[y1:y2, x1:x2]
    if screen.size == 0 or min(screen.shape[:2]) < 50:
        return None, ["lcd-envelope-invalid"]
    return screen, [f"lcd-envelope:{x1},{y1},{x2},{y2}"]


def _binary_variants(image: np.ndarray) -> list[np.ndarray]:
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    clahe = cv2.createCLAHE(clipLimit=2.5, tileGridSize=(8, 8)).apply(gray)
    variants: list[np.ndarray] = []
    for source in (gray, clahe):
        for threshold in (140, 165, 185, 205):
            _, binary = cv2.threshold(source, threshold, 255, cv2.THRESH_BINARY)
            variants.append(binary)
        variants.append(cv2.adaptiveThreshold(source, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
                                              cv2.THRESH_BINARY, 21, -5))
    return variants


def _row_bands(binary: np.ndarray) -> list[tuple[int, int]]:
    rows = np.where((binary > 0).sum(axis=1) > 0)[0]
    if not len(rows):
        return []
    bands, start, previous = [], int(rows[0]), int(rows[0])
    for row in rows[1:]:
        row = int(row)
        if row > previous + 2:
            bands.append((start, previous))
            start = row
        previous = row
    bands.append((start, previous))
    return bands


def _column_runs(binary: np.ndarray) -> list[tuple[int, int]]:
    columns = np.where((binary > 0).sum(axis=0) > 0)[0]
    if not len(columns):
        return []
    runs, start, previous = [], int(columns[0]), int(columns[0])
    for column in columns[1:]:
        column = int(column)
        if column > previous + 1:
            runs.append((start, previous))
            start = column
        previous = column
    runs.append((start, previous))
    return runs


def _split_touching_digits(binary: np.ndarray, runs: list[tuple[int, int]]) -> list[tuple[int, int]]:
    projection, result = (binary > 0).sum(axis=0), []
    for start, end in runs:
        width, height = end - start + 1, max(binary.shape[0], 1)
        if width / height <= 1.08:
            result.append((start, end))
            continue
        a, b = start + int(width * .18), start + int(width * .52)
        valley = a + int(np.argmin(projection[a:b + 1]))
        if projection[valley] <= max(2, int(projection[start:end + 1].max() * .32)):
            result.extend(((start, valley), (valley + 1, end)))
        else:
            result.append((start, end))
    return result


def _deskew_glyph(glyph: np.ndarray) -> np.ndarray:
    """Straighten a glyph tilted by the camera angle.

    A photo taken a few degrees off square slants the whole character. The
    vertical strokes then lean into the neighbouring sampling window, and a
    5 reads as a 9 with an exact segment match, so nothing downstream can
    tell it is wrong. Shearing by the glyph's own second moment puts the
    strokes back inside their own windows.
    """
    points = cv2.findNonZero(glyph)
    if points is None or len(points) < 12:
        return glyph
    moments = cv2.moments(glyph, binaryImage=True)
    if abs(moments["mu02"]) < 1e-2:
        return glyph
    skew = moments["mu11"] / moments["mu02"]
    if abs(skew) < .08:
        return glyph
    skew = max(-.6, min(.6, skew))
    height, width = glyph.shape[:2]
    matrix = np.float32([[1, -skew, skew * height * .5], [0, 1, 0]])
    return cv2.warpAffine(glyph, matrix, (width, height), flags=cv2.INTER_NEAREST,
                          borderMode=cv2.BORDER_CONSTANT, borderValue=0)


def _segment_pattern(glyph: np.ndarray) -> tuple[int, int, int, int, int, int, int]:
    occupied = cv2.resize(_deskew_glyph(glyph), (36, 60), interpolation=cv2.INTER_NEAREST) > 0
    # Keep the sampling windows away from the segment junctions. The former
    # windows overlapped the top/middle bars, turning a reflected 5 into a 9.
    regions = (occupied[2:8, 9:27], occupied[12:24, 1:8], occupied[12:24, 28:35],
               occupied[27:33, 9:27], occupied[37:49, 1:8], occupied[37:49, 28:35],
               occupied[53:59, 9:27])
    return tuple(int(region.mean() >= .14) for region in regions)  # type: ignore[return-value]


def _closest_digit(pattern: tuple[int, ...]) -> tuple[int | None, float]:
    digit, distance = min(((value, sum(a != b for a, b in zip(pattern, expected)))
                           for expected, value in SEVEN_SEGMENT_DIGITS.items()), key=lambda item: item[1])
    return (digit if distance <= 2 else None), max(0.0, 1.0 - distance / 3.0)


def _read_odometer_variant(binary: np.ndarray) -> tuple[int | None, float]:
    bands = [(a, b) for a, b in _row_bands(binary) if 4 <= b - a + 1 <= binary.shape[0] * .52]
    if not bands:
        return None, 0.0
    # ODO is above TRIP; choose the first usable text row.
    for start, end in bands:
        line = binary[start:end + 1]
        runs = [(a, b) for a, b in _split_touching_digits(line, _column_runs(line)) if b - a + 1 >= 2]
        if not 2 <= len(runs) <= 6:
            continue
        digits, confidences = [], []
        for left, right in runs:
            glyph = line[:, left:right + 1]
            if glyph.shape[1] / max(glyph.shape[0], 1) <= .42:
                digits.append(1); confidences.append(.92); continue
            value, confidence = _closest_digit(_segment_pattern(glyph))
            if value is None:
                break
            digits.append(value); confidences.append(confidence)
        if len(digits) == len(runs):
            return int("".join(map(str, digits))), min(confidences)
    return None, 0.0


def read_odometer(screen: np.ndarray) -> tuple[int | None, float, list[str]]:
    """Read the upper three-digit group, keeping ODO separate from TRIP.

    Seven-segment characters are often split into individual lit bars. We
    first join nearby bars only to locate the group, then decode the untouched
    binary pixels in three independently segmented glyph windows.
    """
    gray = cv2.cvtColor(screen, cv2.COLOR_BGR2GRAY)
    candidates: list[tuple[int, float]] = []
    for threshold in (165, 185, 205, 220, 235):
        _, binary = cv2.threshold(gray, threshold, 255, cv2.THRESH_BINARY)
        joined = cv2.dilate(binary, np.ones((3, 7), dtype=np.uint8))
        count, _, stats, _ = cv2.connectedComponentsWithStats(joined)
        groups: list[tuple[int, int, int, int]] = []
        height, width = screen.shape[:2]
        for x, y, group_width, group_height, _ in stats[1:count]:
            aspect = group_width / max(group_height, 1)
            if not (x > .42 * width and .10 * height < y < .55 * height):
                continue
            if not (.03 * height <= group_height <= .16 * height and 1.2 <= aspect <= 4.2):
                continue
            groups.append((int(x), int(y), int(group_width), int(group_height)))
        if not groups:
            continue
        x, y, group_width, group_height = min(groups, key=lambda group: group[1])
        glyphs = binary[y + 1:y + group_height - 1, x + 3:x + group_width - 3]
        if glyphs.shape[0] < 8 or glyphs.shape[1] < 12:
            continue
        projection = (glyphs > 0).sum(axis=0)
        cuts: list[int] = []
        for part in (1, 2):
            expected = round(part * glyphs.shape[1] / 3)
            spread = round(glyphs.shape[1] * .08)
            left, right = max(2, expected - spread), min(glyphs.shape[1] - 2, expected + spread)
            cuts.append(left + int(np.argmin(projection[left:right + 1])))
        bounds = [0, *sorted(cuts), glyphs.shape[1]]
        digits: list[int] = []
        confidences: list[float] = []
        for index in range(3):
            digit, confidence = _closest_digit(_segment_pattern(glyphs[:, bounds[index]:bounds[index + 1]]))
            if digit is None:
                break
            digits.append(digit)
            confidences.append(confidence)
        if len(digits) == 3:
            candidates.append((int("".join(map(str, digits))), min(confidences)))

    if candidates:
        values = {value for value, _ in candidates}
        value = max(values, key=lambda item: sum(candidate == item for candidate, _ in candidates))
        selected = [confidence for candidate, confidence in candidates if candidate == value]
        agreement = len(selected) / len(candidates)
        glyph_quality = float(np.mean(selected))
        confidence = min(.99, .76 + agreement * .20 + glyph_quality * .03)
        # Agreement alone was publishing an odometer the segments never
        # supported: a blown-out photo gave two candidates that agreed on 485
        # while every digit sat one segment away from a clean match, and the
        # reading went out at 0.98. What separates that from a real reading is
        # glyph quality, not how many thresholds survived: the digits must
        # actually look like the digits claimed.
        if agreement >= .75 and glyph_quality >= .80:
            return value, confidence, [f"odometer-groups:{candidates}"]

    # Keep the generic reader as a conservative fallback for other dashboard
    # layouts; it never publishes a low-consensus result.
    crop = crop_normalized(screen, ODO_ROI)
    attempts = [_read_odometer_variant(binary) for binary in _binary_variants(crop)]
    valid = [(value, confidence) for value, confidence in attempts if value is not None]
    if not valid:
        return None, 0.0, ["odometer-not-found"]
    values = {value for value, _ in valid}
    # Agreement between contrast variants is a real confidence signal, unlike
    # the old fixed-threshold result which could look certain when it was wrong.
    value = max(values, key=lambda candidate: sum(item == candidate for item, _ in valid))
    selected = [confidence for item, confidence in valid if item == value]
    agreement = len(selected) / len(attempts)
    confidence = min(.99, float(np.mean(selected)) * .82 + agreement * .18)
    # Never publish a one-off interpretation as an odometer. The caller then
    # invokes the image model, which sees the full-resolution evidence.
    if agreement < .45 or confidence < .80:
        return None, confidence, [f"odometer-rejected:agreement={agreement:.2f}", f"odometer-candidates:{[(v, round(c, 2)) for v, c in valid]}"]
    return value, confidence, [f"odometer-candidates:{[(v, round(c, 2)) for v, c in valid]}"]


def _fuel_components(binary: np.ndarray) -> list[tuple[int, int, int, int]]:
    count, _, stats, _ = cv2.connectedComponentsWithStats(binary)
    height, width = binary.shape[:2]
    bars = []
    for x, y, component_width, component_height, area in stats[1:count]:
        if not (.18 * height <= component_height <= .72 * height):
            continue
        if not (.025 * width <= component_width <= .20 * width):
            continue
        if area < component_width * component_height * .28:
            continue
        bars.append((int(x), int(y), int(component_width), int(component_height)))
    return sorted(bars)


def _strip_rows(gray: np.ndarray, threshold: int) -> np.ndarray | None:
    """Locate the fuel row by its own shape, not by a fixed window.

    A tilted or high-angle photo moves the LCD inside its envelope: a band
    pinned to .75-.85 of the crop then samples the fuel-pump icon and reads
    two bars with full threshold agreement. The fuel row is instead the one
    row in the lower half holding several separated blocks of similar width,
    which is true wherever the warp puts it.
    """
    height = gray.shape[0]
    _, binary = cv2.threshold(gray, threshold, 255, cv2.THRESH_BINARY)
    window = max(3, int(height * .07))
    best: tuple[int, np.ndarray] | None = None
    for top in range(int(height * .62), int(height * .95) - window, max(1, window // 3)):
        strip = binary[top:top + window, :]
        dense = (strip > 0).sum(axis=0) >= strip.shape[0] * .5
        blocks, start = [], None
        for index, value in enumerate(dense):
            if value and start is None:
                start = index
            elif not value and start is not None:
                blocks.append((start, index - 1))
                start = None
        if start is not None:
            blocks.append((start, len(dense) - 1))
        wide = [(a, b) for a, b in blocks if b - a + 1 >= max(2, int(gray.shape[1] * .015))]
        if len(wide) < 3:
            continue
        # Prefer the row with the most same-width blocks: the bar track.
        widths = [b - a + 1 for a, b in wide]
        median = float(np.median(widths))
        regular = sum(1 for value in widths if abs(value - median) <= median * .45)
        if best is None or regular > best[0]:
            best = (regular, strip)
    return best[1] if best is not None else None


def _fuel_track(gray: np.ndarray, threshold: int) -> int | None:
    """Read the gauge from the track's geometry, not by counting blobs.

    The strip reads `E [bar][bar]...[empty][empty] F`. Counting connected
    components breaks as soon as two neighbouring bars touch: a bright photo
    fuses six bars into one blob and the gauge reports 1/8 with high
    confidence. Here the lit span is measured against one bar's pitch, which
    survives fusion, and the E/F labels are dropped by their isolation rather
    than by a brightness rule that daylight defeats.
    """
    strip = _strip_rows(gray, threshold)
    if strip is None:
        return None

    dense = (strip > 0).sum(axis=0) >= strip.shape[0] * .5
    width = gray.shape[1]
    runs: list[tuple[int, int]] = []
    start: int | None = None
    for index, value in enumerate(dense):
        if value and start is None:
            start = index
        elif not value and start is not None:
            runs.append((start, index - 1))
            start = None
    if start is not None:
        runs.append((start, len(dense) - 1))
    # A seam of one or two dim columns splits a single bar in the photo; the
    # bars themselves never sit that close together.
    merged: list[list[int]] = []
    for left, right in runs:
        if merged and left - merged[-1][1] <= max(2, int(width * .012)):
            merged[-1][1] = right
        else:
            merged.append([left, right])
    # A bar occupies about an eighth of the track, so a block far wider than
    # that is washed-out screen, not a bar. The margins are excluded for the
    # same reason: an overexposed photo lights up both crop edges, and those
    # two blobs are regular with each other, so they read as two bars at full
    # confidence while the real track sits between them.
    margin = width * .04
    blocks = [(a, b) for a, b in merged
              if max(2, int(width * .015)) <= b - a + 1 <= width * .22
              and a >= margin and b <= width - margin]
    if len(blocks) < 2:
        return None

    # The bars are the one evenly pitched run of same-sized blocks on the row.
    # E, F, the fuel pump icon and any screen-edge reflection are narrower,
    # wider or off-pitch, so picking the longest regular sequence drops them
    # without a brightness rule that daylight defeats. Trimming the ends by a
    # gap ratio could not tell a lit E from a seventh bar.
    best: list[tuple[int, int]] = []
    for start in range(len(blocks)):
        for end in range(start + 1, len(blocks) + 1):
            run = blocks[start:end]
            if len(run) < 2:
                continue
            widths = [b - a + 1 for a, b in run]
            pitches = [run[i + 1][0] - run[i][0] for i in range(len(run) - 1)]
            median_width = float(np.median(widths))
            median_pitch = float(np.median(pitches))
            if median_width <= 0 or median_pitch <= 0:
                continue
            # Same width and same spacing, within the tolerance a phone photo
            # of a backlit LCD actually produces.
            if max(abs(w - median_width) for w in widths) > median_width * .45:
                continue
            if max(abs(p - median_pitch) for p in pitches) > median_pitch * .35:
                continue
            if not 1.05 <= median_pitch / median_width <= 2.2:
                continue
            if len(run) > len(best):
                best = run
    if len(best) < 2:
        return None

    widths = [b - a + 1 for a, b in best]
    unit = float(np.median(widths))
    pitches = [best[i + 1][0] - best[i][0] for i in range(len(best) - 1)]
    pitch = float(np.median(pitches))
    if pitch <= 0 or unit <= 0:
        return None

    # A uniform blowout fuses every pair of bars at once, and the local pitch
    # then doubles with them: the run still looks perfectly regular while it
    # reports half the bars. The track's own width is the invariant that does
    # not double, so reject a pitch that cannot divide E..F into eight slots.
    span = blocks[-1][1] - blocks[0][0] + 1
    if span > 0:
        slot = span / TOTAL_FUEL_BARS
        if not .55 <= pitch / slot <= 1.75:
            return None

    # A block may still hold several fused bars: size each against the pitch.
    bars = sum(max(1, int(round((b - a + 1 + (pitch - unit)) / pitch))) for a, b in best)
    return bars if 1 <= bars <= TOTAL_FUEL_BARS else None


def read_fuel_bars(screen: np.ndarray) -> tuple[int | None, float, list[str]]:
    """Read the gauge across a threshold sweep and publish only on consensus.

    A threshold that fuses or drops bars produces an outlier, so the decision
    rests on how many thresholds agree on one value, not on the raw spread:
    [2, 6, 6, 6] is three independent readings of six plus one bad exposure,
    while [1, 1, 2, 3] is noise and stays unpublished.
    """
    gray = cv2.cvtColor(screen, cv2.COLOR_BGR2GRAY)
    readings: list[int] = []
    for threshold in (150, 170, 190, 210, 230):
        value = _fuel_track(gray, threshold)
        if value is not None:
            readings.append(value)
    if not readings:
        return None, 0.0, ["fuel-bars-not-found"]

    bars = max(set(readings), key=readings.count)
    votes = readings.count(bars)
    agreement = votes / len(readings)
    confidence = min(.99, .72 + agreement * .26)
    # Two agreeing thresholds are the least that distinguishes a reading from
    # a coincidence; a lone reading is never published, however clean it looks.
    if votes >= 2 and agreement >= .60:
        return bars, confidence, [f"fuel-track:{readings}"]
    return None, confidence, [f"fuel-rejected:votes={votes},agreement={agreement:.2f}",
                              f"fuel-track:{readings}"]


def read_qr(image: np.ndarray) -> str | None:
    payload, points, _ = cv2.QRCodeDetector().detectAndDecode(image)
    return payload.strip() if payload and points is not None else None


def analyze_image(image_bytes: bytes) -> AnalysisResponse:
    started = time.perf_counter()
    image = decode_image(image_bytes)
    decoded_at = time.perf_counter()
    screen, screen_diagnostics = _screen_from_dials(image)
    localized_at = time.perf_counter()
    if screen is None:
        bars, fuel_confidence, fuel_diagnostics = None, 0.0, []
        odometer, odometer_confidence, odometer_diagnostics = None, 0.0, []
    else:
        bars, fuel_confidence, fuel_diagnostics = read_fuel_bars(screen)
        odometer, odometer_confidence, odometer_diagnostics = read_odometer(screen)
    readings_at = time.perf_counter()
    qr_payload = read_qr(image)
    finished = time.perf_counter()

    fuel_percent = round(bars / TOTAL_FUEL_BARS * 100) if bars is not None else None
    confidences = [c for value, c in ((bars, fuel_confidence), (odometer, odometer_confidence)) if value is not None]
    confidence = min(confidences) if confidences else 0.0
    needs_review = bars is None or odometer is None or confidence < .80
    readable = ([f"ODO {odometer} km"] if odometer is not None else []) + ([f"combustivel {bars}/{TOTAL_FUEL_BARS} ({fuel_percent}%)"] if bars is not None else [])
    return AnalysisResponse(
        odometerKm=odometer, fuelLevelPercent=fuel_percent, fuelLevelRange=fuel_range(fuel_percent),
        fuelBarsFilled=bars, fuelBarsTotal=TOTAL_FUEL_BARS if bars is not None else None,
        ocrText=f"ODO {odometer}" if odometer is not None else None, confidence=round(confidence, 4),
        needsReview=needs_review, summary="Leitura local: " + (", ".join(readable) if readable else "painel nao reconhecido") + ".",
        method="opencv-dashboard-localization-v2", qrPayload=qr_payload,
        timingsMs={"decode": round((decoded_at-started)*1000,2), "localize": round((localized_at-decoded_at)*1000,2), "read": round((readings_at-localized_at)*1000,2), "qr": round((finished-readings_at)*1000,2), "total": round((finished-started)*1000,2)},
        diagnostics=screen_diagnostics + fuel_diagnostics + odometer_diagnostics,
    )
