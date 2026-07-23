/*
 * viz/histogram.ts — draw the IMF: sampled counts (bars) against the analytic
 * Kroupa law (line), log–log (Layer 2). Dumb: consumes an IMFModel. The ragged,
 * sparse high-mass bars straying from the smooth line ARE the lesson.
 */
import type { IMFModel } from "../state/render.ts";

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
  grid: "rgba(230,232,238,0.09)",
  text: "rgba(230,232,238,0.65)",
};

const MARGIN = { top: 14, right: 14, bottom: 28, left: 44 };
const AXIS_FONT = "13px ui-monospace, SFMono-Regular, Menlo, monospace";
const FLOOR = 0.3; // y-axis floor (count) so sub-1 expectations still show
const log10 = Math.log10;

export function renderHistogram(
  ctx: CanvasRenderingContext2D,
  model: IMFModel,
  w: number,
  h: number,
  opts: { colors?: Partial<HistogramColors> } = {},
): void {
  const c = { ...DEFAULTS, ...opts.colors };
  const bins = model.bins;
  if (!bins.length) return;

  const lo = bins[0].logMlo;
  const hi = bins[bins.length - 1].logMhi;
  const plotW = w - MARGIN.left - MARGIN.right;
  const plotH = h - MARGIN.top - MARGIN.bottom;
  const topV = Math.max(10, model.maxCount);

  const x = (logM: number) => MARGIN.left + ((logM - lo) / (hi - lo)) * plotW;
  const y = (v: number) => {
    const t = (log10(Math.max(v, FLOOR)) - log10(FLOOR)) / (log10(topV) - log10(FLOOR));
    return MARGIN.top + (1 - t) * plotH;
  };
  const y0 = MARGIN.top + plotH;

  ctx.clearRect(0, 0, w, h);
  ctx.font = AXIS_FONT;
  ctx.textBaseline = "middle";

  // Count gridlines (y).
  ctx.textAlign = "right";
  for (let p = 0; 10 ** p <= topV; p++) {
    const yy = y(10 ** p);
    ctx.strokeStyle = c.grid;
    ctx.beginPath();
    ctx.moveTo(MARGIN.left, yy);
    ctx.lineTo(MARGIN.left + plotW, yy);
    ctx.stroke();
    ctx.fillStyle = c.text;
    ctx.fillText(`${10 ** p}`, MARGIN.left - 5, yy);
  }

  // Bars (sampled counts).
  ctx.fillStyle = c.bar;
  for (const b of bins) {
    if (b.count < 1) continue;
    const bx = x(b.logMlo) + 0.5;
    const bw = Math.max(1, x(b.logMhi) - x(b.logMlo) - 1);
    const by = y(b.count);
    ctx.fillRect(bx, by, bw, y0 - by);
  }

  // Analytic law (line through expected values).
  ctx.strokeStyle = c.line;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  bins.forEach((b, i) => {
    const px = x(b.logMc);
    const py = y(b.expected);
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  });
  ctx.stroke();

  // Axis frame + mass labels (x).
  ctx.strokeStyle = c.axis;
  ctx.lineWidth = 1;
  ctx.strokeRect(MARGIN.left, MARGIN.top, plotW, plotH);
  ctx.textAlign = "center";
  ctx.fillStyle = c.text;
  for (const m of [0.1, 1, 10, 100]) {
    const lm = log10(m);
    if (lm < lo - 1e-9 || lm > hi + 1e-9) continue;
    ctx.fillText(`${m}`, x(lm), h - MARGIN.bottom + 12);
  }
  // Axis titles live in an HTML KaTeX caption under the canvas, not on it.
}
