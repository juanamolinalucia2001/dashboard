import { useCallback, useEffect, useState } from "react";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  PointElement,
  LineElement,
  LineController,
  Tooltip,
  Legend,
} from "chart.js";
import { Bar, Line, Scatter } from "react-chartjs-2";
import { api } from "./api";

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  PointElement,
  LineElement,
  LineController,
  Tooltip,
  Legend
);

function barColor(v) {
  if (v >= 75) return "#3B6D11";
  if (v >= 55) return "#639922";
  if (v >= 40) return "#EF9F27";
  if (v >= 20) return "#D85A30";
  return "#E24B4A";
}

export default function App() {
  const [model, setModel] = useState("tuneado");
  const [models, setModels] = useState([]);
  const [metrics, setMetrics] = useState(null);
  const [evolution, setEvolution] = useState([]);
  const [improvement, setImprovement] = useState([]);
  const [shap, setShap] = useState([]);
  const [scatter, setScatter] = useState([]);
  const [hourly, setHourly] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await api.health();
      const [mList, met, evo, imp, sh, sc, hr] = await Promise.all([
        api.models(),
        api.metrics(model),
        api.evolution(),
        api.improvement(model),
        api.shap(model),
        api.scatter(model),
        api.hourly(model),
      ]);
      setModels(mList.models || []);
      setMetrics(met);
      setEvolution(evo.evolution || []);
      setImprovement(imp.stations || []);
      setShap(sh.features || []);
      setScatter(sc.points || []);
      setHourly(hr.hourly || []);
    } catch (e) {
      console.error(e);
      setError(
        "No se pudo conectar con la API. En otra terminal ejecutá: python backend_api.py"
      );
    } finally {
      setLoading(false);
    }
  }, [model]);

  useEffect(() => {
    load();
  }, [load]);

  const kpis = metrics
    ? [
        {
          lbl: "MAE error humedad",
          val: `${metrics.mae.toFixed(2)}%`,
          sub: `benchmark: ${metrics.mae_benchmark.toFixed(1)}%`,
          col: "#3B6D11",
        },
        {
          lbl: "% mejora MAE",
          val: `${metrics.mejora > 0 ? "+" : ""}${metrics.mejora.toFixed(1)}%`,
          sub: "vs benchmark",
          col: metrics.mejora >= 40 ? "#3B6D11" : "#EF9F27",
        },
        {
          lbl: "RMSE",
          val: `${metrics.rmse.toFixed(1)}%`,
          sub: "raíz error cuad.",
          col: "#888780",
        },
        {
          lbl: "MAE benchmark",
          val: `${metrics.mae_benchmark.toFixed(2)}%`,
          sub: "promedio est+hora",
          col: "#378ADD",
        },
        {
          lbl: "Folds validados",
          val: String(metrics.folds?.length ?? 0),
          sub: "períodos históricos",
          col: "#4BBFB0",
        },
      ]
    : [];

  const evoChart = {
    labels: evolution.map((e) => e.label),
    datasets: [
      {
        data: evolution.map((e) => e.mae),
        backgroundColor: evolution.map((e) =>
          e.model === model ? e.color : `${e.color}66`
        ),
        borderColor: evolution.map((e) => e.color),
        borderWidth: evolution.map((e) => (e.model === model ? 2 : 0)),
        borderRadius: 4,
      },
    ],
  };

  const shapChart = {
    labels: shap.map((d) => d.feature),
    datasets: [
      {
        data: shap.map((d) => d.importance),
        backgroundColor: shap.map((_, i) => {
          const t = shap.length > 1 ? i / (shap.length - 1) : 0;
          return `hsl(${100 + t * 25}, ${42 + t * 30}%, ${32 + t * 18}%)`;
        }),
        borderRadius: 3,
      },
    ],
  };

  const scatterChart = {
    datasets: [
      {
        label: "Línea perfecta",
        data: [
          { x: 20, y: 20 },
          { x: 100, y: 100 },
        ],
        type: "line",
        borderColor: "rgba(128,128,128,0.4)",
        borderWidth: 1,
        borderDash: [4, 3],
        pointRadius: 0,
      },
      {
        label: "Original",
        data: scatter.map((p) => ({ x: p.obs, y: p.fcst_original })),
        backgroundColor: "rgba(226,75,74,0.35)",
        borderColor: "rgba(226,75,74,0.6)",
        pointRadius: 2.5,
      },
      {
        label: "Compensado",
        data: scatter.map((p) => ({ x: p.obs, y: p.fcst_compensado })),
        backgroundColor: "rgba(59,109,17,0.35)",
        borderColor: "rgba(59,109,17,0.7)",
        pointRadius: 2.5,
      },
    ],
  };

  const hourlyChart = {
    labels: hourly.map((h) => h.hora),
    datasets: [
      {
        label: "MAE benchmark",
        data: hourly.map((h) => h.mae_bench),
        borderColor: "#378ADD",
        backgroundColor: "rgba(55,138,221,0.15)",
        tension: 0.25,
      },
      {
        label: "MAE modelo",
        data: hourly.map((h) => h.mae_model),
        borderColor: "#3B6D11",
        backgroundColor: "rgba(59,109,17,0.15)",
        tension: 0.25,
      },
    ],
  };

  const chartOpts = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: false } },
  };

  return (
    <div className="app">
      <header className="header">
        <div>
          <h1>Corrección de pronóstico de humedad relativa</h1>
          <p>
            CatBoost v5 · Walk-forward (5 folds) · 500+ estaciones · Oct 2024 –
            Oct 2025
          </p>
        </div>
        <select
          value={model}
          onChange={(e) => setModel(e.target.value)}
          disabled={loading}
        >
          {(models.length ? models : [{ id: "tuneado", label: "Cargando…" }]).map(
            (m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            )
          )}
        </select>
      </header>

      {error && (
        <div className="banner-error">
          {error} — luego abrí{" "}
          <a href="http://localhost:5173">http://localhost:5173</a> (dev) o{" "}
          <a href="http://localhost:5000">http://localhost:5000</a> (con build).
        </div>
      )}

      <div className="grid-5">
        {kpis.map((k) => (
          <div className="card kpi" key={k.lbl}>
            <div className="kpi-accent" style={{ background: k.col }} />
            <div className="kpi-label">{k.lbl}</div>
            <div className="kpi-value">{k.val}</div>
            <div className="kpi-sub">{k.sub}</div>
          </div>
        ))}
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="card-title">Mejora por estación (top 10)</div>
          {improvement.slice(0, 10).map((r) => (
            <div className="bar-row" key={r.station_id}>
              <span className="bar-label">{r.station}</span>
              <div className="bar-track">
                <div
                  className="bar-fill"
                  style={{
                    width: `${r.improvement}%`,
                    background: barColor(r.improvement),
                  }}
                >
                  {r.improvement.toFixed(0)}%
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="card">
          <div className="card-title">Evolución del MAE entre modelos</div>
          <div className="card-sub">Modelo seleccionado resaltado</div>
          <div className="chart-wrap">
            <Bar
              data={evoChart}
              options={{
                ...chartOpts,
                scales: {
                  y: {
                    min: 0,
                    max: 8,
                    title: { display: true, text: "MAE (%HR)", font: { size: 10 } },
                  },
                },
              }}
            />
          </div>
          <div className="evo-cards">
            {evolution.map((e) => (
              <div
                key={e.model}
                className={`evo-card ${e.model === model ? "active" : ""}`}
              >
                <div className="evo-label">{e.label}</div>
                <div className="evo-value">{e.mae.toFixed(2)}%</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="card-title">MAE por hora del día (UTC)</div>
          <div className="chart-wrap-lg">
            <Line
              data={hourlyChart}
              options={{
                ...chartOpts,
                plugins: {
                  legend: { display: true, position: "bottom" },
                },
                scales: {
                  x: { title: { display: true, text: "Hora UTC" } },
                  y: { title: { display: true, text: "MAE (%HR)" } },
                },
              }}
            />
          </div>
        </div>

        <div className="card">
          <div className="card-title">Folds — MAE humedad original vs compensada</div>
          <div className="chart-wrap-lg">
            <Bar
              data={{
                labels: (metrics?.folds || []).map((f) => `Fold ${f.fold}`),
                datasets: [
                  {
                    label: "Original",
                    data: (metrics?.folds || []).map((f) => f.mae_hum_orig),
                    backgroundColor: "rgba(226,75,74,0.7)",
                  },
                  {
                    label: "Compensado",
                    data: (metrics?.folds || []).map((f) => f.mae_hum_comp),
                    backgroundColor: "rgba(59,109,17,0.7)",
                  },
                ],
              }}
              options={{
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { position: "bottom" } },
              }}
            />
          </div>
        </div>
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="card-title">SHAP — importancia de features</div>
          <div className="card-sub">Modelo: {model}</div>
          {shap.length === 0 ? (
            <p style={{ color: "var(--txt2)", fontSize: 11 }}>
              Sin datos SHAP para este modelo.
            </p>
          ) : (
            <div className="chart-wrap-lg">
              <Bar
                data={shapChart}
                options={{
                  ...chartOpts,
                  indexAxis: "y",
                  scales: {
                    x: {
                      ticks: { callback: (v) => `${v}%` },
                      title: { display: true, text: "Importancia (%)" },
                    },
                  },
                }}
              />
            </div>
          )}
        </div>

        <div className="card">
          <div className="card-title">Observado vs pronosticado</div>
          <div className="legend">
            <span>
              <span className="legend-dot" style={{ background: "#E24B4A" }} />
              Original
            </span>
            <span>
              <span className="legend-dot" style={{ background: "#3B6D11" }} />
              Compensado
            </span>
          </div>
          <div className="chart-wrap-lg">
            <Scatter
              data={scatterChart}
              options={{
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                  x: {
                    min: 20,
                    max: 100,
                    title: { display: true, text: "Humedad observada (%HR)" },
                  },
                  y: {
                    min: 20,
                    max: 100,
                    title: { display: true, text: "Humedad pronosticada (%HR)" },
                  },
                },
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
