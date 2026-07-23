/*
 * core/cluster/params.ts — the cluster IDENTITY (Architecture §3, Cluster-state
 * spec). A seed plus a handful of generative parameters *is* the cluster; the
 * population and every derived property are reconstructed from it. Identity is
 * what gets named, shared (URL), and resumed.
 *
 * Nothing here stores derived state — no star list, no L/Teff/colour. That is
 * the point: minimal latent input, everything else derived on demand.
 */

/** Bump when the identity shape changes; deserialize() migrates older payloads. */
export const CLUSTER_SCHEMA_VERSION = 1;

export interface ClusterIdentity {
  schemaVersion: number;
  seed: number;
  /** How many stars to draw: a fixed count, or draw until a target mass (M☉). */
  sampling: { mode: "count" | "mass"; target: number };
  /** Kroupa IMF bounds (M☉) and the high-mass slope knob (default 2.3). */
  imf: { mMin: number; mMax: number; alphaHigh: number };
  /** Metallicity — CLUSTER-level (a coeval cluster is chemically uniform). */
  Z: number;
  /** Spatial profile; scaleRadius in pc (r_h ≈ 1.305·scaleRadius for Plummer).
   *  EFF (Elson+1987) adds `gamma`, the 3-D density slope (γ=5 ≈ Plummer). */
  profile: { kind: "plummer" | "eff"; scaleRadius: number; gamma?: number };
  /** Primordial mass segregation strength λ ∈ [0,1] (McLuster/Küpper; 0 = random). */
  segregation: number;
  /** Reserved for N-body; theory-only engines ignore it. */
  kinematics: { virialRatio: number };
}

/**
 * The only STORED per-star state — the latent truth. Everything a reader sees
 * (L, R, Teff, colour, spectral type, remnant) is derived from `mass, Z, t` via
 * the star() contract, never stored here.
 */
export interface LatentStar {
  id: number;
  mass: number; // M☉
  Z: number;
  x: number; // pc
  y: number; // pc
  z: number; // pc — authoritative; 2-D views project, never flatten
  vx: number; // km/s — 0 until the dynamics engine draws velocities
  vy: number;
  vz: number;
}

/** The baseline cluster; overrides deep-merge onto it. */
export function defaultIdentity(over: Partial<ClusterIdentity> = {}): ClusterIdentity {
  return {
    schemaVersion: CLUSTER_SCHEMA_VERSION,
    seed: 20260718,
    sampling: { mode: "count", target: 1200, ...over.sampling },
    imf: { mMin: 0.1, mMax: 100, alphaHigh: 2.3, ...over.imf },
    Z: over.Z ?? 0.02,
    profile: { kind: "plummer", scaleRadius: 1, ...over.profile },
    segregation: over.segregation ?? 0,
    kinematics: { virialRatio: 0.5, ...over.kinematics },
    ...("seed" in over ? { seed: over.seed! } : {}),
  };
}

/** Curated "strange universes" — each is just a named identity (Navigation spec). */
export const presets: Record<string, ClusterIdentity> = {
  default: defaultIdentity(),
  lowMass: defaultIdentity({ seed: 7, sampling: { mode: "count", target: 60 } }),
  starburst: defaultIdentity({
    seed: 42,
    sampling: { mode: "mass", target: 3e4 },
    imf: { mMin: 0.1, mMax: 120, alphaHigh: 2.0 }, // top-heavy
  }),
  diffuse: defaultIdentity({ seed: 99, profile: { kind: "plummer", scaleRadius: 3 } }),
  segregated: defaultIdentity({ seed: 11, segregation: 1, profile: { kind: "plummer", scaleRadius: 1 } }),
};

/* ── Versioned (de)serialization ─────────────────────────────────────────
 * Identity ⇄ a compact query string, so a cluster is a shareable URL. The
 * loader is tolerant: unknown/older schemaVersion falls back to defaults for
 * anything missing and never throws (§9.6), so old shared links keep working. */

export function serializeIdentity(id: ClusterIdentity): string {
  const p = new URLSearchParams({
    v: String(id.schemaVersion),
    seed: String(id.seed),
    sm: id.sampling.mode,
    st: String(id.sampling.target),
    mn: String(id.imf.mMin),
    mx: String(id.imf.mMax),
    ah: String(id.imf.alphaHigh),
    z: String(id.Z),
    pr: id.profile.kind,
    sr: String(id.profile.scaleRadius),
    gm: String(id.profile.gamma ?? 5),
    sg: String(id.segregation),
    vr: String(id.kinematics.virialRatio),
  });
  return p.toString();
}

export function deserializeIdentity(query: string): ClusterIdentity {
  const p = new URLSearchParams(query);
  const num = (k: string, fallback: number) => {
    const v = Number(p.get(k));
    return Number.isFinite(v) ? v : fallback;
  };
  const d = defaultIdentity();
  const mode = p.get("sm") === "mass" ? "mass" : "count";
  const kind = p.get("pr") === "eff" ? "eff" : "plummer";
  return {
    schemaVersion: CLUSTER_SCHEMA_VERSION, // normalize to current on load
    seed: num("seed", d.seed),
    sampling: { mode, target: num("st", d.sampling.target) },
    imf: { mMin: num("mn", d.imf.mMin), mMax: num("mx", d.imf.mMax), alphaHigh: num("ah", d.imf.alphaHigh) },
    Z: num("z", d.Z),
    profile: { kind, scaleRadius: num("sr", d.profile.scaleRadius), gamma: num("gm", 5) },
    segregation: num("sg", d.segregation),
    kinematics: { virialRatio: num("vr", d.kinematics.virialRatio) },
  };
}
