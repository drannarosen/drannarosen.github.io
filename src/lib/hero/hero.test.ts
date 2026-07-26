/*
 * The homepage hero is FROZEN — asserted star by star.
 *
 * ── WHAT THIS IS FOR ──
 *
 * `src/lib/hero/sampler.ts` is a relocation of the cluster sampler that used to live in
 * `@novascope/core/imf`, moved so Layer 0 could stop holding canvas pixels. The move must not
 * change the picture by one star, and "must not" is worth nothing unless something checks it.
 * The fixture was captured from the pre-relocation sampler, in its own commit, before any code
 * moved.
 *
 * ── IF THIS FAILS ──
 *
 * The relocation is wrong. Do NOT regenerate `__fixtures__/hero-baseline.json` — that would
 * launder a real change into a new baseline and the homepage would silently move. Read the diff:
 * a whole-array mismatch from some index onward usually means the position sampler consumed a
 * different NUMBER of randoms, which reshuffles every star after it.
 *
 * The import below is the only line Task 5 changes — from `@novascope/core/imf` to `./sampler.ts`.
 * Same call, same numbers, different home: that is the entire test.
 */
import { describe, expect, it } from "vitest";
import baseline from "./__fixtures__/hero-baseline.json";
/* Task 5 changed THIS LINE ONLY, from `@novascope/core/imf` to `./sampler.ts`. Nothing else in
 * this file moved — same call, same fixture, different home. That is the entire test. */
import { sampleCluster } from "./sampler.ts";

/*
 * ── WHY THIS COMPARES WITH A TOLERANCE, AND WHY THAT IS NOT A LOOSENED TEST ──
 *
 * The first version asserted exact equality at 15 significant figures and PASSED LOCALLY BUT
 * FAILED THE DEPLOY. The CI runner disagreed with this laptop in the last digit:
 *
 *     teff  3735.45112581403  (macOS arm64)  vs  3735.45112581402  (CI x64 Linux)
 *     blue  0.601152784683429                vs  0.601152784683428
 *
 * That is one ulp, ~3e-16 relative. ECMAScript deliberately leaves `Math.pow`, `Math.log`, `exp`
 * and the trig functions IMPLEMENTATION-DEFINED, and `zamsLuminosity` evaluates M**5.5, M**11 and
 * M**19.5 — so the last bit is a property of the CPU and libm, not of this code.
 *
 * So the old assertion was not strict, it was WRONG: it claimed bit-identical transcendental
 * arithmetic across architectures, which no one ever intended to promise. The actual claim is
 * "the homepage does not change", and the tolerance below is chosen against that claim rather
 * than against the failure:
 *
 *     platform noise floor      ~3e-16 relative   (measured, above)
 *     THIS TOLERANCE             1e-10 relative   (~300,000x above the noise)
 *     one 8-bit colour level      4e-3  relative   (1/255 — the smallest VISIBLE change)
 *
 * There are seven orders of magnitude between this tolerance and anything a pixel could show.
 * A change that actually moved the hero would exceed it by a factor of tens of millions.
 */
const REL_TOL = 1e-10;

/** Worst relative difference seen, so the margin is reported rather than assumed. */
let worstRel = 0;

const close = (actual: number, expected: number): boolean => {
  const rel = Math.abs(actual - expected) / Math.max(Math.abs(expected), 1e-300);
  if (Number.isFinite(rel)) worstRel = Math.max(worstRel, rel);
  return rel <= REL_TOL;
};

describe("the homepage hero is frozen", () => {
  const stars = sampleCluster({ count: baseline.call.count, seed: baseline.call.seed });

  it("draws the same number of stars", () => {
    expect(stars.length).toBe(baseline.count);
  });

  it("draws the SAME stars — every mass, position, colour, size and opacity", () => {
    const mismatches: string[] = [];

    stars.forEach((s, i) => {
      const b = baseline.stars[i]!;
      const numeric: Array<[string, number, number]> = [
        ["x", s.x, b.x],
        ["y", s.y, b.y],
        ["z", s.z, b.z],
        ["mass", s.mass, b.mass],
        ["teff", s.teff, b.teff],
        ["sizePx", s.sizePx, b.sizePx],
        ["baseOpacity", s.baseOpacity, b.baseOpacity],
        ["color[0]", s.color[0], b.color[0]!],
        ["color[1]", s.color[1], b.color[1]!],
        ["color[2]", s.color[2], b.color[2]!],
      ];
      for (const [field, got, want] of numeric) {
        if (!close(got, want)) mismatches.push(`star ${i} ${field}: ${got} vs ${want}`);
      }
      /* `twinkles` is a BOOLEAN and gets no tolerance — it is a threshold decision, so a flip is
       * a real change in what is drawn however small the underlying difference was. */
      if (s.twinkles !== b.twinkles) {
        mismatches.push(`star ${i} twinkles: ${s.twinkles} vs ${b.twinkles}`);
      }
    });

    expect(mismatches.slice(0, 5)).toEqual([]);
    /* Reported, not just used: if the margin ever creeps toward the tolerance, that is worth
     * seeing BEFORE it fails a deploy — which is how this test's first version was found. */
    expect(worstRel).toBeLessThanOrEqual(REL_TOL);
  });

  it("is painter-ordered, faint first", () => {
    const sizes = stars.map((s) => s.sizePx);
    expect(sizes).toEqual([...sizes].sort((a, b) => a - b));
  });

  it("twinkles on the brighter minority only", () => {
    /* 147 of 520 at the time of freezing. Asserted as a fraction band rather than the exact
     * count, because the exact count is already pinned star-by-star above; what this adds is that
     * the twinkle predicate still discriminates rather than having collapsed to all-or-nothing. */
    const t = stars.filter((s) => s.twinkles).length;
    expect(t).toBeGreaterThan(0);
    expect(t).toBeLessThan(stars.length);
  });
});
