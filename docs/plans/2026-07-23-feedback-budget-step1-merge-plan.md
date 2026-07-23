# Feedback Budget — Step 1: merge the `lib/cluster` WebGL engine into novascope

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Re-home the `lib/cluster` WebGL volumetric engine into `src/novascope`
so novascope has a WebGL viz capability, WITHOUT changing behavior — every
existing consumer keeps rendering. This is the load-bearing foundation for
Feedback Budget (design: `docs/plans/2026-07-23-feedback-budget-design.md`;
decision: ADR 0013).

**Architecture:** Move the engine source under `src/novascope/viz/webgl/`, adapt
imports to novascope conventions (relative, explicit `.ts`), and turn
`src/lib/cluster/index.ts` into a thin **compat re-export shim** from novascope.
The 4 real consumers (`volume-lab`, `explore/gas-expulsion`,
`explore/mass-segregation`, `explore/cluster`) keep importing from
`../lib/cluster` unchanged. No dedupe and no consumer migration in this step —
those are a separate follow-on. `ClusterHero` (`lib/clusterField.ts`) and
`cluster-lab` (`lib/clusterArt.ts`) are DIFFERENT files — untouched, not consumers.

**Tech Stack:** Astro static + strict TS; novascope layered engine (ADR 0012);
gates `pnpm check:novascope` (import boundary), `pnpm check`, `pnpm build`;
browser preview at 1440px for render checks.

**What moves** (engine.ts closure + siblings): `engine.ts`, `shaders.ts`,
`spectral.ts`, `scene.ts`, `interaction.ts`, `massSegregation.ts`, `dynamics.ts`.
`engine.ts` imports only `shaders`, `spectral`, `scene` — the rest are
independent siblings consumed directly (`attachInteraction`, `makeSegregator`,
`createDynamics`).

**Deferred to a follow-on plan (NOT here):** dedupe (`spectralRGB`→`teffToRGB`,
`makeSegregator`→`segregateMasses`, `attachInteraction`→`viz/camera`); migrate
the 4 consumers to import from novascope; delete the shim; wire `createDynamics`.
Then Feedback Budget itself (design steps 3–4).

---

### Task 0: Baseline — capture green before touching anything

**Step 1:** Run the gates and record they pass.
Run: `pnpm check:novascope && pnpm check && pnpm build`
Expected: novascope boundary ok; 0 type errors; build succeeds.

**Step 2:** Start the preview and confirm each of the 4 consumers renders.
Run: `astro dev` (background), then load and eyeball at 1440px:
`/volume-lab`, `/explore/gas-expulsion`, `/explore/mass-segregation`,
`/explore/cluster`. Confirm the WebGL cluster/gas draws (no blank canvas, no
console errors). Screenshot each — this is the regression baseline.

**Step 3:** Commit nothing; this task only establishes the safety net.

---

### Task 1: Re-home the renderer closure into `novascope/viz/webgl/`

**Files:**
- Create: `src/novascope/viz/webgl/{engine,shaders,spectral,scene,interaction}.ts`
- Source: the same-named files from `src/lib/cluster/`

**Step 1:** `git mv` each of `engine.ts shaders.ts spectral.ts scene.ts interaction.ts`
from `src/lib/cluster/` to `src/novascope/viz/webgl/`.

**Step 2:** Fix imports to novascope convention — relative with explicit `.ts`
extensions (Node `--experimental-strip-types` requires them). In `engine.ts`:
`from "./shaders"` → `from "./shaders.ts"`, same for `spectral`, `scene`.
`interaction.ts` and `scene.ts` similarly for any sibling imports.

**Step 3:** Run the type check.
Run: `pnpm check`
Expected: 0 errors (imports resolve at the new path).

**Step 4:** Run the boundary gate.
Run: `pnpm check:novascope`
Expected: green. If it flags `viz/webgl` importing DOM/WebGL — that is allowed
(viz is the rendering layer; `mountCanvas` already uses canvas). If it flags
`scene.ts` (a data loader/`fetch`) as mis-layered, move the pure `Scene`/`View`
types to `viz/webgl/scene.ts` and keep it Layer-2 (it renders, it may fetch).
Do NOT put WebGL/DOM in `core/`.

---

### Task 2: Re-home the independent siblings

