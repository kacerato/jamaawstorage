from __future__ import annotations

import cv2
import numpy as np

from app.analyzer import _closest_digit, fuel_range, read_qr


def test_fuel_ranges_follow_the_eight_bar_scale() -> None:
    assert fuel_range(12) == "reserva"
    assert fuel_range(13) == "baixo"
    assert fuel_range(50) == "meio"
    assert fuel_range(75) == "alto"
    assert fuel_range(100) == "cheio"


def test_seven_segment_exact_patterns_are_recognized() -> None:
    digit, confidence = _closest_digit((1, 1, 1, 0, 1, 1, 1))
    assert digit == 0
    assert confidence == 1.0


def test_opencv_is_available_in_runtime() -> None:
    image = np.zeros((10, 10, 3), dtype=np.uint8)
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    assert gray.shape == (10, 10)


def test_generated_vehicle_marker_can_be_read() -> None:
    marker = cv2.QRCodeEncoder_create().encode("jamaaw:vehicle:JAMAAW-T30-01")
    marker = cv2.resize(marker, (580, 580), interpolation=cv2.INTER_NEAREST)
    image = cv2.cvtColor(marker, cv2.COLOR_GRAY2BGR)
    assert read_qr(image) == "jamaaw:vehicle:JAMAAW-T30-01"
