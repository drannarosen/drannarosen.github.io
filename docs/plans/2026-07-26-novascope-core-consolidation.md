# Novascope core consolidation — implementation plan

> **For Claude:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan
> task-by-task. Project skills that govern this work: `site-integrity` (derive facts, gate drift),
> `site-verify` (verify at 1440 px, confirm the deploy), `lab-measure` (Anna's eyes are ground
> truth). Read them before starting.

**Goal:** Retire the legacy cluster sampler in `core/imf`, so Novascope has exactly one cluster
sampler, one star contract, and no rendering concepts in Layer 0 — and add a unit-test layer so
the pure core can be tested without writing a build gate.

**Architecture:** `core/cluster.sampleCluster(ClusterIdentity) → LatentStar[]` becomes Novascope's
only sampler. `core/imf` becomes pure IMF mathematics, split by law. The IMF law becomes a field
on `ClusterIdentity`, so Kroupa and Maschberger are both selectable and the code stops disagreeing
with its own comments.

The homepage hero is **frozen** and does not adopt any of it. Its sampling loop and renderer move
verbatim to `src/lib/hero/` — site code — while every piece of physics they use is imported from
Novascope. So the picture does not change by one pixel, no physics is duplicated, and Layer 0
still loses its rendering concepts. That is the whole trick of this plan.

**Tech stack:** Astro static · strict TypeScript · pnpm · Vitest (new) · Node gate scripts.

---

## Ground rules for this plan

1. **No version-number changes.** `CLUSTER_SCHEMA_VERSION` stays at `1` and the `schemaVersion`
   field stays on `ClusterIdentity`. It is pre-release; the version stays pinned at 1 through
   development and starts moving after release (decision D7). No bumps, no deletion.
2. **No backward-compatibility shims.** `deserializeIdentity` already defaults every key it
   reads; the new key follows that existing pattern and nothing else is added for old data.
3. **Read before you edit.** Every file this plan touches was read in full while writing it. Work
   whose files have **not** been read is deliberately absent rather than half-specified — see
   "Explicitly out of scope".
4. **The repo has no test framework today.** Task 0 adds one. Until it lands, verification is via
   the existing gates.
5. **Copy, do not improve.** Tasks 4–5 relocate the hero. Anything that looks wrong on the way
   past gets written down, not fixed. A "small improvement" there breaks D8, which is the one
   guarantee those tasks exist to provide.

---

## Decision log — settled with Anna, 2026-07-26

| # | decision |
| --- | --- |
Read in order. D8–D10 were decided last and **supersede** the earlier hero decisions where they
conflict; the superseded ones are kept struck through rather than deleted, so the plan does not
silently rewrite its own history.

| # | decision |
| --- | --- |
| D1 | Kroupa **and** Maschberger are both selectable in `ClusterIdentity`. Kroupa is kept, not deleted. |
| D2 | ~~`clusterHero` is site-specific and stays in `src/novascope/viz/`.~~ **Superseded by D9** — still site-specific, but it leaves the package. |
| D3 | `clusterHero` keeps its **own draw loop**. It does not adopt `renderClusterField`. Still true, and now trivially so: the file is not modified at all. |
| D4 | `StageInitialConditions` keeps its own draw loops. Confirmed by reading both files: `viz/histogram.ts` draws log–log axes with an analytic overlay, this draws 16 linear bins with none — reusing it would change the page. |
| D5 | No back-compat shims. `deserializeIdentity` already defaults every key it reads. |
| D6 | Vitest is adopted for unit tests. The `check-*.mjs` gates stay as gates, with the boundary recorded in ADR 0017. |
| D7 | `schemaVersion` **stays**, pinned at `1`. It is currently write-only — `deserializeIdentity:111` overwrites the incoming value — and that is fine pre-release: nothing is in the wild to migrate. It starts carrying meaning after release. Anna: "I want v1 while I develop this. Version can be updated after release." |
| D8 | **The homepage hero is FROZEN.** Its output does not change by one pixel. It keeps the legacy sampler, the single `mulberry32` stream, the same seed and therefore the same 520 stars. Anna: "leave the cluster hero on the homepage as is, don't touch any of it." |
| D9 | To let Layer 0 be cleaned while D8 holds, the hero's **glue moves to the site** and its **physics keeps coming from Novascope** (option B). `src/lib/hero/` owns the sampler loop and the renderer; Kroupa, Plummer, the ZAMS relations, the colour map and the RNG are all imported from `@novascope/*`. Nothing is duplicated except the assembly loop that turns a luminosity into a pixel size. |
| D10 | `toHeroModel` is **not built**. Under D9 the hero uses its frozen sampler, so the selector would have no consumer. YAGNI. |
| D11 | `StageInitialConditions` points at the **frozen** sampler, not the canonical one, so `/model-path` also draws exactly what it draws today. Migrating it to `core/cluster` is a separate decision. |

---

## The hero does not change. That is the constraint this plan is built around.

An earlier draft of this plan repointed the homepage hero at the canonical sampler, which would
have reshuffled its 520 stars — the canonical sampler uses named sub-streams
(`subStream(seed, "mass")`, `"position"`) where the legacy one uses a single `mulberry32` stream,
so the same seed yields different numbers. **That is rejected** (D8).

Instead the hero's code is relocated without being rewritten (D9). Same loop, same stream, same
seed, same stars. What it gains is that its physics now comes from Novascope by import rather
than from a copy inside Layer 0 — so `core/imf` can be cleaned while the picture is untouched.

### Verified against the code before execution

Every factual claim this plan makes about the hero was checked by **running** it, not by reading
(2026-07-26):

