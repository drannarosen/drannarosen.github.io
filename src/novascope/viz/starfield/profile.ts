/*
 * profile.ts — the star profile, as ONE scalar function (Layer 2).
 *
 * This is the entire surface the GPU shader mirrors. ADR 0015 accepts that the TSL
 * graph restates the maths, because a TSL node has no CPU value and cannot be
 * asserted on in node; what it does NOT accept is the restatement being large. So
 * the profile lives here, in one named function, and `starGraph.ts` mirrors this
 * and nothing else.
 *
 * It exists because the previous "CPU reference renderer" was not one. It was a
 * separate implementation that chose its own beta (2.8 against the model's 3.2),
 * its own PSF width (1.3 px against 2.2), its own aureole amplitude and its own
 * quad-extent rule, then tone-mapped with Reinhard where the renderer uses AgX.
 * Every one of those can disagree with the shader independently, which is how the
 * claim "the CPU reference produces a correct image" survived alongside a GPU path
 * that was squaring the profile: the two were never the same model, so agreement
 * was never being tested. A reference that cannot be compared is decoration.
 */

import { moffat, type AureoleParams } from "../../core/optics/index.ts";

export interface ProfileInputs {
  /** Radius from the star's centre, in PSF widths. */
  rho: number;
  /** Radius of the billboard edge, in PSF widths. */
  edge: number;
  /** Display signal — drives the Moffat core. */
  signal: number;
  /** Linear flux relative to white — drives the scattered-light halo. */
  halo: number;
  /** Aureole shape and amplitude. */
  aureole: AureoleParams;
  /** Moffat wing exponent. */
  beta: number;
}

/**
 * Unsubtracted profile: the Moffat core on the display signal plus the
 * scattered-light wing on the LINEAR flux.
 *
 * Two drives, because the core is what the exposure is choosing how to show while
 * scattered light is a fixed fraction of the flux that entered the instrument and
 * knows nothing about display. See `StarField.halo`.
 */
function rawProfile(rho: number, p: ProfileInputs): number {
  const core = moffat(rho, 1, p.beta) * p.signal;
  const wing = (p.aureole.amp * p.halo) / (1 + Math.max(0, rho) / p.aureole.scale) ** p.aureole.p;
  return core + wing;
}

/**
 * The radiance multiplier at `rho`, with the billboard's pedestal removed.
 *
 * The subtraction is what makes the profile reach EXACTLY zero at the quad edge.
 * Without it the value is still ~1e-3 out there, which survives the sRGB transfer
 * against a black sky and crops every star into a visible square — the failure
 * this renderer was accused of and which turned out to be a different bug entirely.
 *
 * Clamped at zero, so a star contributes nothing outside its own billboard.
 */
export function starProfile(p: ProfileInputs): number {
  if (p.rho > p.edge) return 0;
  return Math.max(0, rawProfile(p.rho, p) - rawProfile(p.edge, p));
}
