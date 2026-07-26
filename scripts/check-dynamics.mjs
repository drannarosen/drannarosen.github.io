/*
 * check-dynamics.mjs — does `core/dynamics` still produce the survival verdict it did?
 *
 * The subject is 481 lines that, until this gate existed, nothing ran and nothing tested
 * (2026-07-26 audit §4a). It is being re-homed into `dynamics/gasExpulsion/` on top of a
 * shared integrator, and the point of this gate is that the move is provably a move.
 *
 * TWO FAILURES, AND THEY MEAN OPPOSITE THINGS. That distinction is the whole design, and it
 * is the thing `check-calibrate`'s fixture got wrong (audit §3e): a stale fixture there
 * tripped an assertion whose message told you to re-tune a physical constant, when the
 * correct action was to regenerate. So:
 *
 *   fingerprint differs  -> the INPUTS moved (data regenerated, G changed, RELAX_TCROSS
 *                           changed). The numbers below are meaningless. Regenerate.
 *   fingerprint matches,
 *   numbers differ       -> the PHYSICS moved. During a refactor that is a bug; after a
 *                           deliberate change it is the thing to look at and re-bless.
 *
 * WHY THE TOLERANCE IS 1e-3 AND NOT MACHINE EPSILON. Measured on this machine, two
 * consecutive generations agree bit-for-bit — the arithmetic is deterministic float64. But
 * the hero fixture asserted `toPrecision(15)` on `Math.pow`, passed locally and failed the
 * deploy on a different CPU (audit addendum), and this run integrates 6,000 sub-steps through
 * a `Math.floor(Math.log(r))` bin index. A star sitting on a bin boundary can change bins on
 * a one-ulp difference and feel a discontinuously different force, so cross-architecture
 * agreement is not bounded by anything as small as accumulated round-off.
 *
 * The bound is therefore set from the PHYSICS: a bound-mass fraction or a survival fraction
 * that has moved by more than 0.1% has moved for a reason worth looking at, and one that has
 * moved by less has not. It is not fitted to any observed spread — the observed spread on
 * this machine is exactly zero, and a bound set from that could never fail anywhere else.
 *
 * COST, STATED BECAUSE IT IS THE MOST EXPENSIVE GATE IN THE BUILD. Measured 2026-07-26: 7.8 s,
 * against a 26.4 s build — about 30% on top. It earns that by being the only thing that runs
 * `core/dynamics` at all, and it is in `prebuild` rather than on-demand for one reason: a gate
 * that must fire during a refactor is useless if the refactor can be run without it. If it ever
 * needs trimming, drop the middle SFE, not the settling — the settling is what makes the
 * survival numbers mean anything (see the module header on the sub-virial IC).
 *
 * Usage:
 *   node --experimental-strip-types scripts/check-dynamics.mjs
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createDynamics } from "../src/novascope/core/dynamics/index.ts";
import { loadFiducial, inputFingerprint, runOne, RUNS } from "./reference/gen-dynamics-ref.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");

/** Relative tolerance on every recorded quantity. See the header for why it is not smaller. */
const TOL = 1e-3;

/** Measured 2026-07-26 on this machine: two consecutive generations agreed bit-for-bit. */
const OBSERVED_SAME_MACHINE_SPREAD = 0;

const fixture = JSON.parse(
  readFileSync(resolve(ROOT, "scripts/fixtures/dynamics-gasexpulsion.json"), "utf8"),
);

const fail = (msg) => {
  console.error(`\n✗ ${msg}`);
  process.exit(1);
};

console.log("check-dynamics — gas-expulsion survival against the frozen reference\n");

/* ── 1. the inputs must be the ones the fixture was taken over ── */

const { meta, init } = loadFiducial();
const live = inputFingerprint(meta);
for (const [key, want] of Object.entries(fixture.fingerprint)) {
  if (live[key] !== want) {
    fail(
      `STALE FIXTURE — input '${key}' changed (fixture ${want}, now ${live[key]}).\n` +
        `  The recorded numbers describe a different run and cannot certify this one.\n` +
        `  Regenerate:  node --experimental-strip-types scripts/reference/gen-dynamics-ref.mjs\n` +
        `  Then READ the diff — a changed realization legitimately changes the physics.`,
    );
  }
}
console.log(`  inputs match the fixture (${fixture.realization}, ${fixture.nStars} stars)`);

/* ── 2. the physics must still produce the same verdict ── */

const dyn = createDynamics(init);
if (dyn.n !== fixture.nStars) fail(`star count ${dyn.n} != fixture ${fixture.nStars}`);

let worst = { rel: 0, where: "—" };
let compared = 0;

const compare = (where, got, want) => {
  compared++;
  // Relative where the reference is non-zero; absolute at zero, where a ratio is undefined.
  const rel = want === 0 ? Math.abs(got) : Math.abs(got - want) / Math.abs(want);
  if (rel > worst.rel) worst = { rel, where };
  if (rel > TOL) {
    fail(
      `PHYSICS DRIFTED — ${where}\n` +
        `  fixture ${want}\n` +
        `  now     ${got}\n` +
        `  relative difference ${rel.toExponential(3)} exceeds ${TOL}.\n` +
        `  The inputs are unchanged, so this is a real change in behaviour. If it was\n` +
        `  intended, regenerate the fixture and say in the commit what moved and why.`,
    );
  }
};

for (const run of RUNS) {
  const want = fixture.runs.find((r) => r.id === run.id);
  if (!want) fail(`fixture has no run '${run.id}' — regenerate`);
  const got = runOne(dyn, run);

  compare(`${run.id} tCross`, got.tCross, want.tCross);
  for (const key of Object.keys(want.settled)) {
    compare(`${run.id} settled.${key}`, got.settled[key], want.settled[key]);
  }
  want.after.forEach((wantMark, i) => {
    for (const key of Object.keys(wantMark)) {
      compare(`${run.id} +${wantMark.tCross}tc.${key}`, got.after[i][key], wantMark[key]);
    }
  });

  console.log(
    `  ${run.id}  boundMass ${got.settled.boundMassFraction.toFixed(6)}` +
      `  localSfe ${got.settled.localSfe.toFixed(6)}` +
      `  surviving@10 ${got.after[1].survivingFraction.toFixed(6)}`,
  );
}

const worstText =
  worst.rel === 0
    ? "exact — every quantity reproduced bit-for-bit"
    : `worst ${worst.rel.toExponential(2)} at ${worst.where}`;
console.log(
  `\n✓ ${compared} quantities within ${TOL} of the frozen reference (${worstText};` +
    ` same-machine spread when recorded: ${OBSERVED_SAME_MACHINE_SPREAD}).`,
);
