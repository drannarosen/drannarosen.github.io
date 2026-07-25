/*
 * check-stretch.mjs — validate the display transfer curves against ASTROPY ITSELF.
 *
 * Same shape of gate as `check-lupton`, and for the same reason: transcribing a formula from a
 * reference implementation is exactly the task where being 95% right feels identical to being
 * right, and the failure mode is a plausible image rather than an exception.
 *
 * IT ALREADY EARNED ITS KEEP. `SinhStretch`'s default parameter is `1/3`; the first version of
 * `stretch.ts` wrote `0.333`, which put that curve 3.4e-4 off — small enough to read as float noise
 * and twelve orders of magnitude above it. Nothing but a comparison against the real thing would
 * have found that.
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  stretch,
  isMonotonic,
  STRETCH_IDS,
  STRETCH_NOTES,
  ASINH_A,
  SINH_A,
  stretchInverse,
} from "../src/novascope/core/imaging/stretch.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
let failures = 0;
const ok = (cond, msg) => {
  console.log(`  ${cond ? "ok  " : "FAIL"}  ${msg}`);
  if (!cond) failures++;
};

console.log("stretch (display transfer curves, validated against astropy):");

const ref = JSON.parse(readFileSync(resolve(HERE, "reference/stretch-astropy.json"), "utf8"));
ok(/^https:\/\/github\.com\/astropy/.test(ref.authority), "the authority is astropy's public repository");
ok(ref.x.length >= 40, `${ref.x.length} sample points from astropy ${ref.astropyVersion}`);
ok(
  STRETCH_IDS.every((id) => ref.curves[id] !== undefined),
  `all ${STRETCH_IDS.length} curves have reference values`,
);

/* ── THE CROSS-VALIDATION ── */
{
  let worstAll = 0;
  for (const id of STRETCH_IDS) {
    let worst = 0;
    let at = 0;
    ref.x.forEach((x, i) => {
      const d = Math.abs(stretch(x, id) - ref.curves[id][i]);
      if (d > worst) {
        worst = d;
        at = x;
      }
    });
    worstAll = Math.max(worstAll, worst);
    ok(worst < 1e-12, `${id}: matches astropy to ${worst.toExponential(2)} (worst at x = ${at})`);
  }
  ok(worstAll < 1e-12, `worst across all five curves: ${worstAll.toExponential(2)}`);
}

/* The parameters are astropy's, and the sinh one is the reason this gate exists. */
{
  ok(ASINH_A === ref.defaults.asinh_a, `asinh a = ${ASINH_A}, as astropy defaults`);
  ok(SINH_A === ref.defaults.sinh_a, `sinh a = 1/3 exactly, not 0.333 (${SINH_A})`);
  ok(SINH_A !== 0.333, "…asserted explicitly, because 0.333 is the mistake that was made");
}

/* ── PROPERTIES every curve must have ── */
{
  for (const id of STRETCH_IDS) {
    ok(isMonotonic(id), `${id}: is monotonic, so it cannot reorder two stars' brightnesses`);
    ok(stretch(0, id) === 0, `${id}: maps black to black`);
    ok(Math.abs(stretch(1, id) - 1) < 1e-12, `${id}: maps white to white`);
    ok(stretch(-5, id) === 0 && stretch(5, id) === 1, `${id}: clamps out-of-range input`);
    ok(STRETCH_NOTES[id]?.length > 40, `${id}: carries a note saying what it does to a star field`);
  }
}

