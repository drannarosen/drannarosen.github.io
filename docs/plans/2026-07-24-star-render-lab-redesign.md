# Star-render redesign — photographic cluster optics (novascope) + Three.js lab harness

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to
> implement this plan task-by-task. Honor the project skills: **site-verify**
> (browser-verify at 1440×900, record `innerWidth`; confirm the green deploy),
> the **no-cosmetic-hacks** memory (morphology must come from the model/optics,
> never a hand-drawn mask), **push-after-every-edit** (Anna A/Bs on the deployed
> link — the lab page is `noindex`/unlinked, so pushing `main` is safe), and the
> **novascope boundary** (`check:novascope`): the pure module imports nothing but
> the science core, downward only, no `three`, no `astro`.

**Goal:** Rebuild the `/star-render-lab` renderer so its default is a coherent,
scientifically grounded *observed-image* of the real gravoturb cluster — crisp
unresolved cores, temperature-diverse colour, robust HDR exposure, restrained
glare, stable under orbit — with named educational transfer functions and a
component-isolation debug view, and an easy A/B against the legacy renderer.

**Architecture (Option B — split by portability, locked 2026-07-24):**
The physics→pixel **mathematics is a pure, dependency-free novascope module**
(`src/novascope/viz/starOptics.ts` + `starTransfer.ts`): **no `three`, no DOM**,
node-type-strippable, unit-tested by a build gate. It is the durable, extractable
asset and the exact code that later ports to TSL/WebGPU and into the raw-WebGL2
production renderer. The **Three.js layer is a disposable lab *harness*** at
`src/lib/starlab/` (`scene.ts` + `shaders.ts` + the page) that imports the math
through the `@novascope/viz/*` alias (the site→package seam). GLSL mirrors the
pure functions; the constants live once, in the module. **novascope stays
three-free.**

**Tech Stack:** Astro (static) · Three.js `0.185.1` `WebGLRenderer` + custom GLSL
in the harness only (no R3F, no WebGPU yet) · `node --experimental-strip-types`
check-script tests (no vitest in repo) · gravoturb data
(`stars.f32` = `[x,y,z,mass,teff,radius]` in pc,pc,pc,M☉,K,R☉).

---

## Module boundary (why the split is clean)

| Concern | Home | Rule |
| --- | --- | --- |
| Flux, exposure, PSF, aureole, tiers, chromaticity, transfer registry | `src/novascope/viz/starOptics.ts`, `starTransfer.ts` | pure; no `three`/DOM/`astro`; `check:novascope` + `check:star-optics` green; node-testable |
| Three.js scene, HDR pipeline, passes, controls glue | `src/lib/starlab/scene.ts`, `shaders.ts` | disposable harness; imports math via `@novascope/viz/starOptics` |
| Legacy renderer (A/B reference) | `src/lib/starlab/scene-legacy.ts` | untouched after Task 0.1 |
| Page + controls | `src/pages/star-render-lab.astro` | `noindex`, unlinked |

`starOptics.ts` is **viz-layer**: it may import *downward* (core/state) relatively
if it needs an existing constant — reuse the core solar `Teff☉`/`T☉` if one
exists rather than redefining it (site-integrity: one home per fact); otherwise
define `T_SUN_K = 5772` with a provenance comment (IAU 2015 nominal). It must not
import upward, `astro`, or `three`. Note the *existing* `src/novascope/state/render.ts`
`toRenderModel` is the **schematic** physics→render-model for the shipped
explorables; this photographic pipeline is a **separate** mapping — do not merge
or duplicate it, and reference it in a header comment so the two stay distinct.

## Design decisions (locked before implementation)

- **Flux.** `F = L / (4π d²)`, single common cluster distance `D0` (module
  constant, documented). Optional depth relief `d = D0·(1 + z_pc·κ)`, `κ` default
  **0** (Observed mode has no depth fog). `L/L☉ = (R/R☉)²(Teff/T☉)⁴`; mass is used
  only by the Mass educational view, **never** as the size law.
- **Exposure.** Scene-fixed calibrated (no camera adaptation → no pumping).
  `whiteFlux` = robust percentile (default **P99.5**) of all apparent fluxes,
  computed **once at load**, not the max. Optional clamped/smoothed auto-adapt is
  a lab toggle, off by default.
- **Dynamic range.** `displaySignal = asinh(k·exp·F) / asinh(k·whiteFlux)`,
  `k` default 8.
- **Core size.** `coreRadiusPx = clamp(r0 + a·log1p(F/F0), coreMin, coreMax)`,
  defaults `r0=0.75, a=0.35, coreMin=0.7, coreMax=3.0` px — **independent of the
  brightness law** (luminosity → radiance, not diameter).
