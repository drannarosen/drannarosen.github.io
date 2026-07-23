# Novascope: absorb all cluster viz (WebGL engine + hero + art)

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.
>
> **Supersedes** `docs/plans/2026-07-23-feedback-budget-step1-merge-plan.md` (the
> WebGL-only step 1). This is the complete "bring every cluster renderer home"
> branch. Decision: ADR 0013 (extended in-session to the hero + art renderers).

**Goal:** Re-home every cluster *renderer* into `src/novascope/viz/` — the WebGL
volumetric engine (`lib/cluster/*`), the Plummer hero (`lib/clusterField.ts`),
and the gravoturb art (`lib/clusterArt.ts`) — so novascope is the single,
extractable home for all storyline/engine/demo viz, WITHOUT changing behavior.
Every existing consumer keeps rendering through a compat re-export shim.

**Architecture:** Moves only — behavior-preserving. Each renderer relocates under
`src/novascope/viz/`, its imports adapted to the package's internal convention
(relative, explicit `.ts`; no `@novascope/` alias *inside* the package), and its
old `src/lib/*` path becomes a thin **compat shim** (`export * from
"@novascope/viz/…"`, alias because site→package). The 6 real consumers are
untouched. The existing boundary gate (`check:novascope`) already forbids
novascope from importing the site, so a green gate after the move *is* the proof
the renderers belong. No dedupe, no consumer migration here — that is the
follow-on (see "Deferred").

**Novascope is a SHARED package, not a local folder.** It is intended for reuse
by other Astro sites (cosmic-playground, the Sophie consumers) — each configures
its own `@novascope/*` path alias to the extracted package. Two consequences
this branch honors: (1) the internal convention (relative + `.ts`, alias only at
the site seam) is what lets the whole package `git mv` into a standalone repo
with no per-import rewrite; (2) the barrels (`viz/index.ts`, `core/*/index.ts`)
are now a real **public API contract** — keep them intentional and stable, since
external sites import through them. Verified portability property (checked, not
assumed): the incoming renderers read **no** site CSS tokens / computed styles —
colors come in as params/constants — so they render correctly under a different
site's token system.

**Tech Stack:** Astro static + strict TS; novascope layered engine (ADR 0012);
gates `pnpm check:novascope` (import boundary), `pnpm check`, `pnpm build`;
browser preview at 1440px for render parity.

**Why move-then-dedupe (the load-bearing discipline):** convergence
(`spectralRGB`→`teffToRGB`, `makeSegregator`→`segregateMasses`,
`attachInteraction`→`attachOrbit`, four lifecycle loops → one, three
point-painters → one) is behavior-CHANGING. Mixing it with the move makes a
render regression un-bisectable (move bug? or dedupe bug?). This branch changes
zero behavior; the follow-on changes behavior with the moves already banked.

**The 6 consumers (regression surface):**
- WebGL (`lib/cluster`): `explore/cluster.astro`, `explore/gas-expulsion.astro`,
  `explore/mass-segregation.astro`, `volume-lab.astro`
- Hero (`lib/clusterField.ts`): `components/ClusterHero.astro` → homepage `/`
- Art (`lib/clusterArt.ts`): `cluster-lab.astro`

**Target layout:**
```
src/novascope/viz/
  camera.ts  lifecycle.ts                             # shared substrate (unchanged)
  axis.ts  histogram.ts  hrDiagram.ts  clusterField.ts # existing 2-D (unchanged)
  clusterHero.ts     ← src/lib/clusterField.ts
  clusterArt.ts      ← src/lib/clusterArt.ts
  webgl/             ← src/lib/cluster/{engine,shaders,spectral,scene,interaction,massSegregation,dynamics}.ts
    index.ts
  index.ts           # barrel gains webgl + hero + art
```

