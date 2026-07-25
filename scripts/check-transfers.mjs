/*
 * check-transfers.mjs — the display-convention registry, and the CPU mirror of three's tone
 * mappers underneath it.
 *
 * WHAT THIS GATE IS FOR. `core/imaging/toneMap` transcribes six operators out of three r185.1's
 * `src/nodes/display/ToneMappingFunctions.js`. Transcription is the task where being 95% right
 * feels identical to being right — `check:stretch` exists because `0.333` instead of `1/3` was
 * 3.4e-4 off and looked like float noise — and here the specific hazard is worse than a typo:
 *
 *   TSL's `mat3()` USES TWO CONVENTIONS. Nine plain numbers construct a `THREE.Matrix3`, whose
 *   constructor is ROW-major. Three `vec3` nodes emit GLSL/WGSL `mat3(c0,c1,c2)`, which is
 *   COLUMN-major. Three's own source uses both within one file: ACES is written as nine scalars
 *   in published row order, AgX as three vec3 columns matching the GLSL chunk's "transposed
 *   from source" layout. Copy one with the other's convention and you get a transposed colour
 *   matrix — an image that renders, looks fine, and has the wrong hues.
 *
 * The orientation is therefore not asserted anywhere, it is DERIVED from an invariant these
 * matrices must satisfy: they map neutral to neutral, so their ROWS sum to 1. That is checked
 * here first, before anything else depends on the transcription, and it is what would catch a
 * transpose — the wrong reading gives 0.7016 for ACES's first row and 1.1058 for AgX's.
 *
 * WHAT IT CANNOT CHECK, stated so the limit is not mistaken for coverage: node cannot run TSL,
 * so this compares the mirror against its own invariants and against published anchor values,
 * NOT against three's shader output. The GPU-versus-CPU comparison is `viz/starfield/parity`,
 * which runs in a browser. Both halves are needed and neither substitutes for the other.
 */
import {
  TONE_MAP_IDS,
  TONE_MAP_MATRICES,
  TONE_MAP_NEUTRALITY_TOLERANCE,
  TONE_MAP_NOTES,
  toneMapRGB,
  toneMapGrey,
  toneMapDisplay,
  toneMapInverseGrey,
  toneMapFloor,
  isToneMapMonotonic,
} from "../src/novascope/core/imaging/toneMap.ts";
import {
  TRANSFER_IDS,
  TRANSFERS,
  getTransfer,
  transferFamily,
  transferFloor,
} from "../src/novascope/core/imaging/transfers.ts";
import { STRETCH_IDS } from "../src/novascope/core/imaging/stretch.ts";
import { DEFAULT_LUPTON_DEPTH_MAG } from "../src/novascope/core/imaging/lupton.ts";
/*
 * Layer 2, imported by a gate — same as `check-calibrate` does. The invariance below is a claim
 * about the RENDERER's exposure, so it cannot be checked from Layer 0 alone.
 */
import { clusterStarTable } from "../src/novascope/viz/starfield/source.ts";
import { prepareStarField } from "../src/novascope/viz/starfield/prepare.ts";
import { whitePixelIntensity } from "../src/novascope/viz/starfield/calibrate.ts";

let failures = 0;
const ok = (cond, msg) => {
  console.log(`  ${cond ? "ok  " : "FAIL"}  ${msg}`);
  if (!cond) failures++;
};

console.log("transfers (display conventions, and the CPU mirror of three's tone mappers):");

/* ── 1. THE TRANSPOSE GATE — the invariant that settles the matrix orientations ── */
console.log("\n  matrix orientation (rows must sum to 1 — a transpose fails here first):");
/*
 * TOLERANCE IS DERIVED FROM THREE'S OWN PRECISION, not chosen. `quotedDecimals` records how
 * many places three writes each constant to; half an ulp of the last digit, summed over three
 * terms, is 1.5 * 10^-d, and 5 * 10^-d leaves headroom without letting a transpose through. The
 * floor at 1e-14 is float noise on the two 15-16 digit AgX matrices.
 */
const rowSumError = (rows) =>
  Math.max(...rows.map((r) => Math.abs(r[0] + r[1] + r[2] - 1)));
