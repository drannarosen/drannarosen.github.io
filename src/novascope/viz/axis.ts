/*
 * viz/axis.ts — shared canvas axis helpers (Layer 2). Plain-ASCII only; the
 * semantic axis titles are HTML KaTeX in the component. drawPower renders a
 * proper "10^x" with a raised exponent (no Unicode superscript), used by both
 * the H–R diagram and the IMF histogram.
 */
export const AXIS_FONT = "14px ui-monospace, SFMono-Regular, Menlo, monospace";
export const SUB_FONT = "10px ui-monospace, SFMono-Regular, Menlo, monospace";

/** Draw "10^exp" anchored at (x, y). `align` positions the whole label. */
export function drawPower(
  ctx: CanvasRenderingContext2D,
  exp: number,
  x: number,
  y: number,
  align: "center" | "right",
  color: string,
): void {
  const expStr = Number.isInteger(exp) ? String(exp) : exp.toFixed(1);
  ctx.font = AXIS_FONT;
  const baseW = ctx.measureText("10").width;
  ctx.font = SUB_FONT;
  const expW = ctx.measureText(expStr).width;
  const total = baseW + 1 + expW;
  const sx = align === "right" ? x - total : x - total / 2;
  ctx.fillStyle = color;
  ctx.textAlign = "left";
  ctx.font = AXIS_FONT;
  ctx.fillText("10", sx, y);
  ctx.font = SUB_FONT;
  ctx.fillText(expStr, sx + baseW + 1, y - 5);
  ctx.font = AXIS_FONT;
}
