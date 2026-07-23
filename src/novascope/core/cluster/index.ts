/*
 * core/cluster — the canonical cluster: identity in, latent population out.
 * Everything derived (L, Teff, colour, remnant) comes from the star() contract
 * applied to these latent stars, never stored here.
 */
export type { ClusterIdentity, LatentStar } from "./params.ts";
export {
  CLUSTER_SCHEMA_VERSION,
  defaultIdentity,
  presets,
  serializeIdentity,
  deserializeIdentity,
} from "./params.ts";
export { samplePlummer, PLUMMER_RH_OVER_A, effRhOverA } from "./profiles.ts";
export { sampleCluster } from "./sample.ts";
export { segregateMasses } from "./segregation.ts";