/* ── THE ORDERING, WHICH IS NOT A SINGLE ORDERING ──
 *
 * `log` lifts most and `sinh` least at every input, and both bracket `linear`. But ASINH AND SQRT
 * CROSS, and that crossing is the most useful thing in this module to understand:
 *
 *   below the crossing  asinh lifts LESS than sqrt, because asinh is LINEAR at the toe
 *   above the crossing  asinh lifts MORE than sqrt, because asinh is LOGARITHMIC at the top
 *
 * That is exactly why Lupton chose asinh: it leaves the faint end undistorted while still
 * compressing the bright end, where sqrt does a bit of both everywhere. My first version of this
 * gate asserted `asinh > sqrt` at x = 0.01 and failed — 0.033 against 0.100 — because I had
 * assumed a single ranking instead of measuring one. The crossing is asserted now, in both
 * directions, so the caption cannot drift from the arithmetic.
 */
{
  const faint = 0.01;
  const bright = 0.5;
  const v = Object.fromEntries(STRETCH_IDS.map((id) => [id, stretch(faint, id)]));
  ok(v.log > v.sqrt, `at x = ${faint}, log lifts most (${v.log.toFixed(3)} > ${v.sqrt.toFixed(3)})`);
  ok(v.sqrt > v.asinh, `…sqrt more than asinh, since asinh is still LINEAR here (${v.sqrt.toFixed(3)} > ${v.asinh.toFixed(3)})`);
  ok(v.asinh > v.linear, `…asinh more than linear (${v.asinh.toFixed(3)} > ${v.linear.toFixed(3)})`);
  ok(v.linear > v.sinh, `…and linear more than sinh, which SUPPRESSES the faint end (${v.linear.toFixed(3)} > ${v.sinh.toFixed(4)})`);

  // The reversal, and the crossing between them.
  ok(
    stretch(bright, "asinh") > stretch(bright, "sqrt"),
    `at x = ${bright} the order REVERSES: asinh ${stretch(bright, "asinh").toFixed(3)} > sqrt ${stretch(bright, "sqrt").toFixed(3)}`,
  );
  let lo = faint;
  let hi = bright;
  for (let i = 0; i < 60; i++) {
    const mid = 0.5 * (lo + hi);
    if (stretch(mid, "asinh") < stretch(mid, "sqrt")) lo = mid;
    else hi = mid;
  }
  const cross = 0.5 * (lo + hi);
  ok(cross > faint && cross < bright, `…crossing exactly once, at x = ${cross.toFixed(4)}`);
  // log above and sinh below everything, at BOTH ends, so the bracket is not an artefact of one x.
  for (const x of [faint, bright]) {
    ok(
      STRETCH_IDS.every((id) => id === "log" || stretch(x, "log") >= stretch(x, id)),
      `log lifts most at x = ${x}`,
    );
    ok(
      STRETCH_IDS.every((id) => id === "sinh" || stretch(x, "sinh") <= stretch(x, id)),
      `sinh lifts least at x = ${x}`,
    );
  }

  // astropy's log form is finite at zero, unlike a naive log(x) — the thing that makes
  // hand-rolled log stretches punch black holes where the sky should be.
  ok(Number.isFinite(stretch(0, "log")) && stretch(0, "log") === 0, "log is finite at zero, not -Infinity");
  ok(stretch(1e-12, "log") > 0, "…and still lifts an extremely faint value above black");
}

/* ── THE INVERSE ──
 *
 * Closed form, for the reason recorded on `softeningForLimit`: that function is the same shape and
 * its first version was inverted, answering a 10-magnitude request with 30.6 while looking
 * plausible. Round-tripped anyway, because algebra can be wrong too — and in BOTH directions,
 * since each traverses the curve differently. */
{
  let worst = 0;
  let worstAt = "";
  for (const id of STRETCH_IDS) {
    for (let i = 0; i <= 200; i++) {
      const x = i / 200;
      const back = stretchInverse(stretch(x, id), id);
      const err = Math.abs(back - x);
      if (err > worst) {
        worst = err;
        worstAt = `${id} at x=${x.toFixed(3)}`;
      }
      const y = i / 200;
      const backY = stretch(stretchInverse(y, id), id);
      const errY = Math.abs(backY - y);
      if (errY > worst) {
        worst = errY;
        worstAt = `${id} at y=${y.toFixed(3)}`;
      }
    }
  }
  ok(worst < 1e-9, `stretch and its inverse round-trip both ways (worst ${worst.toExponential(1)} at ${worstAt})`);

  /* The number the renderer actually asks for: the faintest input each curve can still show. It
   * spans four orders of magnitude across the family, which is why a quad-sizing floor cannot be a
   * constant once the curve is selectable. */
  const floors = STRETCH_IDS.map((id) => [id, stretchInverse(1 / 255, id)]);
  for (const [id, f] of floors) {
    ok(f > 0 && f < 1, `${id}: one display level corresponds to input ${f.toExponential(2)}`);
  }
  const vals = floors.map(([, f]) => f);
  ok(
    Math.max(...vals) / Math.min(...vals) > 100,
    `…and those floors span ${(Math.max(...vals) / Math.min(...vals)).toExponential(1)}x across the family`,
  );
  ok(stretchInverse(0, "log") === 0, "a zero target inverts to zero, not a negative input");
}

if (failures) {
  console.error(`\n✗ stretch — ${failures} failure(s)`);
  process.exit(1);
}
console.log("\n✓ stretch ok");
