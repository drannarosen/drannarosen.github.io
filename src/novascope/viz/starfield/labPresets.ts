/*
 * labPresets.ts — named states, for teaching and for talks (Layer 2).
 *
 * A preset is a URL and nothing more. That is the whole payoff of putting every control in the
 * query string: no preset machinery, no serialisation format, no way for a preset to drift from
 * what the controls can express. Each entry below is a partial `LabState`; the page encodes it
 * with the same codec it uses for the address bar, so a preset button and a hand-typed link are
 * the same thing.
 *
 * ── WHAT MAKES A PRESET WORTH HAVING HERE ──
 *
 * Every one of these states something MEASURED, and the note says what. This page is an
 * instrument, so a preset that merely looks nice would be a decoration; a preset that reproduces
 * a measurement is a claim you can check. The figures in the notes come from this session's
 * measurements on the shipped population and are quoted at the star count they were taken at —
 * a smaller `?stars=` changes the summed sky and the white point, so the numbers do not carry.
 *
 * They are also the answer to "how do I get back to that?" during a lecture. Arrow keys step
 * through them in order, so a demo is a sequence rather than a hunt through eleven controls.
 */
import type { LabState } from "./labParams.ts";

export interface LabPreset {
  id: string;
  label: string;
  /** One line, shown under the buttons. States what the setting demonstrates, not what it does. */
  note: string;
  /** Partial state — anything omitted stays at its default, exactly as in a URL. */
  state: Partial<LabState>;
}

export const LAB_PRESETS: ReadonlyArray<LabPreset> = [
  {
    id: "population",
    label: "The population",
    note: "Every star at unit luminance, coloured by temperature. 86.9% of the frame is black and 85.6% of stars clear the threshold — the only mode in which the faint majority is visible at all, because it discards how much light each star emits.",
    state: { instrument: "population", band: "bolometric", transfer: "asinh", depth: 24 },
  },
  {
    id: "rubin",
    label: "What Rubin records",
    note: "The same cluster as real band fluxes through Rubin g/r/i, with Lupton — astronomy's own convention, validated here to 1.11e-16 against astropy. Hue spread collapses to 0.021: ten hot stars carry 48% of the light, so a photometric image of a young cluster IS blue.",
    state: { instrument: "rubin", transfer: "lupton", curve: 8, depth: 24 },
  },
  {
    id: "fog",
    label: "Why depth alone fails",
    note: "Photometric at maximum star reach with no sky subtracted. The median pixel sits at 51% grey: raising depth lifts the stars and the background together, because the background is the summed PSF wings of every star rather than noise.",
    state: { instrument: "rubin", transfer: "lupton", curve: 20, depth: 24, sky: 0 },
  },
  {
    id: "subtracted",
    label: "…and what fixes it",
    note: "The same state with 0.5% of white subtracted. Measured: 0% black becomes 76.4% black, and the count of distinguishable faint peaks reaches its highest of any setting tried. Subtraction is the one lever that treats a smooth pedestal differently from a compact peak.",
    state: { instrument: "rubin", transfer: "lupton", curve: 20, depth: 24, sky: 0.005 },
  },
  {
    id: "distance",
    label: "Absolute vs apparent",
    note: "The same stars moved to 7 kpc. Apparent magnitude slides 9.6 magnitudes across the slider's range while absolute magnitude does not move a thousandth — one is a property of this view, the other of the stars.",
    state: { instrument: "population", band: "bolometric", transfer: "asinh", depth: 24, dist: 7000 },
  },
];
