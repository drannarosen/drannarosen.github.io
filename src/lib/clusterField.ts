/*
 * Compat shim — the hero cluster renderer lives in novascope now
 * (src/novascope/viz/clusterHero; ADR 0013). Kept so ClusterHero.astro resolves
 * unchanged; migrate it and delete this in the follow-on. Alias, because this is
 * a site→package import.
 */
export * from "@novascope/viz/clusterHero";
