---
title: "Chapter 9 — Feedback & Energetics"
kind: chapter
order: 9
status: spec
tagline: "The massive stars fight the cloud that made them — and where the energy goes decides everything."
research: ["ORION2", "HARM²", "Taming the Tarantula (30 Dor)", "Sim2SKIRT / STARFORGE"]
tools: ["feedback-budget"]
spinoffs: ["feedback-zoo"]
tours: ["undergrad", "research"]
---

Anna's research, dead-center. "Energetics" is the sharper framing than plain "feedback,"
because it turns a list of processes into the one question that decides a cluster's fate:
**where does the energy go?**

## Story beat

The massive stars from the census switch on and turn on the cloud that made them.
Feedback isn't one thing — it's a **cast with a budget**, and each member is driven by a
particular *kind* of star (that mapping is its own exhibit — see the **Feedback Zoo**):

- **Protostellar outflows** — collimated jets from young, accreting stars; the first holes.
- **Radiation pressure** — from the most luminous stars: **direct (L/c) and
  dust-reprocessed**, the channel Anna's radiation-hydrodynamics work centers on.
- **Line-driven winds** — hot OB/WR stars; mechanical power ~½Ṁv².
- **Photoionization** — the hottest O stars; HII-region thermal pressure.
- **Supernovae** — ~10⁵¹ erg each, at the end of a massive star's life.

Each injects energy and momentum on its own timescale.

## The energetics twist (the point, and Anna's paper)

Naively add up the wind power and you predict a blazing X-ray bubble. Observe it and the
X-rays are **far dimmer** — a large fraction of the energy has gone **missing**. Where?
Turbulent mixing, radiative cooling, and physical leakage out of the cluster. That is
literally **Taming the Tarantula / 30 Doradus**: classical wind models over-predict the
X-ray luminosity, so significant wind energy is lost. The chapter's core interaction is an
**energy-budget ledger** — injected vs retained vs radiated/leaked — and the reader
discovers that the deciding number, the **coupling efficiency**, is exactly the hard,
uncertain quantity real research fights over.

## Why it drives gas expulsion (closes back to Chapter 1)

Compare the *retained* momentum/energy against the cloud's **gravitational binding
energy**. Exceed it → the gas unbinds and is **expelled** → the potential drops → the
cluster can unravel. Energetics literally decides whether the cluster survives to
Chapter 10.

## What the reader does

Toggle each channel on/off; watch the ledger and the bubble respond; dial the coupling
efficiency and watch the gas either blow out or stay bound.

## The research, woven in

- **HARM²** — the radiation-hydrodynamics method that models exactly this coupling.
- **30 Dor / R136** — the observed "lost energy" result driving the ledger.
- **Sim2SKIRT / STARFORGE** — the synthetic view of feedback-carved gas.

## Visual style — JWST as inspiration (not imitation)

The feedback-carved gas is shown as visualizations whose **structure is inspired by real
JWST imagery** — its gorgeous outflows, pillars, and wind bubbles — rendered from Anna's
**ORION2 massive-star-formation simulations**, driven by a **star / luminosity slider**.
The framing is deliberate: JWST is the *aesthetic and structural muse*, **not** something
we mimic or pass off as real data. The rigorous synthetic-observation-and-**spectra**
machinery (Sim2SKIRT / fluxax) is introduced later, in the Observer route (Chapter 12).

## Physics & data

Per-channel energy/momentum budgets vs a binding-energy comparison; a HARM²-informed
coupling-efficiency dial. Illustrative, labeled — not a live RHD run.

## Carries forward

Gas expelled (or retained) and a reduced binding energy — the initial condition for
dynamics and dissolution.
