---
title: "Extraction blueprint — the novascope Astro integration"
kind: overview
order: 4
status: spec
tagline: "Build here, but so the day novascope becomes an Astro package is a folder move, not a rewrite."
research: []
---

The plan for making extraction of **novascope** trivial if the explorables ever warrant their
own package. Built in this repo first (see [Architecture §8](/explore-plan/01-architecture) for
the layers and the name); this doc is only the *packaging boundary* — what to avoid coupling to
now, the public surface, and the mechanical checklist that proves the move is cheap.

## The insight: the gate handles code; four things make the move trivial

The import-boundary gate already guarantees the science core has no site/DOM/framework
imports — so *code* portability is solved. Three couplings a gate can't see, plus one aliasing
habit, are what turn extraction into a folder move. All four are good practice for the site
regardless.

### 0. Imports already read as the package — the `@novascope/*` alias

In-repo code imports from `@novascope/core`, `@novascope/state`, etc. (a tsconfig path alias →
`src/novascope/*`). So every import specifier is *already* the package name; extraction just
repoints the alias from `src/novascope` to `node_modules/@drannarosen/novascope` — **zero
import lines edited** across the whole repo.

### 1. Styling — prefixed tokens, host-overridable

Components must **not** consume this site's raw tokens (`--step-*`, `--ink`, `--spec-teal`…)
directly. They read a **self-namespaced set** with fallbacks:

```css
color: var(--xpl-ink, var(--ink, #e8e8ea));
font-size: var(--xpl-step-0, 1rem);
```

Standalone, the `--xpl-*` fallbacks make the component look right with zero host setup; inside a
host with design tokens, the host maps `--xpl-ink: var(--ink)` once and everything themes. The
science core and viz never touch CSS at all.

### 2. State — a factory, not a global; injectable persistence

The store is created by `createClusterStore(options)`, never a module-level singleton — so two
explorables on one page, or two consumer sites, never collide. Persistence is an **injected
adapter** (default: localStorage under a namespaced key `novascope:<instance>`; a consumer can
pass a URL adapter, a no-op, or their own). No hardcoded global keys.

### 3. SSR — no top-level `window`

Every importable module must be import-safe on the server (Astro SSR/SSG evaluates them). The
pure core already is. Viz and store touch `window`/`canvas` **only** inside client-only paths
(island `onMount`, event handlers) — never at module top level. One lint/gate line
(`no-restricted-globals` at module scope in viz) keeps this true.

## Package anatomy (the target)

Mirrors the layers, one entry point each — the same `src/novascope/` tree, lifted:

```
@drannarosen/novascope/
  core/         Layer 0 — pure physics (stellar, imf, dynamics, cluster, random, constants)
  viz/          Layer 2 — canvas/WebGL renderers (starfield lineage: DPR, reduced-motion, cleanup)
  state/        Layer 1 — createClusterStore + adapters
  components/   Layer 3 — Astro islands: <HRInspector/>, <ClusterField/>, <IMFSampler/>, …
  styles/       the --xpl-* token defaults + cascade-layer registration
  integration.ts  the optional AstroIntegration (styling/config convenience)
  package.json  "exports": { ".": integration, "./core": …, "./viz": …, "./components/*": … }
```

## The integration is optional sugar

Consumers can use it two ways, and the components work either way:

- **Manual** — `import { HRInspector } from "@drannarosen/novascope/components"`, import the
  token CSS once. No integration needed. This is the floor.
- **Integration** — add `novascope()` to `astro.config`. Its `astro:config:setup` hook injects
  the `--xpl-*` token defaults and registers the cascade-layer order (via `injectScript`), and
  accepts config: `{ theme, injectTokens, defaultPreset, reducedMotion, math }`. Optionally
  `injectRoute` for a ready-made demo gallery. It only ever does *convenience*; it holds no
  physics.

Every consumer repo is Astro (Cosmic Playground, the Sophie/ASTR 201 site, future courses) and
so is this one — so components ship as `.astro` islands (vanilla/TS, no React per the site's
YAGNI rule), `astro` is a **peerDependency**, and the core/viz carry no framework dep.

## Public API surface (what a consumer touches)

- `@drannarosen/novascope/core` — `star(M,Z,t)`, `sampleCluster(identity)`, presets,
  integrators, constants.
- `@drannarosen/novascope/viz` — `renderClusterField(canvas, data, opts)`, `renderHR(…)`.
- `@drannarosen/novascope/state` — `createClusterStore(options)`.
- `@drannarosen/novascope/components` — the islands by name.
- default — the `novascope()` integration.

## Extraction checklist (the proof it's trivial)

When/if the day comes:

1. `git mv src/novascope packages/novascope` — the whole package is already one directory.
2. Add `package.json` with the `exports` map + `astro` peer dep. (No code edits — the gate
   guaranteed no site imports; the `@novascope/*` alias means specifiers already match; the
   `--xpl-*` tokens guaranteed no host-style edits; the factory store guaranteed no global-key
   edits.)
3. Add `integration.ts` (the token/config hook — new code, but small and additive).
4. Repoint the `@novascope/*` alias from `src/novascope` to the package; in this repo,
   `npm i @drannarosen/novascope`.

Steps 1–2 and 4 are mechanical; only 3 is new. That is the definition of trivial, and it is
bought entirely by the alias + three couplings above being handled from the start.

## Name (locked)

**`novascope`** — package-root `src/novascope/`, alias `@novascope/*`, future publish
`@drannarosen/novascope`, integration wrapper `astro-novascope`. Neutral and honest (not
`startrax`/`gravax`, not a physics-event word like `supernova`): *nova* = "new," so a **new kind
of telescope** — fitting for an instrument that reveals the theory a real telescope cannot.
