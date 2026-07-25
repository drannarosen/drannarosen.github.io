/*
 * check-calibrate.mjs — gate for the per-pixel exposure calibration.
 *
 * `WHITE_FROM_ANALYTIC_MEAN` stands in for a per-frame histogram pass, so what has to be
 * gated is not its value but its VALIDITY: that the cheap analytic mean really tracks the
 * rendered frame's white point across everything a user can change, and that the spread stays
 * inside the magnitudes claimed for it.
 *
 * Getting the true white point means rasterising, which costs ~100 s for the full sweep
 * against a 4 s build. This gate briefly ran in two sizes because of that — a fast subset in
 * `prebuild` and a slow `--full` for the real claim — which was a bad trade dressed up as a
 * considered one: the fast run could not catch the thing most worth catching, a WIDENING
 * spread, so the gate that ran on every commit was not gating the claim at all.
 *
 * It is not a real trade. The CPU reference is DETERMINISTIC, so it does not belong in the
 * build: `scripts/reference/gen-calibrate-ref.mjs` rasterises once and commits the result, and
 * this compares the millisecond-scale analytic mean against it. All seventeen configurations,
 * every build, in a few milliseconds — strictly more coverage than the slow version at a
 * fraction of the fast version's cost.
 *
 * The fixture's own risk is silent staleness, and that is what `fingerprint` is for.
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { clusterStarTable } from "../src/novascope/viz/starfield/source.ts";
import { prepareStarField } from "../src/novascope/viz/starfield/prepare.ts";
import {
  analyticMeanIntensity,
  whitePixelIntensity,
  profileIntegral,
  calibrationFingerprint,
  floorForDepth,
  CALIBRATION_RUNS,
  WHITE_FROM_ANALYTIC_MEAN,
  WHITE_FROM_ANALYTIC_MEAN_SPREAD,
} from "../src/novascope/viz/starfield/calibrate.ts";
import { starProfile } from "../src/novascope/viz/starfield/profile.ts";
import {
  DEFAULT_AUREOLE,
  DEFAULT_DIFFRACTION,
  moffatIntegral,
  aureoleIntegral,
  diffractionIntegral,
  diffractionAzimuthalMean,
} from "../src/novascope/core/optics/index.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
let failures = 0;
const ok = (cond, msg) => {
  console.log(`  ${cond ? "ok  " : "FAIL"}  ${msg}`);
  if (!cond) failures++;
};

console.log("calibrate (per-pixel exposure):");

const fixture = JSON.parse(
  readFileSync(resolve(HERE, "reference/calibrate-whitepoint.json"), "utf8"),
);

/* ── STALENESS, checked before anything is compared against the fixture ──
 *
 * A committed reference goes on certifying a calibration after the thing it measured has
 * moved. Change the aureole amplitude, the Moffat beta, the PSF width or the quad cap and
 * every recorded white point is wrong while a value-only gate keeps passing. So this is
 * checked first, and reported as an instruction rather than a puzzle. */
{
  const now = calibrationFingerprint();
  ok(
    fixture.fingerprint === now,
    fixture.fingerprint === now
      ? `the fixture matches the current optics (${now})`
      : `STALE FIXTURE — regenerate with 'node --experimental-strip-types scripts/reference/gen-calibrate-ref.mjs'\n        recorded: ${fixture.fingerprint}\n        current:  ${now}`,
  );
  ok(
    fixture.runs.length === CALIBRATION_RUNS.length,
    `the fixture covers all ${CALIBRATION_RUNS.length} configurations`,
  );
}

/* ── THE CLAIM: the analytic mean tracks the recorded white point everywhere ── */
const stars = clusterStarTable({ sampling: { mode: "count", target: 10_000 } });
const ratios = [];
for (const run of CALIBRATION_RUNS) {
  const recorded = fixture.runs.find((r) => r.id === run.id);
  ok(recorded !== undefined, `${run.id}: has a recorded white point`);
  if (!recorded) continue;

  const field = prepareStarField(stars, { ...run.prepare });
  const mean = analyticMeanIntensity(field, run.camera.width, run.camera.height, {
    floor: floorForDepth(run.depthMag),
  });
  /* The analytic mean is recomputed HERE rather than read from the fixture, so a change to a
   * term integral, the profile composition or the quad sizing shows up immediately — it is the
   * half of the comparison that is cheap, and therefore the half worth re-deriving. */
  ok(
    Math.abs(mean - recorded.analyticMean) / recorded.analyticMean < 1e-6,
    `${run.id}: the analytic mean reproduces its recorded value (${mean.toExponential(4)})`,
  );
  const k = recorded.whitePixel / mean;
  ratios.push(k);
  ok(
    k >= WHITE_FROM_ANALYTIC_MEAN_SPREAD.min && k <= WHITE_FROM_ANALYTIC_MEAN_SPREAD.max,
    `${run.id}: white/mean = ${k.toFixed(2)} stays inside the recorded spread`,
  );
}

