"""Gera variacoes sinteticas de uma foto de painel para medir a leitura.

A foto de campo chega inclinada, com reflexo do para-brisa, sombra do
volante e exposicao variada. Reproduzir isso a partir de uma foto boa
da um conjunto rotulado sem precisar voltar ao patio a cada ajuste.

Uso:
    python scripts/make_dataset.py base.jpg --out dataset/ --odo 425 --bars 6
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import cv2
import numpy as np


def rotate(image: np.ndarray, degrees: float) -> np.ndarray:
    height, width = image.shape[:2]
    matrix = cv2.getRotationMatrix2D((width / 2, height / 2), degrees, 1.0)
    return cv2.warpAffine(image, matrix, (width, height), borderMode=cv2.BORDER_REPLICATE)


def perspective(image: np.ndarray, horizontal: float, vertical: float) -> np.ndarray:
    """Simula a foto tirada de lado ou de cima, como quem fotografa em pe."""
    height, width = image.shape[:2]
    dx, dy = width * horizontal, height * vertical
    source = np.float32([[0, 0], [width, 0], [width, height], [0, height]])
    target = np.float32([
        [0 + max(dx, 0), 0 + max(dy, 0)],
        [width + min(dx, 0), 0 + max(-dy, 0)],
        [width + min(dx, 0), height - max(dy, 0)],
        [0 + max(dx, 0), height - max(-dy, 0)],
    ])
    matrix = cv2.getPerspectiveTransform(source, target)
    return cv2.warpPerspective(image, matrix, (width, height), borderMode=cv2.BORDER_REPLICATE)


def exposure(image: np.ndarray, gain: float, bias: int) -> np.ndarray:
    return cv2.convertScaleAbs(image, alpha=gain, beta=bias)


def gamma(image: np.ndarray, value: float) -> np.ndarray:
    table = np.array([((i / 255.0) ** (1.0 / value)) * 255 for i in range(256)], dtype=np.uint8)
    return cv2.LUT(image, table)


def shadow(image: np.ndarray, side: str, strength: float) -> np.ndarray:
    """Sombra em gradiente, como a do volante ou do pilar sobre o painel."""
    height, width = image.shape[:2]
    if side in ("left", "right"):
        ramp = np.linspace(0, 1, width, dtype=np.float32)
        if side == "left":
            ramp = ramp[::-1]
        mask = np.tile(ramp, (height, 1))
    else:
        ramp = np.linspace(0, 1, height, dtype=np.float32)
        if side == "top":
            ramp = ramp[::-1]
        mask = np.tile(ramp.reshape(-1, 1), (1, width))
    mask = 1.0 - mask * strength
    return np.clip(image.astype(np.float32) * mask[:, :, None], 0, 255).astype(np.uint8)


def glare(image: np.ndarray, center: tuple[float, float], radius: float, strength: float) -> np.ndarray:
    """Reflexo especular do para-brisa sobre o vidro do painel."""
    height, width = image.shape[:2]
    y, x = np.ogrid[:height, :width]
    cx, cy = center[0] * width, center[1] * height
    distance = np.sqrt((x - cx) ** 2 + (y - cy) ** 2)
    mask = np.clip(1.0 - distance / (radius * max(height, width)), 0, 1) ** 2
    return np.clip(image.astype(np.float32) + mask[:, :, None] * 255 * strength, 0, 255).astype(np.uint8)


def blur(image: np.ndarray, size: int) -> np.ndarray:
    return cv2.GaussianBlur(image, (size, size), 0)


def noise(image: np.ndarray, sigma: float, seed: int) -> np.ndarray:
    generator = np.random.default_rng(seed)
    grain = generator.normal(0, sigma, image.shape).astype(np.float32)
    return np.clip(image.astype(np.float32) + grain, 0, 255).astype(np.uint8)


def scale(image: np.ndarray, factor: float) -> np.ndarray:
    height, width = image.shape[:2]
    return cv2.resize(image, (round(width * factor), round(height * factor)),
                      interpolation=cv2.INTER_AREA if factor < 1 else cv2.INTER_CUBIC)


# Cada entrada e um caso que o celular produz no patio de verdade.
VARIANTS: list[tuple[str, callable]] = [
    ("00_base", lambda img: img),
    ("01_rot_left_6", lambda img: rotate(img, 6)),
    ("02_rot_right_6", lambda img: rotate(img, -6)),
    ("03_rot_left_12", lambda img: rotate(img, 12)),
    ("04_rot_right_12", lambda img: rotate(img, -12)),
    ("05_persp_left", lambda img: perspective(img, 0.10, 0.0)),
    ("06_persp_right", lambda img: perspective(img, -0.10, 0.0)),
    ("07_persp_above", lambda img: perspective(img, 0.0, 0.08)),
    ("08_persp_corner", lambda img: perspective(rotate(img, 5), 0.08, 0.06)),
    ("09_dark", lambda img: exposure(img, 0.62, -18)),
    ("10_very_dark", lambda img: exposure(img, 0.45, -28)),
    ("11_bright", lambda img: exposure(img, 1.38, 26)),
    ("12_very_bright", lambda img: exposure(img, 1.62, 44)),
    ("13_low_contrast", lambda img: exposure(img, 0.70, 58)),
    ("14_high_contrast", lambda img: exposure(img, 1.55, -42)),
    ("15_gamma_low", lambda img: gamma(img, 0.55)),
    ("16_gamma_high", lambda img: gamma(img, 1.85)),
    ("17_shadow_left", lambda img: shadow(img, "left", 0.55)),
    ("18_shadow_right", lambda img: shadow(img, "right", 0.55)),
    ("19_shadow_top", lambda img: shadow(img, "top", 0.48)),
    ("20_shadow_bottom", lambda img: shadow(img, "bottom", 0.48)),
    ("21_glare_center", lambda img: glare(img, (0.50, 0.42), 0.30, 0.55)),
    ("22_glare_left", lambda img: glare(img, (0.22, 0.30), 0.34, 0.60)),
    ("23_glare_right", lambda img: glare(img, (0.78, 0.30), 0.34, 0.60)),
    ("24_glare_on_lcd", lambda img: glare(img, (0.58, 0.45), 0.16, 0.50)),
    ("25_blur_soft", lambda img: blur(img, 5)),
    ("26_blur_strong", lambda img: blur(img, 11)),
    ("27_noise", lambda img: noise(img, 12.0, 7)),
    ("28_noise_dark", lambda img: noise(exposure(img, 0.60, -16), 16.0, 11)),
    ("29_small", lambda img: scale(img, 0.55)),
    ("30_large", lambda img: scale(img, 1.35)),
    ("31_dark_tilted", lambda img: rotate(exposure(img, 0.58, -20), 8)),
    ("32_bright_tilted", lambda img: rotate(exposure(img, 1.45, 30), -8)),
    ("33_shadow_glare", lambda img: glare(shadow(img, "left", 0.45), (0.70, 0.35), 0.26, 0.50)),
    ("34_persp_dark", lambda img: perspective(exposure(img, 0.62, -16), 0.09, 0.05)),
    ("35_worst_case", lambda img: noise(blur(glare(rotate(exposure(img, 0.70, -12), 9), (0.60, 0.40), 0.22, 0.45), 5), 9.0, 3)),
]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--odo", type=int, required=True, help="ODO verdadeiro da foto.")
    parser.add_argument("--bars", type=int, required=True, help="Barras acesas verdadeiras.")
    args = parser.parse_args()

    image = cv2.imread(str(args.source))
    if image is None:
        raise SystemExit(f"Nao foi possivel ler {args.source}")

    args.out.mkdir(parents=True, exist_ok=True)
    labels = []
    for name, transform in VARIANTS:
        variant = transform(image)
        path = args.out / f"{name}.jpg"
        cv2.imwrite(str(path), variant, [cv2.IMWRITE_JPEG_QUALITY, 92])
        labels.append({"file": path.name, "odometerKm": args.odo, "fuelBarsFilled": args.bars})

    manifest = args.out / "labels.json"
    manifest.write_text(json.dumps(labels, indent=2), encoding="utf-8")
    print(f"{len(labels)} variacoes em {args.out}")


if __name__ == "__main__":
    main()
