/*
 * Vitest — the UNIT layer. See ADR 0017 for the boundary against scripts/check-*.mjs.
 *
 * Scoped to the pure layers on purpose: `core/` and `state/` are dependency-free and
 * environment-free, so they need no DOM, no browser and no fixtures beyond their own. `viz/`
 * is excluded because it imports `three` and touches the DOM; what is testable there is
 * already covered by the build gates.
 *
 * The alias mirrors tsconfig's `@novascope/*`, so a test can import the way a consumer does.
 * Inside the package itself imports stay relative and `.ts`-suffixed (ADR 0012) — the alias is
 * for the site→package seam, and for tests that want to exercise that seam deliberately.
 */
import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  resolve: {
    alias: { "@novascope": resolve(import.meta.dirname, "src/novascope") },
  },
  test: {
    include: ["src/novascope/{core,state}/**/*.test.ts"],
    environment: "node",
  },
});
