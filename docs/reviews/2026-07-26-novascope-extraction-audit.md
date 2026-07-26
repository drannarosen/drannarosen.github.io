# Novascope extraction audit — 2026-07-26

Scope: `src/novascope/`, `src/lib/`, `src/pages/`, `src/components/`, `scripts/check-*`,
against ADRs 0012 / 0013 / 0015 / 0016 and `docs/plans/2026-07-25-star-rendering-vision-roadmap.md`.

Requested before continuing Novascope work: is everything Novascope-related in Novascope,
is the layering real, where are the remaining one-home-per-fact violations, and are the
gates the right gates.

## Method, and what "verified" means here

Every claim below is labelled by how it was established:

- **(read)** — I opened the file in this session and the claim is quoted from it.
- **(measured)** — produced by running a command whose output is recorded here.
- **(inferred)** — reasoned from evidence but not directly executed. Treated as *suspected*.

Two commands were run to completion:

```
pnpm build     # green — all 22 prebuild gates + 3 postbuild gates pass, 32 pages built
pnpm check     # 0 errors, 0 warnings, 12 hints (astro check, 175 files)
```

Nothing in this audit changes code.

---

## Grades

| Axis | Grade | One-line reason |
| --- | --- | --- |
| **Architecture** | **A−** | Layering is enforced and real in the direction it checks. Layer 0 still holds render concerns; Layer 1 is bypassed by the newest and most-worked surface; five cluster renderers coexist. |
| **DRY / one home per fact** | **B+** | Where the discipline has been applied it is genuinely exceptional (registries, `figures.json`, `urlState`, `labStateToPrepareOptions`). The violations that remain are all in code written *before* the discipline, and one of them is a live dead-code trap. |
| **Gate coverage** | **B** | 21 gates, thoughtfully non-tautological — `check-calibrate` explicitly refuses to fit its own bounds to its fixture. But the single duplication ADR 0015 *conditionally accepted* (TSL mirrors TS) has no automated gate, two shipped subsystems have none, and `astro check` runs in neither `build` nor CI. |
| **Extraction readiness** | **A−** | The mechanism works: alias at the seam, relative inside, gate green on 72 files. Four concrete blockers, all small, listed in P1/P2. |

The headline: **this is a well-built package with a small number of specific, cheap
defects.** Almost every problem below is a leftover from a migration that was 90% finished,
not a design error.

---

## 1. Is everything Novascope-related actually in Novascope?

### 1a. The known shim — smaller than you thought (read)

`src/lib/clusterField.ts` is the ADR 0013 compat shim. Its consumer set is **one file, not
four**:

```
src/components/ClusterHero.astro:136   import { initClusterField } from "../lib/clusterField";
```

The other three pages you named do **not** go through it — they import Novascope directly:

| page | actual import |
| --- | --- |
| `src/pages/cluster-lab.astro` | `@novascope/viz/clusterArt` |
| `src/pages/volume-lab.astro` | `@novascope/viz/webgl` |
| `src/pages/explore/mass-segregation.astro` | `@novascope/viz/webgl` |

So retiring the shim is a **one-line edit plus one file deletion**, not a four-site migration.