| claim | result |
| --- | --- |
| Every symbol `src/lib/hero/sampler.ts` imports is already exported | ✓ all 7, no new exports needed |
| `core/cluster`'s `samplePlummer` is identical to `core/imf`'s private one — **including how many randoms it consumes**, or the hero reshuffles | ✓ max diff `0` over 500 draws, streams left in the same state |
| Task 6's `star(m, 0.02).color` === `teffToRGB(massToTeff(m))` | ✓ max diff `0`, 0.05–150 M☉ including out-of-domain clamping |
| `massToTeff`/`massToLuminosity` are exactly `zamsTeff`/`zamsLuminosity` clamped to [0.1, 100] | ✓ exact |
| The hero's production call is `count: 520, seed: 20260718` | ✓ 520 stars, painter-ordered, 147 twinkle |

Sanity values for the Task 4 fixture — if the generator disagrees with these, stop:

```
first star (after painter sort):  mass 0.10014704   x 0.46046506   sizePx 0.50413933
twinkling stars: 147 / 520
```

**The bar for "unchanged" is bit-identical, and it is asserted, not assumed.** Task 4 captures a
fixture of the current output BEFORE anything moves; Task 5 does the move and the same Vitest case
must still pass, failing if a single mass, coordinate, colour, size or opacity has shifted. The
screenshot diff at 1440 px is the second check, not the only one.

---

## Task 0: Add Vitest

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`
- Create: `src/novascope/core/imf/imf.test.ts`
- Create: `.adr/0017-vitest-for-units-gates-for-invariants.md`

**Why a second test system is justified, and where its boundary is.** State this in the ADR so it
cannot erode: **Vitest answers "does this function do what it says"** — pure functions in
`core/**` and `state/**`, run on watch, many small cases. **`scripts/check-*.mjs` answers "does
this build satisfy an invariant"** — cross-module consistency, comparison against external
references (astropy, progenax, startrax), and scans of built output. The gates' narrative output
is their deliverable and must not be converted to assertions.

**Step 1: Install**

```bash
pnpm add -D vitest@^4
```

**Step 2: Create `vitest.config.ts`**

```ts
/*
 * Vitest — the UNIT layer. See ADR 0017 for the boundary against scripts/check-*.mjs.
 *
 * Scoped to the pure layers on purpose: `core/` and `state/` are dependency-free and
 * environment-free, so they need no DOM, no browser and no fixtures beyond their own. `viz/`
 * is excluded because it imports `three` and touches the DOM; what is testable there is
 * already covered by the build gates.
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
```

**Step 3: Add scripts to `package.json`**

```json
"test": "vitest run",
"test:watch": "vitest",
```

And append `&& pnpm test` to the END of the existing `prebuild` chain, after
`node scripts/check-novascope-boundary.mjs`.

**Step 4: Write one real test to prove the harness works**

`src/novascope/core/imf/imf.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { maschbergerMass, maschbergerMassFraction } from "./index.ts";

describe("maschbergerMassFraction", () => {
  const p = { mMin: 0.1, mMax: 100, alpha: 2.3 };

  it("integrates to 1 over the full range", () => {
    expect(maschbergerMassFraction(0.1, 100, p)).toBeCloseTo(1, 12);
  });

  it("is monotone in the upper bound", () => {
    const a = maschbergerMassFraction(0.1, 1, p);
    const b = maschbergerMassFraction(0.1, 10, p);
    expect(b).toBeGreaterThan(a);
  });

  it("returns 0 for an inverted interval", () => {
    expect(maschbergerMassFraction(10, 1, p)).toBe(0);
  });
});

describe("maschbergerMass", () => {
  const p = { mMin: 0.1, mMax: 100, alpha: 2.3 };

  it("maps the unit interval onto the mass range, inclusive", () => {
    expect(maschbergerMass(0, p)).toBeCloseTo(0.1, 6);
    expect(maschbergerMass(1, p)).toBeCloseTo(100, 6);
  });

  it("is monotone increasing in u", () => {
    const us = [0.1, 0.3, 0.5, 0.7, 0.9];
    const ms = us.map((u) => maschbergerMass(u, p));
    expect(ms).toEqual([...ms].sort((a, b) => a - b));
  });
});
```

**Step 5: Run**

```bash
pnpm test
```
Expected: 5 passing. If `maschbergerMassFraction(10, 1, p)` does not return exactly 0, read
`core/imf/index.ts:164-173` — the guard is `if (b <= a) return 0` — and report rather than
"fixing" the test to match.

**Step 6: Commit**

```bash
git add package.json pnpm-lock.yaml vitest.config.ts src/novascope/core/imf/imf.test.ts .adr/0017-*.md
git commit -m "test(novascope): add vitest for the pure core, gates stay gates"
```

---

## Task 1: Split `core/imf` by law — a pure move

**Files:**
- Create: `src/novascope/core/imf/kroupa.ts`
- Create: `src/novascope/core/imf/maschberger.ts`
- Create: `src/novascope/core/imf/environment.ts`
- Modify: `src/novascope/core/imf/index.ts`

**Nothing changes behaviourally.** Every line moves verbatim. The header comments move with their
code — they carry the citations and are the reason this repo's comments are load-bearing.

**Step 1: `kroupa.ts`** — move verbatim from `core/imf/index.ts:22-116`:
`Segment`, `KROUPA_BREAK`, `KROUPA_ALPHA_LOW`, `KROUPA_ALPHA_HIGH`, `segmentIntegral`,
`buildKroupaSegments`, `sampleKroupaMass`, `kroupaMassFraction`, and the `── Kroupa (2001) IMF ──`
block comment.

**Step 2: `maschberger.ts`** — move verbatim from `core/imf/index.ts:118-173`:
`MASCHBERGER_MU`, `MASCHBERGER_BETA`, `MaschbergerParams`, `maschbergerPrimitive`,
`maschbergerMass`, `maschbergerMassFraction`, and the `── Maschberger (2013) IMF ──` block comment.

**Step 3: `environment.ts`** — move verbatim from `core/imf/index.ts:175-191`:
`alpha3FromEnvironment` and its block comment.

**Step 4: `index.ts` becomes a barrel**

```ts
/*
 * core/imf — stellar initial mass functions, filed by law.
 *
 * PURE MATHEMATICS ONLY. This module knows how many stars of each mass a law predicts and how to
 * draw one; it knows nothing about where they sit, what colour they are, or how large they render.
 * Sampling a cluster is `core/cluster`; a star's state is `core/stellar.star()`; turning either
 * into something drawable is `state/render`.
 *
 * That boundary is load-bearing and was not always held: this module used to export a
 * `sampleCluster` that returned `sizePx`, `baseOpacity` and `twinkles`, which put canvas pixels in
 * Layer 0 and bypassed the star() contract. `check:imf-surface` now pins the export list so it
 * cannot come back.
 */
