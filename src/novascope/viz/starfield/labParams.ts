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
  enumField,
  numberField,
  type Schema,
  type StateOf,
} from "../../core/params/urlState.ts";
import { TRANSFER_IDS } from "../../core/imaging/transfers.ts";
import { INSTRUMENTS } from "../../core/photometry/instruments.ts";
import { COLOR_SCHEMES } from "../../core/colorimetry/schemes.ts";
import { PASSBANDS } from "../../core/photometry/passbands.ts";
import {
  DEPTH_MAG_RANGE,
  DEFAULT_POPULATION_DEPTH_MAG,
} from "../../core/imaging/lupton.ts";

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
  band: enumField(BAND_IDS, "V"),
  transfer: enumField([TRANSFER_AUTO, ...TRANSFER_IDS], TRANSFER_AUTO),
  /*
   * ALWAYS WRITTEN — see `alwaysWrite`. Omitting it at the schema default is not merely verbose
   * here, it is wrong: a photometric link sitting at 16 (population's default) omitted `depth`
   * and REOPENED AT 8, because the page forces the mode's own default when the URL is silent.
   * Measured, not theorised — the sender's picture and the recipient's differed, silently.
   */
  depth: numberField(DEPTH_MAG_RANGE.min, DEPTH_MAG_RANGE.max, DEFAULT_POPULATION_DEPTH_MAG, 2, true),
  sky: numberField(0, 0.05, 0, 4),
  bloom: numberField(0, 1, 0.35, 2),
  exposure: numberField(0.25, 4, 1, 2),
  minmass: numberField(0, 2, 0, 2),
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
 * `stars` and `forceWebGL` are harness affordances rather than controls — they change the
 * population size and the render backend, which are not part of "what the image shows". A
 * round trip that dropped them would make a shared debugging link useless the moment it was
 * copied back, which is the whole point of a debugging link.
 */
export const PASSTHROUGH_KEYS = ["stars", "forceWebGL"] as const;
