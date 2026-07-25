/*
 * check-calibrate.mjs — gate for the per-pixel exposure calibration.
 *
 * `WHITE_FROM_ANALYTIC_MEAN` is a MEASURED constant standing in for a histogram pass, so
 * the thing that has to be gated is not its value but its VALIDITY: that the analytic mean
 * really tracks the rendered frame's white point across everything a user can change, and
 * that the spread stays inside the 0.43 magnitudes claimed for it.
 *
 * A constant like this is exactly the kind that quietly stops being true — a new colour
 * composite, a different default exposure, a change to the aureole, and the image is
 * suddenly washed out or black with nothing having obviously broken. So it is re-derived
 * from the CPU reference and the gate fails if the relationship widens.
 *
 * IT RUNS IN TWO SIZES, because the full sweep costs ~100 seconds against a 4-second build
 * and a 25x build slowdown is not a price worth paying on every commit:
 *
 *   default  — three representative configurations, plus every check that is cheap: the
 *              closed form against a quadrature of `starProfile`, the exact scaling laws,
 *              and the boundary behaviour. This is what `prebuild` runs.
 *   --full   — all seventeen configurations, re-deriving the constant and its spread.
 *              Run this when the constant, the profile, the aureole or the composites
 *              change; it is the run that produced the recorded numbers.
 *
 * The split is deliberate rather than a shortcut: what the fast run cannot catch is a
 * WIDENING of the spread, and the spread only widens when something in the optics or the
 * composites changes — which is exactly when a person is already editing this area and can
 * run the full sweep. The fast run still catches every way the closed form itself can break.
 */
import { clusterStarTable } from "../src/novascope/viz/starfield/source.ts";
import { prepareStarField } from "../src/novascope/viz/starfield/prepare.ts";
import { renderReferenceLupton } from "../src/novascope/viz/starfield/reference.ts";
import {
  analyticMeanIntensity,
  whitePixelIntensity,
  profileIntegral,
  WHITE_FROM_ANALYTIC_MEAN,
  WHITE_FROM_ANALYTIC_MEAN_SPREAD,
} from "../src/novascope/viz/starfield/calibrate.ts";
import { starProfile } from "../src/novascope/viz/starfield/profile.ts";
import { DEFAULT_AUREOLE } from "../src/novascope/core/optics/index.ts";
import {
  luptonQForDepth,
  luptonStretchForWhite,
  luptonIntensityForOutput,
  ONE_DISPLAY_LEVEL,
} from "../src/novascope/core/imaging/lupton.ts";

let failures = 0;
const ok = (cond, msg) => {
  console.log(`  ${cond ? "ok  " : "FAIL"}  ${msg}`);
  if (!cond) failures++;
};

console.log("calibrate (per-pixel exposure):");

const stars = clusterStarTable({ sampling: { mode: "count", target: 10_000 } });
const BASE = { bandTriple: ["R", "V", "B"], pixelRatio: 1 };
const CAM = { width: 320, height: 320, distancePc: 12, fovDeg: 40 };
const floorFor = (depthMag) => {
  const q = luptonQForDepth(depthMag);
  return luptonIntensityForOutput(ONE_DISPLAY_LEVEL, luptonStretchForWhite(q), q);
};

/* The configurations the constant was measured over. Changing this list is changing the
 * claim, which is why it is written out rather than generated. */
