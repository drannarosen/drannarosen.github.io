/*
 * core/cluster/sample.ts — turn a ClusterIdentity into its latent population.
 *
 * Pure and deterministic: the same identity always yields the same stars, which
 * is what makes "these are the stars I made earlier" literally true across pages
 * and shareable by URL. Composition only — masses from the IMF, positions from a
 * profile, each on its OWN seeded sub-stream (§9.3) so adding a sampled quantity
 * later (velocities) never perturbs the existing draws.
 */
import { maschbergerMass } from "../imf/index.ts";
import { subStream } from "../random/index.ts";
import { makeProfileSampler } from "./profiles.ts";
import { segregateMasses } from "./segregation.ts";
import type { ClusterIdentity, LatentStar } from "./params.ts";

/** Safety bound for mass-limited sampling, so a tiny target can't spin forever. */
const MAX_STARS = 2_000_000;

export function sampleCluster(id: ClusterIdentity): LatentStar[] {
  const massStream = subStream(id.seed, "mass");
  const posStream = subStream(id.seed, "position");
  // velocity sub-stream is reserved (subStream(id.seed, "velocity")) — not drawn
  // yet, so theory stays velocity-free and dynamics can add it without a reshuffle.

  const imf = { mMin: id.imf.mMin, mMax: id.imf.mMax, alpha: id.imf.alphaHigh };
  const sampleProfile = makeProfileSampler(id.profile);

  const stars: LatentStar[] = [];
  const draw = (i: number): number => {
    const mass = maschbergerMass(massStream(), imf);
    const [x, y, z] = sampleProfile(posStream);
    stars.push({ id: i, mass, Z: id.Z, x, y, z, vx: 0, vy: 0, vz: 0 });
    return mass;
  };

  if (id.sampling.mode === "count") {
    const n = Math.min(Math.max(0, Math.floor(id.sampling.target)), MAX_STARS);
    for (let i = 0; i < n; i++) draw(i);
  } else {
    let total = 0;
    for (let i = 0; total < id.sampling.target && i < MAX_STARS; i++) total += draw(i);
  }

  // Primordial mass segregation: re-pair masses to positions by density (its own
  // sub-stream, so mass/position draws above are unperturbed — §9.3).
  if (id.segregation > 0 && stars.length > 1) {
    const seg = subStream(id.seed, "segregation");
    const radii = stars.map((s) => Math.hypot(s.x, s.y, s.z));
    const reassigned = segregateMasses(stars.map((s) => s.mass), radii, id.segregation, seg);
    for (let i = 0; i < stars.length; i++) stars[i].mass = reassigned[i];
  }
  return stars;
}
