/*
 * Compat shim — the WebGL cluster engine lives in novascope now
 * (src/novascope/viz/webgl; ADR 0013). Kept so the /explore + volume-lab
 * consumers resolve unchanged; migrate them and delete this in the dedupe
 * follow-on. Alias, because this is a site→package import.
 */
export * from "@novascope/viz/webgl";
