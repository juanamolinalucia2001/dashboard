const API_BASE = import.meta.env.VITE_API_URL || "";

async function get(path) {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) {
    throw new Error(`API ${path}: ${res.status}`);
  }
  return res.json();
}

export const api = {
  health: () => get("/api/health"),
  models: () => get("/api/models"),
  metrics: (model) => get(`/api/metrics?model=${encodeURIComponent(model)}`),
  shap: (model) => get(`/api/shap?model=${encodeURIComponent(model)}`),
  scatter: (model) => get(`/api/scatter?model=${encodeURIComponent(model)}`),
  improvement: (model) => get(`/api/improvement?model=${encodeURIComponent(model)}`),
  evolution: () => get("/api/evolution"),
  hourly: (model) => get(`/api/hourly?model=${encodeURIComponent(model)}`),
};
