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
  analyticChannelMeans,
  skyChannelWeights,
  NEUTRAL_SKY,
  analyticMeanIntensity,
  whitePixelIntensity,
  profileIntegral,
  calibrationFingerprint,
  floorForDepth,
  CALIBRATION_RUNS,
  WHITE_FROM_ANALYTIC_MEAN,
} from "../src/novascope/viz/starfield/calibrate.ts";
import { starProfile } from "../src/novascope/viz/starfield/profile.ts";
import { transferFloor } from "../src/novascope/core/imaging/transfers.ts";
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
  /* A LOOSE PLAUSIBILITY BOUND, deliberately not tuned to the measurements.
   *
   * The measured ratios run 27-39, and bounds set near those would be a copy of the fixture — which
   * cannot fail, since `k` is the fixture's own ratio once the mean is asserted above. This instead
   * asserts something independent: white-over-mean is a SHAPE factor for a heavily skewed
   * distribution, so a star field cannot plausibly sit below ~5 (the 99.5th percentile barely above
   * the mean) or above ~200. It catches a corrupted fixture row or a units error, and it can never
   * go stale because it was never fitted. */
  ok(k > 5 && k < 200, `${run.id}: white/mean = ${k.toFixed(2)} is a plausible skew factor`);
}

/* The constant and the spread, re-derived over ALL configurations on every build now that
 * doing so costs nothing. This is the assertion the two-size split could not make. */
{
  const lo = Math.min(...ratios);
  const hi = Math.max(...ratios);
  const geo = Math.exp(ratios.reduce((a, b) => a + Math.log(b), 0) / ratios.length);
  ok(
    /* 0.2%, not 2%. The looser bound let the constant sit at 33.70 while the fixture's own
     * geometric mean had moved to 33.91 — a 0.62% drift, absorbed silently, which is precisely the
     * two-homes-for-one-fact failure the fixture exists to prevent. The constant IS the fixture's
     * geometric mean, so the tolerance only has to cover rounding to two decimals. */
    Math.abs(geo - WHITE_FROM_ANALYTIC_MEAN) / WHITE_FROM_ANALYTIC_MEAN < 0.002,
    Math.abs(geo - WHITE_FROM_ANALYTIC_MEAN) / WHITE_FROM_ANALYTIC_MEAN < 0.002
      ? `the constant is the geometric mean of all ${ratios.length} (${geo.toFixed(2)})`
      : `CONSTANT DRIFTED — set WHITE_FROM_ANALYTIC_MEAN in src/novascope/viz/starfield/calibrate.ts to ${geo.toFixed(2)} (currently ${WHITE_FROM_ANALYTIC_MEAN})`,
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
  /*
   * THE TWO WINGS NOW DIFFER HERE, DELIBERATELY, and the asymmetry is the thing to record.
   *
   * Both closed forms have exponents where the general expression divides by zero while the
   * integral is finite — the antiderivative turns into a logarithm. The question is what to do
   * about a removable singularity, and the answer depends on whether it is REACHABLE:
   *
   *   - The AUREOLE's exponent is fixed at 3 and is not a control. Its singular cases stay a
   *     throw, because an unreachable branch that silently returns a number is a branch nobody
   *     will ever check; a throw says "you have moved somewhere unverified".
   *   - The DIFFRACTION exponent is 2 — one of the singular values — since it was derived from
   *     Fraunhofer. So it needs the limit form, which `check:star-optics` verifies against
   *     numerical integration at every exponent including this one.
   *
   * What this asserts is the property that matters to the white point either way: no NaN and no
   * Infinity reaches the exposure. A NaN there does not crash, it makes the whole frame black.
   */
  {
    let threw = false;
    try {
      aureoleIntegral(10, { amp: 0.012, scale: 2, p: 2 });
    } catch {
      threw = true;
    }
    ok(threw, "a singular AUREOLE exponent throws rather than returning NaN into the white point");
  }
  for (const p of [1, 2]) {
    const v = diffractionIntegral(10, { ...DEFAULT_DIFFRACTION, p });
    ok(
      Number.isFinite(v) && v > 0,
      `the DIFFRACTION integral is finite and positive at its logarithmic exponent p = ${p} (${v.toExponential(3)})`,
    );
  }
  ok(
    Number.isFinite(diffractionIntegral(10, DEFAULT_DIFFRACTION)),
    `…and the SHIPPED exponent p = ${DEFAULT_DIFFRACTION.p} is one of them, which is why it is no longer a throw`,
  );
}

/* ── THE SKY HAS A COLOUR, AND THE PER-BAND SUBTRACTION MUST REDUCE TO THE SCALAR ONE ── */
/*
 * The renderer subtracted ONE scalar from three channels, which changes their ratios and is
 * therefore a colour operation wearing a brightness operation's name. Measured on the shipped
 * population at a 6.43%-of-white subtraction: 100% of blue stars survived against 3.3% of red
 * ones. What is gated here is the property that made the fix safe to make — unit-mean weights, so
 * a grey background reproduces the old behaviour EXACTLY and only coloured backgrounds change.
 */
console.log("\n  the sky's colour (per-band subtraction):");
{
  const field = prepareStarField(clusterStarTable({ sampling: { mode: "count", target: 4000 } }), {
    scheme: "true",
    band: "LSST_r",
    bandTriple: ["LSST_i", "LSST_r", "LSST_g"],
    starDepthMag: 24,
    pixelDepthMag: 20,
    scaling: "lupton",
    distancePc: 400,
  });
  const opts = { floor: transferFloor("lupton", 20) };
  const means = analyticChannelMeans(field, 1600, 1000, opts);
  const w = skyChannelWeights(field, 1600, 1000, opts);

  /* The scalar mean must still be exactly the mean of the three, or the two have forked. */
  const scalar = analyticMeanIntensity(field, 1600, 1000, opts);
  const fromChannels = (means[0] + means[1] + means[2]) / 3;
  ok(
    Math.abs(scalar - fromChannels) <= 1e-12 * Math.max(scalar, 1e-30),
    "analyticMeanIntensity IS the mean of the per-channel means — one derivation, not two",
  );

  ok(
    Math.abs((w[0] + w[1] + w[2]) / 3 - 1) < 1e-12,
    `the weights are unit-mean (${w.map((x) => x.toFixed(3)).join(", ")}) — so the TOTAL light removed does not depend on them`,
  );
  ok(
    w[2] > w[1] && w[1] > w[0],
    "…and ordered blue > green > red, because the background IS the summed wings of the hot stars",
  );
  /*
   * The reduction property, stated as a test rather than as a comment: a GREY field must produce
   * neutral weights, so introducing this could not change any image whose sky had no colour.
   */
  const grey = {
    ...field,
    bandFlux: (() => {
      const a = new Float32Array(field.bandFlux.length);
      for (let i = 0; i < field.count; i++) {
        const m =
          ((field.bandFlux[i * 3] ?? 0) +
            (field.bandFlux[i * 3 + 1] ?? 0) +
            (field.bandFlux[i * 3 + 2] ?? 0)) /
          3;
        a[i * 3] = m;
        a[i * 3 + 1] = m;
        a[i * 3 + 2] = m;
      }
      return a;
    })(),
  };
  const gw = skyChannelWeights(grey, 1600, 1000, opts);
  ok(
    gw.every((x) => Math.abs(x - 1) < 1e-9),
    "a GREY background returns [1,1,1] — the per-band subtraction reduces exactly to the scalar one",
  );
  ok(
    NEUTRAL_SKY.every((x) => x === 1),
    "…and that neutral value is the documented fallback, not a coincidence",
  );
}

if (failures) {
  console.error(`\n✗ calibrate — ${failures} failure(s)`);
  process.exit(1);
}
console.log("\n✓ calibrate ok");
