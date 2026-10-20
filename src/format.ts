// 24 distinct colors — cycle-safe for many collections.
const PALETTE = [
  "#e6194b", "#3cb44b", "#4363d8", "#f58231", "#911eb4",
  "#46f0f0", "#f032e6", "#bcf60c", "#fabebe", "#008080",
  "#e6beff", "#9a6324", "#fffac8", "#800000", "#aaffc3",
  "#808000", "#ffd8b1", "#000075", "#808080", "#f97316",
  "#0ea5e9", "#8b5cf6", "#10b981", "#ec4899",
];

export function colorFor(index: number): string {
  return PALETTE[index % PALETTE.length];
}

/** Per-track color: golden-angle HSL walk. Unlimited (no 24-cycle), so
 *  libraries with hundreds of tracks stay visually distinct, and adjacent
 *  tracks in the list always land far apart on the color wheel. */
export function trackColorFor(index: number): string {
  const hue = (index * 137.508) % 360;
  return `hsl(${hue.toFixed(1)}, 65%, 45%)`;
}

export function fmtDistance(km: number): string {
  return km < 10 ? `${km.toFixed(2)} km` : `${Math.round(km)} km`;
}

export function fmtGain(m: number | null): string {
  return m == null ? "—" : `${Math.round(m)} m D+`;
}

export function fmtDuration(s: number | null): string {
  if (s == null) return "—";
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  return h > 0 ? `${h}h${String(m).padStart(2, "0")}` : `${m} min`;
}