**`clusterHero` is site-specific, and that is settled** (Anna, 2026-07-26). It renders *this
site's* homepage hero — a specific composition, a specific centre offset, a specific "felt, not
noticed" rotation period — and it is not a general-purpose renderer. It is therefore **not a
candidate for extraction, not to be generalised, and not to be re-platformed onto the newer
starfield engine.** ADR 0015 already carves the hero out of the star-renderer work ("the
homepage hero stays as it is"); this extends that from the *look* to the *code*. Any
recommendation below that touches it is about naming and stale comments only.

**A trap sits on top of it, though.** There are two different modules whose names collide:

- `src/novascope/viz/clusterField.ts` → exports `renderClusterField` (canvas-2D, consumes a
  `RenderModel`)
- `src/novascope/viz/clusterHero.ts` → exports `initClusterField` (the hero Plummer canvas)

`src/lib/clusterField.ts` re-exports **`clusterHero`**. Both are re-exported from
`viz/index.ts`. Someone re-homing the shim by name-matching will import the wrong one and get
a type error at best, the wrong renderer at worst.

Compounding it: `clusterHero.ts` line 2 still opens `clusterField.ts — renderer for the hero
star-cluster visual` (read). The file was renamed; its header was not.

### 1b. `src/lib/gravoturb.ts` — your judgement is correct (read)

Confirmed, not taken on trust. It does exactly one thing: `readFileSync` on
`public/data/gravoturb/**/meta.json` at build time and format the result for prose. It imports
`node:fs` and `node:path`, no Novascope module, and it exists specifically so a page lede
cannot retype a star count. That is site plumbing over a shipped dataset — it belongs in
`src/lib/`, and putting it in `core/` would import `node:fs` into Layer 0 and break the
boundary gate. **Not a leak. Leave it.**

### 1c. The real leak: `src/components/story/StageInitialConditions.astro` (read)

276 lines, 159 of them an inline `<script>`, used only by `/model-path`. It imports
`sampleCluster`, `teffToRGB`, `massToTeff` from `@novascope/core/imf` — then implements, inline
in the site layer:

- **a cluster point renderer** with radial-gradient glow, depth ordering and alpha
  (lines ~85–112) — which is what `viz/clusterField.ts` already does, and what
  `viz/clusterHero.ts` already does;
- **an IMF histogram renderer** with its own binning, axes, tick labels and colour mapping
  (`drawIMF`, lines ~114–175) — which is what `viz/histogram.ts` already does.

That makes **three** canvas cluster-point renderers and **two** IMF histograms in the repo, one
of each living outside the package. It also bypasses `state/render.ts`, which its own header
calls "the ONE physics→pixel mapping (Architecture §9.4)".

Two smaller things inside it:

- Header cites **`lib/imf.ts`** (line 5) — a path that has not existed since the merge (read;
  `ls src/lib/` confirms).
- `updateReadout()` carries `// O/B stars: roughly Teff > 10,000 K ⇒ mass ≳ 3 Msun via our MS
  relation` and then implements `s.mass >= 3`. The threshold is *stated* in temperature and
  *implemented* in mass, with the conversion done once by hand. `zamsTeff` is the authority and
  nothing connects them. This is the same species as the PSF-aureole amplitude bug.

### 1d. Rendering concerns inside Layer 0 (read)

`src/novascope/core/imf/index.ts` exports `sampleCluster()`, which returns:

```ts
export interface Star {
  x, y, z, mass, teff
  color: [number, number, number];
  sizePx: number;          // "Base render radius in logical px"
  baseOpacity: number;
  twinkles: boolean;       // "Whether this star twinkles (only the brighter ones do)"
}
```

with `ClusterOptions.minSizePx` / `maxSizePx`, and a final
`stars.sort((a,b) => a.sizePx - b.sizePx)` commented `// Painter's order`.

Apply ADR 0015's own test — *"would a consumer who never renders anything want this?"* —
and the answer for `sizePx`, `baseOpacity`, `twinkles` and painter's order is plainly no.
Layer 0 is supposed to be the module `photometry` and `colorimetry` are found in, and it
currently ships a canvas billboard size in logical pixels.

The boundary gate cannot see this: it checks **imports and DOM globals**, not concepts. A
module can hold pixels, opacity and paint order without importing anything.

Two related notes, stated as tension rather than as bugs:

- `sizePx` is normalised across `[logL(mMin), logL(mMax)]` — the *sampled range's* endpoints.
  It is not rank-based, so it is not the thing ADR 0015 forbids outright, but it is
  population-relative: widen `mMax` and every star's drawn size changes. ADR 0015's carve-out
  ("the homepage hero stays as it is") covers the current consumer, so this is a note for
  whenever the hero is next touched, not a defect today.
- `core/imf` re-exports `teffToRGB` from `core/stellar` with the comment "*so existing callers
  (the hero story) keep importing it from `@novascope/core/imf`*" — a compat shim of exactly
  the same species as `src/lib/clusterField.ts`, living inside the package.

### 1e. Stale path references (measured — grep across `src/` and `scripts/`)

Three files point at `src/lib/stellar.ts`, which does not exist:

| file | line | text |
| --- | --- | --- |
| `src/novascope/core/imf/index.ts` | 195 | "the shared stellar core (src/lib/stellar.ts)" |
| `scripts/check-stellar.mjs` | 2 | "validate src/lib/stellar.ts against startrax" |
| `src/components/story/StageInitialConditions.astro` | 5 | "the Kroupa IMF (lib/imf.ts)" |

Harmless to the build, corrosive to the comments' credibility — and this repo's comments are
load-bearing.

---

## 2. Architecture assessment

### The layering is real, in the direction it checks

`check-novascope-boundary.mjs` (read, 162 lines) enforces four rules over every `.ts` in the
package and reports **72 files clean** (measured). The rules are the right ones and the
comments are honest about their limits — including the documented seam that `.astro` Layer-3
components are unscanned by design.

Three things it structurally cannot catch, worth naming so they are not mistaken for coverage:

1. **Concept leakage downward** (§1d) — pixels in Layer 0 pass every import rule.
2. **Layer-3 `.astro`** — `CensusEngine.astro` and `FeedbackEngine.astro` are unchecked. This
   is documented and correct-by-design, but it means the two files that will need the most
   rewriting on extraction are the two nobody is watching.
3. **A site file importing the package wrongly** — the gate looks outward from the package,
   never inward at consumers.

### Is `state/` earning its layer? Partly — and the honest answer is "not yet" (read)

`state/` has exactly five consumers (measured):

```
src/novascope/components/CensusEngine.astro     → createClusterStore, toRenderModel, toHRModel, toIMFHistogram
src/novascope/components/FeedbackEngine.astro   → state/feedback
src/novascope/viz/clusterField.ts               → type RenderModel
src/novascope/viz/histogram.ts                  → type IMFModel
src/novascope/viz/hrDiagram.ts                  → type HRModel
scripts/check-store.mjs, scripts/check-render.mjs
```

Note what is **absent**: the entire `viz/starfield/` tree — the star-render lab, the newest and
by far the most-worked surface — never touches `state/`. It has its own state mechanism
(`core/params/urlState` + `viz/starfield/labParams`), which is URL-first, has no subscribers, no
persistence adapter, and no store.

So there are **two state architectures in one package**:

| | `state/store.ts` | `core/params/urlState` + `labParams` |
| --- | --- | --- |
| shape | subscriber store, factory | codec + schema, stateless |
| home | Layer 1 | Layer 0 (codec) + Layer 2 (schema) |
| persistence | injectable adapter → localStorage | the URL |
| consumers | 2 Astro islands, 3 canvas renderers | the lab |
| gated by | `check-store`, `check-render` | `check-url-state`, `check-lab-field` |

Neither is wrong. But `state/` was declared as *the* Layer 1 in ADR 0012, and the surface that
grew fastest since then routed around it. **I do not think this is a bug to fix by forcing the
lab into `state/`.** The URL-first design is better for this use case (shareable, projectable,
node-reproducible) and its gates are stronger. What is worth deciding — and it is a decision,
not a cleanup — is whether Layer 1 is "the session store" or "the state layer, of which the
store is one implementation". Right now the ADR says the latter and the code says the former.

### Where a second consumer breaks (inferred, from the import graph)

If Cosmic Playground or an ASTR 201 site adopted the package tomorrow:

**Works immediately.** `core/*` — pure, no imports, node-runnable. That is the majority of the
value and it is genuinely portable.

**Breaks or needs work:**

1. **`three` pinning.** ADR 0015 pins `three@0.185.1` exactly, in *this repo's* `package.json`.
   The package has no `package.json` of its own, so the pin does not travel. A consumer on
   0.186 gets a TSL graph built against a different node API, and the failure mode is a shader
   that compiles to the wrong image rather than an error.
2. **No `exports` map.** ADR 0015 states as a maintained-by-hand invariant that
   `viz/starfield/index.ts` must *not* re-export `scene.ts` or `starGraph.ts`, because
   `three/webgpu` will not load in node and would break `check:star-optics`. That invariant is
   currently enforced by a comment. A second consumer with its own barrel will re-break it.
3. **Layer 3.** `CensusEngine.astro` / `FeedbackEngine.astro` are Astro-specific and will need
   rewriting per framework. Expected, but they are also where the store wiring lives, so "just
   the components" understates it.
4. **Data-path assumptions.** `viz/clusterArt.ts` defaults to `base = "/data/gravoturb"` and
   `state/feedback.ts` fetches shipped realization paths. Both are injectable, but the defaults
   assume this site's `public/` layout.
5. **The shim and the story component** (§1a, §1c) — the shim leaves a dangling site import;
   `StageInitialConditions` means the *renderers* a second consumer would want are partly
   outside the thing they'd install.

None of these is architectural. They are packaging.

---

## 3. DRY / one-home-per-fact violations

Ordered by how likely each is to produce a wrong result rather than an inconvenience.

### 3a. `prepare.ts` — dead code wearing the authoritative comment (measured + read) **P1**

`pnpm check` reports (measured):

```
src/novascope/viz/starfield/prepare.ts:527:9 - warning ts(6133):
  'defaultDepthMag' is declared but its value is never read.
```

Reading it (read), the situation is worse than an unused local. `prepareStarField` derives the
same two facts twice, 40 lines apart:

```ts
// line 480–490 — LIVE. Re-derives colorMode inline, then the mode's default depth.
const softening = opts.starDepthMag !== undefined
  ? softeningForLimit(fluxRatioForMagnitudes(opts.starDepthMag))
  : (opts.softening ?? softeningForLimit(fluxRatioForMagnitudes(
      (opts.colorMode ?? (opts.bandTriple ? "photometric" : "population")) === "photometric"
        ? DEFAULT_LUPTON_DEPTH_MAG : DEFAULT_POPULATION_DEPTH_MAG)));

// line 507 — the named colorMode, computed a second time
const colorMode = opts.colorMode ?? (opts.bandTriple ? "photometric" : "population");

// line 522–528 — DEAD, and carrying the explanatory comment
/* The depth default is PER MODE, because `depthMag` drives a different parameter in each… */
const defaultDepthMag =
  colorMode === "photometric" ? DEFAULT_LUPTON_DEPTH_MAG : DEFAULT_POPULATION_DEPTH_MAG;
```

**Concrete failure:** the dead binding is the one that *reads* authoritative — it is named, it
has the multi-line comment explaining the rule, and it sits under the well-organised half of
the function. The live one is buried inside a nested ternary. Anyone changing the per-mode
default rule will edit line 527, run the build (green — `pnpm build` does not run `astro
check`), and ship no behaviour change at all. This is the exact shape of the bug the comment at
line 523 was written about.

Also: the comment "*A stated DEPTH wins over a raw softening*" appears twice, at lines 471 and
473 (read).

**Effort:** ~15 min. Hoist `colorMode` above the softening derivation, use it in both places,
delete `defaultDepthMag`.
**Evidence a fix worked:** `pnpm check` hint count drops from 12 to 11; `check:star-optics`,
`check:calibrate` and `check:lab-field` stay green (they exercise both modes).

### 3b. `labParams.ts` — a header that contradicts its own body (read) **P1**

The file header, lines 16–27, says:

> ── THE ONE AWKWARD FIELD, stated rather than hidden ──
> `depth` has a MODE-DEPENDENT default: **16 mag in population mode, 8 in photometric** … A URL
> schema wants one default per field, so this takes the population figure … one control meaning
> two things is already recorded as the wart to fix

Every clause of that is now false, and the file says so itself 110 lines later (lines 134–143):

> TWO DEPTHS, because they were always two parameters. `depth` is the PER-STAR reach … `curve`
> is the PER-PIXEL transfer's span … With two fields each has ONE honest default and that whole
> class of bug is gone

And the actual default is neither 16 nor 8: `depth: numberField(…, DEPTH_MAG_RANGE.max, …)`
where `DEPTH_MAG_RANGE.max === 24` (read, `core/imaging/lupton.ts:185`).

**Concrete failure:** this is the *first* thing anyone reads before touching the lab's URL
schema, and it describes a fixed bug as live. The cost is a session spent re-fixing something,
or worse, "restoring" the single-field design.

### 3c. The published depth default on `/star-render-lab` is wrong (read) **P1**

`src/pages/star-render-lab.astro:633`, in the Design record:

```html
<dt>Depth (default 19.8 mag below white)</dt>
```

The actual default is `snap(DEPTH_MAG_RANGE.max)` = **24** (read, lines 133–137). 19.78 was the
range maximum when that entry was written; the range moved to 24 and the hand-typed prose did
not. The measured table in the comment block at lines 112–120 has the same problem — it ends at
19.78 and presents it as the top of the range.

This is a **published number on a page that documents itself as derived-not-typed**, and it is
the one class of error `site-claims` exists to prevent. It is `noindex`, so the blast radius is
a talk or a screenshot rather than the public site — but a screenshot from a talk is exactly
what this page is designed to produce.

**Effort:** 10 min for the `<dt>`; interpolate `{DEPTH_DEFAULTS.population}` rather than
retyping. The comment table is a judgement call — it records a real measurement at 19.78, so
it should be *labelled* as measured-at-19.78, not updated to a number nobody measured.

### 3d. Bloom's default lives in four places (read) **P2**

| home | value |
| --- | --- |
| `viz/starfield/labParams.ts:182` — `bloom: numberField(0, 1, 0.35, 2)` | 0.35 |
| `star-render-lab.astro:297` — `<input … value="0.35" data-bloom />` | 0.35 |
| `star-render-lab.astro:296` — `<span data-bloom-val>0.35</span>` | 0.35 |
| `star-render-lab.astro:1391` — `Number(…?.value ?? 0.35)` inside `schedule()` | 0.35 |

The fourth is the sharp one: it is a **live runtime fallback**, not just an initial paint.
Change the schema default and `setDisplay` silently keeps applying 0.35 whenever the element
query misses — which is precisely the `?? fallback`-against-a-missing-element failure that
`labControls.ts` was extracted to eliminate, still present in the one call site that did not
move.

The other slider `value=` attributes (`aureole`, `spikes`, `exposure`, `minmass`, `sky`) have
the same restatement but are overwritten by `applyState()` on load, so they only affect the
pre-hydration paint. Lower severity, same species. `dist`, `depth` and `curve` are already
interpolated from the constants — the pattern exists, it just was not applied uniformly.

### 3e. The calibration fingerprint does not cover what its docstring claims (read) **P2**

`scripts/reference/gen-calibrate-ref.mjs` header:

> A committed fixture's danger is that it keeps certifying a calibration after the thing it
> measured has changed — the optics constants, the PSF, **the population**. So the fixture
> records a fingerprint of **exactly those inputs**…

`calibrationFingerprint()` (read, `viz/starfield/calibrate.ts:243`) covers:

```
aureole  diffraction  psf(width, beta)  quadCap  runs(digest, count)
```

**No population term.** Nothing about `clusterStarTable`, the seed, the IMF, the Plummer
profile, or `prepareStarField`'s physics.

**Concrete failure:** change the sampler and `whitePixel` in the fixture is stale while
`analyticMean` recomputes live. The build does not pass silently — the geometric-mean assertion
at 0.2% will trip — but it trips with the **wrong instruction**: *"CONSTANT DRIFTED — set
`WHITE_FROM_ANALYTIC_MEAN` … to 33.xx"*. Following that instruction re-tunes a physical
constant to absorb a stale fixture. The correct action is to regenerate the fixture, and the
gate that knows how to say that (the fingerprint check) will have passed.

**Effort:** ~20 min. Add a digest of the sampler's identity to `calibrationFingerprint()`.
**Evidence a fix worked:** change the sampler seed, run `pnpm check:calibrate`, confirm the
message is "STALE FIXTURE — regenerate" and not "CONSTANT DRIFTED".

### 3f. `as never` in the one mapping that must not be wrong (read, fix unverified) **P2**

`viz/starfield/labParams.ts:284`:

```ts
...(state.transfer === TRANSFER_AUTO ? {} : { scaling: state.transfer as never }),
```

`never` is assignable to every type, so this cast disables *all* checking at the single most
load-bearing line in the file — `labStateToPrepareOptions` is, by its own docstring, "THE ONE
MAPPING", written because a hand-built mapping once ran a whole colour analysis on the wrong
render mode.

Reading the types: `TRANSFER_AUTO` is `"auto"` (a literal), `TRANSFER_IDS` is `as const`, so
`enumField([TRANSFER_AUTO, ...TRANSFER_IDS], "asinh")` infers `Field<"auto" | TransferId>` and
`state.transfer` narrows to `TransferId` in the false branch — which is exactly what
`PrepareOptions.scaling?: TransferId` wants. **I believe the cast is unnecessary** and is a
leftover from before `TRANSFER_IDS` was `as const`. I did not remove it, so this is
**suspected, not certain**.

**Evidence that would settle it:** delete `as never` and run `pnpm check`. If it stays at 0
errors, the cast was dead weight and should go. If it errors, the error message names the real
mismatch, which is information worth having either way.

Separately (inferred, low severity): `instrument`, `scheme` and `band` in `LAB_SCHEMA` infer as
`Field<string>`, because `INSTRUMENTS.map(i => i.id)` and `Object.keys(PASSBANDS)` both produce
`string[]`. Runtime validation is intact (`enumField` holds a real `Set`), so this is a lost
compile-time check rather than a hole — but it means `LabState["band"]` is `string`, and a
downstream consumer cannot switch on it exhaustively.

### 3g. Deliberate duplications I checked and am **not** flagging (read)

Stated so they are not re-litigated later:

- **`core/cluster/segregation.ts` vs `viz/webgl/massSegregation.ts`.** Both implement McLuster
  Eq. A1, and both say so. The shared machinery (`AvailableRanks`, the Fenwick tree) has one
  home in core and is imported by the viz copy. Only the rank key (radius vs local gas density)
  and the random draw (fresh vs fixed uniforms, so the permutation morphs under a slider)
  differ, and both files explain why in comments that agree with each other. **Correct.**
- **`viz/spectral.ts` vs `core/colorimetry`.** ADR 0013 called for `spectralRGB` → `teffToRGB`.
  What actually happened is better than the ADR asked for: `spectral.ts` deleted its own
  Planckian-locus fit, XYZ→sRGB matrix and gamma curve, and now composes
  `blackbodyLinearRGB` + `linearToSrgb` from core, adding only a chroma stretch and 0–255
  encoding. That is a viz-layer presentation helper over one colour model, not a second colour
  model. **Correct.**
- **Kroupa and Maschberger both in `core/imf`.** Two different published IMFs, both cited, both
  gated (`check-imf` pins Maschberger to progenax). Not a duplication.
- **`check-calibrate`'s `analyticMean` self-comparison.** It compares the live analytic mean to
  its own recorded value at 1e-6 — which *is* tautological in isolation, and the file says so
  and explains it is a change-detector, with the real claim carried by `k = whitePixel / mean`
  against a deliberately un-fitted 5..200 bound. **This is the best-designed gate in the repo.**

---

## 4. Technical debt and correctness risks

### 4a. `core/dynamics/` has no caller (measured) **P2**

```
$ grep -rn "createDynamics" src scripts
src/novascope/core/dynamics/index.ts:174:export function createDynamics(…)
src/novascope/viz/webgl/index.ts:16:  export { createDynamics, RELAX_TCROSS } from "../../core/dynamics/index.ts";
```

That is the definition and one re-export. **No page, component or gate invokes it.** 481 lines
— the third-largest module in the package — that nothing runs and nothing tests.

It is not accidental: ADR 0013 brought it in as "the uniquely-new capability" and ADR 0015 moved
it to `core/`. But ADR 0016 then makes dynamics central to the roadmap ("leapfrog rather than a
gravax trajectory dump"), and the existing `core/dynamics` is a 1-D spherical shell code that
integrates an exported progenax population — which ADR 0016 names as *the inconsistency it is
deciding against*.

So this is a **decision, not a cleanup**: is the current `dynamics` the base the leapfrog work
builds on, or is it the thing the leapfrog work replaces? Either way it should not sit unused
and ungated while that is unresolved, because whichever answer is right, 481 lines of
never-executed physics will have drifted by the time it is picked up.

### 4b. Dead imports in the lab, invisible to the build (measured)

`pnpm check` hints, all in `src/pages/star-render-lab.astro`:

| line | symbol |
| --- | --- |
| 727 | `D0_PC` imported in `<script>`, unused (it *is* used in the frontmatter, via a separate import) |
| 728 | `DEFAULT_LUPTON_DEPTH_MAG` imported, unused |
| 741 | `TRANSFER_AUTO` imported, unused |
| 835 | `readValue` destructured from `createLabControls`, unused |

Plus `labField.ts:35` — `PrepareOptions` imported as a type, unused.

The `readValue` one is the interesting one: `LabControls` exposes it as public API and nothing
consumes it. That is API surface with no consumer on a module whose whole purpose is to be the
single binding point.

None of these is harmful today. They matter because **nothing catches them** — see §5.

### 4c. `?? fallback` against a possibly-absent element, still present (read)

`labControls.ts` was extracted precisely because `?.value ?? fallback` "turns a missing element
into a plausible wrong answer rather than an error", and `assertControlsPresent()` was written
to make that loud. But the page still contains raw DOM reads with literal fallbacks outside
that module — `showInputs()` reads `[data-min-mass]`, `[data-bloom]`, `[data-aureole]`,
`[data-spikes]`, `[data-exposure]`, `[data-dist]`, `[data-curve]` directly, and `schedule()`
reads `[data-bloom]` with `?? 0.35` (§3d).

These are readouts, so a wrong value shows a wrong *number* rather than rendering wrong
*physics* — except `schedule()`, which feeds `lab.setDisplay`. The mitigating factor is real:
`assertControlsPresent()` covers `[data-bloom]` and runs in dev. So the class of bug is
detected, one layer later than it should be.

### 4d. Silent catches (read) — all three are fine

- `scene.ts:583` — `.catch(() => {})` on the sky probe, commented "*A lost device or a resize
  mid-readback. Keep the manual sky rather than a bad one.*" Correct: the fallback is a value
  the user chose, and `lab.sky.pixels === 0` is separately surfaced as "measuring…" rather than
  as zero.
- `state/store.ts:110`, `state/adapters.ts:34,44` — localStorage availability. Correct.

No fail-soft-where-it-should-fail-loud found in the render path.

### 4e. Comment accuracy (read)

You asked me to judge the ~44% comment density for accuracy and staleness rather than volume.
**The density is earning its keep** — several findings above (§3a, §3e, §4a) were only
findable because a comment recorded what a previous session measured. Comments that assert
something the code no longer does:

| file:line | asserts | reality |
| --- | --- | --- |
| `labParams.ts:16–27` | `depth` default is mode-dependent, 16/8; the one-control wart is unfixed | Split into `depth`/`curve`; default is 24 |
| `prepare.ts:522–526` | the per-mode default rule, above a binding that implements it | The binding is dead; the live one is 40 lines up |
| `star-render-lab.astro:633` | default depth is 19.8 | It is 24 |
| `clusterHero.ts:2` | file is `clusterField.ts` | Renamed |
| `core/imf/index.ts:195`, `check-stellar.mjs:2`, `StageInitialConditions.astro:5` | `src/lib/stellar.ts`, `lib/imf.ts` | Moved into `core/` |
| `core/imf/index.ts:2` | the module is "for the hero visual" | It is the shared IMF core, used by 4 gates and `state/render` |
| `gen-calibrate-ref.mjs` header | fingerprint covers the population | It does not (§3e) |

That is **7 stale assertions out of a very large corpus** — a low rate for a codebase this
comment-dense, and every one of them is in a file that was migrated or refactored recently. The
pattern is not carelessness; it is that headers do not get re-read when a body changes.

### 4f. `AGENTS.md` deployment section is stale (read)

`AGENTS.md` § Deployment:

> Target: `https://drannarosen.github.io/` (user site, root domain, no base path). Migration to
> anna-rosen.com later changes only `site` in `astro.config.mjs` … Do NOT touch DNS or configure
> the real domain.

`astro.config.mjs` (read):

```js
// Deployed to GitHub Pages on the custom apex domain anna-rosen.com
// (migrated from drannarosen.github.io on 2026-07-19 — see docs/domain-migration.md).
site: 'https://anna-rosen.com',
```

The migration happened a week ago. `AGENTS.md` still describes it as future and instructs
agents not to do it. Every agent session loads this file; a stale instruction here is
higher-leverage than a stale code comment.

---

## 5. Are the gates the right gates?

21 `check-*.mjs` scripts; 22 commands in `prebuild`, 3 in `postbuild`. All green (measured).

### What is well gated

Coverage by module (measured — grep for `src/novascope/...` imports across `scripts/`):

```
core/blackbody   ✓   core/imaging     ✓   core/photometry  ✓
core/cluster     ✓   core/imf         ✓   core/stellar     ✓
core/colorimetry ✓   core/optics      ✓   state/render     ✓
core/constants   ✓   core/params      ✓   state/store      ✓
core/feedback    ✓   viz/starfield    ✓
```

And the *quality* is high in a specific, unusual way: several gates explicitly reason about
their own tautology risk and design around it.

- `check-calibrate` refuses to fit its plausibility bound to its fixture — "*bounds set near
  those would be a copy of the fixture — which cannot fail*" — and instead asserts an
  independent property (a skew factor between 5 and 200) that "*can never go stale because it
  was never fitted*."
- `check-lab-field` §3 asserts that *changing* each control *changes* the options object,
  rather than restating the mapping — "*a check that mirrors its subject cannot catch the
  subject being wrong*."
- `check-lupton` / `check-stretch` validate against **astropy itself**, not against a
  self-generated fixture.
- `check-imf` pins Maschberger to a **progenax** fixture; `check-stellar` pins to **startrax**.
- `calibrationFingerprint()` exists at all — the staleness problem is *recognised*, which is
  more than most fixture-based gates manage. (Its coverage gap is §3e.)

I looked for tautological gates and found **one partial case**, which is documented as
deliberate and correctly compensated (§3g, `check-calibrate`'s analytic self-comparison).
That is a genuinely good result.

### What is not gated, in order of consequence

**1. GPU↔CPU parity has no automated gate. (measured) — P1, and this is the important one.**

ADR 0015 accepted duplicating every equation (once in pure TS, once as a TSL graph) *on an
explicit condition*:

> A parity check renders the TSL functions over a known input sweep into a float32 target and
> compares the readback against the TS reference, so divergence is **detected rather than
> merely unlikely**.

`viz/starfield/parity.ts` (392 lines) implements it, and its header states it is deliberately
un-imported so the production build tree-shakes it — loaded by hand from a browser automation
session. Nothing in `prebuild`, `postbuild` or `.github/workflows/deploy.yml` runs it
(measured). `check-star-optics` imports `reference.ts` and `profile.ts`, which is **CPU against
CPU** — it validates the reference rasteriser, not the shader.

So the condition ADR 0015 attached to its central trade-off is currently met by *discipline*,
not by *detection*. The exact failure this guards against has already happened once and is
recorded on `DEFAULT_AUREOLE` — `amp: 0.06` in `core/optics` while the shader used `0.012`.
That mitigation (resolving optics onto the field) prevents *that* divergence; it does not
prevent the next one in a different term.

I am **not** proposing this become a `prebuild` gate — it needs a GPU and a browser, and
blocking every build on that is the wrong trade. What would close it: a Playwright-driven
`pnpm check:parity` that a CI job runs on a schedule or on changes under
`viz/starfield/**`, with the run's numbers committed the way the roadmap already records them
(`energy ratio 0.99951, median 0.069%`). The harness is already written; only the driver is
missing.

**2. `astro check` runs in neither `build` nor CI. (measured) — P2**

`pnpm build` runs 25 checks and none of them is the type checker. `.github/workflows/deploy.yml`
runs `pnpm build` and nothing else — and its own comment says "*ONE definition of 'build'*
… rather than an ad-hoc subset re-listed here that drifts", which is exactly right and makes
the omission more surprising, not less.

Consequence: a repo whose ADR 0002 is "strict TypeScript" can ship a type error to production.
Today it would not (0 errors, measured), but the 12 hints — including the dead-code trap in
§3a — accumulated precisely because nothing reports them.

**3. `viz/webgl/` is entirely ungated. (measured) — P2**

~1,000 lines across `engine.ts` (400), `scene.ts`, `shaders.ts`, `interaction.ts`,
`massSegregation.ts`, serving **three shipped `/explore` pages** (cluster, gas-expulsion,
mass-segregation) plus `volume-lab`. No gate imports it. It is the oldest engine and the one
with real readers.

**4. `core/dynamics/` is ungated. (measured)** — see §4a; the gate gap and the unused-code
question are the same question.

**5. `core/random/` is imported by no gate directly.** Determinism is the property everything
seed-based rests on ("*One canonical cluster = (seed, params, t)*"). It is exercised
transitively by `check-cluster` and `check-imf`, so a broken RNG would fail those — but as a
fixture mismatch rather than as "the RNG is not deterministic".

**6. Layer-3 `.astro` boundary.** Documented seam, correctly scoped. Worth revisiting only when
extraction is actually scheduled.

**7. No accessibility or reduced-motion gate.** The individual components handle it well (the
lab's motion button derives its label from `lab.drifting` rather than assuming; the tri-state
`motion` field exists specifically so a link cannot override someone's system preference).
Nothing enforces it for the next component.

### Gates that are the right shape and worth copying

`check-lab-field.mjs` §4 reads `scene.ts` **as text** and regexes out the default star count,
because `initStarLab` owns it and does not export it:

```js
const m = src.match(/target:\s*opts\.count\s*\?\?\s*([\d_]+)/);
```

Brittle — and correctly so. If `scene.ts` is refactored the regex returns `NaN` and the gate
**fails**, loudly, telling you the copy is unverified. That is the right failure direction for
a brittle check, and it is the pattern to reach for whenever a fact must be gated but its owner
will not export it.

---

## 6. On `star-render-lab.astro` and the 530-line closure

You judged ~1,600 lines acceptable *if it is well-designed at the seams*, and asked me to
disagree with a reason beyond line count.

**I largely agree, and the seams are in fact good.** The evidence, from reading the whole file:

- The three hard extractions have already happened: the URL codec (`core/params/urlState`), the
  schema (`labParams`), and the DOM binding (`labControls`) — each for a *stated bug*, not for
  tidiness.
- `labStateToPrepareOptions` means the page reaches the renderer by the same road an offline
  script does. That is the single most important seam and it is correct.
- The physics/display split in `schedule()` keys off a **data attribute** (`el.matches(
  "[data-sky],[data-bloom],[data-sky-auto]")`) rather than a list of ids kept elsewhere — so
  "this control is display-only" and "this control is wired to `setDisplay`" cannot drift.
  That is a genuinely good piece of design.
- Everything remaining in the closure needs `lab`, and most of it is readout formatting.

**Two specific disagreements, both about content rather than size:**

1. **`showInputs()` is a second reader of the controls.** `readState()` in `labControls` reads
   every control; `showInputs()` reads seven of them again, directly, with literal fallbacks
   (§3d, §4c). Those two readers can disagree — and "a reader and a writer of the same control,
   too far apart to see together" is verbatim the reason `labControls` was extracted. The
   extraction took the *writer* and left one *reader* behind. Fixing this is not "shorten the
   closure"; it is "finish the extraction that was already justified."

2. **The build-time frontmatter and the client script derive overlapping facts.**
   `DEPTH_DEFAULTS` is computed in the frontmatter and passed to the client via a JSON
   `<script>` tag — which is the *right* pattern, and it is used for `INSTRUMENT_TABLE` too.
   But `star-render-lab.astro:633`'s hand-typed 19.8 (§3c) shows the pattern was not applied
   everywhere it should have been. Every number in the Design record that has a home in a
   module should be interpolated, not typed.

So: not a refactor for length. Two named seams to finish.

---

## 7. Backlog

### P1 — correctness or credibility, cheap

| # | item | file | effort |
| --- | --- | --- | --- |
| 1 | Dead `defaultDepthMag` + duplicated `colorMode` derivation; the dead one carries the authoritative comment | `viz/starfield/prepare.ts:480–528` | 15 min |
| 2 | `labParams.ts` header describes a fixed bug as live, with two wrong numbers | `viz/starfield/labParams.ts:16–27` | 15 min |
| 3 | Published default depth is 19.8; it is 24. Interpolate it | `pages/star-render-lab.astro:633` | 10 min |
| 4 | GPU↔CPU parity is un-run. Add `pnpm check:parity` + a scheduled/path-filtered CI job | `viz/starfield/parity.ts`, `.github/workflows/` | 2–4 h |
| 5 | `AGENTS.md` says the domain migration is future; it happened 2026-07-19 | `AGENTS.md` § Deployment | 5 min |

### P2 — structural, worth doing before the next Novascope push

| # | item | effort |
| --- | --- | --- |
| 6 | Retire `src/lib/clusterField.ts` — one import in `ClusterHero.astro`, then delete. Fix `clusterHero.ts`'s stale header at the same time | 15 min |
| 7 | Add `astro check` to `prebuild` (or to CI as a separate step). Clear the 12 hints first so it starts clean | 45 min |
| 8 | Decide `core/dynamics`: base for the ADR 0016 leapfrog, or superseded by it. Then either gate it or delete it | decision + 1–3 h |
| 9 | Extend `calibrationFingerprint()` to cover the population, so a stale fixture says "regenerate" rather than "re-tune the constant" | 20 min |
| 10 | Remove `as never` at `labParams.ts:284`; run `pnpm check` to find out whether it was load-bearing | 10 min |
| 11 | Move `StageInitialConditions`'s two renderers into `viz/` (reuse `histogram.ts` / `clusterField.ts`) and derive its Teff→mass threshold from `zamsTeff` | 3–4 h |
| 12 | Collapse bloom's four homes to one; interpolate the remaining slider `value=` attributes from `LAB_SCHEMA` | 45 min |

### P3 — architectural, needs a decision first

| # | item |
| --- | --- |
| 13 | Move render concerns (`sizePx`, `baseOpacity`, `twinkles`, painter's order) out of `core/imf`. Blocked on the hero's ADR 0015 carve-out — do it when the hero is next touched |
| 14 | Resolve the two-state-architectures question: is Layer 1 "the store" or "the state layer"? Update ADR 0012 or route the lab through `state/` — but I recommend the former |
| 15 | Gate `viz/webgl/` — it serves three live pages with no coverage |
| 16 | Extraction packaging: a `package.json` inside `src/novascope/` carrying the `three` pin and an `exports` map that encodes the "no `scene`/`starGraph` in the barrel" invariant currently held by a comment |

### P4 — hygiene

| # | item |
| --- | --- |
| 17 | Fix the three `src/lib/stellar.ts` / `lib/imf.ts` path references |
| 18 | Rename `viz/clusterField.ts` or `viz/clusterHero.ts` so `renderClusterField` and `initClusterField` are not one letter apart in two files exported from the same barrel |
| 19 | Delete the duplicated comment at `prepare.ts:471`/`473` |
| 20 | Remove `readValue` from the `LabControls` interface if it stays unused |

---

## 8. What I could not verify

Stated rather than inferred, per the standing rule.

- **Whether the `as never` at `labParams.ts:284` is removable.** Reasoned from the type
  declarations; not tested. §3f says what would settle it.
- **Whether `core/colorimetry`'s CIE integration is *numerically* validated.** A gate imports
  the module, but I did not read `check-star-optics.mjs` (1,234 lines) closely enough to say
  which of its 151 assertions cover colour. "Imported by a gate" is not "gated".
- **Runtime behaviour of anything.** I did not open the browser this session — no dev server,
  no screenshots, no `starlab.stats`. Every claim about the lab is from source. Anything about
  what it *draws* is out of scope for this audit and would need `lab-measure`.
- **Bundle impact.** The build warns that some chunks exceed 500 kB; I did not attribute that
  to `three` or check whether it lands only on the `noindex` lab page as ADR 0015 expects.
- **Whether `/model-path` is still wanted.** `StageInitialConditions` exists only for it, and
  the page is excluded from the sitemap. P2 #11 assumes it stays; if it does not, the fix is a
  deletion instead.

---

# Addendum — what was executed, same day

The plan in `docs/plans/2026-07-26-novascope-core-consolidation.md` was executed in full, plus
two follow-on pieces of work. 22 commits, three deploys, all green.

## Grades, revised

| axis | was | now | what moved it |
| --- | --- | --- | --- |
| **Architecture** | A− | **A** | Layer 0 holds no pixels; one cluster sampler; the `star()` contract is genuinely un-bypassed; `viz/webgl`'s camera is single-homed. |
| **DRY** | B+ | **A−** | The legacy sampler and the duplicated camera are gone. `core/feedback`'s constants remain by explicit ADR 0015 decision, not by neglect. |
| **Gate coverage** | B | **A−** | ADR 0015's stated condition is finally met — `check:parity` runs. Plus `check:webgl-camera`, `check:imf-surface`, `astro check` in `prebuild`, and a Vitest layer (49 tests). `core/dynamics` and the volume shader's maths remain uncovered. |
| **Extraction readiness** | A− | **A−** | Unchanged, honestly. The hero leaving helps, but the packaging blockers — no `package.json` inside `src/novascope`, no `exports` map, `three` pinned only in the site — are untouched. |

## What the gates found that reading did not

Three bugs, all the same species: **a claim verified only in the environment where it was
written.**

1. **`toPrecision(15)` on the hero fixture** — asserted bit-identical `Math.pow` across CPU
   architectures. Passed locally, failed the deploy, left the site stale for three minutes.
2. **A 1% parity bound** — measured on Metal, applied to CI's SwiftShader. And underneath it, a
   real bug: `parity.ts` read the framebuffer top-down on *both* backends, which is correct for
   WebGPU and wrong for WebGL 2. ~5% of visitors take that path and ADR 0015 claimed it was
   "verified rather than assumed". It was assumed, for months.
3. **`camera.ts`'s rotation** — GLSL `mat3` read as rows when it is columns, giving the transpose.
   Zero error at yaw = pitch = 0, 48 px at ZOOM_MIN. The node test passed because its "independent"
   reference was written in the same sitting and carried the same misreading.

In each case the fix was not a better check. It was **running the check somewhere else.**

## Corrections to this audit

- **"Two colour models" overstated the problem.** Measured: the Helland fit and the CIE
  integration agree to 7/255 across 2500–40000 K — invisible. The visible difference is the 2.4×
  chroma stretch in `viz/spectral.ts` (166/255 at 4000 K), which is a deliberate presentation
  choice. Acting on the original framing would have unified the models and changed nothing.
- **Task 7's grep in the plan was wrong** — it matched the symbol `sampleCluster`, and there were
  two functions with that name. Caught while verifying the plan against the code, before execution.

## Still open, with triggers rather than deadlines

| item | trigger |
| --- | --- |
| `core/dynamics` (481 lines, no callers, no gates) | **Parked deliberately** — Anna is adding a real leapfrog integrator. Do not delete. |
| Retire `teffToRGB` for `blackbodyLinearRGB` | The first page that needs a **reddened** star. A Teff→RGB fit cannot express extinction at all. |
| Extraction packaging | A second consumer. |
| `core/feedback` shared constants | Its own session, per ADR 0015 — the channels are mutually consistent only because they share rounded values. |
| Volume-shader maths (dilution, colorbar) | Testable now that a browser harness exists. |
