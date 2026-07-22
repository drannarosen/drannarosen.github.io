---
title: "The cluster-state object"
kind: overview
order: 2
status: spec
tagline: "The keystone: one seed-defined cluster, everything derived, persisted so it survives a page load."
research: ["progenax", "startrax", "gravax"]
---

The single source of truth the whole series hangs on. Every engine reads this object; none
holds its own copy of "the cluster." Getting its shape right on paper — what is stored vs
derived, how `star(M,Z,t)` hangs off it, how it persists — is what makes the IMF, HR and
Tracks engines *compose* instead of fork. Built on the contract in
**[Architecture](/explore-plan/01-architecture)**.

## Identity vs view — two kinds of state

A hard split that keeps the object honest:

- **Identity** — *which* cluster this is. A seed plus a handful of generative parameters.
  Change it and you have a different cluster.
- **View** — *how you are looking at it right now*: the age `t` you have scrubbed to, the
  star you selected, which toggles are flipped. Change it and it is the same cluster, seen
  differently.

Identity is the thing worth naming, sharing, and resuming. View is per-session sugar (though
it persists too, so a reader returns to exactly where they were).

## Stored state — the minimum

```
ClusterIdentity = {
  seed:      number,                       // deterministic RNG seed
  sampling:  { mode: "count" | "mass", target: number },
  imf:       { mMin, mMax, alphaHigh },    // Kroupa broken power law, variable high-mass slope
  Z:         number,                       // metallicity — CLUSTER-level, not per-star
  profile:   { kind, scaleRadius, ... },   // spatial density (truncated EFF now; Plummer/BE later)
  kinematics:{ virialRatio, ... },         // reserved for N-body; unused by theory-only engines
}

ViewState = {
  t:            number,                     // age (Myr) — the shared time global
  selectedId:   number | null,             // the "favorite" star followed across chapters
  toggles:      Record<string, boolean>,   // winds on/off, gravity isolated/N-body, …
}

Log = {                                    // the observing notebook — see Navigation
  visited:      Set<chapterId>,
  milestones:   Milestone[],               // "unlocked a deep dive", "ran an inference", …
}
```

That is all that is stored. Note what is **absent**: no star list, no `L`/`Teff`/`Mdot`, no
colours, no aggregate counts. Those are derived.

## Derived state — everything else, on demand

- `sampleCluster(identity) → Star[]` — a **pure, seeded** function. Each `Star` is latent
  only: `{ id, mass, Z, x, y, z, vx, vy, vz }`. Deterministic, so the same identity always
  yields the same population (reproducibility, and the reason "these are the stars I made
  earlier" is literally true). Needs a seedable RNG (e.g. mulberry32) — `Math.random` is not
  seedable, so this is a deliberate dependency, not an oversight.
- Per-star physics via `star(mass, Z, t) → { L, R, Teff, phase, colour, spectralType, Mdot,
  remnant }` — the contract, re-evaluated at the current view `t`.
- Aggregate readouts — star count, actual total mass, number of O stars, the most massive
  star, the IMF slope you would *measure* — all derived from the two above.

Derived state is never persisted; it is recomputed from identity + view on every page load.
Cheap, and it means there is nothing to keep in sync.

## Persistence — because the site is static MPA

Navigating from one chapter to the next destroys all in-memory state (no SPA router). So
continuity is *only* possible if identity + view serialize and persist:

- **URL** — identity encodes to a short query string (seed + a few numbers), so a cluster is
  shareable by link. This is the reproducibility your program is about, made tactile.
- **localStorage** — the working cluster, view, and log, so "Continue my cluster" resumes a
  return visit and the log accumulates across sessions.
- Load order on any page: explicit URL param → localStorage → a default preset.

Entry choices this enables (see **[Navigation](/explore-plan/03-navigation)**): **Start
fresh** (new seed), **Continue my cluster** (localStorage), **Try a strange universe** (a
named preset).

## Presets — "strange universes"

A preset is just a named `ClusterIdentity`. Curated set: **low-mass** (sampling noise
visible), **starburst** (high mass, many O stars), **binary-rich** (high binary fraction, for
Ch 8), **heavily extincted** (an `observe()` parameter — *reserved*, dialed in the observation
act), **rapidly dissolving** (supervirial kinematics, weak binding). Presets teach by
contrast without new machinery.

## The module shape (for when we build)

- `lib/cluster/params.ts` — `ClusterIdentity` type, presets, (de)serialize to/from URL.
- `lib/cluster/sample.ts` — `sampleCluster(identity)` (seeded), feeding on `lib/imf.ts`.
- `lib/cluster/store.ts` — the reactive session store (identity + view + log) + persistence.
  Framework-agnostic; a tiny pub/sub or nanostores (Astro-native, no React) is enough — no
  SPA state library.
- `lib/stellar.ts` — the `star()` contract (already built, validated against the startrax
  fixture).

## Guardrails (inherited, restated because this object is where they bite)

- Minimal latent state; derive the rest.
- Physical units in the contract; **colour is derived, never stored** (or `observe()` cannot
  re-derive it under extinction later).
- **3-D positions authoritative**; the on-screen 2-D is a derived view — never flatten `z`.
- `Z` is cluster-level.
