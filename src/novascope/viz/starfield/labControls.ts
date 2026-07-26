/*
 * labControls.ts — the lab's controls, as a module (Layer 2).
 *
 * The binding between three representations of one state: the QUERY STRING a link carries, the
 * DOM the visitor manipulates, and the `LabState` everything else consumes. It was 90 lines in
 * the middle of an 843-line inline `<script>`, where its pieces sat hundreds of lines from the
 * code that had to agree with them.
 *
 * ── WHY IT LEFT THE PAGE ──
 *
 * Not for line count. Two bugs in one week came from the same shape, and both were "a reader and
 * a writer of the same control, too far apart to see together":
 *
 *   - `?skyauto` decoded true and was immediately re-encoded false, because `readState` asked a
 *     checkbox that had been removed. The flag was dead and the probe unreachable, while the docs
 *     still described it.
 *   - the sky READOUT asked the same removed checkbox, so with `?skyauto` genuinely on the page
 *     ran the probe, subtracted its answer, and displayed "none".
 *
 * Both are the same class: A QUERY FOR AN ELEMENT THAT IS NOT THERE, which `?.value ?? fallback`
 * turns into a plausible wrong answer rather than an error. `assertControlsPresent` below makes
 * that class loud instead of silent — see its comment for why it runs only in dev.
 *
 * ── AND WHY IT IS A FACTORY ──
 *
 * `readState` and `syncUrl` need the decoded initial state (for fallbacks) and the passthrough
 * keys (so `?stars=` survives a round trip). Passing those once, at construction, is what stops
 * them being read from a module-level mutable — which is how a "current state" ends up with two
 * homes that disagree.
 */
import { encode } from "../../core/params/urlState.ts";
import { D0_PC } from "../../core/photometry/index.ts";
import { DEFAULT_LUPTON_DEPTH_MAG } from "../../core/imaging/lupton.ts";
import {
  LAB_SCHEMA,
  TRANSFER_AUTO,
  skyFractionFromSlider,
  sliderFromSkyFraction,
  type LabState,
  type MotionChoice,
} from "./labParams.ts";

/**
 * Every selector the controls bind to, in one list.
 *
 * ONE HOME FOR "WHICH ELEMENTS MUST EXIST". The markup and this module have to agree, and nothing
 * made them: removing a control from the page left every reader of it querying `null` forever,
 * silently taking its fallback. Listing them here lets one assertion check the whole set.
 */
export const CONTROL_SELECTORS = [
  "[data-instrument]",
  "[data-scheme]",
  "[data-band]",
  "[data-scaling]",
  "[data-depth]",
  "[data-curve]",
  "[data-sky]",
  "[data-bloom]",
  "[data-aureole]",
  "[data-spikes]",
  "[data-exposure]",
  "[data-min-mass]",
  "[data-dist]",
] as const;

/**
 * Controls that are DELIBERATELY absent, with the reason.
 *
 * `[data-sky-auto]` is the "measure the sky" checkbox. It is not in the markup because the probe
 * is not repeatable yet (its zero-fraction is unexplained), so the flag is reachable only as
 * `?skyauto`. Recording that here is the difference between a control that is missing on purpose
 * and one that was deleted and forgotten — which is exactly the pair of bugs this file exists to
 * prevent. Remove an entry when the control ships.
 */
export const INTENTIONALLY_ABSENT: Readonly<Record<string, string>> = {
  "[data-sky-auto]": "the sky probe is not repeatable yet; ?skyauto is the only way in",
};

export interface LabControls {
  /** A sky level as a percentage string, at a precision that survives the low end. */
  skyPercent(fraction: number): string;
  /** The sky slider's position, as the fraction of white it means. */
  readSky(): number;
  /** Whether the sky is MEASURED rather than chosen. */
  readSkyAuto(): boolean;
  /** Read one control's raw value, with a fallback for an absent element. */
  readValue(selector: string, fallback: string): string;
  /** Push a decoded state into the controls. */
  applyState(state: LabState): void;
  /** The controls' current state, for the URL and the renderer. */
  readState(motion: MotionChoice): LabState;
  /** Write the state to the address bar. */
  syncUrl(motion: MotionChoice): void;
}

/**
 * Fail loudly when a bound control is missing from the markup.
 *
 * DEV ONLY, and that is a deliberate trade rather than timidity. In production a missing control
 * means a stale cached page, where degrading to the fallback and rendering *something* beats a
 * blank screen. In development it means the markup and this module have diverged, which is a bug
 * that otherwise shows up weeks later as a URL parameter that silently stops working.
 *
 * Returns the offenders rather than throwing, so a caller can decide — the page logs them; a test
 * can assert on them.
 */
export function assertControlsPresent(root: ParentNode = document): string[] {
  const missing = CONTROL_SELECTORS.filter((sel) => root.querySelector(sel) === null);
  for (const sel of missing) {
    // eslint-disable-next-line no-console
    console.error(
      `[star-lab] control ${sel} is bound but not in the markup. ` +
        (INTENTIONALLY_ABSENT[sel]
          ? `If that is intended, it is recorded as: ${INTENTIONALLY_ABSENT[sel]}`
          : "Every reader of it will silently take its fallback."),
    );
  }
  return missing;
}

/**
 * Bind the controls.
 *
 * `initial` supplies the fallbacks — the decoded URL state, so a control the markup does not have
 * still reports what the link asked for rather than a made-up default. `passthrough` carries the
 * keys the schema does not own (`stars`, `forceWebGL`, `project`) through a round trip.
 */
