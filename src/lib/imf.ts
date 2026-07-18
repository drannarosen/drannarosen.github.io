/*
 * imf.ts — physically-motivated star-cluster sampling for the hero visual.
 *
 * This is deliberately real, not decorative: masses are drawn from a stellar
 * initial mass function, positions from a Plummer sphere, and each star's
 * color and size follow simplified main-sequence relations. The visual payoff
 * (a few rare bright-blue massive stars among many faint red ones) is a direct
 * consequence of the IMF slope — which is the point.
 *
 * These relations are SIMPLIFIED FOR VISUALIZATION. They are not intended for
 * quantitative science. Each carries a provenance note to its source.
 */

/* ── Deterministic RNG (mulberry32) ──────────────────────────────────
 * Seedable so the static/offscreen layer and animated layer agree, and so
 * the cluster looks the same on every load. Public-domain algorithm. */
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

/* ── Kroupa (2001) IMF ───────────────────────────────────────────────
 * Broken power law  dN/dm ∝ m^-α  (Kroupa 2001, MNRAS 322, 231):
 *   α = 1.3 for 0.08 ≤ m/M☉ < 0.5
 *   α = 2.3 for 0.5  ≤ m/M☉        (Salpeter-like high-mass slope)
 * We sample over [mMin, mMax] via inverse-CDF of the piecewise law with
 * amplitudes chosen for continuity at the 0.5 M☉ break. */
interface Segment {
  lo: number;
  hi: number;
  alpha: number;
  amp: number; // continuity amplitude A_i in ξ = A_i m^-α
  weight: number; // ∫ ξ dm over [lo, hi]
  cum: number; // cumulative weight up to and including this segment
}

const KROUPA_BREAK = 0.5;
const KROUPA_ALPHA_LOW = 1.3;
const KROUPA_ALPHA_HIGH = 2.3;

function segmentIntegral(alpha: number, amp: number, a: number, b: number): number {
  if (Math.abs(1 - alpha) < 1e-9) return amp * Math.log(b / a);
  const p = 1 - alpha;
  return (amp * (Math.pow(b, p) - Math.pow(a, p))) / p;
}

function buildKroupaSegments(mMin: number, mMax: number): Segment[] {
  const segs: Segment[] = [];
  // Amplitudes: fix low segment at 1, match high segment at the break.
  const ampLow = 1;
  const ampHigh = ampLow * Math.pow(KROUPA_BREAK, KROUPA_ALPHA_HIGH - KROUPA_ALPHA_LOW);

  const raw: Array<Omit<Segment, "weight" | "cum">> = [];
  if (mMin < KROUPA_BREAK) {
    raw.push({ lo: mMin, hi: Math.min(KROUPA_BREAK, mMax), alpha: KROUPA_ALPHA_LOW, amp: ampLow });
  }
  if (mMax > KROUPA_BREAK) {
    raw.push({ lo: Math.max(KROUPA_BREAK, mMin), hi: mMax, alpha: KROUPA_ALPHA_HIGH, amp: ampHigh });
  }

  let cum = 0;
  for (const s of raw) {
    const weight = segmentIntegral(s.alpha, s.amp, s.lo, s.hi);
    cum += weight;
    segs.push({ ...s, weight, cum });
  }
  // Normalize cumulative to [0, 1].
  const total = cum;
  for (const s of segs) s.cum /= total;
  return segs;
}

/** Inverse-CDF sample a single mass (M☉) from the Kroupa IMF. */
export function sampleKroupaMass(u: number, segs: Segment[]): number {
  let prevCum = 0;
  for (const s of segs) {
    if (u <= s.cum || s === segs[segs.length - 1]) {
      const segU = (u - prevCum) / (s.cum - prevCum); // 0..1 within segment
      const target = segU * s.weight;
      const p = 1 - s.alpha;
      if (Math.abs(p) < 1e-9) {
        return s.lo * Math.exp(target / s.amp);
      }
      const base = Math.pow(s.lo, p) + (target * p) / s.amp;
      return Math.pow(base, 1 / p);
    }
    prevCum = s.cum;
  }
  return segs[segs.length - 1].hi;
}

/* ── Main-sequence relations (simplified, for visualization) ─────────── */

/** Mass → effective temperature (K). Rough MS scaling Teff ∝ M^0.53 anchored
 * at the Sun (5772 K), clamped to a plausible MS range. Derived from
 * L ∝ M^3.5, R ∝ M^0.7 ⇒ Teff ∝ (L/R²)^{1/4}. Approximate. */
export function massToTeff(m: number): number {
  const teff = 5772 * Math.pow(m, 0.53);
  return Math.min(45000, Math.max(2400, teff));
}

/** Mass → luminosity (L☉). Main-sequence mass–luminosity relation L ∝ M^3.5
 * (e.g. Salaris & Cassisi 2005, textbook MS relation). Approximate. */
export function massToLuminosity(m: number): number {
  return Math.pow(m, 3.5);
}

/** Effective temperature → linear RGB in [0,1]. Blackbody-color approximation
 * after Tanner Helland (2012), valid ~1000–40000 K. Approximate but perceptually
 * convincing: O/B stars blue-white, G yellow, M red. */
export function teffToRGB(teff: number): [number, number, number] {
  const t = Math.min(40000, Math.max(1000, teff)) / 100;
  let r: number, g: number, b: number;

  if (t <= 66) {
    r = 255;
    g = 99.4708025861 * Math.log(t) - 161.1195681661;
  } else {
    r = 329.698727446 * Math.pow(t - 60, -0.1332047592);
    g = 288.1221695283 * Math.pow(t - 60, -0.0755148492);
  }
  if (t >= 66) {
    b = 255;
  } else if (t <= 19) {
    b = 0;
  } else {
    b = 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  }

  const clamp01 = (v: number) => Math.min(1, Math.max(0, v / 255));
  return [clamp01(r), clamp01(g), clamp01(b)];
}

/* ── Plummer sphere positions ────────────────────────────────────────
 * Isotropic 3D sample of a Plummer (1911) density profile. Enclosed-mass
 * inversion: for u = M(<r)/M_tot, r = a / sqrt(u^{-2/3} − 1). We keep z for
 * subtle depth (parallax + brightness falloff) when projecting to 2D. */
function samplePlummer(u: number, rng: () => number, a: number): [number, number, number] {
  const r = a / Math.sqrt(Math.pow(Math.max(u, 1e-6), -2 / 3) - 1);
  const cosTheta = 2 * rng() - 1;
  const sinTheta = Math.sqrt(Math.max(0, 1 - cosTheta * cosTheta));
  const phi = 2 * Math.PI * rng();
  return [r * sinTheta * Math.cos(phi), r * sinTheta * Math.sin(phi), r * cosTheta];
}

/* ── Public cluster sampler ──────────────────────────────────────────── */

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
      twinkles: sizeFrac > 0.35,
    });
  }
  // Painter's order: faint/back stars first, bright/front last.
  stars.sort((s1, s2) => s1.sizePx - s2.sizePx);
  return stars;
}
