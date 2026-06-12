import { useCallback, useEffect, useRef, useState } from "react";
import {
  Chart as ChartJS,
  CategoryScale, LinearScale, BarElement,
  PointElement, LineElement, LineController, ScatterController,
  Filler, Tooltip, Legend,
} from "chart.js";
import { Bar, Line, Scatter } from "react-chartjs-2";
import { api, isStaticData } from "./api";

const LOAD_ERROR = isStaticData
  ? "No se pudieron cargar los datos del dashboard."
  : "No se pudo conectar con la API. Ejecutá: python backend_api.py";
import { US_STATES } from "./usStates.js";
import { featureLabel } from "./storyContent.js";
import { buildExecutiveNarrative } from "./executiveBusiness.js";
import { C, HUE, cat, hsl, quant, shade, tint } from "./theme.js";

const GRID = "hsla(40, 8%, 40%, 0.1)";

const TOP_SHAP = 5;

function ChartPanel({ children, wide = false, fill = false }) {
  const cls = [
    "chart-panel",
    wide && "chart-panel-wide",
    fill && "chart-panel-fill",
  ].filter(Boolean).join(" ");
  return <div className={cls}>{children}</div>;
}

ChartJS.register(
  CategoryScale, LinearScale, BarElement, PointElement,
  LineElement, LineController, ScatterController,
  Filler, Tooltip, Legend
);

const REGION_LABEL = { coastal: "Costera", inland: "Interior" };

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

function absErrorsSorted(points, fcstKey) {
  return points.map((p) => Math.abs(p.obs - p[fcstKey])).sort((a, b) => a - b);
}

function buildObsBins(points, step = 10) {
  const bins = [];
  for (let lo = 0; lo < 100; lo += step) {
    const hi = Math.min(100, lo + step);
    const inBin = points.filter(
      (p) => p.obs >= lo && (hi === 100 ? p.obs <= hi : p.obs < hi)
    );
    if (inBin.length) bins.push({ lo, hi, inBin, center: lo + step / 2 });
  }
  return bins;
}

function meanField(items, key) {
  return items.reduce((s, p) => s + p[key], 0) / items.length;
}

function stationJitter(id, spread = 0.34) {
  const h = [...id].reduce((a, c) => a + c.charCodeAt(0), 0);
  return ((h % 100) / 100 - 0.5) * spread;
}

const REGION_X = { coastal: 1, inland: 2 };

const regionBoxPlugin = {
  id: "regionBox",
  beforeDatasetsDraw(chart, _args, opts) {
    const stats = opts.stats;
    if (!stats?.length) return;
    const { ctx, scales: { x, y } } = chart;
    const w = 36;
    ctx.save();
    for (const r of stats) {
      const xPix = x.getPixelForValue(REGION_X[r.key]);
      const yP25 = y.getPixelForValue(r.p25);
      const yP75 = y.getPixelForValue(r.p75);
      const yMed = y.getPixelForValue(r.median);
      const yMin = y.getPixelForValue(r.min);
      const yMax = y.getPixelForValue(r.max);
      const color = r.key === "coastal" ? C.neutral : C.accent;
      ctx.fillStyle = r.key === "coastal" ? C.neutralA(0.18) : C.accentA(0.18);
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.fillRect(xPix - w / 2, yP75, w, yP25 - yP75);
      ctx.strokeRect(xPix - w / 2, yP75, w, yP25 - yP75);
      ctx.beginPath();
      ctx.moveTo(xPix - w / 2, yMed);
      ctx.lineTo(xPix + w / 2, yMed);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(xPix, yMin);
      ctx.lineTo(xPix, yP25);
      ctx.moveTo(xPix, yMax);
      ctx.lineTo(xPix, yP75);
      ctx.stroke();
    }
    ctx.restore();
  },
};

const CHART_FONT = { size: 17 };
const CHART_TITLE = { display: true, font: { size: 17, weight: "600" } };

function buildResidualHistogram(points, binSize = 3, min = -60, max = 60) {
  const nBins = Math.ceil((max - min) / binSize);
  const labels = [];
  const centers = [];
  const orig = Array(nBins).fill(0);
  const corr = Array(nBins).fill(0);

  for (let i = 0; i < nBins; i++) {
    const lo = min + i * binSize;
    const center = lo + binSize / 2;
    centers.push(center);
    labels.push(String(Math.round(center)));
  }

  const toBin = (residual) => {
    if (residual < min || residual >= max) return -1;
    return Math.min(nBins - 1, Math.floor((residual - min) / binSize));
  };

  for (const p of points) {
    const bOrig = toBin(p.obs - p.fcst_original);
    if (bOrig >= 0) orig[bOrig]++;
    const bCorr = toBin(p.obs - p.fcst_compensado);
    if (bCorr >= 0) corr[bCorr]++;
  }

  return { labels, centers, orig, corr, binSize };
}

const residualZeroLinePlugin = {
  id: "residualZeroLine",
  afterDatasetsDraw(chart, _args, opts) {
    const centers = opts.centers;
    const xScale = chart.scales.x;
    if (!centers?.length || !xScale) return;

    const zeroIdx = centers.reduce(
      (best, c, i) => (Math.abs(c) < Math.abs(centers[best]) ? i : best),
      0
    );
    const xPos = xScale.getPixelForValue(zeroIdx);
    const { top, bottom } = chart.chartArea;
    const ctx = chart.ctx;

    ctx.save();
    ctx.strokeStyle = shade(HUE.muted, 12, 22);
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(xPos, top);
    ctx.lineTo(xPos, bottom);
    ctx.stroke();
    ctx.restore();
  },
};