export function createLabControls(
  initial: LabState,
  passthrough: Record<string, string>,
): LabControls {
  const q = <T extends Element>(selector: string): T | null =>
    document.querySelector<T>(selector);

  const setValue = (selector: string, value: string): void => {
    const el = q<HTMLInputElement | HTMLSelectElement>(selector);
    if (el) el.value = value;
  };

  const readValue = (selector: string, fallback: string): string =>
    q<HTMLInputElement | HTMLSelectElement>(selector)?.value ?? fallback;

  /*
   * SIGNIFICANT FIGURES, NOT FIXED DECIMALS. This is shown in three places and they had drifted to
   * two precisions, so the same number read differently depending on which produced it. At the low
   * end that mattered: useful settings start at 0.2% of white and the probe returns values near
   * 0.001%, both of which print as "0.00%" at two decimals.
   */
  const skyPercent = (fraction: number): string => {
    const s = (100 * fraction).toPrecision(fraction >= 0.001 ? 3 : 2);
    /* Trailing zeros only ever come off a fractional part. Stripping them from "100" would leave
     * "1", which the obvious one-line regex does — out of reach here, but not worth relying on. */
    return `${s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s}%`;
  };

  const readSky = (): number => skyFractionFromSlider(Number(readValue("[data-sky]", "0")));

  /*
   * FROM THE CHECKBOX IF ONE EXISTS, ELSE THE URL — one home, because the same bug happened twice.
   * A `?? false` against a removed element is not a default, it is a wrong answer: it killed the
   * `?skyauto` escape hatch AND made the readout say "none" while the probe's answer was being
   * subtracted from the picture on screen.
   */
  const readSkyAuto = (): boolean =>
    q<HTMLInputElement>("[data-sky-auto]")?.checked ?? initial.skyauto;

  /*
   * Push the decoded state into the controls BEFORE the renderer starts. Order matters: the
   * renderer's options are built by reading the DOM, so the DOM has to be the state first. One
   * code path writes, one reads — the alternative, passing state to the renderer AND setting the
   * controls separately, is two paths that can disagree, and the disagreement shows up as a link
   * whose picture does not match its own sliders.
   */
  const applyState = (s: LabState): void => {
    setValue("[data-instrument]", s.instrument);
    setValue("[data-scheme]", s.scheme);
    setValue("[data-band]", s.band);
    setValue("[data-scaling]", s.transfer === TRANSFER_AUTO ? "" : s.transfer);
    setValue("[data-depth]", String(s.depth));
    /* The URL carries the FRACTION; the widget carries its cubic position. Same split as `dist`. */
    setValue("[data-sky]", String(sliderFromSkyFraction(s.sky)));
    setValue("[data-dist]", String(Math.log10(s.dist)));
    setValue("[data-curve]", String(s.curve));
    const skyAutoEl = q<HTMLInputElement>("[data-sky-auto]");
    if (skyAutoEl) skyAutoEl.checked = s.skyauto;
    setValue("[data-bloom]", String(s.bloom));
    setValue("[data-aureole]", String(s.aureole));
    setValue("[data-spikes]", String(s.spikes));
    setValue("[data-exposure]", String(s.exposure));
    setValue("[data-min-mass]", String(s.minmass));
  };

  /*
   * `motion` is PASSED IN rather than read from the renderer, and that is the whole point of it
   * being tri-state: `lab.drifting` reports what the renderer is DOING, which is not what anyone
   * CHOSE. Recording the former put `?spin` on every link and would have overridden the setting of
   * a visitor who had asked their system for stillness.
   */
  const readState = (motion: MotionChoice): LabState => ({
    instrument: readValue("[data-instrument]", initial.instrument),
    scheme: readValue("[data-scheme]", initial.scheme),
    band: readValue("[data-band]", initial.band),
    transfer: readValue("[data-scaling]", "") || TRANSFER_AUTO,
    depth: Number(readValue("[data-depth]", String(initial.depth))),
    sky: readSky(),
    skyauto: readSkyAuto(),
    bloom: Number(readValue("[data-bloom]", String(initial.bloom))),
    aureole: Number(readValue("[data-aureole]", String(initial.aureole))),
    spikes: Number(readValue("[data-spikes]", String(initial.spikes))),
    exposure: Number(readValue("[data-exposure]", String(initial.exposure))),
    minmass: Number(readValue("[data-min-mass]", String(initial.minmass))),
    /*
     * ROUNDED TO WHOLE PARSECS on the way into the URL. The slider is logarithmic and its raw
     * value carries more precision than the distance is known to; `dist=136` is a link someone can
     * read and retype from a lecture note, `dist=136.4782` is machine exhaust.
     */
    dist: Math.round(10 ** Number(readValue("[data-dist]", String(Math.log10(D0_PC))))),
    curve: Number(readValue("[data-curve]", String(DEFAULT_LUPTON_DEPTH_MAG))),
    motion,
  });

  /*
   * `replaceState`, not `pushState`: a slider drag would otherwise stack one history entry per
   * frame and make the back button unusable. The URL is a live description of the state, not a
   * trail through it.
   */
  const syncUrl = (motion: MotionChoice): void => {
    const query = encode(LAB_SCHEMA, readState(motion), passthrough);
    history.replaceState(null, "", query === "" ? location.pathname : `?${query}`);
  };

  return { skyPercent, readSky, readSkyAuto, readValue, applyState, readState, syncUrl };
}
