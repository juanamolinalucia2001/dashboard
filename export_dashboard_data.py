#!/usr/bin/env python3
"""
Exporta métricas del notebook a dashboard_data.json para el dashboard.

Uso (después de tener res_v5_df, resultados, etc. en el kernel):
  python export_dashboard_data.py

O editá este script con tus DataFrames guardados como CSV/parquet.
"""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "dashboard_data.json"


def default_payload() -> dict:
    """Payload por defecto (mismos valores que backend_api)."""
    path = ROOT / "dashboard_data.json"
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    raise FileNotFoundError("No hay dashboard_data.json base")


def export_from_frames(
    res_v5_df,
    model_metrics: dict | None = None,
    shap_by_model: dict | None = None,
    stations: list | None = None,
    hourly_mae: list | None = None,
) -> None:
    """Llamar desde el notebook con tus resultados reales."""
    import pandas as pd

    folds = []
    for _, row in res_v5_df.iterrows():
        folds.append(
            {
                "fold": int(row["fold"]),
                "n_test": int(row["n_test"]),
                "std_test": float(row["std_test"]),
                "mae_bench": float(row["mae_bench"]),
                "mae_cat": float(row["mae_cat"]),
                "mae_hum_orig": float(row["mae_hum_orig"]),
                "mae_hum_comp": float(row["mae_hum_comp"]),
                "mejora": float(row["mejora_hum_pct"]),
                "best_iter": int(row["best_iter"]),
            }
        )

    payload = default_payload()
    payload["fold_metrics"] = folds
    if model_metrics:
        payload["model_metrics"] = model_metrics
    if shap_by_model:
        payload["shap_data"] = shap_by_model
    if stations:
        payload["stations"] = stations
    if hourly_mae:
        payload["hourly_mae"] = hourly_mae

    OUT.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"✅ Exportado: {OUT}")


if __name__ == "__main__":
    print(f"Archivo actual: {OUT} ({OUT.stat().st_size} bytes)")
    print("Para actualizar desde el notebook, ejecutá:")
    print("  from export_dashboard_data import export_from_frames")
    print("  export_from_frames(res_v5_df)")