- **PSF.** Moffat `pow(1+(ρ/α)², −β)`, `β` default 3.2 (lab range 2.5–4.5).
- **Aureole.** `amp/pow(1+ρ/scale, p)`, Tier ≥ 2 only, `amp≪core peak`
  (default 0.06), broad `scale` (2.5), `p` 2.5 — never an opaque disk.
- **Tiers** by apparent-flux percentile, fixed at load: **T1** F<P90 (cheap
  core-only), **T2** P90≤F<P99.5 (core+wing+aureole), **T3** F≥P99.5 (adds
  diffraction). Boundaries are lab sliders; diffraction runs for T3 only.
- **Compositing.** Linear HDR half-float target; **premultiplied-alpha radiance**;
  depth **test on**, **write off** (emission in linear HDR is order-independent).
  Verify vs additive in the lab; record the final choice in a code comment.
- **Diffraction.** One **shared instrument orientation** (`uSpikeAngle`, default 0);
  spike length **sublinear**: `∝ log1p(F/whiteFlux)`; core brighter than spikes;
  disable-able (off in scientific-neutral mode).
- **Tone mapping.** AgX vs ACES dev toggle; **default chosen empirically in
  Stage 5** — do not hardcode a winner before the screenshots exist.
- **Stability.** DPR-aware sizing; **energy-preserving subpixel coverage** for
  sub-pixel cores (no conspicuous 2 px clamp); all per-star randomness = `hash(id)`
  where `id` = array index, never frame-dependent.

## A/B strategy (spec: preserve easy comparison with the original)

Rename current `scene.ts` → `scene-legacy.ts` (`initStarLabLegacy`), add a page
switch **Renderer: Legacy · Observed-v2** that dynamically imports either module.
Both load the same data. This is the DELIVERABLE's required A/B.

---

## Stage 0 — Scaffold, test harness, A/B switch

### Task 0.1 — Preserve the legacy renderer

**Files:** Rename `src/lib/starlab/scene.ts` → `src/lib/starlab/scene-legacy.ts`.

**Step 1:** `git mv src/lib/starlab/scene.ts src/lib/starlab/scene-legacy.ts`.
**Step 2:** rename export `initStarLab` → `initStarLabLegacy` (nothing else changes).
**Step 3:** `pnpm check` → expect FAIL (page still imports `initStarLab`).
**Step 4:** point the page import at `initStarLabLegacy`; `pnpm check` → PASS.
**Step 5:** Commit `refactor(starlab): preserve legacy renderer as scene-legacy`.

### Task 0.2 — Pure novascope module stub + node gate (in prebuild)

**Files:** Create `src/novascope/viz/starOptics.ts` (pure; **no** `three`/DOM);
create `scripts/check-star-optics.mjs`; modify `package.json`
(`check:star-optics` script **and add it to `prebuild`** next to `check-render.mjs`).

**Step 1 (failing test):** `scripts/check-star-optics.mjs`, mirroring
`scripts/check-render.mjs`'s `ok(cond,msg)` idiom, importing
`../src/novascope/viz/starOptics.ts`:

```js
import { STAROPTICS_OK } from "../src/novascope/viz/starOptics.ts";
let failures = 0;
const ok = (c, m) => { console.log(`  ${c ? "ok  " : "FAIL"}  ${m}`); if (!c) failures++; };
console.log("star-optics (novascope/viz):");
ok(STAROPTICS_OK === true, "module loads");
process.exit(failures ? 1 : 0);
```

**Step 2:** add `"check:star-optics": "node --experimental-strip-types scripts/check-star-optics.mjs"`
and splice `&& node --experimental-strip-types scripts/check-star-optics.mjs` into `prebuild`.
**Step 3:** `pnpm check:star-optics` → FAIL. **Step 4:** create `starOptics.ts`
with `export const STAROPTICS_OK = true;`. **Step 5:** `pnpm check:star-optics` +
`pnpm check:novascope` → PASS (boundary clean). **Step 6:** Commit
`test(novascope): pure star-optics module + prebuild gate`.

### Task 0.3 — Renderer A/B switch in the page

**Files:** Modify `src/pages/star-render-lab.astro`.

**Step 1:** add a `Renderer` button group (`Legacy`/`Observed-v2`) above the stage.
**Step 2:** dynamic import keyed to the switch; default `Observed-v2` → stub
`initStarLabV2` (filled in Stage 4). **Step 3:** `pnpm check` → PASS. **Step 4:**
browser 1440×900 (record `innerWidth`): both buttons present, Legacy renders as
before. **Step 5:** Commit `feat(starlab): renderer A/B switch`.

