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
 * a measurement is a claim you can check. The figures in the notes are measured on the shipped
 * 10,000-star population and quoted at that count — a smaller `?stars=` changes the summed sky and
 * the white point, so they do not carry.
 *
 * PREFER A RATIO TO A RAW COUNT, for the same reason one step further out. The white point is a
 * percentile of the RENDERED pixels, so it moves with the frame size, and an absolute "N stars
 * visible" is therefore only true at the browser window it was measured in. A share of the
 * survivors is far more stable. A note quoting a count that silently depends on the window is a
 * claim that goes wrong without anyone touching it.
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
    note: "Every star at unit luminance, coloured by temperature. 100% of stars clear the display threshold — the only mode in which the faint majority is visible at all, because it discards how much light each star emits and keeps only what colour it is.",
    state: { instrument: "population", band: "bolometric", transfer: "asinh", depth: 24 },
  },
  {
    id: "rubin",
    label: "What Rubin records",
    note: "The same cluster as real band fluxes through Rubin i/r/g, with Lupton — astronomy's own convention, validated here to 1.11e-16 against astropy. The ten brightest stars carry 47.5% of the band flux and the brightest hundred carry 91.0%, so a photometric image of a young cluster IS blue. That is the physics, not the transfer.",
    state: { instrument: "rubin", transfer: "lupton", curve: 8, depth: 24 },
  },
  {
    id: "fog",
    label: "Why depth alone fails",
    note: "Photometric at maximum star reach with nothing subtracted. All 10,000 stars are above the display floor and the background sits at 2.84% of white — because that background IS the summed PSF wings of those same stars, so raising the depth lifts the sky with them and the frame fills rather than deepens.",
    state: { instrument: "rubin", transfer: "lupton", curve: 20, depth: 24, sky: 0 },
  },
  {
    id: "subtracted",
    label: "…and what it costs",
    note: "The same state with 0.5% of white removed PER BAND, because the sky has a colour. Measured: the surviving stars' red share falls from 95% to 72%, so subtraction is the one lever that treats a smooth pedestal differently from a compact peak AND the faint red majority is what it costs. Subtracting a scalar instead left 0% red at all.",
    state: { instrument: "rubin", transfer: "lupton", curve: 20, depth: 24, sky: 0.005 },
  },
  {
    id: "distance",
    label: "Absolute vs apparent",
    note: "The same stars moved to 7 kpc. Apparent magnitude slides 9.6 magnitudes across the slider's range while absolute magnitude does not move a thousandth — one is a property of this view, the other of the stars.",
    state: { instrument: "population", band: "bolometric", transfer: "asinh", depth: 24, dist: 7000 },
  },
];