export type { Segment } from "./kroupa.ts";
export { buildKroupaSegments, sampleKroupaMass, kroupaMassFraction } from "./kroupa.ts";
export type { MaschbergerParams } from "./maschberger.ts";
export {
  MASCHBERGER_MU,
  MASCHBERGER_BETA,
  maschbergerMass,
  maschbergerMassFraction,
} from "./maschberger.ts";
export { alpha3FromEnvironment } from "./environment.ts";
```

**Leave `sampleCluster`, `Star`, `ClusterOptions`, `massToTeff`, `massToLuminosity`,
`samplePlummer` and the `teffToRGB` re-export in place for now** — they are deleted in Task 7,
after their consumers move. Splitting and deleting in one commit makes a bisect useless.

**Step 5: Verify nothing moved semantically**

```bash
pnpm check:imf && pnpm test && pnpm check
```
Expected: `[imf] ok — Maschberger + environment α₃ match progenax.`, 5 vitest passes, 0 TS errors.

**Step 6: Commit**

```bash
git add src/novascope/core/imf/
git commit -m "refactor(novascope): file the IMF by law, not in one module"
```

---

## Task 2: The IMF law becomes part of the cluster's identity

**Files:**
- Modify: `src/novascope/core/cluster/params.ts:19-20, 55, 82-99, 101-120`
- Modify: `src/novascope/core/cluster/sample.ts:10, 27, 30`
- Create: `src/novascope/core/cluster/cluster.test.ts`

**The bug this fixes is a lie in the code.** `params.ts:19` documents the IMF as **Kroupa**;
`sample.ts:30` samples with **Maschberger**. Same in `state/render.ts:105` vs `:137`. So the
answer to "which IMF is this cluster?" is currently wrong in two places, in a type that gets
serialised into URLs.

**Step 1: Write the failing test**

`src/novascope/core/cluster/cluster.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { defaultIdentity, sampleCluster, serializeIdentity, deserializeIdentity } from "./index.ts";

describe("the IMF law is part of the identity", () => {
  it("defaults to maschberger — what the code has always actually sampled", () => {
    expect(defaultIdentity().imf.kind).toBe("maschberger");
  });

  it("round-trips through the query string", () => {
    const id = defaultIdentity({ imf: { kind: "kroupa", mMin: 0.1, mMax: 60, alphaHigh: 2.3 } });
    expect(deserializeIdentity(serializeIdentity(id)).imf.kind).toBe("kroupa");
  });

  it("falls back to maschberger when the key is absent or unknown", () => {
    expect(deserializeIdentity("seed=1").imf.kind).toBe("maschberger");
    expect(deserializeIdentity("seed=1&im=salpeter").imf.kind).toBe("maschberger");
  });

  it("actually changes the population — not just the label", () => {
    const base = { mMin: 0.1, mMax: 60, alphaHigh: 2.3 };
    const m = sampleCluster(defaultIdentity({ seed: 5, sampling: { mode: "count", target: 4000 }, imf: { kind: "maschberger", ...base } }));
    const k = sampleCluster(defaultIdentity({ seed: 5, sampling: { mode: "count", target: 4000 }, imf: { kind: "kroupa", ...base } }));
    const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
    // Maschberger's turnover at mu = 0.2 suppresses the lowest masses that Kroupa's
    // alpha = 1.3 segment keeps, so the medians must differ well beyond sampling noise.
    expect(Math.abs(median(m.map((s) => s.mass)) - median(k.map((s) => s.mass)))).toBeGreaterThan(0.02);
  });

  it("is deterministic in the seed", () => {
    const id = defaultIdentity({ seed: 9, sampling: { mode: "count", target: 200 } });
    expect(sampleCluster(id)).toEqual(sampleCluster(id));
  });
});
```

**Step 2: Run it and watch it fail**

```bash
pnpm test src/novascope/core/cluster/cluster.test.ts
```
Expected: FAIL — `imf.kind` is `undefined`.

**Step 3: `params.ts` — the type and the default**

Replace line 19-20:

```ts
  /*
   * The IMF: which law, its mass bounds [M☉], and the high-mass slope knob.
   *
   * `kind` is explicit because it was implicit and WRONG: this comment said "Kroupa" while
   * `sample.ts` called `maschbergerMass`, so a serialised cluster asserted a law it was not
   * drawn from. Maschberger is the default because it is what the code has always sampled.
   */
  imf: { kind: ImfKind; mMin: number; mMax: number; alphaHigh: number };
```

Add above `ClusterIdentity`:

```ts
/** The IMF laws a cluster can be drawn from. Both live in `core/imf`. */
export type ImfKind = "maschberger" | "kroupa";
```

Line 55 becomes:

```ts
    imf: { kind: "maschberger", mMin: 0.1, mMax: 100, alphaHigh: 2.3, ...over.imf },
