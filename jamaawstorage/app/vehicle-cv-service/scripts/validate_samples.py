from __future__ import annotations

import argparse
import json
from pathlib import Path

from app.analyzer import analyze_image


def main() -> None:
    parser = argparse.ArgumentParser(description="Validate real dashboard samples.")
    parser.add_argument("samples", nargs="+", type=Path)
    parser.add_argument("--expected-bars", nargs="*", type=int)
    args = parser.parse_args()

    expected = args.expected_bars or []
    failures = 0
    for index, sample in enumerate(args.samples):
        result = analyze_image(sample.read_bytes())
        print(json.dumps({"file": sample.name, **result.model_dump()}, ensure_ascii=False, indent=2))
        if index < len(expected) and result.fuelBarsFilled != expected[index]:
            failures += 1
            print(f"ERRO: esperado {expected[index]}/8, obtido {result.fuelBarsFilled}/8")
    if failures:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
