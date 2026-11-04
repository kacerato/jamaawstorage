"""Leitura do painel contra a foto real, incluindo condicoes de campo.

Os testes de unidade cobriam so funcoes auxiliares, entao um erro grave
passou despercebido: em foto clara as barras se fundiam e o medidor
publicava 1/8 com `needsReview: false`, gravando valor falso no historico
do veiculo. Aqui a foto de verdade e lida sob as variacoes que o celular
produz no patio.

A regra que importa e a ultima: errar calado e inaceitavel, abster nao.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.analyzer import analyze_image
from scripts.make_dataset import exposure, gamma, glare, perspective, rotate, shadow

import cv2


FIXTURES = Path(__file__).resolve().parents[1] / "fixtures"


def _label() -> dict:
    return json.loads((FIXTURES / "labels.json").read_text(encoding="utf-8"))[0]


def _photo():
    image = cv2.imread(str(FIXTURES / "dashboard-t30.jpg"))
    assert image is not None, "fixture do painel nao encontrada"
    return image


def _encode(image) -> bytes:
    ok, buffer = cv2.imencode(".jpg", image, [cv2.IMWRITE_JPEG_QUALITY, 92])
    assert ok
    return buffer.tobytes()


# As condicoes que a foto de campo realmente apresenta.
CONDITIONS = {
    "base": lambda img: img,
    "inclinada_esquerda": lambda img: rotate(img, 6),
    "de_cima": lambda img: perspective(img, 0.0, 0.08),
    "escura": lambda img: exposure(img, 0.62, -18),
    "clara": lambda img: exposure(img, 1.38, 26),
    "estourada": lambda img: exposure(img, 1.62, 44),
    "gamma_baixo": lambda img: gamma(img, 0.55),
    "sombra_lateral": lambda img: shadow(img, "left", 0.55),
    "sombra_superior": lambda img: shadow(img, "top", 0.48),
    "reflexo_no_lcd": lambda img: glare(img, (0.58, 0.45), 0.16, 0.50),
    "reflexo_lateral": lambda img: glare(img, (0.22, 0.30), 0.34, 0.60),
}


def test_reads_the_reference_photo() -> None:
    result = analyze_image(_encode(_photo()))
    expected = _label()
    assert result.odometerKm == expected["odometerKm"]
    assert result.fuelBarsFilled == expected["fuelBarsFilled"]
    assert result.needsReview is False


def test_reference_photo_is_read_without_the_ai_fallback() -> None:
    """A confianca precisa bastar sozinha, senao a Vercel chama o modelo."""
    result = analyze_image(_encode(_photo()))
    assert result.confidence >= 0.82
    assert result.method.startswith("opencv")


@pytest.mark.parametrize("condition", sorted(CONDITIONS))
def test_never_reports_a_wrong_reading_as_certain(condition: str) -> None:
    """Abster e aceitavel; publicar valor errado corrompe o historico."""
    expected = _label()
    result = analyze_image(_encode(CONDITIONS[condition](_photo())))

    if result.odometerKm is not None:
        assert result.odometerKm == expected["odometerKm"], (
            f"{condition}: ODO {result.odometerKm} publicado no lugar de "
            f"{expected['odometerKm']} (confianca {result.confidence})"
        )
    if result.fuelBarsFilled is not None:
        assert result.fuelBarsFilled == expected["fuelBarsFilled"], (
            f"{condition}: {result.fuelBarsFilled}/8 barras publicadas no lugar de "
            f"{expected['fuelBarsFilled']}/8 (confianca {result.confidence})"
        )


def test_reads_most_field_conditions() -> None:
    """Abster sempre passaria no teste acima; isto guarda a utilidade."""
    expected = _label()
    read = 0
    for transform in CONDITIONS.values():
        result = analyze_image(_encode(transform(_photo())))
        if result.fuelBarsFilled == expected["fuelBarsFilled"]:
            read += 1
    assert read >= len(CONDITIONS) * 0.5, (
        f"combustivel lido em apenas {read}/{len(CONDITIONS)} condicoes"
    )
