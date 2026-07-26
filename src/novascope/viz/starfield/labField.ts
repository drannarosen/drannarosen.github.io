/*
 * labField.ts — build the field a lab URL describes, without a browser (Layer 2).
 *
 * ── WHAT THIS IS FOR ──
 *
 * Answering "what is Anna actually looking at?" numerically. The lab's state lives entirely in its
 * query string, so a shared link fully determines the image; this turns that link into the same
 * `StarField` the page prepares, so a measurement and the rendered frame cannot describe different
 * configurations.
 *
 * ── WHY IT EXISTS: A MEASUREMENT THAT WAS SELF-CONSISTENT AND WRONG ──
 *
 * A script measured the colour statistics of a photometric image and reported them. It had passed
 * `instrument: "rubin"` to `prepareStarField`, which has no such option, so the value was dropped
 * on the floor and the field came back in POPULATION mode — a temperature ramp with an
 * already-compressed amplitude. Every number was internally consistent. One of them, a dynamic
 * range of 1.71 magnitudes where the population spans 19.8, was nearly reported as a serious bug
 * in the renderer.
 *
 * Nothing failed, because nothing could: a typo'd option name in a structural type is an excess
 * property only when the object is a literal, and it was not. The fix is not vigilance, it is to
 * remove the second mapping — `labStateToPrepareOptions` is now the only translation from lab
 * state to render options, and the page uses it too.
 *
 * ── AND THE MODE IS ASSERTED, NOT ASSUMED ──
 *
 * `assertLabField` re-derives the colour mode from the URL and compares it with what the field
 * came back as. That is deliberately redundant with the mapping above: the mapping is the thing
 * that could be wrong, so a check that trusts it would check nothing. This is what turns "I think
 * I measured the right image" into something that fails loudly.
 */
import { decode } from "../../core/params/urlState.ts";
import { LAB_SCHEMA, POPULATION_ID, labStateToPrepareOptions, type LabState } from "./labParams.ts";
import { clusterStarTable } from "./source.ts";
import { prepareStarField, type StarField } from "./prepare.ts";

/**
 * The lab's own default population size.
 *
 * IMPORTED IN SPIRIT, restated in fact, and the comment is the mitigation: `initStarLab` owns this
 * default and does not export it. A measurement taken at a different count is not comparable —
 * the summed sky and the white point both move with it — so the number matters and is asserted
 * against the page's behaviour in `check:lab-field` rather than trusted.
 */
export const LAB_DEFAULT_STAR_COUNT = 10_000;

export interface LabFieldOptions {
  /** Star count. Defaults to the lab's own, because that is what a shared link renders. */
  count?: number;
  /** Cluster seed, if a URL or caller pins one. */
  seed?: number;
}

/** Decode a lab query string to its full state — every field present, defaults filled. */
export function labStateFromUrl(search: string): LabState {
  return decode(LAB_SCHEMA, search);
}

/**
 * Build the field a lab URL describes.
 *
 * Accepts a full URL, a `?query=string`, or a bare query — whatever is to hand when copying a link
 * out of a browser, because a helper that demands one exact form is a helper people work around.
 */
export function fieldFromLabUrl(url: string, opts: LabFieldOptions = {}): StarField {
  const search = url.includes("?") ? url.slice(url.indexOf("?")) : url;
  const state = labStateFromUrl(search);
  const stars = clusterStarTable({
    ...(opts.seed !== undefined ? { seed: opts.seed } : {}),
    sampling: { mode: "count", target: opts.count ?? LAB_DEFAULT_STAR_COUNT },
  });
  const field = prepareStarField(stars, labStateToPrepareOptions(state));
  assertLabField(field, state);
  return field;
}

/**
 * Fail loudly if the field is not the one the URL asked for.
 *
 * Only the checks that a SILENTLY-DROPPED OPTION would break. Asserting every field would mostly
 * restate the mapping, and a check that mirrors its subject cannot catch the subject being wrong.
 * These three are the ones where a wrong value still produces a plausible image:
 *
 *   - `colorMode`, because population and photometric differ in what `bandFlux` even MEANS
 *     (compressed hue-times-signal against linear band flux), so every colour statistic changes
 *     meaning silently. This is the one that actually went wrong.
 *   - `scaling`, because the transfer decides the display floor, which decides what is visible.
 *   - `distancePc`, because it is the difference between absolute and apparent magnitude.
 */
export function assertLabField(field: StarField, state: LabState): void {
  const expectedMode = state.instrument === POPULATION_ID ? "population" : "photometric";
  if (field.stats.colorMode !== expectedMode) {
    throw new Error(
      `lab field mismatch: URL asks for instrument "${state.instrument}" (${expectedMode}) ` +
        `but the field came back ${field.stats.colorMode}. An option was dropped in translation.`,
    );
  }
  if (state.transfer !== "auto" && field.stats.scaling !== state.transfer) {
    throw new Error(
      `lab field mismatch: URL asks for transfer "${state.transfer}", field has "${field.stats.scaling}".`,
    );
  }
  if (Math.abs(field.stats.distancePc - state.dist) > 1e-6) {
    throw new Error(
      `lab field mismatch: URL asks for ${state.dist} pc, field has ${field.stats.distancePc} pc.`,
    );
  }
}
