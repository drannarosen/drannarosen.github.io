/*
 * check-imf-surface.mjs — `core/imf` exports IMF mathematics and nothing else.
 *
 * ── WHY A GATE AND NOT A COMMENT ──
 *
 * This module used to export a `sampleCluster` returning `sizePx`, `baseOpacity` and `twinkles`:
 * canvas pixels, in the layer whose whole purpose is to be pure, portable and node-runnable. It
 * also derived Teff through its own clamped wrappers instead of the `star(M, Z, t)` contract, and
 * collided by name with `core/cluster.sampleCluster`.
 *
 * `check-novascope-boundary` cannot catch that recurring, and it is worth being precise about
 * why: that gate checks IMPORTS and DOM globals. A field called `sizePx` imports nothing and
 * touches no DOM. The boundary gate would have stayed green through the entire original mistake,
 * and did.
 *
 * So the thing to pin is the SURFACE. A new export here has to be a property of a mass function —
 * how many stars of each mass a law predicts, or how to draw one. Not a position, not a colour,
 * not a pixel, and not a sampler that assembles all three.
 *
 * ── WHY IT FAILS ON ADDITIONS TOO, NOT JUST REMOVALS ──
 *
 * A removal breaks a consumer and is loud already. An ADDITION is the silent direction: nothing
 * fails, the module quietly grows a second job, and a year later Layer 0 is a grab bag again.
 * Failing on both means the list is a decision that has to be re-made deliberately rather than
 * drifted into.
 */
import * as imf from "../src/novascope/core/imf/index.ts";

/**
 * The permitted surface. Every entry is a property of a mass function.
 *
 * Adding a name here is a real decision — read the header first, then apply the test it states:
 * would a consumer who never renders anything want this?
 */
const ALLOWED = [
  "MASCHBERGER_BETA",
  "MASCHBERGER_MU",
  "alpha3FromEnvironment",
  "buildKroupaSegments",
  "kroupaMassFraction",
  "maschbergerMass",
  "maschbergerMassFraction",
  "sampleKroupaMass",
].sort();

const actual = Object.keys(imf).sort();

const added = actual.filter((n) => !ALLOWED.includes(n));
const removed = ALLOWED.filter((n) => !actual.includes(n));

console.log("imf-surface (core/imf exports IMF mathematics and nothing else):");
console.log(`  ${actual.length} export(s): ${actual.join(", ")}`);

let failures = 0;

if (added.length) {
  failures++;
  console.error(`\n  FAIL  core/imf gained ${added.length} export(s): ${added.join(", ")}`);
  console.error(
    "        core/imf is PURE IMF MATHEMATICS. A new export here must be a property of a mass\n" +
      "        function — not a position, a colour, a pixel, or a cluster sampler. Sampling a\n" +
      "        cluster belongs in core/cluster; a star's state in core/stellar.star(); anything\n" +
      "        drawable in state/render.\n" +
      "        If it genuinely belongs, add it to ALLOWED in this file and say why in the commit.",
  );
}

if (removed.length) {
  failures++;
  console.error(`\n  FAIL  core/imf lost ${removed.length} export(s): ${removed.join(", ")}`);
  console.error("        Update ALLOWED in this file if the removal is intended.");
}

if (failures) {
  console.error(`\n✗ imf-surface — ${failures} failure(s)`);
  process.exit(1);
}

console.log("\n✓ imf-surface ok — the surface is exactly the IMF laws.");
