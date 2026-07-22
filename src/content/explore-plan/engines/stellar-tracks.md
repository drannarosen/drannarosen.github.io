---
title: "Interactive — Stellar Tracks"
kind: engine
order: 22
status: spec
tagline: "Pick a mass; scrub time; watch a star trace the HR diagram."
research: ["startrax"]
tours: ["undergrad", "research"]
---

Shared by Chapters 4–6. Choose a mass, scrub time, and watch the star move across the HRD
(MS → giant → AGB) with its properties updating; overlay the whole cluster's stars aging
at once.

**Toggles:** mass · time · metallicity hi/lo.
**Data — the model ladder** ([Architecture](/explore-plan/01-architecture)): ships **now**
on rung 0 (Tout ZAMS + Hurley `t_MS` clock — the star lives then dies, without yet tracing a
giant branch); upgrades to **precomputed startrax tracks** interpolated over a 1-D mass grid
(the validated ZAMS-fixture pattern, extended); and is the **one engine that later shares the
differentiable surrogate** with Inference Reckoning — build it once, it powers both.
**Honesty:** each rung labeled; interpolated data, not a live evolution run.
