/*
 * labParams.ts — the star lab's controls, as a URL schema (Layer 2).
 *
 * The schema half of `core/params/urlState`. It lives here rather than in the core because it
 * describes a UI's controls, not physics — and because the values it maps onto are
 * `PrepareOptions`, which is this directory's type. The core owns the codec; this owns which
 * knobs exist.
 *
 * EVERY ALLOWED VALUE IS DERIVED FROM A REGISTRY, never listed. The transfers come from
 * `TRANSFER_IDS`, the instruments from `INSTRUMENTS`, the schemes from `COLOR_SCHEMES`, the
 * bands from `PASSBANDS`, and the depth bounds from `DEPTH_MAG_RANGE`. A hand-written list here
 * would be a second place the set of transfers lives, and it would drift the first time one was
 * added — the exact failure that left eighteen of thirty-one pages out of the search index.
 * `check:url-state` asserts the schema and the registries still agree.
 *
 * ── THE ONE AWKWARD FIELD, stated rather than hidden ──
 *
 * `depth` has a MODE-DEPENDENT default: 16 mag in population mode, 8 in photometric, because
 * `depthMag` drives a different parameter in each (the per-star asinh softening, or Lupton's Q
 * per pixel). A URL schema wants one default per field, so this takes the population figure —
 * the mode the page starts in — and a photometric link therefore carries `depth=8` explicitly
 * even when it was never touched.
 *
 * That is a symptom, not a design: one control meaning two things is already recorded as the
 * wart to fix (see the vision roadmap, and `DEFAULT_POPULATION_DEPTH_MAG` for the bug it caused).
 * Writing the value explicitly is the honest behaviour in the meantime — a lecture link that
 * states its depth is better than one that inherits a default which may move.
 */
import {
  boolField,
  enumField,
  numberField,
  type Schema,
  type StateOf,
} from "../../core/params/urlState.ts";
import { TRANSFER_IDS } from "../../core/imaging/transfers.ts";
import { INSTRUMENTS } from "../../core/photometry/instruments.ts";
import { COLOR_SCHEMES } from "../../core/colorimetry/schemes.ts";
import { PASSBANDS } from "../../core/photometry/passbands.ts";
import { DEPTH_MAG_RANGE, DEFAULT_LUPTON_DEPTH_MAG } from "../../core/imaging/lupton.ts";
import { D0_PC, DISTANCE_PC_RANGE } from "../../core/photometry/index.ts";
import { SKY_FRACTION_RANGE } from "../../core/imaging/index.ts";

/**
 * The sky slider's position (0…1) to the fraction of white it subtracts, and back.
 *
 * ── WHY A CUBE AND NOT A LOGARITHM ──
 *
 * The need is logarithmic: the useful settings span 0.002 to 0.064 of white (the measured 25th
 * percentile and mean of the background), a factor of 32, inside a control whose top is 0.2 —
 * so a linear slider spends 99% of its travel above everything that matters. That was the old
 * control's real defect, more than its range: at 5% linear with a 0.05% step, the entire
 * interesting region was the first four steps.
 *
 * But a logarithm CANNOT EXPRESS ZERO, and zero is this control's default and its most-used
 * value — "no subtraction" is the honest baseline every other setting is judged against. A log
 * slider needs a special-cased minimum position meaning "off", which is a discontinuity at
 * exactly the value people return to.
 *
 * A cube is the compromise, and it is a compromise, stated rather than hidden: it is 0 at 0,
 * smooth throughout, and puts the interesting decade where a hand can work. The travel it gives:
 *
 *     slider 0.000 -> 0        (off, exactly)
 *     slider 0.215 -> 0.199%   the measured 25th percentile
 *     slider 0.685 -> 6.428%   the measured mean
 *     slider 1.000 -> 20%      deliberate over-subtraction
 *
 * So roughly a fifth of the travel covers "nothing to a fifth of a percent", and half of it
 * covers the span between the two measurements. A true log would spread the low end further
 * still; it would also make the default unreachable, and that trade is not worth it here.
 */
export function skyFractionFromSlider(t: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  return SKY_FRACTION_RANGE.max * clamped ** 3;
}

/** Inverse of {@link skyFractionFromSlider}, for putting the widget back where a URL says. */
export function sliderFromSkyFraction(fraction: number): number {
  const clamped = Math.min(SKY_FRACTION_RANGE.max, Math.max(0, fraction));
  return (clamped / SKY_FRACTION_RANGE.max) ** (1 / 3);
}

