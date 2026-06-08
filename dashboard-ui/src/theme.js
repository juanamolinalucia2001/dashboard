/**
 * Sistema de color para el dashboard:
 * - Hue (matiz): categorías cualitativas
 * - Saturation / Lightness: magnitud cuantitativa
 * - Tint: fondos (más blanco) · Shade: énfasis (más negro)
 */

export const HUE = {
  baseline: 4,     // pronóstico original / benchmark
  corrected: 128,    // pronóstico corregido / modelo
  neutral: 214,      // referencia / ideal / secundario
  accent: 172,       // mejora / progreso
  warn: 36,          // alerta moderada
  muted: 40,         // neutro cálido
};

export function hsl(h, s, l, a) {
  return a != null ? `hsla(${h}, ${s}%, ${l}%, ${a})` : `hsl(${h}, ${s}%, ${l}%)`;
}

/** Categoría cualitativa — color pleno */
export function cat(hue, s = 55, l = 44) {
  return hsl(hue, s, l);
}

/** Tint — fondos suaves */
export function tint(hue, s = 38, l = 93) {
  return hsl(hue, s, l);
}

/** Shade — bordes y texto sobre tint */
export function shade(hue, s = 58, l = 30) {
  return hsl(hue, s, l);
}

/** Cuantitativo — sat/light según valor normalizado 0–1 */
export function quant(hue, t, { sMin = 32, sMax = 78, lMin = 68, lMax = 34 } = {}) {
  const v = Math.max(0, Math.min(1, t));
  return hsl(hue, sMin + v * (sMax - sMin), lMin - v * (lMin - lMax));
}

export const C = {
  baseline: cat(HUE.baseline, 72, 52),
  baselineTint: tint(HUE.baseline),
  baselineShade: shade(HUE.baseline),
  baselineA: (a) => hsl(HUE.baseline, 72, 52, a),

  corrected: cat(HUE.corrected, 52, 38),
  correctedTint: tint(HUE.corrected),
  correctedShade: shade(HUE.corrected),
  correctedA: (a) => hsl(HUE.corrected, 52, 38, a),

  neutral: cat(HUE.neutral, 70, 54),
  neutralTint: tint(HUE.neutral),
  neutralA: (a) => hsl(HUE.neutral, 70, 54, a),

  accent: cat(HUE.accent, 48, 46),
  accentTint: tint(HUE.accent),
  accentA: (a) => hsl(HUE.accent, 48, 46, a),

  warn: cat(HUE.warn, 82, 52),
  warnTint: tint(HUE.warn),
  warnA: (a) => hsl(HUE.warn, 82, 52, a),

  muted: cat(HUE.muted, 8, 52),
  mutedTint: tint(HUE.muted, 6, 94),
};

/** Progresión de matiz para evolución de modelos (benchmark → final) */
export const EVO_HUES = [HUE.muted, HUE.neutral, HUE.accent, 145, HUE.corrected];

export function evoColor(index, active = false) {
  const h = EVO_HUES[index] ?? HUE.corrected;
  return active ? cat(h, 58, 42) : hsl(h, 42, 58, 0.55);
}