// ─── Proyección Mercator simple ───────────────────────────────────────────────
// Ventana: Este de EEUU [lon -100 a -65, lat 23 a 48]
const LON0 = -100, LON1 = -65, LAT0 = 23, LAT1 = 48.5;
const VBW = 700, VBH = 430;

function lonlatToXY(lon, lat) {
  const x = ((lon - LON0) / (LON1 - LON0)) * VBW;
  // Proyección Mercator simple en el eje Y
  const latRad = (lat * Math.PI) / 180;
  const lat0Rad = (LAT0 * Math.PI) / 180;
  const lat1Rad = (LAT1 * Math.PI) / 180;
  const mercY  = Math.log(Math.tan(Math.PI / 4 + latRad / 2));
  const merc0  = Math.log(Math.tan(Math.PI / 4 + lat0Rad / 2));
  const merc1  = Math.log(Math.tan(Math.PI / 4 + lat1Rad / 2));
  const y = ((merc1 - mercY) / (merc1 - merc0)) * VBH;
  return [x, y];
}

// Paleta "hot" matplotlib (negro → rojo → amarillo) para puntos del mapa
function hotColor(t) {
  t = Math.max(0, Math.min(1, t));
  if (t < 1 / 3) return `rgb(${Math.round(t * 3 * 255)},0,0)`;
  if (t < 2 / 3) return `rgb(255,${Math.round((t - 1 / 3) * 3 * 255)},0)`;
  return `rgb(255,255,${Math.round((t - 2 / 3) * 3 * 255)})`;
}