---

## Stage 1 — Flux & chromaticity (pure math, TDD, novascope)

All tasks add to `src/novascope/viz/starOptics.ts` + `scripts/check-star-optics.mjs`.

### Task 1.1 — Physical input (incl. mass) + apparent flux

**Step 1 (failing tests):**

```js
import { deriveLogL, apparentFlux, D0_PC } from "../src/novascope/viz/starOptics.ts";
ok(Math.abs(deriveLogL(5772, 1)) < 1e-6, "Sun logL = 0");
ok(Math.abs(deriveLogL(5772, 2) - 2*Math.log10(2)) < 1e-6, "logL scales as R²");
const F1 = apparentFlux(0, D0_PC), F2 = apparentFlux(0, 2*D0_PC);
ok(Math.abs(F2/F1 - 0.25) < 1e-6, "flux falls as 1/d²");
```

**Step 2:** FAIL. **Step 3:** implement (solar/log units per CLAUDE.md):
`deriveLogL(teffK,Rsun)=2*log10(R)+4*log10(Teff/T_SUN_K)`; `D0_PC=400` (documented);
`apparentFlux(logL,dPc)=10**logL/(dPc*dPc)` (∝; only ratios matter for display).
**Step 4:** PASS. **Step 5:** Commit.

### Task 1.2 — Blackbody chromaticity, linear & flux-separated

**Step 1 (failing tests):**

```js
import { blackbodyLinearRGB } from "../src/novascope/viz/starOptics.ts";
const hot = blackbodyLinearRGB(30000), cool = blackbodyLinearRGB(3200);
ok(Math.abs(Math.max(...hot) - 1) < 1e-6, "hot chroma max-normalized (flux separated)");
ok(hot[2] >= hot[0], "30 kK star is blue-white");
ok(cool[0] > cool[2], "3.2 kK star is warm");
```

**Step 2:** FAIL. **Step 3:** port the Kim et al. 2002 Planckian-locus code from
`scene-legacy.ts` (the `blackbodyLUT` body) into a pure `blackbodyLinearRGB(teffK)`
returning **max-normalized linear** RGB, with the source cited in a comment.
**Step 4:** PASS. **Step 5:** Commit `feat(novascope): linear blackbody chromaticity`.

---

## Stage 2 — Robust exposure & dynamic range (pure math, TDD)

### Task 2.1 — Robust whiteFlux (percentile, not max)

```js
import { robustWhiteFlux } from "../src/novascope/viz/starOptics.ts";
const f = Array.from({length: 1000}, (_, i) => i); f.push(1e9);
const w = robustWhiteFlux(f, 0.995);
ok(w < 1000, "ignores the single runaway (not the max)");
ok(w > 980, "sits at ~P99.5 of the bulk");
```

Implement percentile on a sorted copy: index `clamp(round(p*(n-1)),0,n-1)`. Commit.

### Task 2.2 — asinh photographic response

```js
import { asinhResponse } from "../src/novascope/viz/starOptics.ts";
const white = 100, k = 8;
ok(Math.abs(asinhResponse(white,1,k,white) - 1) < 1e-6, "signal = 1 at whiteFlux");
ok(asinhResponse(0,1,k,white) === 0, "zero flux → zero signal");
const a = asinhResponse(white/2,1,k,white), b = asinhResponse(white,1,k,white);
ok(b > a && b < 2*a, "monotone and compressive");
ok(asinhResponse(white*0.01,1,k,white) > 0.05, "faint stars lifted into visibility");
```

`asinhResponse(F,exp,k,white)=Math.asinh(k*exp*F)/Math.asinh(k*white)` (guard
`white>0`). Commit `feat(novascope): asinh exposure response`.

---

## Stage 3 — Star-profile components (pure math, TDD)

### Task 3.1 — Bounded core radius (decoupled from brightness)

```js
import { coreRadiusPx } from "../src/novascope/viz/starOptics.ts";
const P = { r0:0.75, a:0.35, coreMin:0.7, coreMax:3.0, F0:1 };
for (const F of [1e-3,1,1e3,1e6]) {
  const rpx = coreRadiusPx(F, P);
  ok(rpx >= P.coreMin-1e-9 && rpx <= P.coreMax+1e-9, `core bounded at F=${F}`);
}
ok(coreRadiusPx(1e6, P) <= 3.0, "brightest core ≤ 3 px");
```