/**
 * "Follow the mode" — the transfer control's empty option, spelled for a URL.
 *
 * The DOM uses `""` for it, which cannot appear in a query string without reading as a missing
 * value. `auto` says the same thing out loud, and the page translates at the boundary so neither
 * side has to know the other's spelling.
 */
export const TRANSFER_AUTO = "auto";

/**
 * "Not an instrument" — the population mode, which supplies no composite and no band.
 *
 * Kept as a named constant because its ABSENCE from `INSTRUMENTS` is load-bearing: it is what
 * selects the temperature-ramp path in `prepare`, and inventing an entry for it would turn "this
 * is a temperature ramp" into a false claim that three named filters recorded something.
 */
export const POPULATION_ID = "population";

const INSTRUMENT_IDS = [POPULATION_ID, ...INSTRUMENTS.map((i) => i.id)] as const;
const SCHEME_IDS = COLOR_SCHEMES.map((s) => s.id);
/* "bolometric" is a band the page offers that is not a passband — total light, no filter. */
const BAND_IDS = ["bolometric", ...Object.keys(PASSBANDS)];

/**
 * The schema.
 *
 * Ranges match the controls exactly, and where a bound is a physical fact it is IMPORTED
 * (`DEPTH_MAG_RANGE`) rather than restated — a restated slider range is precisely what caused
 * the depth bug this file's header describes.
 */
