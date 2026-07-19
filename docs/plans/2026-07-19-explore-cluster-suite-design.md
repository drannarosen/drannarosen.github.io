# Explore-the-cluster suite — design

Date: 2026-07-19 · Status: approved (brainstorm), implementation staged

## Goal

A suite of three browser explorables, built on **one shared cluster engine**, that
make Anna's research program legible to grad students, peers, and the public — and
that double as **lecture/talk instruments** (fullscreen, keyboard-driven). All data
comes from Anna's real JAXSTRO models (progenax, informax) via the export-bridge
pattern; nothing is faked.

Three pieces:
1. **`/explore/cluster`** — "Birth of a cluster" scrollytelling (the narrative spine).
2. **`/explore/mass-segregation`** — a live λ_corr explorer (massive stars sink inward).
3. **`/explore/inference`** — an informax posterior demo (watch a posterior tighten).

Plus **`/explore`** — a hub indexing the three as cards.

## Principles

- **DRY / component-first.** One engine, one scene-state model, one present-shell,
  one controls kit. The three surfaces differ only in what drives the engine.
- **Honest.** Real model outputs; synthetic-but-labeled where a mock is used.
- **Vanilla TS islands.** No React yet (YAGNI); revisit only if a piece needs
  component-tree state the plain approach can't handle cleanly.
- **Accessible & lecture-ready.** `prefers-reduced-motion`, keyboard nav, fullscreen,
  projector-legible controls, usable without pointer.
- **Lazy.** Each route streams its own data; heavy WebGL mounts only when visible.

## Architecture — three layers

### 1. Engine — `src/lib/cluster/`

Promote the working `volumeRenderer.ts` into a small module family (DRY split):

```
src/lib/cluster/
  shaders.ts        # GLSL source strings (VOLUME_FS, STAR_VS, STAR_FS, FULLSCREEN_VS)
  spectral.ts       # spectralRGB() — the ZAMS spectral palette (single source of truth)
  scene.ts          # Scene + SceneState types; loadScene(base)
  engine.ts         # createEngine(canvas, scene, opts) -> ClusterEngine
  interaction.ts    # attachInteraction(canvas, engine) -> detach (zoom/pan/rotate)
  massSegregation.ts# correlated_mass_assignment() — McLuster A1 partial-shuffle (TS port)
  index.ts          # barrel: public API surface
```

