/*
 * Each case here is a behaviour `/explore/dynamics` asserts out loud — a banner, a contextual
 * tab, a slowed clock, or ENDING THE RUN. Two of them were measured wrong in a browser before
 * this module existed; the numbers in the names are from those runs.
 */
import { describe, expect, it } from "vitest";
import { createPairWatch, type WatchedPair } from "./pairWatch.ts";

const TCROSS = 1;
const pair = (i: number, j: number, spo: number, hardness = 100): WatchedPair => ({
  i,
  j,
  stepsPerOrbit: spo,
  hardness,
});

describe("pairWatch — entering", () => {
  it("does not confirm a flyby: tight, but gone before half a crossing time", () => {
    const w = createPairWatch();
    /* Seed 2028 announced a 2 + 38 M☉ pair at t/t_cr 5.3 that was gone moments later. */
    expect(w.update(pair(2, 38, 120), 0, TCROSS).confirmed).toBe(false);
    expect(w.update(pair(2, 38, 120), 0.3, TCROSS).confirmed).toBe(false);
    /* The flyby ends — a different, wide pair is now the most bound. */
    expect(w.update(pair(9, 40, 5000), 0.4, TCROSS).confirmed).toBe(false);
    expect(w.update(pair(2, 38, 120), 0.9, TCROSS).confirmed).toBe(false);
  });

  it("confirms a pair that holds the threshold for half a crossing time", () => {
    const w = createPairWatch();
    w.update(pair(3, 7, 300), 0, TCROSS);
    expect(w.update(pair(3, 7, 300), 0.49, TCROSS).confirmed).toBe(false);
    const r = w.update(pair(3, 7, 300), 0.5, TCROSS);
    expect(r.confirmed).toBe(true);
    expect(r.changed).toBe(true);
    expect(r.segment).toBe(1);
    expect(w.members).toEqual([3, 7]);
  });

  it("restarts the clock when a DIFFERENT pair becomes the most bound", () => {
    const w = createPairWatch();
    w.update(pair(3, 7, 300), 0, TCROSS);
    w.update(pair(11, 12, 300), 0.4, TCROSS); // shares nothing — a new candidate
    expect(w.update(pair(11, 12, 300), 0.6, TCROSS).confirmed).toBe(false);
    expect(w.update(pair(11, 12, 300), 0.9, TCROSS).confirmed).toBe(true);
  });

  it("never confirms without a step size, so no claim is keyed on a guess", () => {
    /* Hermite's adaptive arm reports no fixed step; steps/orbit is NaN there. */
    const w = createPairWatch();
    for (const t of [0, 0.5, 1, 5]) expect(w.update(pair(3, 7, NaN), t, TCROSS).confirmed).toBe(false);
  });
});

describe("pairWatch — staying", () => {
  const confirmed = () => {
    const w = createPairWatch();
    w.update(pair(3, 7, 300), 0, TCROSS);
    w.update(pair(3, 7, 300), 0.5, TCROSS);
    return w;
  };

  it("HOLDS when steps/orbit wanders back above the watch threshold", () => {
    /* The measured bug: seed 2027 crossed back above 400 at spo 524, 651, 877 and 469, and the
       page dropped the binary for up to 3.97 crossing times each time. Same pair, still hard. */
    const w = confirmed();
    for (const spo of [421, 505, 524, 651, 877, 1584]) {
      const r = w.update(pair(3, 7, spo), 1, TCROSS);
      expect(r.confirmed).toBe(true);
      expect(r.changed).toBe(false);
    }
  });

  it("releases when the pair is REPLACED outright", () => {
    const w = confirmed();
    const r = w.update(pair(20, 21, 300), 1, TCROSS); // shares neither star
    expect(r.confirmed).toBe(false);
    expect(r.changed).toBe(true);
    expect(w.members).toBeNull();
  });

  it("releases when the pair stops being hard, which is Heggie's own boundary", () => {
    const w = confirmed();
    expect(w.update(pair(3, 7, 300, 1.5), 1, TCROSS).confirmed).toBe(true);
    expect(w.update(pair(3, 7, 300, 0.4), 1.1, TCROSS).confirmed).toBe(false);
  });

  it("releases when there is no bound pair at all", () => {
    const w = confirmed();
    expect(w.update(null, 1, TCROSS).confirmed).toBe(false);
  });
});

describe("pairWatch — the exchange", () => {
  const confirmed = () => {
    const w = createPairWatch();
    w.update(pair(195, 219, 300), 0, TCROSS);
    w.update(pair(195, 219, 300), 0.5, TCROSS);
    return w;
  };

  it("survives an exchange rather than dropping the binary across it", () => {
    /* Seed 2028, t/t_cr 19.8: 195:219 -> 195:281, star 195 retained. The old rule un-confirmed
       here and took 1.53 crossing times to come back — losing the binary at exactly the moment
       the interesting thing happened to it. */
    const w = confirmed();
    const r = w.update(pair(195, 281, 300), 1, TCROSS);
    expect(r.confirmed).toBe(true);
    expect(r.changed).toBe(false);
    expect(r.exchanged).toBe(true);
    expect(w.members).toEqual([195, 281]);
  });

  it("bumps the segment on every exchange, so a plot can colour the swap", () => {
    const w = confirmed();
    expect(w.segment).toBe(1);
    expect(w.update(pair(195, 281, 300), 1, TCROSS).segment).toBe(2);
    expect(w.update(pair(281, 400, 300), 2, TCROSS).segment).toBe(3);
  });

  it("reports `exchanged` on exactly the update it happens, not afterwards", () => {
    const w = confirmed();
    expect(w.update(pair(195, 281, 300), 1, TCROSS).exchanged).toBe(true);
    expect(w.update(pair(195, 281, 300), 1.1, TCROSS).exchanged).toBe(false);
  });

  it("treats an index order swap as the SAME pair, not an exchange", () => {
    /* `hardestBoundPair` always emits i < j, but nothing in the type says so, and a silent
       segment bump would paint a fake exchange on the plot. */
    const w = confirmed();
    const r = w.update(pair(219, 195, 300), 1, TCROSS);
    expect(r.exchanged).toBe(false);
    expect(r.segment).toBe(1);
  });
});

describe("pairWatch — reset", () => {
  it("forgets the pair AND the segment, so a new run starts at colour one", () => {
    const w = createPairWatch();
    w.update(pair(3, 7, 300), 0, TCROSS);
    w.update(pair(3, 7, 300), 0.5, TCROSS);
    w.reset();
    expect(w.confirmed).toBe(false);
    expect(w.segment).toBe(0);
    expect(w.members).toBeNull();
  });

  it("does not treat a new run's pair as a continuation of the old one", () => {
    /* The bug this guards: `members` left set across a rebuild meant a fresh pair sharing an
       index with a long-dead one counted as its exchange. */
    const w = createPairWatch();
    w.update(pair(3, 7, 300), 0, TCROSS);
    w.update(pair(3, 7, 300), 0.5, TCROSS);
    w.reset();
    const r = w.update(pair(3, 99, 300), 0, TCROSS);
    expect(r.confirmed).toBe(false);
    expect(r.exchanged).toBe(false);
  });
});