export const LAB_SCHEMA = {
  instrument: enumField(INSTRUMENT_IDS, POPULATION_ID),
  scheme: enumField(SCHEME_IDS, SCHEME_IDS[0] ?? "true"),
  /*
   * BOLOMETRIC by default — total light, no filter, which is the physical quantity rather than an
   * instrument's view of it. It pairs with the population default: both say "the stars", not "a
   * camera". Choosing an instrument still overrides it, because an instrument drives its own band.
   */
  band: enumField(BAND_IDS, "bolometric"),
  /*
   * ASINH, not "follow the mode". `auto` remains selectable and now resolves to asinh in both
   * modes, so it is no longer a fork — see `prepare` for what that costs in population mode.
   */
  transfer: enumField([TRANSFER_AUTO, ...TRANSFER_IDS], "asinh"),
  /*
   * ALWAYS WRITTEN — see `alwaysWrite`. Omitting it at the schema default is not merely verbose
   * here, it is wrong: a photometric link sitting at 16 (population's default) omitted `depth`
   * and REOPENED AT 8, because the page forces the mode's own default when the URL is silent.
   * Measured, not theorised — the sender's picture and the recipient's differed, silently.
   */
  /*
   * TWO DEPTHS, because they were always two parameters.
   *
   * `depth` is the PER-STAR reach — how far down the population the asinh curve lifts. `curve` is
   * the PER-PIXEL transfer's span, which only `lupton` varies with. Sharing one field is what made
   * the default mode-dependent, which is what made `alwaysWrite` necessary: a photometric link at
   * 16 reopened at 8. With two fields each has ONE honest default and that whole class of bug is
   * gone — `alwaysWrite` is kept on `depth` anyway, because a lecture link that states its depth
   * is better than one inheriting a default that may move.
   */
  depth: numberField(
    DEPTH_MAG_RANGE.min,
    DEPTH_MAG_RANGE.max,
    // THE MAXIMUM, so every star clears the display floor by default — Anna's call. See the page's
    // DEPTH_DEFAULTS for what the measurements say this costs in colour separation.
    DEPTH_MAG_RANGE.max,
    2,
    true,
  ),
  curve: numberField(DEPTH_MAG_RANGE.min, DEPTH_MAG_RANGE.max, DEFAULT_LUPTON_DEPTH_MAG, 2),
  /*
   * A FRACTION OF WHITE, always — never the slider's own position. Same discipline as `dist`,
   * which carries parsecs while its widget works in log10: a link reads `sky=0.005` and means
   * "half a percent of white", which is a quantity someone can check against a measurement.
   *
   * EIGHT DECIMALS, and the count is derived from a measurement rather than picked. The probe has
   * returned backgrounds of 1.17e-5 and 5.91e-5 of white. At the original FOUR both encode as
   * `sky=0`, so the link asserts "no subtraction" about a state that had one. At six they survive
   * but round — 1.17e-5 becomes 1.2e-5, a 2.6% error — because fixed decimals bound the ABSOLUTE
   * error, which turns into an unbounded RELATIVE error as the value approaches zero, and this
   * control's interesting values are the ones near zero.
   *
   * Eight holds the relative error under 0.1% across the whole range, and sits about a hundred
   * times finer than the slider's own resolution near the low end (~1e-6 of white per pixel of
   * travel), so the URL is never the thing losing information. Trailing zeros are stripped on the
   * way out, so a plain setting still reads `sky=0.002`. Gated in `check:url-state`, which is what
   * caught six being insufficient.
   */
  sky: numberField(SKY_FRACTION_RANGE.min, SKY_FRACTION_RANGE.max, 0, 8),
  /*
   * MEASURE the sky from the rendered frame rather than using the slider.
   *
   * A boolean is right here where it was wrong for motion: there is no viewer preference to defer
   * to, so "absent" and "off" really are the same statement. Off by default because it costs an
   * extra render pass and a readback per rebuild, and because a link should keep meaning what it
   * meant when it was made.
   */
  skyauto: boolField(false),
  bloom: numberField(0, 1, 0.35, 2),
  /*
   * THE OPTICAL TERMS, each as a multiple of the instrument's own amplitude. 0 is off, 1 is the
   * shipped instrument, 2 is twice as much.
   *
   * A multiplier rather than an amplitude because the amplitude has a home already
   * (`core/optics`), and a URL carrying `aureole=0.006` would be a second copy of a physical
   * constant — the failure this file's header is about. `aureole=0.5` says "half the instrument's
   * scattered light" and stays meaningful if that instrument is ever re-measured.
   *
   * ZERO NEEDS NO SEPARATE TOGGLE. Both terms fall out of the quad sizing on their own when their
   * peak drops below the display floor, so a strength of 0 removes them by the same route a faint
   * star takes. One control per effect instead of a checkbox and a slider that can disagree.
   */
  aureole: numberField(0, 2, 1, 2),
  spikes: numberField(0, 2, 1, 2),
  exposure: numberField(0.25, 4, 1, 2),
  minmass: numberField(0, 2, 0, 2),
  /*
   * Distance to the cluster centre [pc] — ladder rung 4, where theory becomes observation.
   *
   * Carried in PARSECS rather than in the slider's log units, so a shared link reads
   * `dist=136` and not `dist=2.13`. The page converts; the URL stays something a person can type
   * from a lecture note.
   */
  dist: numberField(DISTANCE_PC_RANGE.min, DISTANCE_PC_RANGE.max, D0_PC, 0),
  /*
   * MOTION IS TRI-STATE, and a boolean cannot say what a shared link needs to say.
   *
   *   auto  (default, omitted)  the VIEWER's `prefers-reduced-motion` decides
   *   on                        force motion — what a talk needs
   *   off                       force stillness
   *
   * A boolean conflates "unset" with "off", and the first version of this field was one. The
   * consequence was not theoretical: the URL writer recorded whatever the renderer happened to be
   * doing, and since drifting is ON unless the visitor reduces motion, every link came out
   * carrying `?spin` — which would then override the setting of anyone who had asked their system
   * for stillness. Exactly the harm the field existed to prevent, caused by its type.
   *
   * `auto` is the default, so a link stays silent about motion unless someone deliberately chose.
   */
  motion: enumField(["auto", "on", "off"], "auto"),
} as const satisfies Schema;



export type LabState = StateOf<typeof LAB_SCHEMA>;

/** The motion states, for a consumer that has to switch on them. */
export type MotionChoice = LabState["motion"];

/**
 * Query-string keys this schema does NOT own but a URL should keep.
 *
 * `stars`, `forceWebGL` and `project` are affordances rather than controls: they change the
 * population size, the render backend, and how the PAGE is laid out — none of which is part of
 * "what the image shows". A round trip that dropped them would make a shared debugging link
 * useless the moment it was copied back, which is the whole point of a debugging link.
 *
 * `project` earned its place here by failing without it: projector mode applied on load and then
 * vanished from the address bar at the first control change, so the link a talk depends on
 * survived exactly until someone touched a slider.
 */
export const PASSTHROUGH_KEYS = ["stars", "forceWebGL", "project"] as const;
