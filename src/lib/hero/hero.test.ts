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
// ← Task 5 changes THIS LINE ONLY, to `from "./sampler.ts"`. Everything else stays.
import { sampleCluster } from "@novascope/core/imf";

/** Same rounding the generator applied, so the two are compared at the same precision. */
const round = (v: number): number => Number(v.toPrecision(15));

describe("the homepage hero is frozen", () => {
  const stars = sampleCluster({ count: baseline.call.count, seed: baseline.call.seed });

  it("draws the same number of stars", () => {
    expect(stars.length).toBe(baseline.count);
  });

  it("draws the SAME stars — every mass, position, colour, size and opacity", () => {
    const actual = stars.map((s) => ({
      x: round(s.x),
      y: round(s.y),
      z: round(s.z),
      mass: round(s.mass),
      teff: round(s.teff),
      color: s.color.map(round),
      sizePx: round(s.sizePx),
      baseOpacity: round(s.baseOpacity),
      twinkles: s.twinkles,
    }));
    expect(actual).toEqual(baseline.stars);
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