const tolFor = (d) => Math.max(1e-14, 5 * 10 ** -d);
for (const { name, rows, quotedDecimals } of TONE_MAP_MATRICES) {
  const worst = rowSumError(rows);
  const tol = tolFor(quotedDecimals);
  ok(
    worst < tol,
    `${name}: rows sum to 1 within ${worst.toExponential(2)} (three quotes ${quotedDecimals} dp, tol ${tol.toExponential(0)})`,
  );
}

/*
 * AND THE GATE IS PROVEN TO BITE. Asserting "a transpose would fail here" is the kind of claim
 * this repository has been wrong about before, so it is executed rather than believed: each
 * matrix is transposed and the same check must reject it. Without this, a tolerance loosened
 * one day to quiet a rounding complaint would silently stop catching the error it exists for.
 */
{
  let caught = 0;
  const margins = [];
  for (const { rows, quotedDecimals } of TONE_MAP_MATRICES) {
    const t = [0, 1, 2].map((i) => [rows[0][i], rows[1][i], rows[2][i]]);
    const err = rowSumError(t);
    if (err >= tolFor(quotedDecimals)) caught++;
    margins.push(err / tolFor(quotedDecimals));
  }
  ok(
    caught === TONE_MAP_MATRICES.length,
    `transposing each matrix is rejected by this check, all ${TONE_MAP_MATRICES.length} of them`,
  );
  ok(
    Math.min(...margins) > 100,
    `…by a margin of at least ${Math.min(...margins).toExponential(1)}x the tolerance, so it is not a near-miss`,
  );
}

/* ── 2. NEUTRALITY END TO END — grey in, grey out ── */
console.log("\n  neutrality (grey in, grey out — what makes a scalar response well-defined):");
for (const id of TONE_MAP_IDS) {
  let worst = 0;
  for (const x of [1e-4, 1e-3, 0.01, 0.1, 0.18, 0.5, 1, 2, 8, 64]) {
    const [r, g, b] = toneMapRGB([x, x, x], id);
    worst = Math.max(worst, Math.abs(r - g), Math.abs(g - b), Math.abs(r - b));
  }
  /*
   * The residual is INHERITED from three's published constants, not introduced here: AgX carries
   * ~2e-4 from the four-decimal Rec.2020 pair, ACES ~1e-5 from its five-decimal output matrix,
   * the rest are exact. All are well under one 8-bit level (3.9e-3), which is the standard that
   * actually matters for a display transfer.
   */
  ok(
    worst < TONE_MAP_NEUTRALITY_TOLERANCE,
    `${id}: neutral to ${worst.toExponential(2)} across 1e-4 to 64 (tol ${TONE_MAP_NEUTRALITY_TOLERANCE}, one display level is 3.9e-3)`,
  );
}

/* ── 3. MONOTONICITY — required before any bisection may be trusted ── */
console.log("\n  monotonicity (a non-monotonic transfer would reorder brightnesses):");
for (const id of TONE_MAP_IDS) {
  ok(isToneMapMonotonic(id), `${id}: monotonic in a neutral input over 1e-9 to 1e4`);
}

/* ── 4. RANGE ── */
console.log("\n  range:");
for (const id of TONE_MAP_IDS) {
  const vals = [0, 1e-6, 0.18, 1, 100, 1e6].map((x) => toneMapGrey(x, id));
  ok(
    vals.every((v) => v >= 0 && v <= 1 && Number.isFinite(v)),
    `${id}: stays in [0,1] and finite, including at x = 0 and x = 1e6`,
  );
  ok(toneMapGrey(0, id) < 1e-6, `${id}: black in gives black out`);
}