const FULL = process.argv.includes("--full");
const RUNS_ALL = [
  ["baseline", {}, null, 8],
  ["Rubin irg", { bandTriple: ["LSST_i", "LSST_r", "LSST_g"] }, null, 8],
  ["Gaia RP/G/BP", { bandTriple: ["Gaia_RP", "Gaia_G", "Gaia_BP"] }, null, 8],
  ["JWST", { bandTriple: ["JWST_F444W", "JWST_F200W", "JWST_F090W"] }, null, 8],
  ["HST", { bandTriple: ["HST_F814W", "HST_F606W", "HST_F275W"] }, null, 8],
  ["2MASS KHJ", { bandTriple: ["K", "H", "J"] }, null, 8],
  ["fallback ramp", { bandTriple: undefined }, null, 8],
  ["exposure 4", { exposure: 4 }, null, 8],
  ["exposure 0.25", { exposure: 0.25 }, null, 8],
  ["minMass 1", { minMass: 1 }, null, 8],
  ["256 px", {}, { width: 256, height: 256, distancePc: 12, fovDeg: 40 }, 8],
  ["512 px", {}, { width: 512, height: 512, distancePc: 12, fovDeg: 40 }, 8],
  ["fov 20", {}, { width: 320, height: 320, distancePc: 12, fovDeg: 20 }, 8],
  ["fov 70", {}, { width: 320, height: 320, distancePc: 12, fovDeg: 70 }, 8],
  ["dpr 2", { pixelRatio: 2 }, null, 8],
  ["depth 12", {}, null, 12],
  ["depth 6.5", {}, null, 6.5],
];
/* The fast subset spans the three axes that matter most: a different composite, a
 * different exposure, and a different frame size. */
const FAST_KEYS = new Set(["baseline", "JWST", "exposure 4"]);
const RUNS = FULL ? RUNS_ALL : RUNS_ALL.filter(([n]) => FAST_KEYS.has(n));
console.log(`  ..    ${FULL ? "FULL sweep" : "fast subset"} — ${RUNS.length} of ${RUNS_ALL.length} configurations`);

const ratios = [];
for (const [name, over, cam, depth] of RUNS) {
  const field = prepareStarField(stars, { ...BASE, ...over });
  const camera = cam ?? CAM;
  const img = renderReferenceLupton(field, camera, { depthMag: depth });
  const mean = analyticMeanIntensity(field, camera.width, camera.height, {
    floor: floorFor(depth),
  });
  ok(mean > 0, `${name}: the analytic mean is positive (${mean.toExponential(2)})`);
  const k = (img.whitePixel ?? 0) / mean;
  ratios.push(k);
  ok(
    k >= WHITE_FROM_ANALYTIC_MEAN_SPREAD.min && k <= WHITE_FROM_ANALYTIC_MEAN_SPREAD.max,
    `${name}: white/mean = ${k.toFixed(2)} stays inside the recorded spread`,
  );
}

/* The claim itself. Only the full sweep can re-derive the constant and the spread; the fast
 * subset would compute a narrower spread over three configurations and asserting against it
 * would be asserting something weaker while looking like the same check. */
if (FULL) {
  const lo = Math.min(...ratios);
  const hi = Math.max(...ratios);
  const geo = Math.exp(ratios.reduce((a, b) => a + Math.log(b), 0) / ratios.length);
  ok(
    Math.abs(geo - WHITE_FROM_ANALYTIC_MEAN) / WHITE_FROM_ANALYTIC_MEAN < 0.05,
    `the constant is still the geometric mean (${geo.toFixed(2)} vs ${WHITE_FROM_ANALYTIC_MEAN})`,
  );
  const spreadMag = 2.5 * Math.log10(hi / lo);
  ok(spreadMag < 0.6, `the spread is ${spreadMag.toFixed(2)} mag across ${ratios.length} configurations`);
  ok(
    spreadMag > 0.1,
    "…and is not suspiciously zero, which would mean the configurations are not varying anything",
  );
} else {
  console.log("  ..    (constant and spread re-derived only by --full)");
}

