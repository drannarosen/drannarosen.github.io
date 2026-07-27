/*
 * check-extinction.mjs — does the TypeScript port reproduce fluxax's curves?
 *
 * `core/extinction` is a PORT, so the only question that matters is whether the transcription
 * landed. Property tests answer it partially: `extinction.test.ts` catches a dropped digit, a
 * transposition and a sign flip in CCM89 — but a last-digit change (0.72085 -> 0.72086) passed
 * all twenty of them. A numerical comparison against the source implementation catches every
 * one, and does not depend on anybody's assertions being sensitive enough.
 *
 * Same family as `check-lupton` (astropy), `check-imf` (progenax) and `check-stellar`
 * (startrax): the reference is another codebase, in another language, not a value this repo
 * generated and then agreed with.
 *
 * 1,182 comparisons — two laws, six R_V values, 87 and 110 wavelengths — plus one deliberate
 * divergence that is asserted rather than tolerated (see §3).
 *
 * Regenerate (needs fluxax's own environment):
 *   cd ~/projects/jaxstro-dev/fluxax
 *   uv run python ~/projects/drannarosen.github.io/scripts/reference/gen-extinction-ref.py
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ccm89AOverAv, ccm89Covers } from "../src/novascope/core/extinction/ccm89.ts";
import { g23AOverAv } from "../src/novascope/core/extinction/g23.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");

/*
 * Tolerance. Both sides are float64 evaluating the same closed-form expressions, so the only
 * honest source of disagreement is the order of operations and each runtime's `Math.pow` /
 * `Math.exp`. That is a handful of ulps, i.e. ~1e-15 relative.
 *
 * 1e-10 is therefore five orders of headroom over the expected disagreement, and still eleven
 * orders tighter than the smallest transcription error that matters: changing CCM89's y^4
 * coefficient in its LAST digit (0.72085 -> 0.72086) moves the curve by ~1e-5, which this
 * catches by a factor of 100,000. The bound is set from what the two implementations can
 * legitimately differ by, not from what they were observed to differ by.
 */
const TOL = 1e-10;

const fixture = JSON.parse(
  readFileSync(resolve(ROOT, "scripts/fixtures/extinction-fluxax.json"), "utf8"),
);

let failures = 0;
const ok = (cond, msg) => {
  console.log(`  ${cond ? "ok  " : "FAIL"}  ${msg}`);
  if (!cond) failures++;
};

console.log("extinction (novascope/core) against fluxax:\n");
console.log(`  reference: ${fixture.reference}`);
console.log(`  ${fixture.papers.ccm89}`);
console.log(`  ${fixture.papers.g23}\n`);

/* ── 1 & 2. the two curves, over every recorded wavelength and R_V ── */

/**
 * Where the two implementations are expected to agree exactly.
 *
 * G23's FUV curvature term F(x) (Eq 6) is non-zero only above x = 5.9 um^-1, i.e. BELOW
 * 169.49 nm. fluxax hardcodes `F(x) = 0` everywhere, with the comment that this is "always
 * true in-range (x <= 3.33)" — correct for fluxax's bands, and a simplification rather than
 * the published equation. novascope implements Eq 6 as the digest verifies it, so the two
 * legitimately differ in the FUV and nowhere else.
 *
 * That region is compared separately below rather than being quietly excluded.
 */
const G23_FUV_EDGE_NM = 1000 / 5.9;

function compareLaw(name, fn, block, { skipBelowNm = 0 } = {}) {
  let worst = 0;
  let worstAt = "";
  let compared = 0;
  let nonFinite = 0;

  for (const run of block.runs) {
    block.lambdaNm.forEach((nm, i) => {
      if (nm < skipBelowNm) return;
      const want = run.aOverAv[i];
      const got = fn(nm, run.rv);
      if (!Number.isFinite(got)) {
        nonFinite++;
        return;
      }
      compared++;
      const rel = want === 0 ? Math.abs(got) : Math.abs(got - want) / Math.abs(want);
      if (rel > worst) {
        worst = rel;
        worstAt = `${nm.toFixed(1)} nm, R_V ${run.rv}`;
      }
    });
  }

  ok(
    nonFinite === 0,
    `${name}: every recorded point is inside novascope's domain (${nonFinite} were not)`,
  );
  ok(
    worst < TOL,
    `${name}: ${compared} comparisons agree to ${worst.toExponential(2)}` +
      (worst > 0 ? ` (worst at ${worstAt})` : " — bit-for-bit") +
      `, tolerance ${TOL}`,
  );
  return worst;
}