/* ── 5. ANCHOR VALUES from the published definitions, not from this implementation ── */
console.log("\n  anchors (published behaviour, independent of the transcription):");
{
  // Reinhard is x/(1+x) exactly, so its display-linear value at x = 1 is 0.5 by definition.
  const r = toneMapRGB([1, 1, 1], "reinhard")[0];
  ok(Math.abs(r - 0.5) < 1e-12, `reinhard(1) = 0.5 exactly (got ${r})`);
  // three's LinearToneMapping is a clamp, so it is the identity below 1 and saturates above.
  ok(Math.abs(toneMapRGB([0.3, 0.3, 0.3], "srgb")[0] - 0.3) < 1e-12, "srgb is the identity below 1");
  ok(toneMapRGB([5, 5, 5], "srgb")[0] === 1, "srgb clamps above 1");
  // Cineon SUBTRACTS 0.004 before its curve, so everything under that is exactly black. This is
  // the property that makes it the shallowest of the six, and the page says so.
  ok(toneMapGrey(0.0039, "cineon") === 0, "cineon is exactly black below scene value 0.004");
  ok(toneMapGrey(0.02, "cineon") > 0, "…and non-black above it");
  // AgX's log2 window bottoms out at 2^-12.47393 of unity.
  const agxCut = 2 ** -12.47393;
  ok(
    toneMapGrey(agxCut * 0.5, "agx") === 0,
    `agx is exactly black below its log2 floor (2^-12.474 = ${agxCut.toExponential(2)})`,
  );
}

/* ── 6. INVERSE ROUND-TRIP ── */
console.log("\n  inverse (bisection, only legitimate because monotonicity passed above):");
for (const id of TONE_MAP_IDS) {
  let worst = 0;
  let at = 0;
  for (const target of [0.004, 0.02, 0.1, 0.25, 0.5, 0.75, 0.9]) {
    const x = toneMapInverseGrey(target, id);
    const back = toneMapGrey(x, id);
    const d = Math.abs(back - target);
    if (d > worst) {
      worst = d;
      at = target;
    }
  }
  ok(worst < 1e-6, `${id}: round-trips to ${worst.toExponential(2)} (worst at output ${at})`);
}

/* ── 7. THE FLOORS — the number the renderer actually consumes ── */
console.log("\n  display floors (what sizes a star's billboard):");
{
  const floors = TONE_MAP_IDS.map((id) => [id, toneMapFloor(id)]);
  for (const [id, f] of floors) {
    ok(f > 0 && f < 1, `${id}: one display level at scene value ${f.toExponential(2)} of white`);
  }
  const vals = floors.map(([, f]) => f);
  const spread = Math.max(...vals) / Math.min(...vals);
  ok(
    spread > 5,
    `…spanning ${spread.toFixed(1)}x across the six, which is why the floor cannot be a constant`,
  );
}

/* ── 8. THE REGISTRY ── */
console.log("\n  registry:");
ok(
  TRANSFER_IDS.length === 1 + STRETCH_IDS.length + TONE_MAP_IDS.length,
  `${TRANSFER_IDS.length} transfers = lupton + ${STRETCH_IDS.length} astropy + ${TONE_MAP_IDS.length} photographic`,
);
ok(new Set(TRANSFER_IDS).size === TRANSFER_IDS.length, "ids are unique across the two families");
ok(
  TRANSFERS.length === TRANSFER_IDS.length,
  "every id has a record (the registry is mapped, not hand-listed)",
);
ok(
  TRANSFERS.every((t) => t.note.length > 40 && t.label.length > 0),
  "every transfer has a label and a substantive note",
);
ok(
  TRANSFERS.filter((t) => t.huePreserving).map((t) => t.id).join(",") === "lupton",
  "lupton is the only transfer claiming to be hue-preserving",
);
ok(
  TRANSFERS.every(
    (t) =>
      t.encoding === (t.family === "photographic" ? "scene-linear" : "display-referred"),
  ),
  "encoding follows family: photographic is scene-linear, astronomical is display-referred",
);
ok(
  transferFamily("lupton") === "astronomical" && transferFamily("agx") === "photographic",
  "family lookup agrees for one id from each side",
);
ok(getTransfer("agx").note === TONE_MAP_NOTES.agx, "notes are DERIVED from the source module, not retyped");

/* ── 9. transferFloor DISPATCHES, and only lupton listens to depth ── */
console.log("\n  transferFloor:");
{
  let worst = 0;
  for (const id of TRANSFER_IDS) {
    if (id === "lupton") continue;
    const a = transferFloor(id, 8);
    const b = transferFloor(id, 20);
    worst = Math.max(worst, Math.abs(a - b));
    if (!(a > 0 && a < 1)) ok(false, `${id}: floor ${a} is not in (0,1)`);
  }
  ok(worst === 0, "depthMag changes nothing for the ten fixed-shape transfers");
  const shallow = transferFloor("lupton", 8);
  const deep = transferFloor("lupton", 20);
  ok(deep < shallow, `lupton's floor DOES move with depth (${shallow.toExponential(2)} at 8 mag -> ${deep.toExponential(2)} at 20)`);
  ok(
    transferFloor("lupton", DEFAULT_LUPTON_DEPTH_MAG) > 0,
    "…and is positive at the shipped default",
  );
  const all = TRANSFER_IDS.map((id) => transferFloor(id, DEFAULT_LUPTON_DEPTH_MAG));
  const spread = Math.max(...all) / Math.min(...all);
  ok(spread > 100, `floors span ${spread.toExponential(1)}x across all ${TRANSFER_IDS.length} transfers`);
}

