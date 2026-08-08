/*
 * viz/axis.ts — shared canvas axis helpers (Layer 2). Plain-ASCII only; the
 * semantic axis titles are HTML KaTeX in the component. drawPower renders a
 * proper "10^x" with a raised exponent (no Unicode superscript), used by both
 * the H–R diagram and the IMF histogram.
 */
export const AXIS_FONT = "14px ui-monospace, SFMono-Regular, Menlo, monospace";
export const SUB_FONT = "10px ui-monospace, SFMono-Regular, Menlo, monospace";

/*
 * A LARGER PAIR, for plots that own the full width of a panel.
 *
 * Not a bump to AXIS_FONT: `hrDiagram` and `histogram` are small multiples inside
 * census's narrow column, where 14px already reads large relative to the plot,
 * while `/explore/dynamics` draws two full-width time series where the same 14px
 * reads small. The apparent size is what a reader judges, so the px size is a
 * call-site choice rather than one default that is wrong in one of the two places.
 *
 * Kept here rather than in the component so there is still exactly one file that
 * decides what a canvas axis is allowed to be set to — see the note above on why
 * these must be literal strings.
 */
export const AXIS_FONT_LG = "16px ui-monospace, SFMono-Regular, Menlo, monospace";
export const SUB_FONT_LG = "11px ui-monospace, SFMono-Regular, Menlo, monospace";

/*
 * THESE ARE LITERAL FONT STRINGS, AND THEY HAVE TO BE.
 *
 * `ctx.font` is parsed as the CSS font shorthand but resolved with no element and
 * no cascade, so a custom property in it cannot be substituted and the whole
 * assignment is REJECTED — silently, leaving whatever font was set before.
 * `/explore/dynamics` shipped `ctx.font = "9px var(--font-mono, monospace)"` and
 * every tick label on both its plots drew in the canvas default, 10px sans-serif:
 * measured in the browser, setting it left `ctx.font` reading "10px sans-serif".
 *
 * That is why it read as "the ticks are too small" rather than as an error. Use
 * these constants; never interpolate a token into a canvas font.
 */

/**
 * Round tick values covering [lo, hi] — roughly `want` of them, on a 1/2/2.5/5/10
 * mantissa so the labels are numbers a reader can hold in their head.
 *
 * Lives here rather than in a plot module because it is the LINEAR counterpart to
 * `drawPower`: the H–R diagram and the IMF histogram are log–log with fixed decade
 * ticks and never needed it, so the first linear time series on the site
 * (`/explore/dynamics`) hand-rolled its own. Shared now so the tick law is one
 * function with a node test rather than one per plot.
 */
export function niceTicks(lo: number, hi: number, want = 4): number[] {
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [];
  const span = hi - lo;
  if (!(span > 0)) return [lo];
  const raw = span / Math.max(1, want);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((k) => k * mag).find((v) => v >= raw) ?? mag * 10;
  const out: number[] = [];
  /* The epsilon is a FLOATING-POINT guard, not a fudge: `hi` is often an exact
     multiple of `step` (a 0..1 axis with step 0.25), and without it the last tick
     is dropped whenever the accumulated sum lands a few ulps above `hi`. */
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) out.push(v);
  return out;
}

/**
 * Draw "10^exp" anchored at (x, y). `align` positions the whole label.
 *
 * `fonts` defaults to the standard pair, so census's two callers are unchanged.
 * A caller drawing at AXIS_FONT_LG must pass the large pair, or its log ticks
 * would come out at 14px beside 16px linear ones — a mismatch that is invisible
 * in review because both are "the tick font" at the call site.
 */
export function drawPower(
  ctx: CanvasRenderingContext2D,
  exp: number,
  x: number,
  y: number,
  align: "center" | "right",
  color: string,
  fonts: { base: string; sub: string } = { base: AXIS_FONT, sub: SUB_FONT },
): void {
  const expStr = Number.isInteger(exp) ? String(exp) : exp.toFixed(1);
  ctx.font = fonts.base;
  const baseW = ctx.measureText("10").width;
  ctx.font = fonts.sub;
  const expW = ctx.measureText(expStr).width;
  const total = baseW + 1 + expW;
  const sx = align === "right" ? x - total : x - total / 2;
  ctx.fillStyle = color;
  ctx.textAlign = "left";
  ctx.font = fonts.base;
  ctx.fillText("10", sx, y);
  ctx.font = fonts.sub;
  ctx.fillText(expStr, sx + baseW + 1, y - 5);
  ctx.font = fonts.base;
}