compareLaw("CCM89", ccm89AOverAv, fixture.ccm89);
compareLaw("G23  ", g23AOverAv, fixture.g23, { skipBelowNm: G23_FUV_EDGE_NM });

/* The FUV region, where the divergence is expected and has a direction. Both c4 coefficients
   are positive (Table 2: 0.11303 and 0.65484) and F(x) > 0 above 5.9 um^-1, so implementing
   the term must make novascope's curve LARGER than fluxax's, never smaller. Asserting the
   direction is what turns "they differ" into "they differ for the reason stated". */
{
  let checked = 0;
  let allLarger = true;
  let biggest = 0;
  for (const run of fixture.g23.runs) {
    fixture.g23.lambdaNm.forEach((nm, i) => {
      if (nm >= G23_FUV_EDGE_NM) return;
      const ours = g23AOverAv(nm, run.rv);
      const theirs = run.aOverAv[i];
      checked++;
      if (!(ours > theirs)) allLarger = false;
      biggest = Math.max(biggest, Math.abs(ours - theirs) / Math.abs(theirs));
    });
  }
  ok(
    checked > 0 && allLarger,
    `G23  : below ${G23_FUV_EDGE_NM.toFixed(1)} nm novascope exceeds fluxax at all ${checked} ` +
      `points (up to ${(biggest * 100).toFixed(1)}%) — the FUV curvature term F(x), Eq 6`,
  );
  console.log(
    "        ^ deliberate: fluxax hardcodes F(x) = 0 because its bands stop at x <= 3.33.\n" +
      "          novascope implements Eq 6, so its stated 912 A validity is true. NOTE that this\n" +
      "          region is therefore verified by the equation digest ALONE, not cross-checked\n" +
      "          against a second implementation — and no passband here reaches it (the bluest,\n" +
      "          HST F275W, sits at 270.8 nm).",
  );
}

/* ── 3. the ONE place novascope deliberately disagrees, asserted rather than tolerated ── */

console.log("");
const od = fixture.ccm89OutOfDomain;
let divergenceHolds = od.lambdaNm.length > 0;
od.lambdaNm.forEach((nm, i) => {
  const fluxaxValue = od.fluxaxAOverAv[i];
  const ours = ccm89AOverAv(nm, 3.1);
  // fluxax must produce a finite number here, and we must refuse.
  if (!Number.isFinite(fluxaxValue) || !Number.isNaN(ours) || ccm89Covers(nm)) {
    divergenceHolds = false;
  }
});
ok(
  divergenceHolds,
  `CCM89: novascope returns NaN at the ${od.lambdaNm.length} bands outside its implemented ` +
    `branches (${od.lambdaNm.map((n) => `${n.toFixed(0)}nm`).join(", ")}) where fluxax ` +
    `extrapolates to ${od.fluxaxAOverAv.map((v) => v.toFixed(3)).join(", ")}`,
);
console.log(
  "        ^ deliberate: fluxax has no UV branch and no domain guard, which is correct for its\n" +
    "          band set (x <= 3.33) and wrong for this one (HST F275W sits at x = 3.69). The\n" +
    "          extrapolated 0.978 is BELOW CCM89's own value at its valid edge (1.80), when\n" +
    "          extinction should be rising steeply into the near-UV.",
);

if (failures > 0) {
  console.error(`\n✗ ${failures} check(s) failed — the port no longer reproduces its reference.`);
  process.exit(1);
}
console.log("\n✓ extinction port reproduces fluxax across both laws.");