/* The constant and the spread, re-derived over ALL configurations on every build now that
 * doing so costs nothing. This is the assertion the two-size split could not make. */
{
  const lo = Math.min(...ratios);
  const hi = Math.max(...ratios);
  const geo = Math.exp(ratios.reduce((a, b) => a + Math.log(b), 0) / ratios.length);
  ok(
    Math.abs(geo - WHITE_FROM_ANALYTIC_MEAN) / WHITE_FROM_ANALYTIC_MEAN < 0.02,
    `the constant is the geometric mean of all ${ratios.length} (${geo.toFixed(2)} vs ${WHITE_FROM_ANALYTIC_MEAN})`,
  );
  const spreadMag = 2.5 * Math.log10(hi / lo);
  ok(spreadMag < 0.6, `the spread is ${spreadMag.toFixed(2)} mag`);
  ok(spreadMag > 0.1, "…and not suspiciously zero, which would mean the configurations vary nothing");
}

/* ── SCALING LAWS, which no measured constant can paper over ── */
{
  const field1 = prepareStarField(stars, { bandTriple: ["R", "V", "B"], pixelRatio: 1 });
  const field4 = prepareStarField(stars, {
    bandTriple: ["R", "V", "B"],
    pixelRatio: 1,
    exposure: 4,
  });
  const f = floorForDepth(8);
  const m1 = analyticMeanIntensity(field1, 320, 320, { floor: f });
  const m4 = analyticMeanIntensity(field4, 320, 320, { floor: f });
  // Not exactly 4x: a brighter star also reaches further, so its quad grows too.
  ok(m4 > m1 * 3.5 && m4 < m1 * 5, `4x exposure raises the mean ${(m4 / m1).toFixed(2)}x`);
  ok(
    Math.abs(m1 / analyticMeanIntensity(field1, 640, 640, { floor: f }) - 4) < 1e-9,
    "doubling both frame dimensions quarters the mean exactly",
  );
  ok(
    analyticMeanIntensity(field1, 0, 320, { floor: f }) === 0,
    "a degenerate frame gives 0, not a division by zero",
  );
  ok(
    whitePixelIntensity(field1, 320, 320, { floor: f }) === WHITE_FROM_ANALYTIC_MEAN * m1,
    "whitePixelIntensity is exactly the constant times the mean",
  );
}

/* ── THE TERM INTEGRALS AGAINST THE PROFILE THEY INTEGRATE ──
 *
 * `profileIntegral` composes the area integrals from `core/optics`; each of those states a
 * closed form for a term whose VALUE is defined beside it, so no formula is written twice.
 * A closed form can still be wrong, though, so the composition is checked against a
 * two-dimensional quadrature of `starProfile` itself — radial AND azimuthal, because with
 * diffraction present the profile is not axisymmetric and a radial-only check would miss the
 * angular factor entirely. That factor is exactly what an earlier version got wrong. */
{
  let worst = 0;
  let worstAt = "";
  const NR = 800;
  const NT = 240;
  for (const amp of [1e-3, 1, 26]) {
    for (const edge of [5.8, 17.2, 28.7]) {
      for (const spikes of [undefined, DEFAULT_DIFFRACTION]) {
        const closed = profileIntegral(amp, edge, DEFAULT_AUREOLE, 3.2, spikes);
        // Substituted radially so the Moffat core is resolved (see calibrate.ts).
        const vMax = Math.log1p(edge * edge);
        let quad = 0;
        for (let j = 0; j < NR; j++) {
          const v = (vMax * (j + 0.5)) / NR;
          const ev = Math.exp(v);
          const rho = Math.sqrt(Math.max(0, ev - 1));
          let ring = 0;
          for (let t = 0; t < NT; t++) {
            ring += starProfile({
              rho,
              edge,
              signal: amp,
              halo: amp,
              aureole: DEFAULT_AUREOLE,
              beta: 3.2,
              theta: (2 * Math.PI * (t + 0.5)) / NT,
              ...(spikes === undefined ? {} : { spikes }),
            });
          }
          quad += (ring / NT) * Math.PI * ev * (vMax / NR);
        }
        const err = Math.abs(closed - quad) / Math.max(quad, 1e-300);
        if (err > worst) {
          worst = err;
          worstAt = `amp=${amp} edge=${edge} spikes=${spikes ? "yes" : "no"}`;
        }
      }
    }
  }
  ok(
    worst < 3e-3,
    `the composed integral matches a 2D quadrature of starProfile to ${(100 * worst).toFixed(4)}% (worst: ${worstAt})`,
  );
}

