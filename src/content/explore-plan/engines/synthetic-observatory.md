---
title: "Interactive — Synthetic Observatory"
kind: engine
order: 29
status: spec
tagline: "Turn the true cluster into what a telescope actually sees."
research: ["fluxax", "Sim2SKIRT / STARFORGE"]
tours: ["research"]
---

The first half of the Chapter 12 finale. Take the true cluster and **synthesize the
observation**: a mock image (PSF blur, crowding, noise) and a **reddened color-magnitude
diagram**, with dust extinction, distance, and a detection limit. Slide the reddening and
distance and watch the "data" degrade.

This is the full expression of the **observation face** (`observe()`) that the
[Architecture](/explore-plan/01-architecture) threads through the whole series — the
*instrument dialed to realistic*. **Deferred for now:** theory is the current build, and
only `observe()`'s free foundation is pre-wired (minimal physical latent state, the
face-agnostic compare primitive, Teff→colour as rung 0 behind a named boundary). This engine
is where rungs 1–5 (distance → extinction → noise → blending → incompleteness) get built.

**Toggles:** extinction A_V · distance · exposure/noise · completeness.
**Data/engine:** a **fluxax**-style forward model (Sim2SKIRT lineage), built on real,
citeable relations — Pecaut–Mamajek colours, a Cardelli/Fitzpatrick extinction law, the
distance modulus. **Purpose:** feeds the inference reckoning — you can only fit what the
telescope gives you.
