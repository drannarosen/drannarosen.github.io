---
title: "Chapter 10 — No Star Is an Island"
kind: chapter
order: 10
status: spec
tagline: "Dynamics: gravity couples every star; the massive ones sink."
research: ["gravax"]
engines: ["nbody-dynamics"]
tours: ["undergrad", "research"]
---

The categorical shift: until now stars were individuals. Here they become a **system**,
bound to each other by gravity, with behavior no single-star model can predict.

## Story beat

Every star pulls on every other. Run the clock and the cluster comes alive:
**two-body relaxation** shuffles energies, the heaviest stars lose energy and **sink to
the center** (mass segregation), close encounters fling stars outward, and a dense core
begins to form. None of this has a closed-form answer — it must be integrated.

## What the reader does

Flip the fundamental toggle — **gravity: isolated ↔ N-body** — and watch a static scatter
become a living, segregating cluster. Run and rewind the clock; watch the massive stars
drift inward and the occasional star get ejected.

## The research, woven in

- The engine is a real **N-body integrator ported from gravax** — a symplectic scheme
  (leapfrog or 4th-order Forest–Ruth), the same family of methods gravax owns, validated
  by energy conservation.
- Mass segregation is an *emergent* result of the same gravity, not an added rule — the
  honest way to show it.

## Physics & data

Direct N-body for a modest star count, symplectic integration (energy drift bounded);
Plummer initial conditions from the shared sampler.

## Carries forward

A mass-segregated, ejecting cluster with a hardening core — one step from dissolution.

## Heartbeat toggle

Gravity isolated / N-body; time; particle count.