/* ── THE AZIMUTHAL MEAN, against an independent closed form ──
 *
 * `diffractionAzimuthalMean` is computed by quadrature because the exact expression needs a
 * log-gamma this package has no other use for. At the shipped sharpness of 24, (s+1)/2 is a
 * half-integer, so the gamma form is an elementary product and can be evaluated here — a
 * genuinely independent check rather than a finer version of the same sum.
 *
 * Its INDEPENDENCE of spike count and spider angle is asserted too. Both fall out of the
 * substitution u = n (theta - angle), and both are the kind of property an optimisation could
 * break while still producing a plausible image. */
{
  let gamma125 = Math.sqrt(Math.PI);
  for (let k = 0; k < 12; k++) gamma125 *= k + 0.5; // Gamma(12.5)
  let gamma13 = 1;
  for (let k = 1; k <= 12; k++) gamma13 *= k; // Gamma(13) = 12!
  const exact = gamma125 / (2 * Math.sqrt(Math.PI) * gamma13);
  const got = diffractionAzimuthalMean(24);
  ok(
    Math.abs(got - exact) < 1e-9,
    `the azimuthal mean at sharpness 24 matches the gamma form (${got.toFixed(8)} vs ${exact.toFixed(8)})`,
  );
  ok(
    Math.abs(1 / got - 12.4) < 0.1,
    "…so a spike's peak overstates its contribution to the total light by 12.4x",
  );

  for (const n of [2, 6, 8]) {
    ok(
      Math.abs(
        diffractionIntegral(20, { ...DEFAULT_DIFFRACTION, spikes: n }) -
          diffractionIntegral(20, DEFAULT_DIFFRACTION),
      ) < 1e-12,
      `${n} spikes carry the same total light as 4 — the mean is independent of spike count`,
    );
  }
  for (const angle of [0.7, Math.PI / 3]) {
    ok(
      Math.abs(
        diffractionIntegral(20, { ...DEFAULT_DIFFRACTION, angle }) -
          diffractionIntegral(20, DEFAULT_DIFFRACTION),
      ) < 1e-12,
      `…and rotating the spider by ${angle.toFixed(2)} rad changes nothing`,
    );
  }
  ok(diffractionAzimuthalMean(0) === 1, "a sharpness of 0 means no angular narrowing at all");
}

/* ── BOUNDARIES on the term integrals ── */
{
  ok(moffatIntegral(0, 1, 3.2) === 0, "a zero-extent Moffat integrates to zero");
  ok(
    moffatIntegral(10, 1, 1) === 0,
    "beta = 1 does not converge and is refused rather than returning Infinity",
  );
  ok(
    moffatIntegral(10, 1, 3.2) > 0 && Number.isFinite(moffatIntegral(1e6, 1, 3.2)),
    "…and it converges to a finite total",
  );
  ok(aureoleIntegral(0, DEFAULT_AUREOLE) === 0, "a zero-extent aureole integrates to zero");
  ok(profileIntegral(0, 10, DEFAULT_AUREOLE, 3.2) === 0, "zero amplitude integrates to zero");
  ok(profileIntegral(1, 0, DEFAULT_AUREOLE, 3.2) === 0, "a zero-extent quad integrates to zero");
  for (const [label, fn] of [
    ["aureole", () => aureoleIntegral(10, { amp: 0.012, scale: 2, p: 2 })],
    ["diffraction", () => diffractionIntegral(10, { ...DEFAULT_DIFFRACTION, p: 1 })],
  ]) {
    let threw = false;
    try {
      fn();
    } catch {
      threw = true;
    }
    ok(threw, `a singular ${label} exponent throws rather than returning NaN into the white point`);
  }
}

if (failures) {
  console.error(`\n✗ calibrate — ${failures} failure(s)`);
  process.exit(1);
}
console.log("\n✓ calibrate ok");
