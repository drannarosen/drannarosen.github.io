/*
 * viz/histogram.ts — draw the IMF: sampled bars against the analytic Maschberger
 * law (line), log–log (Layer 2). Two forms (Anna's toggle):
 *   "dNdM"   — ξ(m) = dN/dM, the textbook straight power-law line
 *   "perDex" — dN/dlog m, counts per dex (the turnover hump)
 * Dumb: consumes an IMFModel; the ragged, sparse high-mass bars straying from
 * the smooth line ARE the lesson. Axis titles are HTML KaTeX in the component;
 * tick labels are 10^x (shared drawPower), matching the H–R diagram.
 */
import type { IMFModel } from "../state/render.ts";
import { AXIS_FONT, drawPower } from "./axis.ts";

export type IMFForm = "dNdM" | "perDex";

export interface HistogramColors {
  bar: string;
  line: string;
  axis: string;
  grid: string;
  text: string;
}

const DEFAULTS: HistogramColors = {
  bar: "rgba(79,209,197,0.55)", // teal
  line: "rgba(244,114,182,0.95)", // rose
  axis: "rgba(230,232,238,0.5)",
  grid: "rgba(230,232,238,0.10)",
  text: "rgba(230,232,238,0.65)",
};

const MARGIN = { top: 14, right: 16, bottom: 30, left: 60 };
const MASS_TICKS = [-1, 0, 1, 2]; // log₁₀ m: 0.1, 1, 10, 100 M☉
const log10 = Math.log10;

export function renderHistogram(
  ctx: CanvasRenderingContext2D,
  model: IMFModel,
  w: number,
  h: number,
  opts: { colors?: Partial<HistogramColors>; form?: IMFForm } = {},
): void {
  const c = { ...DEFAULTS, ...opts.colors };
  const form = opts.form ?? "dNdM";
  const bins = model.bins;
  if (!bins.length) return;

  const lo = bins[0].logMlo;
  const hi = bins[bins.length - 1].logMhi;
  const plotW = w - MARGIN.left - MARGIN.right;
  const plotH = h - MARGIN.top - MARGIN.bottom;

  // Per-form values: dN/dM divides by the linear bin width (→ power-law line);
  // per-dex is the raw count (→ turnover hump).
  const dM = (b: (typeof bins)[number]) => 10 ** b.logMhi - 10 ** b.logMlo;
  const barV = (b: (typeof bins)[number]) => (form === "dNdM" ? b.count / dM(b) : b.count);
  const lineV = (b: (typeof bins)[number]) => (form === "dNdM" ? b.expected / dM(b) : b.expected);

  const positives = bins.flatMap((b) => [barV(b), lineV(b)]).filter((v) => v > 0);
  const vMax = Math.max(...positives, 1);
  const vMin = Math.min(...positives);
  const topDec = Math.ceil(log10(vMax));
  const botDec = Math.max(Math.floor(log10(vMin)), topDec - 6); // cap at 6 decades

  const x = (logM: number) => MARGIN.left + ((logM - lo) / (hi - lo)) * plotW;
  const y = (v: number) => {
    const t = (log10(Math.max(v, 10 ** botDec)) - botDec) / (topDec - botDec || 1);
    return MARGIN.top + (1 - t) * plotH;
  };
  const y0 = MARGIN.top + plotH;

  ctx.clearRect(0, 0, w, h);
  ctx.font = AXIS_FONT;
  ctx.textBaseline = "middle";

  // y gridlines + 10^n labels (every decade, or every other if many).
  const step = topDec - botDec > 6 ? 2 : 1;
  for (let n = botDec; n <= topDec; n += step) {
    const yy = y(10 ** n);
    ctx.strokeStyle = c.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(MARGIN.left, yy);
    ctx.lineTo(MARGIN.left + plotW, yy);
    ctx.stroke();
    drawPower(ctx, n, MARGIN.left - 5, yy, "right", c.text);
  }

  // Bars.
  ctx.fillStyle = c.bar;
  for (const b of bins) {
    const v = barV(b);
    if (v <= 0) continue;
    const bx = x(b.logMlo) + 0.5;
    const bw = Math.max(1, x(b.logMhi) - x(b.logMlo) - 1);
    const by = y(v);
    ctx.fillRect(bx, by, bw, y0 - by);
  }

  // Analytic Maschberger law.
  ctx.strokeStyle = c.line;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  bins.forEach((b, i) => {
    const px = x(b.logMc);
    const py = y(lineV(b));
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  });
  ctx.stroke();

  // Axis frame + mass 10^x labels (x).
  ctx.strokeStyle = c.axis;
  ctx.lineWidth = 1;
  ctx.strokeRect(MARGIN.left, MARGIN.top, plotW, plotH);
  for (const lm of MASS_TICKS) {
    if (lm < lo - 1e-9 || lm > hi + 1e-9) continue;
    drawPower(ctx, lm, x(lm), h - MARGIN.bottom + 16, "center", c.text);
  }
}
