---
name: lab-measure
description: Use when measuring, diagnosing, or judging anything the star-render lab draws — before reporting a number, a "this is fixed", or a cause for something Anna says looks wrong. Enforces that the instrument is proved to respond, the harness is proved to be the state she is looking at, and the suspected cause is eliminated rather than confirmed. Don't use for building the page (site-integrity), publishing claims (site-claims), or shipping (site-verify).
---

# Measuring the star-render lab

Anna judges this page by looking at it. Every time this session she was right about
the image and a confident explanation of something else was wrong. That is the
failure to design against — **not being wrong, but being wrong at her**.

## Rule 0 — her eyes are the ground truth

When she says the image looks wrong, **the image is wrong**. The job is to find
out why, never to explain why it is fine. If a measurement disagrees with what she
can see, the measurement is the suspect.

Three separate times a confident report was built on an instrument that was
measuring nothing. Presenting those as findings is what makes her doubt her own
observation, and it is worse than saying "I don't know yet".

## Before trusting any measurement

**1. Prove the instrument responds.** Move a knob whose effect you can predict and
confirm the number moves. A null result from an instrument you have not exercised
is not evidence.

Known traps on this page, all hit for real:

| Instrument | Failure |
| --- | --- |
| `window.starlab.stats` | a snapshot, not a getter — unchanged at 4x exposure |
| the contact sheet | returned byte-identical pixels across genuinely different settings |
| `requestAnimationFrame` | starved in a hidden tab, so rebuilds never run; the URL still updates, so it looks like the control is broken |

Change state by **navigating to a URL**, not by setting `.value` and dispatching
`input`. Check `document.visibilityState` before believing a null result.

**2. Prove the harness is her state.** Use `fieldFromLabUrl()` from
`viz/starfield/labField` with the URL from her browser. It asserts the field's mode,
transfer and distance against the URL and throws on a mismatch.

Never hand-build `PrepareOptions`. A script once passed `instrument: "rubin"` — not
an option — so it was dropped, the field came back in population mode, and a whole
analysis of photometric colour ran on a temperature ramp. Every number was
self-consistent. A typo'd key is an excess-property error only for object literals,
so nothing catches it but this.

**3. Inspect her actual tab first.** `mcp__claude-in-chrome__tabs_context_mcp`, then
read the live control values off the DOM and screenshot. Do not reconstruct her
state from a URL you remember — hers can be stale, or she may have moved a control.
Never return `location.href` from the JS tool; the result is blocked.

## Before naming a cause

**Eliminate, do not confirm.** Turn the suspect OFF and check the symptom
disappears. One navigation. Every misdiagnosis this session came from reasoning to
a plausible culprit and then measuring to support it:

- the blue "spread" — blamed the aureole; `?aureole=0&spikes=0` showed it was the
  diffraction falloff
- the plateau — two explanations built (over-strong aureole, then a spatially
  varying background model) before `?curve=8` fixed it outright
- the sky probe — blamed bloom cropping; bloom off proved a degenerate percentile

The lab has off switches for exactly this: `aureole=0`, `spikes=0`, `bloom=0`,
`sky=0`, `motion=off`. Use them before building a theory.

## Before reporting a number

State the conditions that make it true, or you do not have a measurement:
**star count, frame size, colour mode, transfer, and the depth/span/sky settings.**
The white point is a percentile of the rendered pixels, so it moves with the window
— which means an absolute "N stars visible" is only true at the size it was taken
at. Prefer a ratio.

## Before claiming something is fixed

Name the thing that was actually wanted, not the proxy that moved. "Mean frame
level 78% → 0%" was true and meant 92% of the stars had been deleted. If the only
evidence is a summary statistic, say so and show the image.
