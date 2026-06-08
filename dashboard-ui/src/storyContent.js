/** Etiquetas legibles para features SHAP */
export const FEATURE_LABELS = {
  error_humedad_lag1: "Error HR h−1",
  fcst_relative_humidity_pct: "HR pronosticada",
  error_humedad_lag24: "Error HR h−24",
  "hora_sin/hora_cos": "Hora del día",
  obs_temperature_celsius: "Temperatura obs.",
  station_id: "Estación",
  dia_anio: "Día del año",
  obs_sea_level_pressure: "Presión nivel mar",
  obs_wind_speed_ms: "Velocidad viento",
  "latitude/longitude": "Ubicación",
};

export function featureLabel(name) {
  return FEATURE_LABELS[name] || name;
}
