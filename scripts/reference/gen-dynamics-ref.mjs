/*
 * gen-dynamics-ref.mjs — freeze what `core/dynamics` does TODAY, before it moves.
 *
 * WHY THIS EXISTS AT ALL, AND WHY IT IS ITS OWN COMMIT.
 *
 * `core/dynamics` is 481 lines with zero callers and zero gates (2026-07-26 audit §4a). It is
 * about to be re-homed into `dynamics/gasExpulsion/` on top of a shared integrator. A "pure
 * move" that silently changed a number would be invisible — nothing runs it, so nothing would
 * notice. A baseline captured ALONGSIDE that change proves only that the new code agrees with
 * itself; captured BEFORE it, it certifies the old behaviour independently.
 *
 * So this runs first, on its own commit, against the code as it stands.
 *
 * WHAT IT RECORDS. The gas-expulsion run at three star-formation efficiencies, at three
 * points each: the settled cluster, and 5 and 10 crossing times after expulsion begins. Those
 * are the quantities the module is FOR — a survival verdict — rather than internal state,
 * so a refactor that preserves them has preserved what matters.
 *
 * THE FINGERPRINT, and what the 2026-07-26 audit taught about it (§3e). `check-calibrate`'s
 * fixture claimed to fingerprint "the population" and did not, so a changed sampler would trip
 * a DIFFERENT assertion and tell you to re-tune a physical constant — the wrong instruction.
 * The fingerprint here therefore covers the actual inputs: a sha256 of each of the three
 * binary files, plus G, the gas grid extent and RELAX_TCROSS. If those move, the gate says
 * REGENERATE. If they hold and the numbers moved, the gate says the PHYSICS moved — which,
 * during the re-home, is precisely the question being asked.
 *
 * NEVER BIT-IDENTITY. The hero fixture asserted `toPrecision(15)` on `Math.pow` across CPU
 * architectures, passed locally, and failed the deploy (audit addendum). This integrates
 * 6,000 sub-steps, and `binOf` floors a logarithm — a star sitting on a bin boundary can
 * change bins on a one-ulp difference and feel a discontinuously different force. So the gate
 * compares on a RELATIVE tolerance chosen for what counts as a material change in the
 * physics, not for what this machine happens to reproduce.
 *
 * Usage:
 *   node --experimental-strip-types scripts/reference/gen-dynamics-ref.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createDynamics, RELAX_TCROSS } from "../../src/novascope/core/dynamics/index.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");
const DATA = resolve(ROOT, "public/data/gravoturb");

/* The three efficiencies the module header itself tabulates, so the fixture speaks to the
   same cases the comments do. tauOverTCross and qTarget are the module's own defaults. */
export const RUNS = [
  { id: "sfe-0.05", sfe: 0.05, tauOverTCross: 1, qTarget: 0.5 },
  { id: "sfe-0.20", sfe: 0.2, tauOverTCross: 1, qTarget: 0.5 },
  { id: "sfe-0.50", sfe: 0.5, tauOverTCross: 1, qTarget: 0.5 },
];

/** Crossing times after expulsion begins at which the run is sampled. */
export const EXPULSION_CHECKPOINTS = [5, 10];

function readF32(name) {
  const buf = readFileSync(resolve(DATA, name));
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
}

function sha256(name) {
  return createHash("sha256").update(readFileSync(resolve(DATA, name))).digest("hex").slice(0, 16);
}

/**
 * Load the shipped fiducial realization exactly as a consumer would.
 *
 * G comes from meta.json rather than from `core/constants`. That is deliberate: progenax's
 * exported G is 0.004498479820381242 and novascope's derived value is 0.004498502151469551,
 * a relative difference of 5.0e-6. The run must reproduce what the module does TODAY, and
 * today it consumes the exported number. Which of the two is canonical is a separate
 * question, and answering it here would change the thing being frozen.
 */