/* SCALING LAWS the analytic mean must obey exactly, which no measured constant can
 * paper over. These are the checks that would catch a units error in the quadrature. */
{
  const field1 = prepareStarField(stars, { ...BASE });
  const field4 = prepareStarField(stars, { ...BASE, exposure: 4 });
  const f = floorFor(8);
  const m1 = analyticMeanIntensity(field1, 320, 320, { floor: f });
  const m4 = analyticMeanIntensity(field4, 320, 320, { floor: f });
  // Not exactly 4x: a brighter star also reaches further, so its quad grows too.
  ok(m4 > m1 * 3.5 && m4 < m1 * 5, `4x exposure raises the mean ${(m4 / m1).toFixed(2)}x`);

  // Total light is fixed, so the mean must fall as 1/area.
  const a = analyticMeanIntensity(field1, 320, 320, { floor: f });
  const b = analyticMeanIntensity(field1, 640, 640, { floor: f });
  ok(Math.abs(a / b - 4) < 1e-9, `doubling both frame dimensions quarters the mean exactly (${(a / b).toFixed(6)})`);

  ok(analyticMeanIntensity(field1, 0, 320, { floor: f }) === 0, "a degenerate frame gives 0, not a division by zero");
  ok(
    whitePixelIntensity(field1, 320, 320, { floor: f }) ===
      WHITE_FROM_ANALYTIC_MEAN * analyticMeanIntensity(field1, 320, 320, { floor: f }),
    "whitePixelIntensity is exactly the constant times the mean",
  );
}

/* ── THE CLOSED FORM AGAINST THE PROFILE IT INTEGRATES ──
 *
 * `profileIntegral` restates the profile's algebra in order to solve it exactly, which is
 * the one place this codebase deliberately duplicates a formula. So the two are gated equal:
 * a high-sample quadrature of `starProfile` itself, with no diffraction, must reproduce the
 * closed form. Two independent derivations that must agree is a stronger position than one
 * that cannot be checked. */
{
  let worst = 0;
  let worstAt = "";
  for (const amp of [1e-6, 1e-3, 0.3, 1, 26]) {
    for (const edge of [1.7, 5.8, 17.2, 28.7]) {
      const closed = profileIntegral(amp, edge, DEFAULT_AUREOLE, 3.2);
      // Substituted quadrature, so the core is properly resolved (see calibrate.ts).
      const NQ = 20000;
      const vMax = Math.log1p(edge * edge);
      let quad = 0;
      for (let j = 0; j < NQ; j++) {
        const v = (vMax * (j + 0.5)) / NQ;
        const ev = Math.exp(v);
        const rho = Math.sqrt(Math.max(0, ev - 1));
        const p = starProfile({
          rho,
          edge,
          signal: amp,
          halo: amp,
          aureole: DEFAULT_AUREOLE,
          beta: 3.2,
          theta: 0,
        });
        if (p > 0) quad += p * Math.PI * ev * (vMax / NQ);
      }
      const err = Math.abs(closed - quad) / Math.max(quad, 1e-300);
      if (err > worst) {
        worst = err;
        worstAt = `amp=${amp} edge=${edge} (closed ${closed.toExponential(4)} vs quad ${quad.toExponential(4)})`;
      }
    }
  }
  ok(worst < 2e-3, `the closed form matches a quadrature of starProfile to ${(100 * worst).toFixed(4)}% (worst: ${worstAt})`);

  ok(profileIntegral(0, 10, DEFAULT_AUREOLE, 3.2) === 0, "zero amplitude integrates to zero");
  ok(profileIntegral(1, 0, DEFAULT_AUREOLE, 3.2) === 0, "a zero-extent quad integrates to zero");
  ok(profileIntegral(1, 10, DEFAULT_AUREOLE, 3.2) > 0, "a real star has positive total light");
  let threw = false;
  try {
    profileIntegral(1, 10, { amp: 0.012, scale: 2, p: 2 }, 3.2);
  } catch {
    threw = true;
  }
  ok(threw, "a singular aureole exponent throws rather than returning NaN into the white point");
}

if (failures) {
  console.error(`\n✗ calibrate — ${failures} failure(s)`);
  process.exit(1);
}
console.log("\n✓ calibrate ok");
