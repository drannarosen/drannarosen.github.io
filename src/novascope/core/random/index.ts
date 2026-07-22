/*
 * core/random — deterministic pseudo-randomness for the whole engine.
 *
 * One home for seeded RNG so identity → population is a pure, reproducible
 * function (Architecture §9.3). Everything that samples — IMF masses, spatial
 * profiles, N-body initial velocities — draws from here, never from
 * `Math.random`, which is not seedable.
 *
 * The key invariant is DETERMINISM UNDER FEATURE GROWTH: each sampled quantity
 * draws from an INDEPENDENT sub-stream (mass, position, velocity, …) derived
 * from one master seed. Adding a new quantity later is a new labelled stream
 * that never perturbs the existing draws — so "same seed ⇒ same cluster" holds
 * across versions, and shared URLs stay valid.
 *
 * `mulberry32` is a public-domain generator; `xmur3` is the companion string
 * hash used to turn a (seed, label) pair into a well-separated 32-bit seed so
 * sub-streams are decorrelated rather than adjacent seeds.
 */

/** Seeded uniform generator on [0, 1). Public-domain (mulberry32). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** String → 32-bit seed generator (public-domain xmur3). Decorrelates labels. */
export function xmur3(str: string): () => number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return function () {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^= h >>> 16) >>> 0;
  };
}

/**
 * An independent sub-stream for a named quantity, derived from the master seed.
 * `subStream(seed, "mass")` and `subStream(seed, "velocity")` advance
 * independently, so adding one never shifts the other's draws (§9.3).
 */
export function subStream(masterSeed: number, label: string): () => number {
  return mulberry32(xmur3(`${masterSeed}:${label}`)());
}