export function loadFiducial() {
  const meta = JSON.parse(readFileSync(resolve(DATA, "meta.json"), "utf8"));
  return {
    meta,
    init: {
      stars: readF32("stars.f32"),
      velocities: readF32("velocities.f32"),
      gasMenc: readF32("gas_menc.f32"),
      gasMencRMax: meta.gas_menc_r_max_pc,
      G: meta.G_pc3_msun_myr2,
    },
  };
}

/** The identity of everything that feeds the run. Changing any of it invalidates the fixture. */
export function inputFingerprint(meta) {
  return {
    stars: sha256("stars.f32"),
    velocities: sha256("velocities.f32"),
    gasMenc: sha256("gas_menc.f32"),
    G: meta.G_pc3_msun_myr2,
    gasMencRMax: meta.gas_menc_r_max_pc,
    relaxTCross: RELAX_TCROSS,
  };
}

/**
 * Run one configuration to the settled state, expel, and sample.
 *
 * Stepping in whole crossing times matches how a caller drives it (`step` sub-steps
 * internally to `SUBSTEPS` per crossing time regardless), and it keeps the sample points
 * expressible in the module's own time unit rather than in Myr, which depends on the data.
 */
export function runOne(dyn, run) {
  dyn.setParams({ sfe: run.sfe, tauOverTCross: run.tauOverTCross, qTarget: run.qTarget });
  const tCross = dyn.tCross;

  while (dyn.diagnostics().settleProgress < 1) dyn.step(tCross);
  const settled = dyn.diagnostics();

  dyn.beginExpulsion();
  const after = [];
  let done = 0;
  for (const mark of EXPULSION_CHECKPOINTS) {
    while (done < mark) { dyn.step(tCross); done++; }
    const g = dyn.diagnostics();
    after.push({
      tCross: mark,
      survivingFraction: g.survivingFraction,
      boundMassFraction: g.boundMassFraction,
      boundFraction: g.boundFraction,
      rHalf: g.rHalf,
      energy: g.energy,
      qVirial: g.qVirial,
      mGas: g.mGas,
    });
  }

  return {
    id: run.id,
    ...run,
    tCross,
    settled: {
      boundMassFraction: settled.boundMassFraction,
      boundFraction: settled.boundFraction,
      rHalf: settled.rHalf,
      energy: settled.energy,
      qVirial: settled.qVirial,
      localSfe: settled.localSfe,
    },
    after,
  };
}

/* ── generate ── */

if (import.meta.url === `file://${process.argv[1]}`) {
  const { meta, init } = loadFiducial();
  const dyn = createDynamics(init);
  console.log(`realization ${meta.realization} — ${dyn.n} stars, M* = ${dyn.mStar.toFixed(1)} Msun`);

  const t0 = performance.now();
  const runs = RUNS.map((run) => {
    const row = runOne(dyn, run);
    console.log(
      `  ${row.id}  settled boundMass ${row.settled.boundMassFraction.toFixed(6)}` +
        `  localSfe ${row.settled.localSfe.toFixed(6)}` +
        `  surviving@10 ${row.after[1].survivingFraction.toFixed(6)}`,
    );
    return row;
  });
  const elapsed = (performance.now() - t0) / 1000;

  const out = {
    generatedBy: "scripts/reference/gen-dynamics-ref.mjs",
    subject: "src/novascope/core/dynamics — gas expulsion survival, frozen before the re-home",
    realization: meta.realization,
    nStars: dyn.n,
    mStarMsun: dyn.mStar,
    fingerprint: inputFingerprint(meta),
    expulsionCheckpoints: EXPULSION_CHECKPOINTS,
    runs,
  };
  const path = resolve(ROOT, "scripts/fixtures/dynamics-gasexpulsion.json");
  writeFileSync(path, `${JSON.stringify(out, null, 2)}\n`);
  console.log(`\nwrote ${path} in ${elapsed.toFixed(1)} s`);
}
