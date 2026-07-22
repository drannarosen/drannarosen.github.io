---
title: "Interactive — N-body Dynamics"
kind: engine
order: 28
status: spec
tagline: "Gravity isolated vs N-body — watch a cluster live, segregate, and dissolve."
research: ["gravax"]
tours: ["undergrad", "research"]
---

Shared by Chapters 10–11. The headline toggle — **gravity isolated ↔ N-body** — turns a
static scatter into a living cluster: mass segregation, ejections, core hardening, then
(with a tidal field) evaporation and dissolution.

**Toggles:** gravity isolated/N-body · time (run/rewind) · particle count · tide on/off.
**Data/engine:** a symplectic N-body integrator **ported from gravax** (leapfrog or 4th-
order Forest–Ruth), validated by energy conservation; Plummer initial conditions.
**Honesty:** modest N for browser speed; energy-drift bounded and shown.
