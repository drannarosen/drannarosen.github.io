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

**Toggles:** extinction A_V · distance · exposure/noise · completeness.
**Data/engine:** a **fluxax**-style forward model (Sim2SKIRT lineage). **Purpose:** feeds
the inference reckoning — you can only fit what the telescope gives you.