**Internal import convention (from the gate's own docstring, lines 93–96):**
files *inside* `src/novascope/` import each other **relatively with `.ts`**; the
`@novascope/` alias is for **site→package only**. So on the way in, each incoming
file gets two mechanical, behavior-preserving fixes:
1. sibling imports `.ts`-ified: `./shaders` → `./shaders.ts`
2. alias imports relativized to the file's depth:
   - `viz/clusterHero.ts`: `@novascope/core/imf` → `../core/imf/index.ts`
   - `viz/clusterArt.ts`: `@novascope/core/random` → `../core/random/index.ts`
   - `viz/webgl/massSegregation.ts`: `@novascope/core/random` → `../../core/random/index.ts`

**Deferred to a follow-on branch (NOT here):** dedupe the now-co-located
duplicates (`spectralRGB`/palettes→`teffToRGB`, `makeSegregator`→core
`segregateMasses`, `attachInteraction`→`attachOrbit`, the four lifecycle
implementations→`viz/lifecycle.ts`, the three point-painters→one primitive);
migrate the 6 consumers off the shims; delete the shims; optionally make the
boundary gate `.astro`-aware (Layer-3 seam). Then Feedback Budget itself
(design steps 3–4).

**Cross-site portability items surfaced (for the extraction step, NOT this branch —
changing a default is behavior-changing):** `loadScene` and `loadClusterData`
both default `base = "/data/gravoturb"`, which assumes *this* site's public path
layout. Parameterized already (any consumer can override), but at extraction
decide whether the package ships with no default (each site passes its base) or a
documented convention. Also at extraction: formalize the public API (a
`package.json` `exports` map over the barrels) so cosmic-playground/Sophie import
a versioned surface, not deep paths.

---

### Task 0: Baseline — capture green before touching anything

**Step 1:** Confirm the branch and run the gates.
Run: `git branch --show-current` (expect `novascope-absorb-cluster-viz`), then
`pnpm check:novascope && pnpm check && pnpm build`
Expected: boundary "N file(s) clean"; 0 type errors; build succeeds.

**Step 2:** Confirm the hero's host page.
Run: `grep -rn "ClusterHero" src/pages`
Expected: it resolves to a page (likely `index.astro`). Record which — that page
is the hero's regression check.

**Step 3:** Start the preview and eyeball each of the 6 consumers at 1440px.
Run: `astro dev` (background); load `/`, `/explore/cluster`,
`/explore/gas-expulsion`, `/explore/mass-segregation`, `/volume-lab`,
`/cluster-lab`. Confirm each renders (no blank canvas, no console errors).
Screenshot each — this is the regression baseline. Commit nothing.

---

### Task 1: Re-home the WebGL engine → `viz/webgl/`

**Files:**
- Move: `src/lib/cluster/{engine,shaders,spectral,scene,interaction,massSegregation,dynamics}.ts`
  → `src/novascope/viz/webgl/`
- Create: `src/novascope/viz/webgl/index.ts`
- Modify: `src/novascope/viz/index.ts`, `src/lib/cluster/index.ts`

**Step 1:** `mkdir -p src/novascope/viz/webgl`, then `git mv` each of the 7 files
(NOT `index.ts`) from `src/lib/cluster/` into `src/novascope/viz/webgl/`.

**Step 2:** Fix imports in the moved files to the internal convention:
- `engine.ts`: `./shaders`→`./shaders.ts`, `./spectral`→`./spectral.ts`, `./scene`→`./scene.ts`
- `interaction.ts`: `./engine`→`./engine.ts` (both the type and value import)
- `massSegregation.ts`: `@novascope/core/random` → `../../core/random/index.ts`
(`shaders.ts`, `spectral.ts`, `scene.ts`, `dynamics.ts` have no imports — leave them.)

**Step 3:** Write `src/novascope/viz/webgl/index.ts` re-exporting the exact former
`lib/cluster/index.ts` surface, sibling paths `.ts`-ified:
```ts
/* WebGL volumetric cluster engine — gas raymarch + embedded stars (ADR 0013). */
export type { Scene, View } from "./scene.ts";
export { loadScene, sceneFromParts } from "./scene.ts";
export type { ClusterEngine, EngineOptions } from "./engine.ts";
export { createEngine, DEFAULT_ZOOM, ZOOM_MIN, ZOOM_MAX } from "./engine.ts";
export { attachInteraction } from "./interaction.ts";
export { spectralRGB } from "./spectral.ts";
export type { Segregator } from "./massSegregation.ts";
export { makeSegregator } from "./massSegregation.ts";
export type { Dynamics, DynamicsInit, DynamicsParams, Diagnostics, Phase } from "./dynamics.ts";
export { createDynamics, RELAX_TCROSS } from "./dynamics.ts";
```

**Step 4:** Add to `src/novascope/viz/index.ts`:
`export * from "./webgl/index.ts";`

**Step 5:** Replace `src/lib/cluster/index.ts` body with a compat shim (alias =
site→package):
```ts
/* Compat shim — the WebGL cluster engine lives in novascope now (ADR 0013).
   Migrate the 4 consumers + delete this in the dedupe follow-on. */
export * from "@novascope/viz/webgl";
```

**Step 6:** Gates.
Run: `pnpm check:novascope && pnpm check`
Expected: boundary green (viz→core is downward; no site escape); 0 type errors.
If the boundary flags `viz/webgl/*` importing DOM/WebGL globals — that is
ALLOWED (rule 5 bans DOM only in `core`; viz renders). If it flags a `..` escape,
an alias import was missed in Step 2 — fix it, do not relax the gate.

**Step 7:** Confirm only `index.ts` remains in `src/lib/cluster/`.
Run: `ls src/lib/cluster/` → expect only `index.ts`.

---

### Task 2: Re-home the Plummer hero → `viz/clusterHero.ts`

**Files:**
- Move: `src/lib/clusterField.ts` → `src/novascope/viz/clusterHero.ts` (rename
  avoids the filename clash with the existing census `viz/clusterField.ts`; the
  exported symbols `initClusterField`/`ClusterFieldConfig` do NOT collide with the
  census `renderClusterField`/`ClusterFieldOpts`, so exports are unchanged).
- Modify: `src/novascope/viz/index.ts`, and turn `src/lib/clusterField.ts` into a shim.

**Step 1:** `git mv src/lib/clusterField.ts src/novascope/viz/clusterHero.ts`.

**Step 2:** In `clusterHero.ts`, relativize the one alias import:
`@novascope/core/imf` → `../core/imf/index.ts`. Verify no other non-relative
imports remain.

**Step 3:** Re-create `src/lib/clusterField.ts` as a compat shim:
```ts
/* Compat shim — the hero renderer lives in novascope now (ADR 0013).
   Migrate ClusterHero.astro + delete this in the follow-on. */
export * from "@novascope/viz/clusterHero";
```

**Step 4:** Add to `src/novascope/viz/index.ts`:
```ts
export type { ClusterFieldConfig } from "./clusterHero.ts";
export { initClusterField } from "./clusterHero.ts";
```

**Step 5:** Gates.
Run: `pnpm check:novascope && pnpm check`
Expected: boundary green; 0 type errors. `ClusterHero.astro` still imports
`initClusterField` from `../lib/clusterField` — resolves through the shim.

---

### Task 3: Re-home the gravoturb art → `viz/clusterArt.ts`

**Files:**
- Move: `src/lib/clusterArt.ts` → `src/novascope/viz/clusterArt.ts`
- Modify: `src/novascope/viz/index.ts`, and turn `src/lib/clusterArt.ts` into a shim.

**Step 1:** `git mv src/lib/clusterArt.ts src/novascope/viz/clusterArt.ts`.

**Step 2:** In `clusterArt.ts`, relativize the one alias import:
`@novascope/core/random` → `../core/random/index.ts`. Verify no other
non-relative imports remain.

**Step 3:** Re-create `src/lib/clusterArt.ts` as a compat shim:
```ts
/* Compat shim — the gravoturb art renderer lives in novascope now (ADR 0013).
   Migrate cluster-lab.astro + delete this in the follow-on. */
export * from "@novascope/viz/clusterArt";
```

**Step 4:** Add to `src/novascope/viz/index.ts`:
```ts
export type { ClusterMeta, ClusterData, ClusterArtOptions } from "./clusterArt.ts";
export { loadClusterData, initClusterArt } from "./clusterArt.ts";
```

**Step 5:** Gates.
Run: `pnpm check:novascope && pnpm check`
Expected: boundary green; 0 type errors. `cluster-lab.astro` still imports
`loadClusterData, initClusterArt` from `../lib/clusterArt` — through the shim.

---

### Task 4: Refresh the boundary-gate documentation

**Files:** Modify: `scripts/check-novascope-boundary.mjs` (comment only — no logic
change; the gate already covers viz).

**Step 1:** Update the stale docstring line "Scoped to the core today because
that is all that exists" → note that state/viz now populate the package and the
gate actively enforces them; the inward-import rule (relative escape = site
coupling) is what guarantees extractability.

**Step 2:** Add one honest line recording the known seam: the gate reads `.ts`
only, so Layer-3 `.astro` components are unchecked and *may* import the site by
design (the Astro binding is where package meets site). Making the gate
`.astro`-aware is a follow-on candidate, not a bug.

**Step 3:** Run the gate to confirm the comment edit didn't break it.
Run: `pnpm check:novascope` → expect green.

---

### Task 5: Verify no regression (the whole point)

**Step 1:** All gates.
Run: `pnpm check:novascope && pnpm check && pnpm build`
Expected: boundary green; 0 type errors; build succeeds.

**Step 2:** Confirm `src/lib` now holds only the three shims + genuine site code.
Run: `ls src/lib src/lib/cluster`
Expected: `cluster/index.ts` is the only file in `cluster/`; `clusterField.ts`
and `clusterArt.ts` exist as shims; `abstract.ts`, `figures.ts`,
`figureCaption.ts`, `mathMacros.ts`, `packages.ts`, `site.ts`, `slug.ts`,
`sunSanDiego.ts` untouched.

**Step 3:** Render parity — reload each of the 6 consumers at 1440px (record
`innerWidth` in the same call, per CLAUDE.md) and compare to the Task-0 baseline:
`/`, `/explore/cluster`, `/explore/gas-expulsion`, `/explore/mass-segregation`,
`/volume-lab`, `/cluster-lab`. Each must render identically; no console errors.

**Step 4:** If any page is blank or errors, STOP — a moved import path or a shim
is wrong (systematic-debugging). Do not paper over with a gate relaxation.

---

### Task 6: Commit, merge, verify deploy

**Step 1:** Commit on the branch.
```bash
git add -A
git commit -m "novascope: absorb all cluster viz — WebGL engine + hero + art (ADR 0013)

Re-home every cluster renderer into src/novascope/viz: the WebGL volumetric
engine (viz/webgl/), the Plummer hero (viz/clusterHero.ts), and the gravoturb
art (viz/clusterArt.ts). Their old src/lib paths are compat re-export shims, so
all 6 consumers (homepage hero, cluster-lab, and the 4 explore/volume-lab pages)
render unchanged. Imports adapted to the package's internal convention (relative,
.ts; no alias inside the package), so novascope stays a self-contained,
extractable unit — the boundary gate proves it. No dedupe, no consumer migration
yet: that plus wiring Feedback Budget is the follow-on."
```

**Step 2:** Use superpowers:finishing-a-development-branch to merge to `main`
(verify gates on the merged result, then push).

**Step 3:** After push, confirm the deploy goes green (site-verify) and re-eyeball
one WebGL consumer + the homepage hero on the deployed site.

---

## Definition of done
- Every cluster renderer lives under `src/novascope/viz/` (`webgl/`,
  `clusterHero.ts`, `clusterArt.ts`).
- `src/lib/cluster/index.ts`, `src/lib/clusterField.ts`, `src/lib/clusterArt.ts`
  are compat re-export shims; genuine site lib untouched.
- No file inside `src/novascope/` imports the site or uses the `@novascope/`
  alias internally; `pnpm check:novascope`, `pnpm check`, `pnpm build` all green.
- All 6 consumer pages render identically to baseline; no console errors.
- Nothing deduped, migrated, or deleted beyond the moves — that is the follow-on.
