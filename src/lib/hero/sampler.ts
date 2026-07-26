/*
 * src/lib/hero/sampler.ts — the homepage hero's population. SITE CODE, FROZEN.
 *
 * ── WHY THIS IS NOT IN NOVASCOPE ──
 *
 * It was, and that is what caused the problem. This loop returns `sizePx`, `baseOpacity` and
 * `twinkles` — canvas pixels — and it lived in `@novascope/core/imf`, which put rendering concepts
 * in Layer 0 and derived Teff through its own wrappers instead of the `star(M, Z, t)` contract
 * that ADR 0012 says nothing may bypass. It also collided by name with `core/cluster.sampleCluster`,
 * so `@novascope/core` exported two different functions called the same thing.
 *
 * novascope's canonical sampler does the same job properly: latent state only, named RNG
 * sub-streams, EFF profiles, primordial segregation.
 *
 * ── THE HERO DELIBERATELY DOES NOT USE IT ──
 *
 * The canonical sampler draws from `subStream(seed, "mass")` and `subStream(seed, "position")`
 * where this draws from ONE `mulberry32` stream. Same seed, different numbers — so adopting it
 * would reshuffle all 520 stars and the homepage would change. Anna's call (2026-07-26) is that
 * it does not. So the loop moved here verbatim instead of being rewritten.
 *
 * ── WHAT IS AND IS NOT DUPLICATED ──
 *
 * No physics is duplicated. The IMF, the Plummer draw, the ZAMS relations, the colour map and the
 * RNG are all imported from novascope and stay gated there. What is local is the ASSEMBLY: which
 * pixel size and opacity this particular hero gives a star of a given luminosity.
 *
 * ── FROZEN MEANS FROZEN ──
 *
 * `hero.test.ts` asserts every one of the 520 stars against a fixture captured before this file
 * existed. Do not tune the constants, rename the fields, or tidy the loop — a one-part-in-a-million
 * change fails it, which is the point. If the hero is ever redesigned, that is a new file and a new
 * fixture, not an edit here.
 */
import { buildKroupaSegments, sampleKroupaMass } from "@novascope/core/imf";
import { samplePlummer } from "@novascope/core/cluster";
import { zamsTeff, zamsLuminosity, teffToRGB } from "@novascope/core/stellar";
import { mulberry32 } from "@novascope/core/random";

export interface Star {
  /** Projected position in units of the Plummer scale radius (centered at 0). */
  x: number;
  y: number;
  /** Line-of-sight depth (units of scale radius); used for parallax/brightness. */
  z: number;
  mass: number; // M☉
  teff: number; // K
  color: [number, number, number]; // linear RGB 0..1
  /** Base render radius in logical px, ∝ log luminosity. */
  sizePx: number;
  baseOpacity: number;
  /** Whether this star twinkles (only the brighter ones do). */
  twinkles: boolean;
}

export interface ClusterOptions {
  count: number;
  mMin?: number; // M☉, default 0.1
  mMax?: number; // M☉, default 60
  seed?: number;
  minSizePx?: number;
  maxSizePx?: number;
}

/*
 * Clamped to Tout's valid domain, exactly as the retired originals did.
 *
 * `star(m, Z)` clamps to the same [0.1, 100] AND reports it via `inRange`, which is strictly
 * better — but adopting it here would be an improvement, and this file does not make
 * improvements. Left as they were.
 */
const massToTeff = (m: number): number => zamsTeff(Math.min(100, Math.max(0.1, m)));
const massToLuminosity = (m: number): number => zamsLuminosity(Math.min(100, Math.max(0.1, m)));

/** Sample a full cluster: masses (Kroupa) → positions (Plummer) → color/size
 * (MS relations). Deterministic for a given seed. */
export function sampleCluster(opts: ClusterOptions): Star[] {
  const { count } = opts;
  const mMin = opts.mMin ?? 0.1;
  const mMax = opts.mMax ?? 60;
  const minSize = opts.minSizePx ?? 0.5;
  const maxSize = opts.maxSizePx ?? 4;
  const rng = mulberry32(opts.seed ?? 20260718);
  const segs = buildKroupaSegments(mMin, mMax);

  const logLmin = Math.log10(massToLuminosity(mMin));
  const logLmax = Math.log10(massToLuminosity(mMax));

  const stars: Star[] = [];
  for (let i = 0; i < count; i++) {
    const mass = sampleKroupaMass(rng(), segs);
    const [x, y, z] = samplePlummer(rng(), rng, 1);
    const teff = massToTeff(mass);
    const color = teffToRGB(teff);

    const logL = Math.log10(massToLuminosity(mass));
    const sizeFrac = (logL - logLmin) / (logLmax - logLmin); // 0..1
    const sizePx = minSize + (maxSize - minSize) * Math.pow(sizeFrac, 0.8);

    stars.push({
      x,
      y,
      z,
      mass,
      teff,
      color,
      sizePx,
      baseOpacity: 0.55 + 0.45 * sizeFrac,
      twinkles: sizeFrac > 0.18,
    });
  }
  // Painter's order: faint/back stars first, bright/front last.
  stars.sort((s1, s2) => s1.sizePx - s2.sizePx);
  return stars;
}