`clamp(r0 + a*Math.log1p(Math.max(0,F)/F0), coreMin, coreMax)`. Commit.

### Task 3.2 — Moffat PSF + broad faint aureole

```js
import { moffat, aureole } from "../src/novascope/viz/starOptics.ts";
ok(Math.abs(moffat(0,1,3.2) - 1) < 1e-9, "Moffat peaks at 1 on axis");
ok(moffat(2,1,3.2) < moffat(1,1,3.2), "Moffat decreases with radius");
const A = { amp:0.06, scale:2.5, p:2.5 };
ok(aureole(0,A) <= 0.06, "aureole peak is faint");
ok(aureole(3,A) > aureole(0,A)*0.1, "aureole wing is broad at ρ=3");
```

`moffat(rho,alpha,beta)=Math.pow(1+(rho/alpha)**2,-beta)`;
`aureole(rho,{amp,scale,p})=amp/Math.pow(1+rho/scale,p)`. Commit.

### Task 3.3 — Flux tier classifier

```js
import { computeTiers } from "../src/novascope/viz/starOptics.ts";
const flux = Array.from({length:10000}, (_, i) => i);
const { tier, thresholds } = computeTiers(flux, { t2:0.90, t3:0.995 });
const c = [0,0,0,0]; for (const t of tier) c[t]++;
ok(tier.length === flux.length, "one tier per star");
ok(c[1] > c[2] && c[2] > c[3], "T1 majority, T3 rarest");
ok(Math.abs(c[3]/flux.length - 0.005) < 0.002, "T3 ≈ top 0.5%");
ok(thresholds.t2 < thresholds.t3, "thresholds ordered");
```

Percentile thresholds from a sorted copy, then per-star tier. Commit
`feat(novascope): population flux tiers`.

---

## Stage 4 — GLSL, tiered draw, HDR compositing (Three.js harness, browser-verified)