**Files:**
- Create: `src/novascope/viz/webgl/{massSegregation,dynamics}.ts`
- Source: `src/lib/cluster/{massSegregation,dynamics}.ts`

**Step 1:** `git mv` `massSegregation.ts` and `dynamics.ts` into
`src/novascope/viz/webgl/` (they are cluster-viz concerns for now; the dedupe
step later reconciles `makeSegregator` with core `segregateMasses`). Fix any
sibling imports to `.ts` extensions.

**Step 2:** Type check + boundary gate.
Run: `pnpm check && pnpm check:novascope`
Expected: both green.

---

### Task 3: Export the WebGL surface from novascope viz

**Files:**
- Create: `src/novascope/viz/webgl/index.ts` (barrel for the re-homed engine)
- Modify: `src/novascope/viz/index.ts` (re-export the webgl barrel)

**Step 1:** Write `viz/webgl/index.ts` re-exporting the full former `lib/cluster`
public surface from the moved files: `Scene`, `View`, `loadScene`,
`sceneFromParts`, `ClusterEngine`, `EngineOptions`, `createEngine`,
`DEFAULT_ZOOM`, `ZOOM_MIN`, `ZOOM_MAX`, `attachInteraction`, `spectralRGB`,
`Segregator`, `makeSegregator`, `Dynamics`, `DynamicsInit`, `DynamicsParams`,
`Diagnostics`, `Phase`, `createDynamics`, `RELAX_TCROSS`. (Match
`src/lib/cluster/index.ts`'s original exports exactly.)

**Step 2:** Re-export it from `viz/index.ts`: `export * from "./webgl/index.ts";`

**Step 3:** Type check.
Run: `pnpm check`
Expected: 0 errors.

---

### Task 4: Turn `lib/cluster` into a compat shim

**Files:**
- Modify: `src/lib/cluster/index.ts` (becomes a pure re-export)
- Delete: the now-moved files remain only under novascope

**Step 1:** Replace `src/lib/cluster/index.ts`'s body with a single re-export so
the 4 consumers' `from "../lib/cluster"` keeps resolving:
`export * from "../../novascope/viz/webgl/index.ts";`
(Adjust the relative depth to reach `src/novascope/viz/webgl/index.ts`.) Add a
one-line comment: "compat shim — engine lives in novascope now (ADR 0013);
migrate consumers + delete in the follow-on."

**Step 2:** Confirm no stale files remain in `src/lib/cluster/` except `index.ts`
(the `git mv`s in Tasks 1–2 removed them).
Run: `ls src/lib/cluster/`
Expected: only `index.ts`.

**Step 3:** Type check.
Run: `pnpm check`
Expected: 0 errors — the 4 consumers resolve through the shim.

---

### Task 5: Verify no regression (the whole point)

**Step 1:** All gates.
Run: `pnpm check:novascope && pnpm check && pnpm build`
Expected: boundary green; 0 type errors; build succeeds.

**Step 2:** Render check — reload each of the 4 consumers at 1440px and compare
to the Task-0 baseline screenshots: `/volume-lab`, `/explore/gas-expulsion`,
`/explore/mass-segregation`, `/explore/cluster`. Each must render the WebGL
cluster/gas identically, no console errors.

**Step 3:** If any page is blank or errors, STOP — the move broke an import path
or the shim depth is wrong. Diagnose (systematic-debugging), do not paper over.

---

### Task 6: Commit

**Step 1:** Commit the merge.
```bash
git add -A
git commit -m "novascope: absorb the lib/cluster WebGL engine (ADR 0013)

Re-home the volumetric gas+stars WebGL engine into src/novascope/viz/webgl;
lib/cluster is now a compat re-export shim so the 4 consumers (volume-lab,
gas-expulsion, mass-segregation, Birth) render unchanged. No dedupe, no
consumer migration yet — that plus wiring Feedback Budget is the follow-on."
```

**Step 2:** Push; confirm the deploy goes green and re-eyeball one consumer on
the deployed site (site-verify discipline).

---

## Definition of done
- WebGL engine source lives under `src/novascope/viz/webgl/`.
- `src/lib/cluster/` is just a re-export shim.
- `pnpm check:novascope`, `pnpm check`, `pnpm build` all green.
- All 4 consumer pages render identically to baseline; no console errors.
- Nothing deduped, migrated, or deleted beyond the moves — that is the follow-on.