```

**Step 4: `params.ts` — serialise and deserialise**

In `serializeIdentity`'s `URLSearchParams` object, after `ah:`, add:

```ts
    im: id.imf.kind,
```

In `deserializeIdentity`, beside the existing `mode`/`kind` locals (lines 108-109):

```ts
  /* Same tolerant-parse pattern as `pr` above: an unknown or absent value takes the default
   * rather than throwing, so a hand-edited link still opens. */
  const imfKind = p.get("im") === "kroupa" ? "kroupa" : "maschberger";
```

and in the returned `imf` object:

```ts
    imf: { kind: imfKind, mMin: num("mn", d.imf.mMin), mMax: num("mx", d.imf.mMax), alphaHigh: num("ah", d.imf.alphaHigh) },
```

**`CLUSTER_SCHEMA_VERSION` is NOT touched.** It stays `1`, and `schemaVersion` stays on the
interface (decision D7). Adding `imf.kind` needs no bump: migration here is **per key, not per
version** — every field in `deserializeIdentity` falls back to its default when its key is absent,
so a link written before `im=` existed opens and takes Maschberger, which is what it rendered.
The version starts moving after release; until then it is pinned.

**Step 5: `sample.ts` — dispatch on the law**

Line 10 becomes:

```ts
import { maschbergerMass, buildKroupaSegments, sampleKroupaMass } from "../imf/index.ts";
```

Replace lines 27-31 (the `imf` local and the `draw` closure's first line):

```ts
  /*
   * The law is resolved ONCE, not per star: Kroupa's segments are an inverse-CDF table that
   * costs a build, and rebuilding it 10,000 times would dominate the sampler.
   */
  const imf = { mMin: id.imf.mMin, mMax: id.imf.mMax, alpha: id.imf.alphaHigh };
  const segments = id.imf.kind === "kroupa"
    ? buildKroupaSegments(id.imf.mMin, id.imf.mMax, id.imf.alphaHigh)
    : null;
  const drawMass = (u: number): number =>
    segments === null ? maschbergerMass(u, imf) : sampleKroupaMass(u, segments);
```

and inside `draw`:

```ts
    const mass = drawMass(massStream());
```

**Step 6: Run the test — it passes**

```bash
pnpm test src/novascope/core/cluster/cluster.test.ts
```
Expected: 5 passing.

**Step 7: Run every gate that touches the identity**

```bash
pnpm check:cluster && pnpm check:render && pnpm check:store && pnpm check
```
Expected: all pass, 0 TS errors. If `check:cluster` fails, read `scripts/check-cluster.mjs`
before changing anything — it may construct an identity literal that now needs `kind`.

**Step 8: Commit**

```bash
git add src/novascope/core/cluster/
git commit -m "feat(novascope): the cluster identity says which IMF it was drawn from"
```

---

## Task 3: The histogram's analytic overlay follows the identity's law

**Files:**
- Modify: `src/novascope/state/render.ts:11, 105, 119-142`
- Create: `src/novascope/state/render.test.ts`

`toIMFHistogram` hardcodes `maschbergerMassFraction` while `IMFBin.expected`'s comment says
"the analytic **Kroupa** law". Under a Kroupa identity the overlay would now be drawn from the
wrong law — a smooth line asserting a distribution the bars were not drawn from.

**Step 1: Write the failing test**

`src/novascope/state/render.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { defaultIdentity, sampleCluster } from "../core/cluster/index.ts";
import { toIMFHistogram } from "./render.ts";

describe("toIMFHistogram", () => {
  const mk = (kind: "kroupa" | "maschberger") =>
    defaultIdentity({ seed: 3, sampling: { mode: "count", target: 3000 }, imf: { kind, mMin: 0.1, mMax: 100, alphaHigh: 2.3 } });

  it("integrates the expectation to N, under either law", () => {
    for (const kind of ["maschberger", "kroupa"] as const) {
      const id = mk(kind);
      const m = toIMFHistogram(sampleCluster(id), id);
      const total = m.bins.reduce((t, b) => t + b.expected, 0);
      expect(Math.abs(total - 3000) / 3000).toBeLessThan(0.02);
    }
  });

  it("draws the overlay from the identity's OWN law, not always Maschberger", () => {
    const kId = mk("kroupa");
    const kBins = toIMFHistogram(sampleCluster(kId), kId).bins;
    const mBins = toIMFHistogram(sampleCluster(mk("maschberger")), mk("maschberger")).bins;
    // The laws differ most at the low-mass end, where Maschberger turns over and Kroupa does not.
    expect(kBins[0]!.expected).not.toBeCloseTo(mBins[0]!.expected, 0);
  });
});
```

**Step 2: Run it, watch the second case fail**

```bash
pnpm test src/novascope/state/render.test.ts
```
Expected: FAIL on "draws the overlay from the identity's OWN law".

**Step 3: Implement**

Line 11:

```ts
import { maschbergerMassFraction, buildKroupaSegments, kroupaMassFraction } from "../core/imf/index.ts";
```

Line 105's comment becomes:

```ts
  expected: number; // stars the identity's OWN analytic law predicts here
```

Inside `toIMFHistogram`, replace the `imf` local and the `expected` line:

```ts
  /* The overlay must be the law the bars were DRAWN from. It used to be Maschberger
   * unconditionally, under a comment that said Kroupa — so a Kroupa cluster would have been
   * drawn under a line from a different distribution. */
  const law =
    id.imf.kind === "kroupa"
      ? ((lo: number, hi: number) => kroupaMassFraction(lo, hi, buildKroupaSegments(mMin, mMax, alphaHigh)))
      : ((lo: number, hi: number) => maschbergerMassFraction(lo, hi, { mMin, mMax, alpha: alphaHigh }));