/* ── 10. THE ENCODE IS NOT ALREADY APPLIED ── */
console.log("\n  encoding (the mistake that produces a washed-out image):");
{
  // `toneMapRGB` must be display-LINEAR and `toneMapDisplay` its encoded form. If the encode had
  // been folded into the operator, these would be equal — which is exactly the double-encode
  // this separation exists to make impossible.
  const lin = toneMapRGB([0.18, 0.18, 0.18], "agx")[0];
  const disp = toneMapDisplay([0.18, 0.18, 0.18], "agx")[0];
  ok(disp > lin + 0.05, `agx: encoded ${disp.toFixed(4)} is well above linear ${lin.toFixed(4)}`);
  ok(Math.abs(toneMapDisplay([0, 0, 0], "agx")[0]) < 1e-12, "black stays black through the encode");
}

/* ── 11. SWITCHING TRANSFER MUST NOT MOVE THE EXPOSURE ── */
/*
 * The claim this page's whole comparison rests on: choosing a different display transfer changes
 * the CURVE and not the exposure, so an A/B is a comparison of curves.
 *
 * It is not obvious. `transferFloor` sets how far each star's quad is integrated, and the twelve
 * floors span 850x — so the analytic mean intensity, and with it the white point, could in
 * principle move a long way. It does not, and the reason is physical: the Moffat core and the
 * aureole both have CONVERGENT area integrals, so a wider quad adds area and almost no energy.
 *
 * Gated rather than measured once and written into a comment, because that is precisely the
 * shape of claim this repository has watched go stale — and because a future change to the PSF,
 * the aureole exponent or the quad cap could break it without touching this file.
 */
console.log("\n  exposure invariance (a transfer A/B must compare curves, not exposures):");
{
  const stars = clusterStarTable({ sampling: { mode: "count", target: 4000 } });
  const DEPTH = DEFAULT_LUPTON_DEPTH_MAG;
  const field = prepareStarField(stars, {
    bandTriple: ["LSST_g", "LSST_r", "LSST_i"],
    band: "LSST_r",
    colorMode: "photometric",
    depthMag: DEPTH,
    pixelRatio: 1,
  });
  const ref = whitePixelIntensity(field, 1280, 800, { floor: transferFloor("lupton", DEPTH) });
  let worst = 0;
  let worstId = "";
  for (const id of TRANSFER_IDS) {
    const w = whitePixelIntensity(field, 1280, 800, { floor: transferFloor(id, DEPTH) });
    const dmag = Math.abs(-2.5 * Math.log10(w / ref));
    if (dmag > worst) {
      worst = dmag;
      worstId = id;
    }
  }
  /*
   * The bound is 0.05 mag — an order of magnitude above what is measured (0.008) and an order
   * BELOW the calibration constant's own spread across seventeen configurations (0.41 mag), so
   * it sits in the gap where it can only fire on a real regression.
   */
  ok(
    worst < 0.05,
    `white point moves at most ${worst.toFixed(4)} mag across all ${TRANSFER_IDS.length} floors (worst: ${worstId}; the calibration's own spread is 0.41 mag)`,
  );
  const floors = TRANSFER_IDS.map((id) => transferFloor(id, DEPTH));
  ok(
    Math.max(...floors) / Math.min(...floors) > 100,
    `…while the floors themselves span ${(Math.max(...floors) / Math.min(...floors)).toExponential(1)}x, which is what makes the invariance worth asserting`,
  );
}

if (failures) {
  console.error(`\n✗ transfers — ${failures} failure(s)`);
  process.exit(1);
}
console.log("\n✓ transfers ok");
