/*
 * Compat shim — the gravoturb art renderer lives in novascope now
 * (src/novascope/viz/clusterArt; ADR 0013). Kept so cluster-lab.astro resolves
 * unchanged; migrate it and delete this in the follow-on. Alias, because this is
 * a site→package import.
 */
export * from "@novascope/viz/clusterArt";
