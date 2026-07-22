---
title: "Interactive — The HR Inspector"
kind: engine
order: 20
status: building
tagline: "Sample a cluster; read any star; watch the main sequence build."
research: ["startrax", "Confidently Wrong", "progenax"]
tours: ["undergrad", "research"]
---

The first standalone tool page, and the one **already built and validated this
session** — it becomes the Census chapter's linked interactive.

## What it is

One IMF-sampled cluster drawn two ways: a **2D cluster inspector** (zoom/pan) beside a
**live HR diagram** of the same stars. Hover or tap any star for a card of its real
properties; drag the **IMF slope α** and the whole population re-samples live, with
running **O-star and supernova counts**.

## What the reader learns

The IMF is a *probability distribution you only ever sample*; the HR diagram and the
mass histogram are two projections of one population; rare massive stars dominate the
light and the fate. Steepen α and the O-stars vanish; flatten it and they explode in
number — the tactile seed of the inference story.

## The research, woven in

- Every stellar property (L, Teff, spectral type, lifetime, fate) is **derived from
  `stellar.ts`, ported from and validated against startrax** (Tout 1996, Hurley 2000,
  Heger 2003) — the same relations Anna's stellar-evolution code owns.
- The IMF-as-a-sampled-distribution framing is the on-ramp to **Confidently Wrong**:
  what you infer from a noisy sample can be precise yet wrong.
- The cluster's masses and positions share DNA with the **progenax** IMF/formation work.

## Status

Built: `src/lib/inspector.ts` + `stellar.ts` (validated by `scripts/check-stellar.mjs`
against a startrax fixture). On branch `feat/cluster-inspector`. Phase-1 work: lift it
onto the shared kit as a standalone tool page and link the Census chapter to it.

## Heartbeat toggles

α (slope), N (richness); later: metallicity hi/lo, binaries on/off (the last shared
with the "What fools us" chapter).
