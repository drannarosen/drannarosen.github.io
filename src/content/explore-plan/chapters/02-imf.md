---
title: "Chapter 2 — The IMF, a Probability You Sample"
kind: chapter
order: 2
status: spec
tagline: "Astronomers never see the IMF — they count stars in mass bins."
research: ["progenax", "Confidently Wrong"]
engines: ["imf-sampler"]
tours: ["undergrad", "research"]
---

The reframing the whole series turns on: the initial mass function is not a formula, it
is a **probability distribution you only ever sample**.

## Story beat

No one observes "the IMF." They count the stars they can see, drop them into mass bins,
and a **ragged histogram** tries to trace a smooth power law. The reader does exactly
that on the cluster they just made — and watches the rare, heavy tail wobble wildly from
draw to draw while the light end stays smooth.

## What the reader does

Drag the **high-mass slope α** and the cluster re-samples; bin the masses; compare the
noisy histogram to the underlying law. Small sample → jumpy tail; large sample → the law
emerges. (Full play in the linked IMF sampler.)

## The research, woven in

- The IMF and its sampling sit at the heart of **progenax** (formation → populations).
- "A distribution you infer from a noisy sample" is the on-ramp to **Confidently Wrong**:
  the whole finale is *this histogram, corrupted and fit badly.*

## Physics & data

Kroupa (2001) piecewise power law, variable high-mass α, from the shared `imf.ts`
(inverse-CDF sampler already built).

## Carries forward

The population's shape — and the understanding that everything downstream is a *sample*,
not a truth.

## Heartbeat toggle

α slope; sample size N.
