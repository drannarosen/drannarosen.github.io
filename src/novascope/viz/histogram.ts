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
import { AXIS_FONT, drawPower, niceTicks } from "./axis.ts";

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

/**
 * A SECOND bar series over the same bins — "how many of these are left".
 *
 * Added for `/explore/dynamics`, which needs the mass function as drawn against the mass
 * function of what is still bound. Both pages then share one renderer rather than growing a
 * second histogram that would drift from this one in ticks, margins and log handling.
 *
 * `counts` is indexed by bin and MUST use the model's own binning; passing counts from a
 * different `nBins` would silently draw bars against the wrong masses. The caller gets that
 * for free by building both models with the same `toIMFHistogram` call signature.
 */
export interface HistogramOverlay {
  counts: number[];
  colour: string;
}

export function renderHistogram(
  ctx: CanvasRenderingContext2D,
  model: IMFModel,
  w: number,
  h: number,
  opts: {
    colors?: Partial<HistogramColors>;
    form?: IMFForm;
    overlay?: HistogramOverlay;
    /** Axis font. Defaults to AXIS_FONT; the full-width plots pass the larger pair. */
    font?: string;
    /** Left/bottom room for that font. Defaults to this file's own margins. */
    margin?: Partial<typeof MARGIN>;
    /**
     * y scale. "log" (default) is right for the IMF itself, which spans decades.
     *
     * "linear" exists because a log axis HIDES DEPLETION. `/explore/dynamics` overlays the
     * bound stars on the drawn ones, and losing 13% of a bin moves it 0.06 dex — about 3% of
     * the plot height, a few pixels. The same loss on a linear count axis is 13% of the bar,
     * which is the whole point of that figure. Measured before changing it: the overlay
     * covered all but 2% of the bars it sat on.
     *
     * The trade is that the sparse high-mass bins collapse toward the axis. That is honest
     * here — they hold three or four stars and carry no trend — but it is why this is not
     * the default.
     */
    scale?: "log" | "linear";
  } = {},
): void {
  const c = { ...DEFAULTS, ...opts.colors };
  const form = opts.form ?? "dNdM";
  const font = opts.font ?? AXIS_FONT;
  const M = { ...MARGIN, ...opts.margin };
  const bins = model.bins;
  if (!bins.length) return;

  const lo = bins[0].logMlo;
  const hi = bins[bins.length - 1].logMhi;
  const plotW = w - M.left - M.right;
  const plotH = h - M.top - M.bottom;

  // Per-form values: dN/dM divides by the linear bin width (→ power-law line);
  // per-dex is the raw count (→ turnover hump).
  const dM = (b: (typeof bins)[number]) => 10 ** b.logMhi - 10 ** b.logMlo;
  /* One transform for every bar series, so an overlay can never be scaled differently
     from the bars it sits inside. */
  const barOf = (count: number, b: (typeof bins)[number]) =>
    form === "dNdM" ? count / dM(b) : count;
  const barV = (b: (typeof bins)[number]) => barOf(b.count, b);
  const lineV = (b: (typeof bins)[number]) => (form === "dNdM" ? b.expected / dM(b) : b.expected);
  const overlayV = (b: (typeof bins)[number], i: number) =>
    opts.overlay ? barOf(opts.overlay.counts[i] ?? 0, b) : 0;

  /* The overlay is included in the extent even though it is bounded above by the bars it
     overlays — it is the SMALL values that matter, since a nearly-empty bin would otherwise
     fall below a floor computed without it. */
  const positives = bins
    .flatMap((b, i) => [barV(b), lineV(b), overlayV(b, i)])
    .filter((v) => v > 0);
  const vMax = Math.max(...positives, 1);
  const vMin = Math.min(...positives);
  const topDec = Math.ceil(log10(vMax));
  const botDec = Math.max(Math.floor(log10(vMin)), topDec - 6); // cap at 6 decades
  const scale = opts.scale ?? "log";
  /* Headroom so the tallest bar is not flush with the frame. */
  const yTop = vMax * 1.08;

  const x = (logM: number) => M.left + ((logM - lo) / (hi - lo)) * plotW;
  const y = (v: number) => {
    if (scale === "linear") return M.top + (1 - Math.max(0, v) / (yTop || 1)) * plotH;
    const t = (log10(Math.max(v, 10 ** botDec)) - botDec) / (topDec - botDec || 1);
    return M.top + (1 - t) * plotH;
  };
  const y0 = M.top + plotH;

  ctx.clearRect(0, 0, w, h);
  ctx.font = font;
  ctx.textBaseline = "middle";

  // y gridlines: decades under log, plain counts under linear.
  const rule = (yy: number) => {
    ctx.strokeStyle = c.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(M.left, yy);
    ctx.lineTo(M.left + plotW, yy);
    ctx.stroke();
  };
  if (scale === "linear") {
    ctx.fillStyle = c.text;
    ctx.textAlign = "right";
    for (const v of niceTicks(0, yTop)) {
      if (v < 0) continue;
      const yy = y(v);
      rule(yy);
      ctx.fillText(String(Math.round(v)), M.left - 5, yy);
    }
    ctx.textAlign = "start";
  } else {
    const step = topDec - botDec > 6 ? 2 : 1;
    for (let n = botDec; n <= topDec; n += step) {
      const yy = y(10 ** n);
      rule(yy);
      drawPower(ctx, n, M.left - 5, yy, "right", c.text);
      ctx.font = font; // drawPower sets its own; restore before the next label
    }
  }

  /* Bars, then the overlay ON TOP — the overlay is a subset of them, so drawing it second
     makes the remainder read as the part of each bar that has gone. */
  const bar = (v: number, b: (typeof bins)[number]) => {
    if (v <= 0) return;
    const bx = x(b.logMlo) + 0.5;
    const bw = Math.max(1, x(b.logMhi) - x(b.logMlo) - 1);
    const by = y(v);
    ctx.fillRect(bx, by, bw, y0 - by);
  };
  ctx.fillStyle = c.bar;
  for (const b of bins) bar(barV(b), b);
  if (opts.overlay) {
    ctx.fillStyle = opts.overlay.colour;
    bins.forEach((b, i) => bar(overlayV(b, i), b));
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
  ctx.strokeRect(M.left, M.top, plotW, plotH);
  for (const lm of MASS_TICKS) {
    if (lm < lo - 1e-9 || lm > hi + 1e-9) continue;
    drawPower(ctx, lm, x(lm), h - M.bottom + 16, "center", c.text);
  }
}
