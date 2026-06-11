import { staticApi } from "./dataService.js";

// Por defecto: datos embebidos (sin API). Solo usar fetch si definís VITE_API_URL.
const USE_REMOTE_API = Boolean(import.meta.env.VITE_API_URL);
const API_BASE = import.meta.env.VITE_API_URL || "";

async function get(path) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Cache-Control": "no-cache", "Pragma": "no-cache" },
  });
  if (res.status === 304) {
    const res2 = await fetch(`${API_BASE}${path}?_=${Date.now()}`);
    if (!res2.ok) throw new Error(`API ${path}: ${res2.status}`);
    return res2.json();
  }
  if (!res.ok) {
    throw new Error(`API ${path}: ${res.status}`);
  }
  return res.json();
}

const remoteApi = {
  health: async () => {
    const res = await fetch(`${API_BASE}/api/health`, {
      headers: { "Cache-Control": "no-cache" },
    });
    if (!res.ok && res.status !== 304) {
      throw new Error(`API /api/health: ${res.status}`);
    }
    return true;
  },
  models: () => get("/api/models"),
  metrics: (model) => get(`/api/metrics?model=${encodeURIComponent(model)}`),
  shap: (model) => get(`/api/shap?model=${encodeURIComponent(model)}`),
  scatter: (model) => get(`/api/scatter?model=${encodeURIComponent(model)}`),
  improvement: (model) => get(`/api/improvement?model=${encodeURIComponent(model)}`),
  evolution: () => get("/api/evolution"),
  hourly: (model) => get(`/api/hourly?model=${encodeURIComponent(model)}`),
  stationMae: (model) => get(`/api/station_mae?model=${encodeURIComponent(model)}`),
  errorMetrics: (model) => get(`/api/error_metrics?model=${encodeURIComponent(model)}`),
  modelComparison: () => get("/api/model_comparison"),
};

export const api = USE_REMOTE_API ? remoteApi : staticApi;
export const isStaticData = !USE_REMOTE_API;
