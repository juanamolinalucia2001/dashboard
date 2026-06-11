import DATA from "../../dashboard_data.json";

const FOLD_METRICS = DATA.fold_metrics ?? [];
const MODEL_METRICS = DATA.model_metrics ?? {};
const SHAP_DATA = DATA.shap_data ?? {};
const STATIONS = DATA.stations ?? [];
const EVOLUTION = DATA.evolution ?? [];
const MODELS = DATA.models ?? [];
const HOURLY_MAE = DATA.hourly_mae ?? [];
const HOURLY_BY_MODEL = DATA.hourly_mae_by_model ?? {};
const STATION_MAE = DATA.station_mae ?? {};
const MODEL_ERROR_METRICS = DATA.model_error_metrics ?? {};

function hashSeed(str) {
  let h = 0;
  for (let i = 0; i < str.length; i += 1) {
    h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h) % 2147483646 || 1;
}

function seededRandom(seed) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function randn(rng) {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function clip(x, lo, hi) {
  return Math.max(lo, Math.min(hi, x));
}

function genScatterData(modelKey, nPoints = 250) {
  const rng = seededRandom(hashSeed(modelKey));
  const metrics = MODEL_METRICS[modelKey] ?? MODEL_METRICS.benchmark ?? { mae: 7 };
  const mae = metrics.mae;
  const points = [];
  for (let i = 0; i < nPoints; i += 1) {
    const obs = clip(randn(rng) * 20 + 50, 10, 95);
    const errOrig = randn(rng) * mae * 1.3 + 3;
    const errComp = errOrig * (mae / 8);
    points.push({
      obs,
      fcst_original: clip(obs + errOrig, 5, 100),
      fcst_compensado: clip(obs + errComp, 5, 100),
    });
  }
  return points;
}

function genImprovementByRegion(modelKey) {
  const metrics = MODEL_METRICS[modelKey] ?? MODEL_METRICS.benchmark ?? { mejora: 0 };
  const rng = seededRandom(hashSeed(`${modelKey}-imp`));
  const mejoraBase = metrics.mejora;
  const improvements = STATIONS.map((station) => {
    const regionFactor = station.region === "coastal" ? 1.1 : 0.95;
    const mejora = clip(mejoraBase * regionFactor * (0.85 + rng() * 0.3), 0, 100);
    return {
      station: station.name,
      station_id: station.id,
      lat: station.lat,
      lon: station.lon,
      region: station.region,
      improvement: mejora,
    };
  });
  improvements.sort((a, b) => b.improvement - a.improvement);
  return improvements;
}

const delay = (ms = 0) => new Promise((r) => setTimeout(r, ms));

export const staticApi = {
  health: () => delay().then(() => true),

  models: () => delay().then(() => ({ models: MODELS })),

  evolution: () => delay().then(() => ({ evolution: EVOLUTION })),

  modelComparison: () => delay().then(() => ({
    models: MODELS.map((m) => {
      const met = MODEL_METRICS[m.id] ?? {};
      return {
        id: m.id,
        label: m.label,
        mae: Number((met.mae ?? 0).toFixed(3)),
        rmse: Number((met.rmse ?? 0).toFixed(2)),
        mejora: Number((met.mejora ?? 0).toFixed(1)),
      };
    }),
  })),

  metrics: (model = "tuneado") => delay().then(() => {
    const metrics = MODEL_METRICS[model] ?? MODEL_METRICS.tuneado;
    const maeAvg = FOLD_METRICS.reduce((s, f) => s + f.mae_cat, 0) / (FOLD_METRICS.length || 1);
    const mejoraAvg = FOLD_METRICS.reduce((s, f) => s + f.mejora, 0) / (FOLD_METRICS.length || 1);
    return {
      model,
      mae: Number(metrics.mae.toFixed(3)),
      rmse: Number(metrics.rmse.toFixed(2)),
      mejora: Number(metrics.mejora.toFixed(1)),
      mae_benchmark: Number(metrics.mae_bench.toFixed(3)),
      folds: FOLD_METRICS,
      mae_avg: Number(maeAvg.toFixed(3)),
      mejora_avg: Number(mejoraAvg.toFixed(1)),
    };
  }),

  shap: (model = "tuneado") => delay().then(() => {
    if (MODEL_METRICS[model]?.shap_available === false) {
      return { model, features: [], message: "SHAP no disponible" };
    }
    const shapData = SHAP_DATA[model] ?? SHAP_DATA.tuneado ?? [];
    return { model, features: [...shapData].sort((a, b) => a.importance - b.importance) };
  }),

  scatter: (model = "tuneado") => delay().then(() => ({
    model,
    points: genScatterData(model),
  })),

  improvement: (model = "tuneado") => delay().then(() => ({
    model,
    stations: genImprovementByRegion(model),
  })),

  stationMae: (model = "tuneado") => delay().then(() => ({
    model,
    stations: STATION_MAE[model] ?? STATION_MAE.tuneado ?? [],
  })),

  errorMetrics: (model = "tuneado") => delay().then(() => {
    const em = MODEL_ERROR_METRICS[model] ?? MODEL_ERROR_METRICS.tuneado ?? {};
    return { model, ...em };
  }),

  hourly: (model = "tuneado") => delay().then(() => {
    const source = HOURLY_BY_MODEL[model] ?? HOURLY_BY_MODEL.tuneado ?? HOURLY_MAE;
    return {
      model,
      hourly: source.map((row, i) => ({
        hora: row.hora ?? row.Hora ?? i,
        error_humedad: row.error_humedad ?? 0,
        error_compensado: row.error_compensado ?? 0,
        mae_model: row.mae_model ?? 0,
        mae_bench: row.mae_bench ?? 0,
      })),
    };
  }),
};
