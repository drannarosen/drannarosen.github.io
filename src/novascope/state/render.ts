/*
 * state/render.ts — the ONE physics→pixel mapping (Architecture §9.4).
 *
 * Selectors that turn latent stars + a view into a dumb "render model" the viz
 * layer draws without ever touching physics. Core and viz meet only here: this
 * module imports the star() contract (down into core) and emits plain numbers;
 * the canvas renderers import only these types. Keeping the mapping in one place
 * is what lets a backend swap (ZAMS → tracks) reach every renderer for free.
 */
import { star } from "../core/stellar/index.ts";
import type { LatentStar } from "../core/cluster/index.ts";
import type { ClusterView } from "./store.ts";

/* Fixed HR-diagram bounds, so the diagram does not rescale as you resample —
 * hot stars stay upper-left, faint dwarfs lower-right, run to run. */
export const HR_TEFF_RANGE: [number, number] = [2500, 50000]; // K (plotted reversed)
export const HR_LOGL_RANGE: [number, number] = [-3, 6.5]; // log10 L/L☉

const log10 = Math.log10;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Perceptual size from luminosity, normalized across the cluster's MS stars. */
function sizer(logLmin: number, logLmax: number, minPx: number, maxPx: number) {
  const span = logLmax - logLmin || 1;
  return (logL: number) =>
    minPx + (maxPx - minPx) * Math.pow(clamp((logL - logLmin) / span, 0, 1), 0.8);
}

export interface RenderStar {
  id: number;
  x: number; // pc (projected plane)
  y: number; // pc
  z: number; // pc (line of sight; for depth cues, never flattened away)
  color: [number, number, number];
  sizePx: number;
  alpha: number;
  isRemnant: boolean;
}

export interface RenderModel {
  stars: RenderStar[];
  /** Max projected radius (pc) — the renderer scales this to the canvas. */
  maxR: number;
}

/** Spatial projection of the cluster: positions + colour/size from star(t). */
export function toRenderModel(
  latent: LatentStar[],
  view: ClusterView,
  opts: { minPx?: number; maxPx?: number } = {},
): RenderModel {
  const minPx = opts.minPx ?? 0.6;
  const maxPx = opts.maxPx ?? 5;
  const states = latent.map((s) => star(s.mass, s.Z, view.t));

  const logLs = states.filter((s) => s.phase === "MS").map((s) => log10(s.L));
  const size = sizer(Math.min(...logLs), Math.max(...logLs), minPx, maxPx);

  // Scale to a high PERCENTILE radius, not the max: a Plummer sphere has a long
  // sparse tail, and letting one far star set the scale squashes the core to a
  // dot. The few beyond the 90th percentile simply render toward the edges.
  const radii = latent.map((s) => Math.hypot(s.x, s.y));
  const sorted = [...radii].sort((a, b) => a - b);
  const maxR = sorted[Math.floor(sorted.length * 0.9)] || 1e-6;

  const stars: RenderStar[] = latent.map((s, i) => {
    const st = states[i];
    const isRemnant = st.phase === "remnant";
    return {
      id: s.id,
      x: s.x,
      y: s.y,
      z: s.z,
      color: st.color,
      sizePx: isRemnant ? minPx : size(log10(st.L)),
      alpha: isRemnant ? 0.5 : 0.55 + 0.45 * clamp((log10(st.L) + 3) / 9, 0, 1),
      isRemnant,
    };
  });
  // Painter's order: faint/back first, bright/front last.
  stars.sort((a, b) => a.sizePx - b.sizePx);
  return { stars, maxR };
}

export interface HRPoint {
  id: number;
  logTeff: number;
  logL: number;
  color: [number, number, number];
  sizePx: number;
}

export interface HRModel {
  points: HRPoint[];
  teffRange: [number, number];
  logLRange: [number, number];
}

/** HR diagram: one point per living (MS) star; remnants leave the diagram. */
export function toHRModel(latent: LatentStar[], view: ClusterView): HRModel {
  const living = latent
    .map((s) => ({ s, st: star(s.mass, s.Z, view.t) }))
    .filter(({ st }) => st.phase === "MS" && st.L > 0 && st.Teff > 0);

  const logLs = living.map(({ st }) => log10(st.L));
  const size = sizer(Math.min(...logLs, 0), Math.max(...logLs, 0), 1.2, 6);

  const points: HRPoint[] = living.map(({ s, st }) => ({
    id: s.id,
    logTeff: log10(st.Teff),
    logL: log10(st.L),
    color: st.color,
    sizePx: size(log10(st.L)),
  }));
  return { points, teffRange: HR_TEFF_RANGE, logLRange: HR_LOGL_RANGE };
}