> Visual tasks: acceptance is browser screenshots + clean console, NOT unit
> asserts (a screenshot can't be asserted in node — do not fake a test). Each task
> lists explicit visual pass criteria. The harness imports every constant/formula
> from `@novascope/viz/starOptics` — GLSL mirrors, never re-derives, the math.

### Task 4.1 — `shaders.ts`: GLSL mirroring the pure transfer functions

**Files:** Create `src/lib/starlab/shaders.ts`.

`STAR_VS`/`STAR_FS` with GLSL `coreRadiusPx`, `moffat`, `aureole`, `asinhResponse`
**identical** to `starOptics.ts` (same formulae, uniforms carry the locked
defaults). Per-instance attributes `iPos, iLogL, iTempT, iTier, iFlux`. Vertex
sizes the quad from `coreRadiusPx` + Tier-dependent aureole extent, DPR-aware.
Fragment: linear-HDR radiance = `chromaticity(iTempT)·asinhResponse(iFlux)·
(core·moffat + aureoleTerm + spikeTerm)`, premultiplied-alpha out, **no**
`clamp(...,0,1)` before compositing. Compiles when imported by 4.2. Commit with 4.2.

### Task 4.2 — `src/lib/starlab/scene.ts` (v2): instanced tiered billboards + half-float HDR

**Files:** Create `src/lib/starlab/scene.ts` exporting `initStarLabV2`;
`import { … } from "@novascope/viz/starOptics"`.

- Parse `stars.f32` → per-star `logL`, `iTempT`, `mass`, `flux`, then `whiteFlux`
  and `tier` (all from the module, fixed at load). Stable id = index; jitter = `hash(id)`.
- Branch shading on `iTier` (T1 cheap core-only; diffraction only when `iTier==3`).
- Half-float `WebGLRenderTarget` (`HalfFloatType`); explicit
  `renderer.outputColorSpace = SRGBColorSpace`; tone map applied **once** at resolve.
- Premultiplied-alpha, `depthTest:true`, `depthWrite:false`.
- Energy-preserving subpixel coverage for sub-pixel cores (no 2 px clamp).

**Verify (browser 1440×900, record `innerWidth`, `getContext('webgl2')`):** cluster
renders; **no giant central blob**; faint stars reveal radial structure; hot stars
blue-white, cool warm without an orange cast; cores compact; console clean.
Screenshot for Anna. Commit `feat(starlab): observed-mode v2 renderer`.

### Task 4.3 — Orbit/zoom stability

Scene-fixed exposure (whiteFlux frozen at load), id-based randomness only.
**Verify:** orbit + zoom → no exposure pumping, no flicker, no faint-star popping;
DPR change (`resize_window`) keeps sizes stable. Commit
`fix(starlab): stable exposure + subpixel coverage`.

---

## Stage 5 — Tone mapping (AgX vs ACES) + restrained bloom (browser-verified)

### Task 5.1 — AgX/ACES dev toggle, pick default empirically

Add a tone-mapper switch (`THREE.AgXToneMapping`/`ACESFilmicToneMapping`, both
native in 0.185). Capture the 5 acceptance views under each; choose the default by
colour retention (blue/white/yellow/red), highlight rolloff, faint visibility, no
cream blobs. Record the choice + why in a `scene.ts` comment. Commit
`feat(starlab): AgX/ACES toggle, default = <winner>`.

### Task 5.2 — Bloom as display glare only

Bloom fed only from pixels above a **high** luminance threshold; low strength; soft
threshold. **Verify:** stars remain convincing with **bloom OFF** (spec gate);
cores stay sharp after the composite. Screenshot on/off. Commit
`feat(starlab): restrained HDR bloom`.

---

## Stage 6 — Educational views, debug isolation, control reorg

### Task 6.1 — Named transfer functions (replace A/C) — pure, TDD

**Files:** Create `src/novascope/viz/starTransfer.ts` (imports `starOptics`);
extend `scripts/check-star-optics.mjs`; wire into `scene.ts` + page.

Views **Observed** (default), **Temperature**, **Luminosity**, **Mass**, **Depth**
— each a named transfer that **replaces** the observed mapping (no silent false-
colour mix). Pure `transferColor(mode, star, params)`.

```js
import { transferColor } from "../src/novascope/viz/starTransfer.ts";
const hot = { logL: 4, teffK: 30000, mass: 40, z: 0.2 };
ok(transferColor("temperature",hot)+"" !== transferColor("observed",hot)+"", "views differ");
// Mass view must key on mass, not luminosity:
const a = transferColor("mass", { ...hot, mass: 1 });
const b = transferColor("mass", { ...hot, mass: 40 });
ok(a+"" !== b+"", "Mass view uses mass");
```

Implement, PASS, then **remove the A/C pills**. Browser-verify each view. Commit.

### Task 6.2 — Component-isolation debug render

**Files:** modify `shaders.ts`, `scene.ts`, page. Uniform `uDebugChannel` outputs
**core / PSF / aureole / diffraction / bloom** separately (required so each earns
its place). **Verify:** each channel shows only its component. Commit
`feat(starlab): component debug passes`.

### Task 6.3 — Reorganize controls into groups

**Files:** `src/pages/star-render-lab.astro`. Groups: **View** (Observed/Temperature/
Luminosity/Mass/Depth) · **Camera** (exposure, dynamic-range k, tone mapper) ·
**Optics** (PSF β, aureole, diffraction, bloom) · **Performance/debug** (tier
boundaries, render-pass isolation, overdraw view, frame time). Type tokens per
CLAUDE.md (`--step-*`), theme-aware. **Verify:** browser — every control drives its
uniform; frame-time + overdraw read out. Commit `feat(starlab): grouped lab controls`.

---

## Stage 7 — Acceptance sweep + ship

### Task 7.1 — Acceptance screenshots + checklist

Capture the 5 fixed views — (1) cluster-wide, (2) core close-up, (3) bright-star
close-up, (4) sparse outskirts, (5) overlapping hot+cool. Walk the spec's pass/fail
list explicitly (no star destroys visibility; coherent faint structure; hot=blue-
white; cool=warm not orange; compact cores; broad faint halos; rare instrument-
consistent diffraction; attractive with bloom off; no pumping/flicker on orbit;
10,301 stars interactive). Note frame time. Post screenshots + the verdict to Anna.
Do **not** claim a pass you didn't observe.

### Task 7.2 — Gates + ship

`pnpm check:star-optics`, `pnpm check:novascope`, `pnpm check`, `pnpm build` all
green. **REQUIRED: site-verify** — browser at 1440×900 (record `innerWidth`), push
`main`, **confirm the deploy goes green** (`gh run list`), not just the push. Push
checkpoints one at a time (parallel pushes race the Pages deploy).

---

## Out of scope (record, do not build here)

- Star–gas extinction / Stage-2 raymarch coupling — that is the Layer 2/3 plan's
  Task 5, in the production renderer.
- Porting the winning optics into the **raw-WebGL2** production renderer
  (`src/novascope/viz/webgl/`) — a separate follow-on, done after Anna picks the
  default here. It reuses `starOptics.ts` directly (that is the point of the split).
- Cinematic mode (subtle DoF / broader glare) — a later lab toggle; scientific
  Observed mode is the deliverable.
```