// ─── Convertir GeoJSON geometry → SVG path string ────────────────────────────
function ringToPath(coords) {
  return coords.map(([lon, lat], i) => {
    const [x, y] = lonlatToXY(lon, lat);
    return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ") + " Z";
}

function geomToPaths(geometry) {
  const paths = [];
  if (geometry.type === "Polygon") {
    for (const ring of geometry.coordinates) paths.push(ringToPath(ring));
  } else if (geometry.type === "MultiPolygon") {
    for (const poly of geometry.coordinates)
      for (const ring of poly) paths.push(ringToPath(ring));
  }
  return paths;
}

const breakevenPlugin = {
  id: "breakevenLine",
  afterDatasetsDraw(chart, _args, opts) {
    const month = opts.breakevenMonth;
    if (month == null || month < 0) return;
    const xScale = chart.scales.x;
    const { top, bottom } = chart.chartArea;
    const x = xScale.getPixelForValue(month);
    const ctx = chart.ctx;
    ctx.save();
    ctx.strokeStyle = C.baseline;
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x, bottom);
    ctx.stroke();
    ctx.fillStyle = C.baseline;
    ctx.font = "600 13px sans-serif";
    ctx.fillText("Breakeven", x + 4, top + 14);
    ctx.restore();
  },
};

// ─── Mapa de estaciones ───────────────────────────────────────────────────────
function executiveGreen(t) {
  const x = Math.pow(Math.max(0, Math.min(1, t)), 0.72);
  return `hsl(${92 + Math.round(x * 38)}, ${58 + Math.round(x * 30)}%, ${86 - Math.round(x * 58)}%)`;
}

function StationMap({ stations, mode = "technical" }) {
  const [tooltip, setTooltip] = useState(null);
  const containerRef = useRef(null);
  const executive = mode === "executive";

  if (!stations || !stations.length) {
    return <div style={{ color: "var(--txt2)", fontSize: 17, padding: 20 }}>Sin datos de estaciones.</div>;
  }

  const maes = stations.map((s) => s.mae_model);
  const minMae = Math.min(...maes);
  const maxMae = Math.max(...maes);
  const range = maxMae - minMae || 1;
  const benefits = executive ? stations.map((s) => s.benefitK ?? 0) : [];
  const minBenefit = executive ? Math.min(...benefits) : 0;
  const maxBenefit = executive ? Math.max(...benefits, 1) : 1;
  const benefitRange = Math.max(maxBenefit - minBenefit, 1);

  // Pre-calcular paths de estados (una vez)
  const statePaths = [];
  for (const state of US_STATES.states) {
    for (const d of geomToPaths(state.geometry)) {
      statePaths.push({ name: state.name, d });
    }
  }

  return (
    <div ref={containerRef} style={{ position: "relative", width: "100%", height: "100%" }}>
      <svg
        viewBox={`0 0 ${VBW} ${VBH}`}
        style={{ width: "100%", height: "100%", display: "block" }}
        preserveAspectRatio="xMidYMid meet"
      >
        {/* Océano */}
        <rect width={VBW} height={VBH} fill="var(--map-ocean)" />

        {/* Estados */}
        {statePaths.map((sp, i) => (
          <path key={i} d={sp.d}
            fill="var(--map-land)"
            stroke="var(--map-border)"
            strokeWidth="0.5"
          />
        ))}

        {/* Puntos de estaciones */}
        {stations.map((st, i) => {
          const [x, y] = lonlatToXY(st.lon, st.lat);
          const col = executive
            ? executiveGreen(((st.benefitK ?? 0) - minBenefit) / benefitRange)
            : hotColor((st.mae_model - minMae) / range);
          // Solo mostrar estaciones dentro del mapa
          if (x < 0 || x > VBW || y < 0 || y > VBH) return null;
          return (
            <circle key={i} cx={x} cy={y} r={executive ? 4.6 : 4}
              fill={col} stroke="rgba(0,0,0,0.55)" strokeWidth={executive ? 0.7 : 0.4}
              style={{ cursor: "pointer" }}
              onMouseMove={(e) => {
                const rect = containerRef.current?.getBoundingClientRect();
                if (!rect) return;
                setTooltip({ x: e.clientX - rect.left, y: e.clientY - rect.top, st });
              }}
              onMouseEnter={(e) => e.currentTarget.setAttribute("r", "6")}
              onMouseLeave={(e) => { e.currentTarget.setAttribute("r", executive ? "4.6" : "4"); setTooltip(null); }}
            />
          );
        })}
      </svg>

      {/* Tooltip */}
      {tooltip && (
        <div style={{
          position: "absolute", left: tooltip.x + 10, top: tooltip.y - 50,
          background: "var(--bg1)", border: "0.5px solid var(--brd)",
          borderRadius: 6, padding: "10px 14px", fontSize: 16,
          pointerEvents: "none", whiteSpace: "nowrap",
          boxShadow: "0 2px 8px rgba(0,0,0,0.18)", zIndex: 20,
        }}>
          <div style={{ fontWeight: 600, marginBottom: 2 }}>{tooltip.st.station_id}</div>
          {executive ? (
            <>
              <div>Beneficio est.: <strong>${(tooltip.st.benefitK ?? 0).toFixed(0)}K</strong>/verano</div>
              <div>Mejora: <strong>{(tooltip.st.improvement ?? 0).toFixed(1)}%</strong></div>
              <div style={{ color: "var(--txt2)" }}>
                Error {tooltip.st.mae_bench.toFixed(1)}% → {tooltip.st.mae_model.toFixed(1)}%
              </div>
            </>
          ) : (
            <>
              <div>|Error| corregido: <strong>{tooltip.st.mae_model.toFixed(2)}%</strong></div>
              <div>|Error| original:&nbsp;&nbsp;&nbsp; <strong>{tooltip.st.mae_bench.toFixed(2)}%</strong></div>
              <div style={{ color: "var(--txt2)" }}>Mejora: {(tooltip.st.improvement ?? 0).toFixed(1)}%</div>
            </>
          )}
        </div>
      )}

      {/* Leyenda */}
      <div style={{
        position: "absolute", bottom: 8, right: 10,
        background: "var(--bg1)", border: "0.5px solid var(--brd)",
        borderRadius: 6, padding: "8px 12px", fontSize: 15, color: "var(--txt2)",
      }}>
        <div style={{ marginBottom: 3, fontWeight: 500 }}>
          {executive ? "Beneficio est. / verano" : "|Error| corregido"}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span>{executive ? `$${Math.round(minBenefit)}K` : `${minMae.toFixed(1)}%`}</span>
          <div style={{
            width: 64, height: 8, borderRadius: 4,
            background: executive
              ? "linear-gradient(to right, hsl(92,58%,86%), hsl(112,74%,56%), hsl(130,88%,28%))"
              : "linear-gradient(to right, #000, #ff0000, #ffff00)",
          }} />
          <span>{executive ? `$${Math.round(maxBenefit)}K` : `${maxMae.toFixed(1)}%`}</span>
        </div>
      </div>
    </div>
  );
}

// ─── App principal ─────────────────────────────────────────────────────────────
export default function App() {
  const [profile, setProfile] = useState("ejecutivo");
  const [model, setModel] = useState("tuneado");
  const [models, setModels] = useState([]);
  const [metrics, setMetrics] = useState(null);
  const [evolution, setEvolution] = useState([]);
  const [shap, setShap] = useState([]);
  const [scatter, setScatter] = useState([]);
  const [hourly, setHourly] = useState([]);
  const [stationMae, setStationMae] = useState([]);
  const [errorMetrics, setErrorMetrics] = useState(null);
  const [improvement, setImprovement] = useState([]);
  const [modelComparison, setModelComparison] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [modelLoading, setModelLoading] = useState(false);

  // Datos estáticos (no dependen del modelo seleccionado)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        await api.health();
        const [mList, evo, cmp] = await Promise.all([
          api.models(),
          api.evolution(),
          api.modelComparison(),
        ]);
        if (cancelled) return;
        setModels(mList.models || []);
        setEvolution(evo.evolution || []);
        setModelComparison(cmp.models || []);
      } catch (e) {
        console.error(e);
        if (!cancelled) {
          setError(LOAD_ERROR);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Datos del modelo activo — se recargan al cambiar modelo
  const loadModelData = useCallback(async () => {
    setModelLoading(true);
    setError(null);
    try {
      const [met, sh, sc, hr, sm, em, imp] = await Promise.all([
        api.metrics(model),
        api.shap(model),
        api.scatter(model),
        api.hourly(model),
        api.stationMae(model),
        api.errorMetrics(model),
        api.improvement(model),
      ]);
      setMetrics(met);
      setShap(sh.features || []);
      setScatter(sc.points || []);
      setHourly(hr.hourly || []);
      setStationMae(sm.stations || []);
      setErrorMetrics(em);
      setImprovement(imp.stations || []);
    } catch (e) {
      console.error(e);
      setError(LOAD_ERROR);
    } finally {
      setModelLoading(false);
    }
  }, [model]);

  useEffect(() => {
    if (!loading) loadModelData();
  }, [model, loading, loadModelData]);

  const modelLabel = models.find((m) => m.id === model)?.label ?? model;

  // ── Perfil ejecutivo: narrativa de negocio ─────────────────────────────────
  const exec = metrics
    ? buildExecutiveNarrative({ metrics, errorMetrics, improvement, stationMae })
    : null;

  const execKpiColor = {
    corrected: C.corrected,
    accent: C.accent,
    neutral: C.neutral,
  };

  const purchaseCostChart = exec ? {
    labels: exec.purchaseCost.labels,
    datasets: [
      {
        label: "Sin corrección",
        data: exec.purchaseCost.without,
        borderColor: C.baseline,
        backgroundColor: C.baselineA(0.12),
        fill: false,
        tension: 0.3,
        pointRadius: 4,
      },
      {
        label: "Con corrección",
        data: exec.purchaseCost.withCorrection,
        borderColor: C.corrected,
        backgroundColor: C.correctedA(0.2),
        fill: "-1",
        tension: 0.3,
        pointRadius: 4,
      },
    ],
  } : null;

  const scenarioChart = exec ? {
    labels: exec.scenarios.map((s) => s.label),
    datasets: [
      {
        label: "Sin corrección",
        data: exec.scenarios.map((s) => s.without),
        backgroundColor: C.baselineA(0.8),
        borderRadius: 4,
      },
      {
        label: "Con corrección",
        data: exec.scenarios.map((s) => s.with),
        backgroundColor: C.correctedA(0.8),
        borderRadius: 4,
      },
    ],
  } : null;

  const paybackChart = exec ? {
    labels: exec.payback.months.map((m) => (m === 0 ? "Impl." : `M${m}`)),
    datasets: [
      {
        label: "Sin corrección",
        data: exec.payback.baseline,
        borderColor: C.muted,
        borderDash: [5, 4],
        pointRadius: 0,
        tension: 0,
      },
      {
        label: "Con corrección (acum.)",
        data: exec.payback.corrected,
        borderColor: C.corrected,
        backgroundColor: C.correctedA(0.08),
        fill: true,
        tension: 0.25,
        pointRadius: 4,
      },
    ],
  } : null;

  // ── Evolución del MAE entre modelos ─────────────────────────────────────────
  const evoChart = {
    labels: evolution.map((e) => e.label),
    datasets: [{
      data: evolution.map((e) => e.mae),
      backgroundColor: evolution.map((e) =>
        (e.model === model ? C.corrected : C.neutralA(0.38))
      ),
      borderColor: evolution.map((e) =>
        (e.model === model ? C.correctedShade : C.neutralA(0.55))
      ),
      borderWidth: evolution.map((e) => (e.model === model ? 2 : 1)),
      borderRadius: 4,
    }],
  };
  const evoOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          title: (items) => evolution[items[0]?.dataIndex]?.label ?? "",
          label: (ctx) => ` MAE: ${ctx.raw.toFixed(2)}%HR`,
          afterLabel: (ctx) => {
            const row = evolution[ctx.dataIndex];
            if (!row) return "";
            return row.model === model ? "Modelo activo · clic para cambiar" : "Clic para seleccionar";
          },
        },
      },
    },
    scales: {
      x: { ticks: { font: CHART_FONT, maxRotation: 25, minRotation: 25 } },
      y: { min: 0, max: 8, ticks: { font: CHART_FONT }, title: { ...CHART_TITLE, text: "MAE (%HR)" } },
    },
    onClick: (_e, els) => { if (els.length && evolution[els[0].index]) setModel(evolution[els[0].index].model); },
    onHover: (e, els) => { e.native.target.style.cursor = els.length ? "pointer" : "default"; },
  };

  // ── Ciclo diurno — bias con signo, cambia por modelo ─────────────────────
  const hourlyChart = {
    labels: hourly.map((h) => h.hora),
    datasets: [
      {
        label: "Pronóstico original (obs − fcst)",
        data: hourly.map((h) => h.error_humedad),
        borderColor: C.baseline,
        backgroundColor: C.baselineA(0.08),
        tension: 0.3, pointRadius: 3, pointBackgroundColor: C.baseline, fill: false,
      },
      {
        label: "Pronóstico corregido (obs − fcst_corr)",
        data: hourly.map((h) => h.error_compensado),
        borderColor: C.corrected,
        backgroundColor: C.correctedA(0.08),
        tension: 0.3, pointRadius: 3, pointBackgroundColor: C.corrected, fill: false,
      },
      {
        label: "Sin sesgo (ideal)",
        data: hourly.map(() => 0),
        borderColor: C.neutral, borderWidth: 1.5,
        borderDash: [6, 4], pointRadius: 0, fill: false,
      },
    ],
  };
  const hourlyOptions = {
    responsive: true, maintainAspectRatio: false,
    plugins: {
      legend: { display: true, position: "bottom",
        labels: { font: CHART_FONT, usePointStyle: true, pointStyleWidth: 24, padding: 16 }},
      tooltip: { callbacks: {
        label: (ctx) => ` ${ctx.dataset.label}: ${Number(ctx.raw) >= 0 ? "+" : ""}${Number(ctx.raw).toFixed(2)}%`,
      }},
    },
    scales: {
      x: { ticks: { font: CHART_FONT }, title: { ...CHART_TITLE, text: "Hora del Día (UTC)" } },
      y: {
        ticks: { font: CHART_FONT },
        title: { ...CHART_TITLE, text: "Error medio / Sesgo (% HR)" },
        grid: {
          color: (ctx) => ctx.tick.value === 0 ? C.neutralA(0.45) : GRID,
          lineWidth: (ctx) => ctx.tick.value === 0 ? 2 : 1,
        },
      },
    },
  };

  // ── SHAP (top features) ───────────────────────────────────────────────────
  const topShap = [...shap].sort((a, b) => b.importance - a.importance).slice(0, TOP_SHAP);
  const shapChart = {
    labels: topShap.map((d) => featureLabel(d.feature)),
    datasets: [{
      data: topShap.map((d) => d.importance),
      backgroundColor: C.correctedA(0.65),
      borderRadius: 3,
    }],
  };

  const chartFit = { responsive: true, maintainAspectRatio: false };
  const legendBottom = { position: "bottom", labels: { font: CHART_FONT } };

  // ── Gráficos técnicos (distintos al ejecutivo) ────────────────────────────
  const folds = metrics?.folds || [];
  const foldBenchModelChart = {
    labels: folds.map((f) => `Fold ${f.fold}`),
    datasets: [
      {
        label: "MAE benchmark",
        data: folds.map((f) => f.mae_bench),
        backgroundColor: C.baselineA(0.75),
        borderRadius: 4,
      },
      {
        label: "MAE modelo",
        data: folds.map((f) => f.mae_cat),
        backgroundColor: C.correctedA(0.75),
        borderRadius: 4,
      },
    ],
  };
  const foldBenchModelOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: legendBottom,
      tooltip: {
        callbacks: {
          afterBody: (items) => {
            const f = folds[items[0]?.dataIndex];
            if (!f) return [];
            return [
              `Mejora: ${f.mejora.toFixed(1)}%`,
              `n test: ${f.n_test?.toLocaleString?.() ?? f.n_test}`,
              `σ test: ${f.std_test?.toFixed?.(2) ?? f.std_test} %HR`,
              `Best iter: ${f.best_iter}`,
            ];
          },
        },
      },
    },
    scales: {
      x: { ticks: { font: CHART_FONT } },
      y: {
        beginAtZero: true,
        ticks: { font: CHART_FONT },
        title: { ...CHART_TITLE, text: "MAE (%HR)" },
        grid: { color: GRID },
      },
    },
  };

  const calBins = buildObsBins(scatter);
  const calibrationChart = {
    labels: calBins.map((b) => `${b.lo}–${b.hi}`),
    datasets: [
      {
        label: "Referencia 1:1",
        data: calBins.map((b) => meanField(b.inBin, "obs")),
        borderColor: shade(HUE.muted, 12, 42),
        borderDash: [6, 4],
        borderWidth: 1.5,
        pointRadius: 0,
        tension: 0,
        fill: false,
      },
      {
        label: "Pronóstico original",
        data: calBins.map((b) => meanField(b.inBin, "fcst_original")),
        borderColor: C.baseline,
        backgroundColor: C.baselineA(0.08),
        pointRadius: 5,
        pointBackgroundColor: C.baseline,
        tension: 0.25,
        fill: false,
      },
      {
        label: "Pronóstico corregido",
        data: calBins.map((b) => meanField(b.inBin, "fcst_compensado")),
        borderColor: C.corrected,
        backgroundColor: C.correctedA(0.08),
        pointRadius: 5,
        pointBackgroundColor: C.corrected,
        tension: 0.25,
        fill: false,
      },
    ],
  };
  const calibrationOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: legendBottom,
      tooltip: {
        callbacks: {
          title: (items) => {
            const b = calBins[items[0]?.dataIndex];
            return b ? `HR observada ${b.lo}–${b.hi}% (n=${b.inBin.length})` : "";
          },
          label: (ctx) => {
            const b = calBins[ctx.dataIndex];
            if (!b) return "";
            const obs = meanField(b.inBin, "obs");
            if (ctx.dataset.label === "Referencia 1:1") {
              return ` Referencia: ${obs.toFixed(1)} %HR`;
            }
            const fcst = ctx.raw;
            const err = fcst - obs;
            return [
              ` Pronóstico medio: ${fcst.toFixed(1)} %HR`,
              ` Sesgo: ${err >= 0 ? "+" : ""}${err.toFixed(2)} %HR`,
            ];
          },
        },
      },
    },
    scales: {
      x: { ticks: { font: CHART_FONT }, title: { ...CHART_TITLE, text: "Rango HR observada (%)" } },
      y: {
        min: 0,
        max: 100,
        ticks: { font: CHART_FONT },
        title: { ...CHART_TITLE, text: "HR pronosticada media (%)" },
        grid: { color: GRID },
      },
    },
  };

  const pctLevels = [50, 75, 90, 95];
  const origErrSorted = absErrorsSorted(scatter, "fcst_original");
  const corrErrSorted = absErrorsSorted(scatter, "fcst_compensado");
  const percentilesChart = {
    labels: pctLevels.map((p) => `P${p}`),
    datasets: [
      {
        label: "Pronóstico original",
        data: pctLevels.map((p) => percentile(origErrSorted, p)),
        backgroundColor: C.baselineA(0.75),
        borderRadius: 4,
      },
      {
        label: "Pronóstico corregido",
        data: pctLevels.map((p) => percentile(corrErrSorted, p)),
        backgroundColor: C.correctedA(0.75),
        borderRadius: 4,
      },
    ],
  };
  const percentilesOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: legendBottom,
      tooltip: {
        callbacks: {
          label: (ctx) => ` |error|: ${ctx.raw.toFixed(2)} %HR`,
        },
      },
    },
    scales: {
      x: { ticks: { font: CHART_FONT } },
      y: {
        beginAtZero: true,
        ticks: { font: CHART_FONT },
        title: { ...CHART_TITLE, text: "|Error| (%HR)" },
        grid: { color: GRID },
      },
    },
  };

  const regionKeys = ["coastal", "inland"];
  const regionStats = regionKeys.map((key) => {
    const vals = improvement
      .filter((s) => s.region === key)
      .map((s) => s.improvement)
      .sort((a, b) => a - b);
    return {
      key,
      label: REGION_LABEL[key],
      count: vals.length,
      mean: vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0,
      median: percentile(vals, 50),
      p25: percentile(vals, 25),
      p75: percentile(vals, 75),
      min: vals[0] ?? 0,
      max: vals[vals.length - 1] ?? 0,
    };
  });
  const regionStripChart = {
    datasets: [
      {
        label: "Costera",
        data: improvement
          .filter((s) => s.region === "coastal")
          .map((s) => ({
            x: REGION_X.coastal + stationJitter(s.station_id),
            y: s.improvement,
            station: s.station_id,
          })),
        backgroundColor: C.neutralA(0.55),
        borderColor: C.neutralA(0.2),
        pointRadius: 4,
      },
      {
        label: "Interior",
        data: improvement
          .filter((s) => s.region === "inland")
          .map((s) => ({
            x: REGION_X.inland + stationJitter(s.station_id),
            y: s.improvement,
            station: s.station_id,
          })),
        backgroundColor: C.accentA(0.55),
        borderColor: C.accentA(0.2),
        pointRadius: 4,
      },
    ],
  };
  const regionStripOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: legendBottom,
      regionBox: { stats: regionStats },
      tooltip: {
        callbacks: {
          title: (items) => items[0]?.raw?.station ?? "",
          label: (ctx) => ` Mejora: ${ctx.raw.y.toFixed(1)}%`,
          afterLabel: (ctx) => {
            const r = regionStats.find((s) => s.key === (ctx.dataset.label === "Costera" ? "coastal" : "inland"));
            return r ? ` Media región: ${r.mean.toFixed(1)}% · n=${r.count}` : "";
          },
        },
      },
    },
    scales: {
      x: {
        min: 0.4,
        max: 2.6,
        ticks: {
          font: CHART_FONT,
          callback: (v) => (v === 1 ? "Costera" : v === 2 ? "Interior" : ""),
        },
        grid: { display: false },
      },
      y: {
        beginAtZero: true,
        ticks: { font: CHART_FONT, callback: (v) => `${v}%` },
        title: { ...CHART_TITLE, text: "Mejora (%)" },
        grid: { color: GRID },
      },
    },
  };

  const hourlyMaeChart = {
    labels: hourly.map((h) => h.hora),
    datasets: [
      {
        label: "MAE benchmark",
        data: hourly.map((h) => h.mae_bench),
        borderColor: C.baseline,
        backgroundColor: C.baselineA(0.1),
        tension: 0.3,
        pointRadius: 2,
        fill: true,
      },
      {
        label: "MAE modelo",
        data: hourly.map((h) => h.mae_model),
        borderColor: C.corrected,
        backgroundColor: C.correctedA(0.1),
        tension: 0.3,
        pointRadius: 2,
        fill: true,
      },
    ],
  };

  const topImprovement = improvement.slice(0, 12);
  const maxImpSt = Math.max(...topImprovement.map((s) => s.improvement), 1);
  const improvementChart = {
    labels: topImprovement.map((s) => s.station_id),
    datasets: [{
      label: "Mejora %",
      data: topImprovement.map((s) => s.improvement),
      backgroundColor: topImprovement.map((s) => quant(HUE.neutral, s.improvement / maxImpSt)),
      borderRadius: 3,
    }],
  };

  const modelCmpChart = {
    labels: modelComparison.map((m) => m.label.split(" ").slice(0, 2).join(" ")),
    datasets: [
      {
        label: "MAE (%HR)",
        data: modelComparison.map((m) => m.mae),
        backgroundColor: C.baselineA(0.75),
        borderRadius: 4,
      },
      {
        label: "RMSE (%HR)",
        data: modelComparison.map((m) => m.rmse),
        backgroundColor: C.neutralA(0.75),
        borderRadius: 4,
      },
    ],
  };


  // ── Histograma de error residual (obs − pronóstico) ───────────────────────
  const hist = buildResidualHistogram(scatter);
  const residualChart = {
    labels: hist.labels,
    datasets: [
      {
        label: "Pronóstico original",
        data: hist.orig,
        backgroundColor: C.baselineA(0.55),
        borderColor: "transparent",
        borderWidth: 0,
        order: 2,
      },
      {
        label: "Pronóstico corregido",
        data: hist.corr,
        backgroundColor: C.correctedA(0.55),
        borderColor: "transparent",
        borderWidth: 0,
        order: 1,
      },
    ],
  };
  const residualOptions = {
    responsive: true,
    maintainAspectRatio: false,
    datasets: { bar: { grouped: false, barPercentage: 1, categoryPercentage: 1 } },
    plugins: {
      legend: { display: true, position: "bottom", labels: { font: CHART_FONT, usePointStyle: true } },
      tooltip: {
        titleFont: CHART_FONT,
        bodyFont: CHART_FONT,
        callbacks: {
          title: (items) => {
            const idx = items[0]?.dataIndex ?? 0;
            const c = hist.centers[idx];
            const half = hist.binSize / 2;
            return `Error ${(c - half).toFixed(0)} a ${(c + half).toFixed(0)} %HR`;
          },
        },
      },
      residualZeroLine: { centers: hist.centers },
    },
    scales: {
      x: {
        ticks: {
          font: CHART_FONT,
          maxRotation: 0,
          autoSkip: false,
          callback: (_v, i) => {
            const c = hist.centers[i];
            const mark = Math.round(c / 20) * 20;
            return Math.abs(c - mark) < hist.binSize / 2 ? mark : "";
          },
        },
        title: { ...CHART_TITLE, text: "Error residual" },
        grid: { display: true, color: GRID },
      },
      y: {
        beginAtZero: true,
        ticks: { font: CHART_FONT },
        title: { ...CHART_TITLE, text: "Frecuencia" },
        grid: { color: GRID },
      },
    },
  };

  const chartOpts = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: false } },
    scales: {
      x: { ticks: { font: CHART_FONT } },
      y: { ticks: { font: CHART_FONT } },
    },
  };

  const foldsChart = {
    labels: folds.map((f) => `Fold ${f.fold}`),
    datasets: [
      { label: "Original", data: folds.map((f) => f.mae_hum_orig), backgroundColor: C.baselineA(0.75) },
      { label: "Corregido", data: folds.map((f) => f.mae_hum_comp), backgroundColor: C.correctedA(0.75) },
    ],
  };

  const axis = {
    x: { ticks: { font: CHART_FONT } },
    y: { ticks: { font: CHART_FONT } },
  };

  return (
    <div className="app">
      <header className="header">
        <div>
          <h1>Corrección de pronóstico de humedad relativa</h1>
          <p>CatBoost v5 · Walk-forward (5 folds) · 500+ estaciones · Oct 2025 – May 2026</p>
        </div>
        <div className="header-controls">
          <select value={model} onChange={(e) => setModel(e.target.value)} disabled={loading}>
            {(models.length ? models : [{ id: "tuneado", label: "Cargando…" }]).map((m) => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </select>
        </div>
      </header>

      <div className="profile-tabs">
        <button
          type="button"
          className={`profile-tab${profile === "ejecutivo" ? " active" : ""}`}
          onClick={() => setProfile("ejecutivo")}
        >
          Perfil ejecutivo
          <small>PM · Stakeholder</small>
        </button>
        <button
          type="button"
          className={`profile-tab${profile === "tecnico" ? " active" : ""}`}
          onClick={() => setProfile("tecnico")}
        >
          Perfil técnico
          <small>DE · DA · MLE · Académico</small>
        </button>
      </div>

      {error && (
        <div className="banner-error">
          {error}
          {!isStaticData && (
            <>
              {" "}— luego abrí <a href="http://localhost:5173">localhost:5173</a> (dev) o{" "}
              <a href="http://localhost:5000">localhost:5000</a> (con build).
            </>
          )}
        </div>
      )}

      {/* ═══ PERFIL EJECUTIVO — impacto de negocio ═══════════════════════════ */}
      {profile === "ejecutivo" && exec && (
        <div className={`dashboard-grid${modelLoading ? " is-updating" : ""}`}>
          <div className="grid-thirds">
            <div className="exec-banner span-3">
              <div className="exec-banner-title">{exec.banner.headline}</div>
              <p className="exec-banner-sub">{exec.banner.sub}</p>
            </div>

            <div className="grid-kpi-exec span-3">
              {exec.kpis.map((k) => (
                <div className="card kpi kpi-exec" key={k.lbl}>
                  <div className="kpi-accent" style={{ background: execKpiColor[k.col] }} />
                  <div className="kpi-label">{k.lbl}</div>
                  <div className="kpi-value">{k.val}</div>
                  <div className="kpi-sub">{k.sub}</div>
                  <div className="kpi-badge">{k.badge}</div>
                </div>
              ))}
            </div>

            <div className="card focal span-3">
              <div className="card-title">Costo de compra de energía — sin vs con corrección</div>
              <p className="card-hint">Área entre líneas = ahorro estimado · Escala conservadora para distribuidora mediana del Noreste</p>
              <ChartPanel wide>
                <Line
                  key={model}
                  data={purchaseCostChart}
                  options={{
                    ...chartFit,
                    plugins: { legend: legendBottom },
                    scales: {
                      x: { ...axis.x, title: { ...CHART_TITLE, text: "Humedad pronosticada (%HR)" } },
                      y: { ...axis.y, beginAtZero: false, title: { ...CHART_TITLE, text: "Costo de compra ($/MWh)" }, grid: { color: GRID } },
                    },
                  }}
                />
              </ChartPanel>
            </div>

            <div className="card">
              <div className="card-title">Escenarios de pico — costo del error</div>
              <ChartPanel>
                <Bar
                  key={model}
                  data={scenarioChart}
                  options={{
                    ...chartFit,
                    plugins: { legend: legendBottom },
                    scales: {
                      x: { ticks: { font: CHART_FONT } },
                      y: { beginAtZero: true, ticks: { font: CHART_FONT, callback: (v) => `$${v}M` }, title: { ...CHART_TITLE, text: "Costo ($M)" }, grid: { color: GRID } },
                    },
                  }}
                />
              </ChartPanel>
            </div>

            <div className="card focal-secondary">
              <div className="card-title">Payback period — ROI acumulado</div>
              <ChartPanel>
                <Line
                  key={model}
                  data={paybackChart}
                  options={{
                    ...chartFit,
                    plugins: {
                      legend: legendBottom,
                      breakevenLine: { breakevenMonth: exec.payback.breakevenMonth },
                    },
                    scales: {
                      x: { ticks: { font: CHART_FONT, maxRotation: 45 } },
                      y: {
                        ticks: { font: CHART_FONT, callback: (v) => `$${v}M` },
                        title: { ...CHART_TITLE, text: "Beneficio acumulado ($M)" },
                        grid: { color: GRID },
                      },
                    },
                  }}
                  plugins={[breakevenPlugin]}
                />
              </ChartPanel>
            </div>

            <div className="card span-3">
              <div className="card-title">Cobertura geográfica — {exec.mapStations.length}+ estaciones mejoradas</div>
              <p className="card-hint">Verde = mayor beneficio estimado por estación · La mejora no se concentra en una sola región</p>
              <div className="map-chart-fill map-chart-exec">
                <StationMap key={model} stations={exec.mapStations} mode="executive" />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ═══ PERFIL TÉCNICO — validación e interpretabilidad ═════════════════ */}
      {profile === "tecnico" && (
        <div className={`dashboard-grid${modelLoading ? " is-updating" : ""}`}>
          <div className="grid-thirds">
            {/* 1 — Panorama: todas las variantes */}
            <div className="card focal span-3">
              <div className="card-title">Comparación MAE y RMSE — variantes</div>
              <ChartPanel wide>
                <Bar
                  data={modelCmpChart}
                  options={{
                    ...chartFit,
                    plugins: { legend: legendBottom },
                    scales: {
                      ...axis,
                      y: { ...axis.y, title: { ...CHART_TITLE, text: "%HR" } },
                    },
                  }}
                />
              </ChartPanel>
            </div>

            {/* 2 — Validación: folds, hora y estaciones */}
            <div className="card">
              <div className="card-title">Walk-forward — MAE benchmark vs modelo — {modelLabel}</div>
              <ChartPanel>
                <Bar
                  key={model}
                  data={foldBenchModelChart}
                  options={{ ...foldBenchModelOptions, ...chartFit }}
                />
              </ChartPanel>
            </div>

            <div className="card">
              <div className="card-title">MAE absoluto por hora — {modelLabel}</div>
              <ChartPanel>
                <Line
                  key={model}
                  data={hourlyMaeChart}
                  options={{
                    ...chartFit,
                    plugins: { legend: legendBottom },
                    scales: {
                      x: { ...axis.x, title: { ...CHART_TITLE, text: "Hora UTC" } },
                      y: { ...axis.y, title: { ...CHART_TITLE, text: "MAE (%HR)" } },
                    },
                  }}
                />
              </ChartPanel>
            </div>

            <div className="card">
              <div className="card-title">Top 12 estaciones — mejora % — {modelLabel}</div>
              <ChartPanel>
                <Bar
                  key={model}
                  data={improvementChart}
                  options={{
                    ...chartFit,
                    indexAxis: "y",
                    plugins: { legend: { display: false } },
                    scales: {
                      x: { ...axis.x, title: { ...CHART_TITLE, text: "Mejora (%)" } },
                      y: { ticks: { font: CHART_FONT } },
                    },
                  }}
                />
              </ChartPanel>
            </div>

            {/* 3 — Calidad del pronóstico (3 columnas) */}
            <div className="card">
              <div className="card-title">Calibración — HR observada vs pronóstico medio — {modelLabel}</div>
              <ChartPanel>
                <Line
                  key={model}
                  data={calibrationChart}
                  options={{ ...calibrationOptions, ...chartFit }}
                />
              </ChartPanel>
            </div>

            <div className="card focal-secondary">
              <div className="card-title">Percentiles de |error| — {modelLabel}</div>
              <ChartPanel>
                <Bar
                  key={model}
                  data={percentilesChart}
                  options={{ ...percentilesOptions, ...chartFit }}
                />
              </ChartPanel>
            </div>

            <div className="card">
              <div className="card-title">Mejora % por región — distribución por estación — {modelLabel}</div>
              <ChartPanel>
                <Scatter
                  key={model}
                  data={regionStripChart}
                  options={{ ...regionStripOptions, ...chartFit }}
                  plugins={[regionBoxPlugin]}
                />
              </ChartPanel>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