`ClusterEngine` handle (superset of today's `VolumeControls`):

```ts
interface ClusterEngine {
  // display uniforms (live)
  setEmit(v): void; setAbsorb(v): void; setFloor(v): void; setGamma(v): void;
  setExpel(v: number | null): void;      // null = auto timeline
  // view (also driven by interaction.ts)
  setView(v: Partial<{ yaw; pitch; zoom; panX; panY; spin }>): void;
  getView(): View;
  // stars — re-upload when mass↔position pairing changes (mass-seg)
  setStars(stars: Float32Array): void;   // n*6 x,y,z,mass,teff,radius
  // lifecycle
  redraw(): void; cleanup(): void;
  meta: { floors: { median; mean }; box; ngrid };
}
```

Interaction (zoom/pan/rotate) is **extracted** from the engine into
`interaction.ts` so a surface can opt in (`attachInteraction`) or drive the view
programmatically (scrollytelling) without pointer handlers fighting it.

### 2. Scene state — `src/lib/cluster/scene.ts`

`SceneState` is a plain object of every knob a surface animates (view, floor, gamma,
exposure, expel, lambdaCorr, …). A tiny helper `tween(from, to, t, easing)` blends
two states for scene transitions. Surfaces own their state; the engine just reflects
what it's told. No store framework — a module-level object + rAF is enough.

### 3. Present shell — `src/components/explore/PresentFrame.astro`

One wrapper every `/explore` piece uses. Provides:

- **Fullscreen** toggle (Fullscreen API) + a `present-mode` body class that hides
  site nav/footer and enlarges controls (projector legibility).
- **Keyboard routing**: captures ←/→/space/R/F and emits scoped CustomEvents
  (`present:next|prev|reset|toggleplay|fullscreen`) that the mounted island listens
  for and maps to its own action. Each piece registers what the arrows mean.
- Slot for the canvas + a slot for the piece's controls.

Shared **controls kit** — extract the slider/panel UI from `volume-lab.astro` into
`src/components/explore/ControlPanel.astro` (+ a small `range`/`toggle` partial) so
every piece has identical, tokenized, projector-legible controls.

## The three surfaces

### `/explore/cluster` — scrollytelling (the spine)

One **sticky** cluster canvas; scroll advances a sequence of *scenes*, each a
`SceneState` + a caption. `IntersectionObserver` on scene markers sets the target
scene; the engine tweens view/floor/expel between them. Scenes:

1. Turbulent cloud (gas only, high floor, slow spin).
2. Density grows / structure (floor lowers, filaments emerge).
3. Stars ignite (fade stars in).
4. Massive stars & feedback (highlight O/B stars).
5. Gas expulsion (drive `expel` 0→1 with scroll).
6. Bare cluster revealed.

Present mode: ←/→ jump scenes; space plays the current scene's motion. Fully usable
with JS off → renders scene 1 static image + the captions as an article.

### `/explore/mass-segregation` — live λ_corr

A single **λ_corr slider** (0→1). On change, `correlated_mass_assignment(masses,
localDensity, lambdaCorr, seed)` (TS port of McLuster A1) re-pairs masses to the
fixed positions; `engine.setStars(repaired)` re-uploads. Massive stars migrate to
the dense center as λ_corr→1 — real primordial segregation, computed live.
Extras (YAGNI-gated): highlight m>8 M⊙; a small radial-mass mini-plot.
New export: `export_massseg.py` → positions + per-star local density + masses.
Present mode: ←/→ step λ_corr.

### `/explore/inference` — informax posterior (real NPE, mock obs v1)

Offline `export_inference.py` runs informax NPE on a **synthetic** cluster
observation and exports: a sequence of posteriors as N_obs grows, and the truth.
The page shows (a) the cluster engine rendering the current posterior-mean cluster,
and (b) a **corner plot** (canvas 2D) over cluster params (mass, age, r_t, …) that
tightens as you step "observations added". Honestly labeled: real informax
inference, synthetic observation. `B` (live in-browser) is a later upgrade.
Present mode: ←/→ step N_obs.

## Data / exports (bridge pattern)

```
scripts/gravoturb/export_cluster.py   # exists — volume.u8 + stars.f32 + meta
scripts/gravoturb/export_massseg.py   # positions.f32 + local_density.f32 + masses.f32
scripts/informax/export_inference.py  # posteriors.f32 (steps × samples × dims) + truth + meta
public/data/{gravoturb,informax}/…
```

Each ships gz-small (≤ a couple MB); routes lazy-load. Budget noted in each export.

## Build sequence (reviewable increments)

1. **Foundation** — split `volumeRenderer.ts` into `src/lib/cluster/*`; keep
   `volume-lab` working via the barrel. Extract `ControlPanel`. (No behavior change.)
2. **Present shell + hub** — `PresentFrame.astro`, `/explore` hub, nav "Explore";
   move the sandbox to `/explore/cluster` (or keep `volume-lab` as raw sandbox).
3. **Mass-segregation** — export + TS pairing + page. (Fastest striking win.)
4. **Scrollytelling** — scene system + `/explore/cluster` story.
5. **Inference** — informax export + corner plot + page.

Each increment builds green, is verified in-browser, and is pushed for live review.

## Risks / open

- **informax export shape** — confirm NPE gives exportable posterior samples over a
  clean param vector; if heavy, precompute a small grid. (Verified informax has NPE.)
- **Scrollytelling perf** — one canvas, tween not re-init; cap DPR (already 1.5).
- **Present-mode scope creep** — keep to fullscreen + keys + control sizing; no
  slide framework.
- React stays out unless the corner plot's interactivity demands it (canvas is fine).
