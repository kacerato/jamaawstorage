"""Mede a leitura do painel contra um conjunto rotulado.

Reporta tres numeros que importam em producao, separados de proposito:

  acerto     - leu e acertou
  abstencao  - nao leu (needsReview); o operador digita, nada quebra
  ERRO       - leu e errou; e o unico numero caro, porque entra no
               historico do veiculo como se fosse verdade

Uso:
    python scripts/evaluate.py dataset/variants --labels dataset/variants/labels.json
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.analyzer import analyze_image  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", type=Path)
    parser.add_argument("--labels", type=Path, required=True)
    parser.add_argument("--json", type=Path, help="Grava o resultado por arquivo.")
    parser.add_argument("--quiet", action="store_true")
    args = parser.parse_args()

    labels = {item["file"]: item for item in json.loads(args.labels.read_text(encoding="utf-8"))}
    rows = []
    for name in sorted(labels):
        path = args.directory / name
        if not path.exists():
            continue
        expected = labels[name]
        started = time.perf_counter()
        result = analyze_image(path.read_bytes()).model_dump()
        elapsed = (time.perf_counter() - started) * 1000

        def verdict(got, want):
            if got is None:
                return "abstencao"
            return "acerto" if got == want else "ERRO"

        rows.append({
            "file": name,
            "odo": {"got": result["odometerKm"], "want": expected["odometerKm"],
                    "verdict": verdict(result["odometerKm"], expected["odometerKm"])},
            "fuel": {"got": result["fuelBarsFilled"], "want": expected["fuelBarsFilled"],
                     "verdict": verdict(result["fuelBarsFilled"], expected["fuelBarsFilled"])},
            "confidence": result["confidence"],
            "needsReview": result["needsReview"],
            "ms": round(elapsed, 1),
        })

    def tally(field: str) -> dict[str, int]:
        counts = {"acerto": 0, "abstencao": 0, "ERRO": 0}
        for row in rows:
            counts[row[field]["verdict"]] += 1
        return counts

    if not args.quiet:
        print(f"{'arquivo':<22} {'ODO':>14} {'COMB':>12} {'conf':>6} {'ms':>7}")
        for row in rows:
            odo = f"{row['odo']['got']} {row['odo']['verdict'][:4]}"
            fuel = f"{row['fuel']['got']} {row['fuel']['verdict'][:4]}"
            flag = "!" if "ERRO" in (row["odo"]["verdict"], row["fuel"]["verdict"]) else " "
            print(f"{flag}{row['file']:<21} {odo:>14} {fuel:>12} {row['confidence']:>6.2f} {row['ms']:>7.1f}")

    total = len(rows)
    odo, fuel = tally("odo"), tally("fuel")
    times = sorted(row["ms"] for row in rows)
    print(f"\n{total} imagens")
    for name, counts in (("ODO ", odo), ("COMB", fuel)):
        pct = lambda n: f"{n / total * 100:5.1f}%" if total else "  n/a"
        print(f"  {name}  acerto {counts['acerto']:>3} ({pct(counts['acerto'])})"
              f"  abstencao {counts['abstencao']:>3} ({pct(counts['abstencao'])})"
              f"  ERRO {counts['ERRO']:>3} ({pct(counts['ERRO'])})")
    if times:
        print(f"  tempo mediana {times[len(times)//2]:.0f}ms  p95 {times[int(len(times)*0.95)-1]:.0f}ms")

    if args.json:
        args.json.write_text(json.dumps(rows, indent=2), encoding="utf-8")

    # Erro silencioso e o unico que corrompe o historico do veiculo.
    raise SystemExit(1 if odo["ERRO"] or fuel["ERRO"] else 0)


if __name__ == "__main__":
    main()
