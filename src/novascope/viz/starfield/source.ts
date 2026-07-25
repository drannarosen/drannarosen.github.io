/*
 * source.ts — where a rendered star field's stars come from (Layer 2).
 *
 * `prepare` consumes a flat packed star table: `count * STAR_STRIDE` floats of
 * `[x, y, z, mass, teff, radius]` in `(pc, pc, pc, M☉, K, R☉)`. That encoding is
 * neutral — it is just a struct-of-floats sized for a GPU upload — but WHERE the
 * rows come from is a scientific choice, so the producers live here and are
 * named rather than implied.
 *
 * The default producer is the analytic cluster: `core/cluster` samples a profile
 * continuously and `core/stellar` derives each star's ZAMS state from its mass.
 * Same sampler lineage as the homepage hero, and every position is drawn from a
 * continuous density profile.
 *
 * THIS IS NOT A STYLE PREFERENCE. The alternative — the `gravoturb` export's
 * `stars.f32` — has star positions QUANTIZED to the 128³ gas grid with uniform
 * sub-cell jitter, so the 10,301-star realization occupies only 139 distinct
 * cells of 6.0/128 = 0.046875 pc and ONE cell holds 7,973 of them (77.4%; the
 * top five hold 87.1%). Rendered, 77% of the cluster lands inside a single
 * ~15 px disc, and additive blending of ~8,000 overlapping stars saturates it to
 * a flat white blob — which is what "the stars render as filled squares" (and
 * the earlier "48 stars visible" report) actually were. The renderer was
 * correct; it was faithfully drawing a pile.
 *
 * That quantization happens UPSTREAM, in progenax's `ic.stars.positions`
 * (`scripts/gravoturb/export_cluster.py` only shifts the frame, line 301), so it
 * cannot be fixed from this repo. Note that the same script already knows the
 * failure mode: `_gas_points` samples cells at `rho**0.55` "(not rho)" for
 * exactly this reason. Until the upstream sampler places stars continuously
 * within a cell, that file's POSITIONS are unusable for imaging. Its masses,
 * temperatures and radii are unaffected, and so is its gas.
 */

import { sampleCluster, defaultIdentity, type ClusterIdentity } from "../../core/cluster/index.ts";
import { star } from "../../core/stellar/index.ts";
import { STAR_STRIDE } from "./prepare.ts";

/** One row of the packed table, before packing. */
export interface StarRow {
  /** Position [pc]. */
  x: number;
  y: number;
  z: number;
  /** Mass [M☉] — carried through so a consumer can colour or filter by it. */
  mass: number;
  /** Metallicity, for the ZAMS relations. */
  Z: number;
}

/**
 * Pack rows into the flat table `prepare` reads.
 *
 * Teff and radius are DERIVED here via `core/stellar.star()` rather than stored:
 * they are functions of (mass, Z), and deriving them keeps one home for the ZAMS
 * relations. Remnants (which `star()` returns with `L = R = Teff = 0`) pack as
 * zeros and fall out of the image on their own — a zero radius is zero flux, so
 * no special case is needed to avoid drawing them as stars.
 */
export function packStarTable(rows: readonly StarRow[]): Float32Array {
  const out = new Float32Array(rows.length * STAR_STRIDE);
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!;
    const s = star(r.mass, r.Z);
    const o = i * STAR_STRIDE;
    out[o] = r.x;
    out[o + 1] = r.y;
    out[o + 2] = r.z;
    out[o + 3] = r.mass;
    out[o + 4] = s.Teff;
    out[o + 5] = s.R;
  }
  return out;
}

/**
 * The lab's default population: an analytically sampled cluster.
 *
 * Deterministic in the identity's seed, so the same lab URL always shows the
 * same cluster, and no network fetch is involved. The profile defaults to
 * `plummer` to match the homepage hero's sampler; the identity is otherwise
 * `core/cluster`'s own default, so this adds no second set of cluster
 * parameters to keep in sync.
 */
export function clusterStarTable(over: Partial<ClusterIdentity> = {}): Float32Array {
  const identity = defaultIdentity({ profile: { kind: "plummer", scaleRadius: 1, gamma: 5 }, ...over });
  return packStarTable(sampleCluster(identity));
}
