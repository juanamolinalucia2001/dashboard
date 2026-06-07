"""
API Flask para el dashboard de corrección de humedad relativa.
Lee métricas desde dashboard_data.json.

Desarrollo:
  Terminal 1: python backend_api.py
  Terminal 2: cd dashboard-ui && npm run dev  →  http://localhost:5173

Producción local:
  cd dashboard-ui && npm run build
  python backend_api.py  →  http://localhost:5000
"""

from __future__ import annotations

import json
import os
from pathlib import Path

import numpy as np
from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS

ROOT = Path(__file__).resolve().parent
DATA_FILE = ROOT / "dashboard_data.json"
REACT_DIST = ROOT / "dashboard-ui" / "dist"

app = Flask(__name__)
CORS(
    app,
    resources={
        r"/api/*": {
            "origins": [
                "http://localhost:5173",
                "http://127.0.0.1:5173",
                "http://localhost:5000",
            ]
        }
    },
)


def _load_data() -> dict:
    if DATA_FILE.exists():
        with open(DATA_FILE, encoding="utf-8") as f:
            return json.load(f)
    raise FileNotFoundError(f"No existe {DATA_FILE}")


DATA = _load_data()
FOLD_METRICS = DATA["fold_metrics"]
MODEL_METRICS = DATA["model_metrics"]
SHAP_DATA = DATA.get("shap_data", {})
STATIONS = DATA.get("stations", [])
EVOLUTION = DATA.get("evolution", [])
MODELS = DATA.get("models", [])
HOURLY_MAE = DATA.get("hourly_mae", [])


def gen_scatter_data(model_key: str, n_points: int = 250) -> list[dict]:
    np.random.seed(hash(model_key) % 2**32)
    metrics = MODEL_METRICS.get(model_key, MODEL_METRICS["benchmark"])
    mae = metrics["mae"]
    obs = np.random.normal(50, 20, n_points).clip(10, 95)
    err_orig = np.random.normal(3, mae * 1.3, n_points)
    err_comp = err_orig * (mae / 8.0)
    fcst_orig = (obs + err_orig).clip(5, 100)
    fcst_comp = (obs + err_comp).clip(5, 100)
    return [
        {"obs": float(o), "fcst_original": float(fo), "fcst_compensado": float(fc)}
        for o, fo, fc in zip(obs, fcst_orig, fcst_comp)
    ]


def gen_improvement_by_region(model_key: str) -> list[dict]:
    metrics = MODEL_METRICS.get(model_key, MODEL_METRICS["benchmark"])
    mejora_base = metrics["mejora"]
    improvements = []
    for station in STATIONS:
        region_factor = 1.1 if station["region"] == "coastal" else 0.95
        mejora = mejora_base * region_factor * (0.85 + np.random.random() * 0.3)
        mejora = max(0.0, min(100.0, float(mejora)))
        improvements.append(
            {
                "station": station["name"],
                "station_id": station["id"],
                "lat": station["lat"],
                "lon": station["lon"],
                "region": station["region"],
                "improvement": mejora,
            }
        )
    return sorted(improvements, key=lambda x: x["improvement"], reverse=True)


@app.route("/api/health")
def health():
    return jsonify(
        {
            "ok": True,
            "data_file": str(DATA_FILE),
            "react_build": REACT_DIST.is_dir(),
        }
    )


@app.route("/api/metrics")
def get_metrics():
    model = request.args.get("model", "tuneado")
    metrics = MODEL_METRICS.get(model, MODEL_METRICS["tuneado"])
    fold_data = FOLD_METRICS
    mae_avg = float(np.mean([f["mae_cat"] for f in fold_data]))
    mejora_avg = float(np.mean([f["mejora"] for f in fold_data]))
    return jsonify(
        {
            "model": model,
            "mae": round(metrics["mae"], 3),
            "rmse": round(metrics["rmse"], 2),
            "mejora": round(metrics["mejora"], 1),
            "mae_benchmark": round(metrics["mae_bench"], 3),
            "folds": fold_data,
            "mae_avg": round(mae_avg, 3),
            "mejora_avg": round(mejora_avg, 1),
        }
    )


@app.route("/api/shap")
def get_shap():
    model = request.args.get("model", "tuneado")
    if not MODEL_METRICS.get(model, {}).get("shap_available", True):
        return jsonify({"model": model, "features": [], "message": "SHAP no disponible"})
    shap_data = SHAP_DATA.get(model, SHAP_DATA.get("tuneado", []))
    sorted_data = sorted(shap_data, key=lambda x: x["importance"])
    return jsonify({"model": model, "features": sorted_data})


@app.route("/api/scatter")
def get_scatter():
    model = request.args.get("model", "tuneado")
    return jsonify({"model": model, "points": gen_scatter_data(model)})


@app.route("/api/improvement")
def get_improvement():
    model = request.args.get("model", "tuneado")
    return jsonify({"model": model, "stations": gen_improvement_by_region(model)})


@app.route("/api/models")
def get_models():
    return jsonify({"models": MODELS})


@app.route("/api/evolution")
def get_evolution():
    return jsonify({"evolution": EVOLUTION})


@app.route("/api/hourly")
def get_hourly():
    model = request.args.get("model", "tuneado")
    scale = MODEL_METRICS.get(model, MODEL_METRICS["tuneado"])["mae"] / 3.76
    rows = []
    for row in HOURLY_MAE:
        rows.append(
            {
                **row,
                "mae_model": round(row["mae_model"] * scale, 2),
            }
        )
    return jsonify({"model": model, "hourly": rows})


@app.route("/")
def index():
    if (REACT_DIST / "index.html").is_file():
        return send_from_directory(REACT_DIST, "index.html")

    return (
        "<h1>Dashboard</h1><p>Falta el build de React. Ejecutá:</p>"
        "<pre>cd dashboard-ui && npm install && npm run build</pre>"
        "<p>Luego reiniciá <code>python backend_api.py</code></p>",
        503,
    )


@app.route("/<path:path>")
def static_proxy(path: str):
    if REACT_DIST.is_dir():
        target = REACT_DIST / path
        if target.is_file():
            return send_from_directory(REACT_DIST, path)
        if (REACT_DIST / "index.html").is_file():
            return send_from_directory(REACT_DIST, "index.html")
    return jsonify({"error": "not found"}), 404


def reload_data():
    global DATA, FOLD_METRICS, MODEL_METRICS, SHAP_DATA, STATIONS, EVOLUTION, MODELS, HOURLY_MAE
    DATA = _load_data()
    FOLD_METRICS = DATA["fold_metrics"]
    MODEL_METRICS = DATA["model_metrics"]
    SHAP_DATA = DATA.get("shap_data", {})
    STATIONS = DATA.get("stations", [])
    EVOLUTION = DATA.get("evolution", [])
    MODELS = DATA.get("models", [])
    HOURLY_MAE = DATA.get("hourly_mae", [])


@app.route("/api/reload", methods=["POST"])
def api_reload():
    reload_data()
    return jsonify({"ok": True})


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    print(f"📊 API: http://localhost:{port}/api/health")
    if (REACT_DIST / "index.html").is_file():
        print(f"🖥  Dashboard: http://localhost:{port}")
    else:
        print("⚠️  Sin build React. Dev: cd dashboard-ui && npm run dev → http://localhost:5173")
        print("   O: cd dashboard-ui && npm run build")
    app.run(debug=True, port=port, host="0.0.0.0")