```

and:

```ts
    const expected = N * law(10 ** logMlo, 10 ** logMhi);
```

**Step 4: Run**

```bash
pnpm test && pnpm check:render && pnpm check
```
Expected: all pass.

**Step 5: Commit**

```bash
git add src/novascope/state/render.ts src/novascope/state/render.test.ts
git commit -m "fix(novascope): the IMF overlay follows the law the stars were drawn from"
```

---

## Task 4: Capture the hero's output as a fixture — BEFORE anything moves

**Files:**
- Create: `src/lib/hero/__fixtures__/hero-baseline.json`
- Create: `src/lib/hero/hero.test.ts`
- Modify: `vitest.config.ts` (widen `include`)
- Create: `scripts/reference/gen-hero-baseline.mjs`

**This is a regression guard, not red-green TDD, and the difference matters.** The test passes
before the move and must still pass after. It exists to fail if Task 5 corrupts a single number.
Do not "fix" it by regenerating the fixture — a fixture regenerated after a change certifies
nothing (the same trap `check:calibrate`'s fingerprint exists to close).

**Step 1: Widen the Vitest include**

`vitest.config.ts` — the hero's sampler is pure and node-runnable even though it lives in the
site, so it is testable; only its renderer touches the DOM.

```ts
    include: [
      "src/novascope/{core,state}/**/*.test.ts",
      "src/lib/**/*.test.ts",
    ],
```

**Step 2: Write the generator**

`scripts/reference/gen-hero-baseline.mjs` — imports `sampleCluster` from **the current
`@novascope/core/imf`** and records the exact call the homepage makes.

```js
/*
 * gen-hero-baseline.mjs — freeze the homepage hero's output, once.
 *
 * ClusterHero.astro calls initClusterField({ canvas, reducedMotion }) with no count and no seed,
 * so clusterHero.ts falls back to count 520 and sampleCluster falls back to seed 20260718. That
 * exact call is what this records, so the fixture is the production picture and not a
 * configuration nobody renders.
 *
 * Run ONCE, before src/lib/hero exists. Never regenerate to make a failing test pass — a failing
 * test here means the relocation changed the picture, which is the one thing it must not do.
 */
import { writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { sampleCluster } from "../../src/novascope/core/imf/index.ts";

const stars = sampleCluster({ count: 520, seed: 20260718 });
const round = (v) => Number(v.toPrecision(15));
const out = {
  _comment:
    "GENERATED by scripts/reference/gen-hero-baseline.mjs from the PRE-RELOCATION sampler. " +
    "src/lib/hero/hero.test.ts asserts the relocated sampler reproduces it exactly. " +
    "If that test fails, the relocation is wrong — do not regenerate this file.",
  call: { count: 520, seed: 20260718 },
  count: stars.length,
  stars: stars.map((s) => ({
    x: round(s.x), y: round(s.y), z: round(s.z),
    mass: round(s.mass), teff: round(s.teff),
    color: s.color.map(round),
    sizePx: round(s.sizePx),
    baseOpacity: round(s.baseOpacity),
    twinkles: s.twinkles,
  })),
};
const target = resolve(dirname(fileURLToPath(import.meta.url)), "../../src/lib/hero/__fixtures__/hero-baseline.json");
writeFileSync(target, JSON.stringify(out, null, 1) + "\n");
console.log(`✓ wrote hero-baseline.json — ${stars.length} stars`);
```

**Step 3: Generate it**

```bash
mkdir -p src/lib/hero/__fixtures__
node --experimental-strip-types scripts/reference/gen-hero-baseline.mjs
```
Expected: `✓ wrote hero-baseline.json — 520 stars`

**Step 4: Write the test — pointing at the CURRENT location for now**

`src/lib/hero/hero.test.ts`:

```ts
/*
 * The homepage hero is frozen (plan D8). This asserts it, star by star.
 *
 * The import below moves in Task 5 — from @novascope/core/imf to ./sampler — and NOTHING ELSE
 * about this file changes. That is the whole test: same call, same numbers, different home.
 */
import { describe, expect, it } from "vitest";
import baseline from "./__fixtures__/hero-baseline.json" with { type: "json" };
import { sampleCluster } from "@novascope/core/imf"; // ← Task 5 changes this line to "./sampler.ts"

describe("the homepage hero is frozen", () => {
  const stars = sampleCluster({ count: baseline.call.count, seed: baseline.call.seed });

  it("draws the same number of stars", () => {
    expect(stars.length).toBe(baseline.count);
  });

  it("draws the SAME stars — every mass, position, colour, size and opacity", () => {
    const round = (v: number) => Number(v.toPrecision(15));
    const actual = stars.map((s) => ({
      x: round(s.x), y: round(s.y), z: round(s.z),
      mass: round(s.mass), teff: round(s.teff),
      color: s.color.map(round),
      sizePx: round(s.sizePx),
      baseOpacity: round(s.baseOpacity),
      twinkles: s.twinkles,
    }));
    expect(actual).toEqual(baseline.stars);
  });

  it("is painter-ordered, faint first", () => {
    const sizes = stars.map((s) => s.sizePx);
    expect(sizes).toEqual([...sizes].sort((a, b) => a - b));
  });
});
```

**Step 5: Run — it must PASS immediately**

```bash
pnpm test src/lib/hero/hero.test.ts
```
Expected: 3 passing. If it fails now, the generator and the test disagree about the call — fix
that before going near Task 5.

**Step 6: Commit**

```bash
git add vitest.config.ts scripts/reference/gen-hero-baseline.mjs src/lib/hero/
git commit -m "test(hero): freeze the homepage hero's output as a fixture"
```

---

## Task 5: Relocate the hero's glue to the site — physics stays in Novascope

**Files:**
- Create: `src/lib/hero/sampler.ts`
- Move: `src/novascope/viz/clusterHero.ts` → `src/lib/hero/render.ts`
- Modify: `src/lib/hero/hero.test.ts` (one import line)
- Modify: `src/components/ClusterHero.astro:136` (one import line)
- Delete: `src/lib/clusterField.ts`
- Modify: `src/novascope/viz/index.ts` (drop the two `clusterHero` exports)

**The rule for this task: copy, do not improve.** Every line of the sampler loop and the renderer
moves verbatim. Not the variable names, not the magic numbers, not the comments. If something
looks wrong on the way past, write it down and leave it — a "small fix" here breaks the one
guarantee the task exists to provide (D8).

**Step 1: `src/lib/hero/sampler.ts` — the glue, and only the glue**

Everything physical is imported from Novascope; only the assembly loop is local. Verified
available without adding any export: `buildKroupaSegments`/`sampleKroupaMass`
(`@novascope/core/imf`), `samplePlummer` (`@novascope/core/cluster`),
`zamsTeff`/`zamsLuminosity`/`teffToRGB` (`@novascope/core/stellar`), `mulberry32`
(`@novascope/core/random`).

```ts
/*
 * src/lib/hero/sampler.ts — the homepage hero's population. SITE CODE, FROZEN.
 *
 * ── WHY THIS IS NOT IN NOVASCOPE ──
 *
 * It was, and that is exactly the problem it caused. This loop returns `sizePx`, `baseOpacity`
 * and `twinkles` — canvas pixels — and it lived in `@novascope/core/imf`, which put rendering
 * concepts in Layer 0 and bypassed the `star(M, Z, t)` contract that ADR 0012 says nothing may
 * bypass. Novascope's canonical sampler (`@novascope/core/cluster`) does the same job properly:
 * latent state only, named RNG sub-streams, EFF profiles, segregation.
 *
 * The hero does not use it, deliberately. The canonical sampler draws from `subStream(seed,
 * "mass")` and `subStream(seed, "position")` where this draws from one `mulberry32` stream, so
 * the same seed gives DIFFERENT stars — a reshuffled hero. Anna's call (2026-07-26): the
 * homepage does not change. So the loop was moved here, verbatim, rather than rewritten.
 *
 * ── WHAT IS AND IS NOT DUPLICATED ──
 *
 * No physics is duplicated. The IMF, the Plummer draw, the ZAMS relations, the colour map and the
 * RNG are all imported from Novascope and stay gated there. What is local is the assembly: which
 * pixel size and opacity this particular hero gives a star of a given luminosity.
 *
 * ── FROZEN MEANS FROZEN ──
 *
 * `src/lib/hero/hero.test.ts` asserts every star against a fixture captured before this file
 * existed. Do not tune the constants, rename the fields, or "clean up" the loop. If the hero is
 * ever redesigned, that is a new file and a new fixture, not an edit here.
 */
import { buildKroupaSegments, sampleKroupaMass } from "@novascope/core/imf";
import { samplePlummer } from "@novascope/core/cluster";
import { zamsTeff, zamsLuminosity, teffToRGB } from "@novascope/core/stellar";
import { mulberry32 } from "@novascope/core/random";

export interface Star {
  x: number;
  y: number;
  z: number;
  mass: number;
  teff: number;
  color: [number, number, number];
  sizePx: number;
  baseOpacity: number;
  twinkles: boolean;
}

export interface ClusterOptions {
  count: number;
  mMin?: number;
  mMax?: number;
  seed?: number;
  minSizePx?: number;
  maxSizePx?: number;
}

/* Clamped to Tout's valid domain, exactly as the original did. `star()` clamps to the same
 * [0.1, 100] AND reports it via `inRange`, which is better — but adopting it here would be an
 * improvement, and this file does not make improvements. */
const massToTeff = (m: number): number => zamsTeff(Math.min(100, Math.max(0.1, m)));
const massToLuminosity = (m: number): number => zamsLuminosity(Math.min(100, Math.max(0.1, m)));

/** Sample the hero's cluster. Verbatim from the retired `@novascope/core/imf.sampleCluster`. */
export function sampleCluster(opts: ClusterOptions): Star[] {
  const { count } = opts;
  const mMin = opts.mMin ?? 0.1;
  const mMax = opts.mMax ?? 60;
  const minSize = opts.minSizePx ?? 0.5;
  const maxSize = opts.maxSizePx ?? 4;
  const rng = mulberry32(opts.seed ?? 20260718);
  const segs = buildKroupaSegments(mMin, mMax);

  const logLmin = Math.log10(massToLuminosity(mMin));
  const logLmax = Math.log10(massToLuminosity(mMax));

  const stars: Star[] = [];
  for (let i = 0; i < count; i++) {
    const mass = sampleKroupaMass(rng(), segs);
    const [x, y, z] = samplePlummer(rng(), rng, 1);
    const teff = massToTeff(mass);
    const color = teffToRGB(teff);

    const logL = Math.log10(massToLuminosity(mass));
    const sizeFrac = (logL - logLmin) / (logLmax - logLmin);
    const sizePx = minSize + (maxSize - minSize) * Math.pow(sizeFrac, 0.8);

    stars.push({
      x, y, z, mass, teff, color, sizePx,
      baseOpacity: 0.55 + 0.45 * sizeFrac,
      twinkles: sizeFrac > 0.18,
    });
  }
  // Painter's order: faint/back stars first, bright/front last.
  stars.sort((s1, s2) => s1.sizePx - s2.sizePx);
  return stars;
}
```

**Step 2: Point the test at the new sampler and run it**

`src/lib/hero/hero.test.ts` — change the one import to `from "./sampler.ts"`.

```bash
pnpm test src/lib/hero/hero.test.ts
```
Expected: 3 passing. **If the star-by-star case fails, stop.** The relocation is wrong. The most
likely cause is `samplePlummer`'s random-draw order: `@novascope/core/cluster`'s version consumes
`u` as an argument then two randoms inside `isotropic` (cosTheta, then phi), which matches the
original exactly — verify that before suspecting anything else, and do not regenerate the fixture.

**Step 3: Move the renderer**

```bash
git mv src/novascope/viz/clusterHero.ts src/lib/hero/render.ts
```

Change its import (currently `import { sampleCluster, type Star } from "../core/imf/index.ts"`)
to `from "./sampler.ts"`. **That is the only line that changes.** Then replace the file header,
which still opens `clusterField.ts — renderer for the hero star-cluster visual` — its
pre-rename name — with one that names the file correctly and states that it is frozen site code,
cross-referencing `sampler.ts` for why.

**Step 4: Repoint the component and delete the shim**

`src/components/ClusterHero.astro:136`:

```ts
  import { initClusterField } from "../lib/hero/render";
```

Its header comment (line 4) cites `lib/imf.ts`, which has not existed since the merge — point it
at `lib/hero/`.

```bash
git rm src/lib/clusterField.ts
```

**Step 5: Drop the exports from Novascope's barrel**

`src/novascope/viz/index.ts` — remove the two `clusterHero` lines. `ClusterFieldConfig` and
`initClusterField` are no longer Novascope's to export.

**Step 6: Confirm nothing else referenced any of it**

```bash
grep -rn "clusterHero\|clusterField" src scripts --include='*.ts' --include='*.astro' --include='*.mjs'
```
Expected: hits only in `src/novascope/viz/clusterField.ts` (the unrelated `renderClusterField`,
which stays) and `src/lib/hero/`. **Note the name collision that made this confusing: Novascope's
`viz/clusterField.ts` exports `renderClusterField` and is a different module entirely from the
hero. It is untouched.**

**Step 7: Full verification**

```bash
pnpm test && pnpm check && pnpm build
```

**Step 8: Screenshot `/` at 1440 px and compare against main**

Per `site-verify` and the `end-on-desktop-view` memory: set the viewport explicitly with
`resize_window` to 1440×900 immediately before measuring and record `innerWidth` in the same call
— the preview pane silently resizes, and that has been misdiagnosed as stale CSS twice.

The fixture test is the real proof; this catches anything the fixture does not cover (the draw
loop, the rotation, the composition).

**Step 9: Commit**

```bash
git add -A
git commit -m "refactor(hero): the homepage hero's glue moves to the site, its physics stays in novascope"
```

---

## Task 6: Repoint `StageInitialConditions` at the frozen sampler

**Files:**
- Modify: `src/components/story/StageInitialConditions.astro:2-10, 48`

The other consumer of the retired sampler. Anna's call: point it at the frozen one, so
`/model-path` keeps drawing exactly what it draws today. Migrating it to the canonical cluster is
a separate decision and is **not** in this plan (see "Explicitly out of scope").

**Step 1: One import line** (line 48):

```ts
  import { sampleCluster, type Star } from "../../lib/hero/sampler";
```

`massToTeff` and `teffToRGB` are no longer exported — line 141 uses them for bar colour. Replace
with the contract, which is what the retired wrappers were clamping into anyway:

```ts
import { star } from "@novascope/core/stellar";
// ...
        const [r, g, b] = star(m, 0.02).color;
```

**Step 2: Fix the header** — line 5 cites `lib/imf.ts`, which has not existed since the merge.

**Step 3: Verify at 1440 px** — `/model-path`, resample a few times, confirm both panels draw
and the histogram's bar colours are unchanged. `star(m, 0.02).color` and
`teffToRGB(massToTeff(m))` are the same computation: `star()` clamps to the same [0.1, 100] and
its `.color` IS `teffToRGB(Teff)`. **Verify that by looking, not by trusting this sentence.**

**Step 4: Commit**

```bash
git add src/components/story/StageInitialConditions.astro
git commit -m "refactor(site): the model-path stage uses the frozen hero sampler"
```

---

## Task 7: Delete the legacy sampler from Layer 0

**Files:**
- Modify: `src/novascope/core/imf/index.ts`

**Step 1: Confirm there are no consumers left — and do NOT grep for the function name**

⚠ **There are two functions called `sampleCluster`, and grepping the name is misleading.** The
canonical `core/cluster.sampleCluster` has three legitimate callers inside the package
(`components/CensusEngine.astro` ×3, `viz/starfield/source.ts`) which must NOT be touched. A
name-grep reports them as if they were consumers of the module being emptied. This was caught by
running the check while verifying this plan; the first draft of this step had exactly that bug.

Grep the **import site**, not the symbol:

```bash
grep -rn "from ['\"].*core/imf" src scripts --include='*.ts' --include='*.astro' --include='*.mjs'
```

Expected: every remaining hit imports only IMF-law symbols — `buildKroupaSegments`,
`sampleKroupaMass`, `kroupaMassFraction`, `maschbergerMass`, `maschbergerMassFraction`,
`MASCHBERGER_MU`, `MASCHBERGER_BETA`, `alpha3FromEnvironment`, `Segment`, `MaschbergerParams`.
Anything importing `sampleCluster`, `Star`, `ClusterOptions`, `massToTeff`, `massToLuminosity` or
`teffToRGB` from `core/imf` must be fixed first. `pnpm check` is the backstop: after the deletion
it fails on any reference this grep missed.

**Step 2: Delete** — from `core/imf/index.ts`, remove the `── Main-sequence relations ──` block,
`samplePlummer`, `Star`, `ClusterOptions`, `sampleCluster`, and the `teffToRGB` re-export at lines
18-20. What remains is the barrel written in Task 1.

**Step 3: Full verification**

```bash
pnpm test && pnpm check && pnpm build
```
Expected: all green. `pnpm test` includes the hero fixture, so a mistake here that reaches the
homepage fails loudly.

**Step 4: Commit**

```bash
git add src/novascope/core/imf/index.ts
git commit -m "refactor(novascope): Layer 0 holds no pixels"
```

## Task 8: Gate the boundary that was just established

**Files:**
- Create: `scripts/check-imf-surface.mjs`
- Modify: `package.json` (prebuild + a `check:imf-surface` script)
- Modify: `scripts/check-imf.mjs` (add Kroupa coverage)

**Why.** Deleting the pixels from Layer 0 is worthless if they can come back. `check-novascope-
boundary` cannot catch it — it checks **imports**, and a `sizePx` field imports nothing.

**Step 1: Pin the module's public surface**

`scripts/check-imf-surface.mjs` — import `* as imf from "../src/novascope/core/imf/index.ts"`,
compare `Object.keys(imf).sort()` against an expected list, and fail on any addition **or**
removal, with a message naming the rule: *"`core/imf` is pure IMF mathematics. A new export here
must be a property of a mass function — not a position, a colour, or a pixel."*

**Step 2: Extend `check-imf.mjs` with Kroupa**

It currently pins Maschberger and α₃ to progenax fixtures and leaves Kroupa untested — now that
Kroupa is selectable, that gap is real. Add analytic assertions that need no new fixture:
`kroupaMassFraction(mMin, mMax, segs) === 1`; the piecewise CDF is continuous at the 0.5 M☉ break;
`sampleKroupaMass` is monotone in `u` and lands in `[mMin, mMax]`; a flatter `alphaHigh` raises the
fraction above 10 M☉. **Do not invent a progenax fixture that does not exist.**

**Step 3: Wire both into `prebuild`** and run `pnpm build`.

**Step 4: Commit**

```bash
git commit -m "test(novascope): pin core/imf's surface so pixels cannot return to Layer 0"
```

---

## Task 9: The stale references

**Files:**
- `src/novascope/core/imf/index.ts:195` → `src/lib/stellar.ts` does not exist
- `scripts/check-stellar.mjs:2` → same
- `src/novascope/viz/spectral.ts` → its "one home now" claim is **false**: `star().color` uses
  `teffToRGB` (a Helland fit in `core/stellar`) while this module uses `blackbodyLinearRGB` (CIE
  integration in `core/colorimetry`). Two live colour models. **Record the discrepancy in the
  comment; do not unify them in this plan** — changing `star().color` changes every renderer.
- `AGENTS.md` § Deployment → says the anna-rosen.com migration is future; `astro.config.mjs` says
  it happened 2026-07-19.

Most of these vanish with Task 1/7. Commit the rest as `docs: fix references to files that moved`.

---

## Explicitly out of scope, and why

**I have not read these files, so this plan does not specify them.**

| item | lines | why deferred |
| --- | --- | --- |
| `viz/starfield/prepare.ts` split | 918 | Read only L465-564. It is 63% comment with one 450-line function; a split needs the whole function read first. Its three P1 defects (dead `defaultDepthMag`, duplicated `colorMode`, duplicated comment) are in the audit backlog and are independent of this plan. |
| `viz/starfield/scene.ts` split | 846 | Read only L560-600. `contactSheet` looks separable from its structure, but "looks separable" is not a plan. |
| `core/dynamics/` | 481 | Zero callers, zero gates, 27% comments. Whether it is the base for ADR 0016's leapfrog or superseded by it is **Anna's decision**, not a refactor. |
| `viz/webgl/` | ~1000 | Serves three live `/explore` pages with no coverage. Vitest cannot reach it (DOM + WebGL); it needs a browser harness, which is the same work as `check:parity`. |
| `core/feedback` constants | — | ADR 0015 defers this deliberately: the channels are mutually consistent only because they share rounded values, so they move together or not at all. |
| `mountAnimatedCanvas` | — | Real duplication between the hero's renderer and `viz/clusterArt.ts`. But `clusterArt.resize()` also sizes an offscreen gas buffer, so a shared lifecycle needs a resize hook — more than a move. And under D8 the hero's renderer is frozen, so it cannot adopt one anyway. |
| the hero on the canonical sampler | — | Rejected for now (D8): it would reshuffle the homepage's 520 stars. If it is ever wanted, the work is `toHeroModel` (D10, unbuilt) plus a seed chosen by eye — not a bug fix. |
| `StageInitialConditions` on the canonical sampler | — | D11 points it at the frozen sampler instead. Migrating it would change what `/model-path` draws and belongs with a decision about that page, not with this cleanup. |
| `star().color` vs `blackbodyLinearRGB` | — | **Two live colour models**, found while writing this plan: `core/stellar.teffToRGB` is a Tanner Helland fit and `core/colorimetry.blackbodyLinearRGB` is a CIE integration, and `viz/spectral.ts`'s header claims "one home now", which is false. Unifying them changes every renderer's colour. Task 9 corrects the comment only. |

---

## Verification summary

Run after every task:

```bash
pnpm test && pnpm check
```

Run before every commit that touches a gate or the build:

```bash
pnpm build
```

Browser verification (Tasks 5 and 6) at **1440×900**, viewport set explicitly with
`resize_window` immediately before measuring, `innerWidth` recorded in the same call — the preview
pane silently resizes and that has been misdiagnosed as stale CSS twice.
