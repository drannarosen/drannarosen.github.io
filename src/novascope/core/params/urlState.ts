/*
 * urlState.ts — controls in the query string, and back (Layer 0, pure).
 *
 * ADR 0012 committed to this and it has been outstanding since: "One canonical cluster =
 * (seed, params, t) … Reproducible and URL-shareable." This is the general half — a codec
 * between a query string and a typed state object. Each explorable supplies its own schema;
 * see `viz/starfield/labParams` for the star lab's.
 *
 * WHY IT EARNS ITS PLACE, given it is "just" query-string parsing. The star renderer is going
 * into a lecture theatre, a talk, and an open-source release, and each of those wants the same
 * thing from a different direction:
 *
 *   - a CLASS gets one link per concept, so the demo cannot be fumbled live
 *   - a TALK becomes a set of bookmarks rather than a sequence of slider drags
 *   - a FIGURE becomes reproducible, because the state that produced it is the address
 *   - a BUG REPORT from a stranger arrives as a URL that reproduces the state exactly
 *
 * Presets then need no machinery at all: a preset is a named URL.
 *
 * NO DOM. It takes and returns strings, so it is node-testable and `check:novascope` stays
 * green — the page owns `location` and `history`, this owns the meaning.
 *
 * ── TWO BEHAVIOURS THAT ARE DECISIONS, NOT DETAILS ──
 *
 * ONLY NON-DEFAULTS ARE WRITTEN. A freshly-loaded lab has a clean URL, and a shared link
 * carries exactly what was changed and nothing else. The alternative — writing every field —
 * produces a 300-character URL in which the one value that matters is invisible, and it also
 * freezes today's defaults into every old link, so improving a default would silently stop
 * reaching anyone who had bookmarked a page.
 *
 * A BAD VALUE DEGRADES, IT DOES NOT THROW. These links outlive the builds that made them: a
 * lecture bookmarked in September must still open in March, after a control has been renamed or
 * a range narrowed. So an unparseable value falls back to the default and an out-of-range number
 * is CLAMPED to the range rather than discarded — clamping keeps the direction of the intent,
 * which a fallback to the default would throw away. Unknown keys are ignored entirely, which is
 * what lets a URL survive a control being removed.
 */

/** The value kinds a control can hold. Deliberately narrow — no nested state in a URL. */
export type ParamValue = string | number | boolean;

export interface Field<T extends ParamValue = ParamValue> {
  /** The value used when the key is absent, unparseable, or equal to this. Never serialised. */
  readonly default: T;
  /** Parse a raw query value; `undefined` means "not valid", and the caller falls back. */
  parse(raw: string): T | undefined;
  /** Render a value for the query string. */
  format(value: T): string;
  /**
   * Write this field even when it equals the default.
   *
   * Escape hatch for a field whose EFFECTIVE default depends on another field, where "omit at
   * default" is not merely verbose but WRONG. The star lab's `depth` is one: it means a different
   * parameter in each colour mode and the page forces a different value for each, so a URL that
   * omitted 16 (the schema default, and population's) reopened in photometric mode at 8 — the
   * sender saw one picture and the recipient another, with nothing to signal it.
   *
   * Use sparingly. Every `alwaysWrite` field is in every link forever, and it also freezes that
   * value against a future improvement to the default. It is the right trade only when the field
   * is consequential enough that stating it is a feature.
   */
  readonly alwaysWrite?: boolean;
}

export type Schema = Readonly<Record<string, Field>>;

/** The state object a schema describes, with each field's own type preserved. */
export type StateOf<S extends Schema> = {
  [K in keyof S]: S[K] extends Field<infer T> ? T : never;
};

/**
 * A field constrained to a known set of strings.
 *
 * Takes the allowed values rather than trusting the string, so a URL naming a transfer that no
 * longer exists falls back instead of reaching the renderer — which would otherwise surface as
 * a shader that fails to build, three navigations later.
 */
export function enumField<T extends string>(
  allowed: readonly T[],
  fallback: T,
): Field<T> {
  const set: ReadonlySet<string> = new Set(allowed);
  return {
    default: fallback,
    parse: (raw) => (set.has(raw) ? (raw as T) : undefined),
    format: (v) => v,
  };
}

/**
 * A numeric field, clamped to `[min, max]`.
 *
 * `decimals` controls only how it is WRITTEN. A slider at 0.05 steps produces values like
 * 0.15000000000000002, and a URL carrying that reads as machine output rather than as a
 * setting someone chose; rounding on the way out keeps a shared link legible without the
 * rounding ever reaching the renderer.
 */
export function numberField(
  min: number,
  max: number,
  fallback: number,
  decimals = 4,
  alwaysWrite = false,
): Field<number> {
  const clamp = (v: number): number => (v < min ? min : v > max ? max : v);
  return {
    default: clamp(fallback),
    alwaysWrite,
    parse: (raw) => {
      const v = Number(raw);
      return Number.isFinite(v) ? clamp(v) : undefined;
    },
    // `Number()` strips the trailing zeros `toFixed` leaves, so 0.5 writes as "0.5" not "0.5000".
    format: (v) => String(Number(clamp(v).toFixed(decimals))),
  };
}

/**
 * A boolean field, written bare.
 *
 * `?spin` rather than `?spin=true`, because that is how a URL conventionally carries a flag and
 * it is what `?forceWebGL` already established on this page. Both spellings parse, so a
 * hand-typed `?spin=true` still works.
 */
export function boolField(fallback: boolean): Field<boolean> {
  return {
    default: fallback,
    parse: (raw) => (raw === "" || raw === "true" ? true : raw === "false" ? false : undefined),
    format: (v) => (v ? "" : "false"),
  };
}

/**
 * Read a query string into a full state object.
 *
 * Every key in the schema is present in the result, so a consumer never branches on absence —
 * "not in the URL" and "at its default" are the same statement, which is exactly what makes the
 * omit-defaults rule safe.
 */
export function decode<S extends Schema>(schema: S, search: string): StateOf<S> {
  const params = new URLSearchParams(search);
  const out: Record<string, ParamValue> = {};
  for (const [key, field] of Object.entries(schema)) {
    const raw = params.get(key);
    if (raw === null) {
      out[key] = field.default;
      continue;
    }
    const parsed = field.parse(raw);
    out[key] = parsed === undefined ? field.default : parsed;
  }
  return out as StateOf<S>;
}

/**
 * Write a state object as a query string, omitting anything at its default.
 *
 * Returns a bare string with no leading "?" — the caller decides, since an empty result must
 * produce a URL with no "?" at all rather than a trailing one.
 *
 * `extra` carries keys the schema does not own but the URL should keep, which is what stops this
 * from eating `?forceWebGL` and `?stars=` — those are harness affordances rather than controls,
 * and a round trip that silently dropped them would make a shared debugging link useless.
 */
export function encode<S extends Schema>(
  schema: S,
  state: StateOf<S>,
  extra: Readonly<Record<string, string>> = {},
): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(extra)) params.set(key, value);
  for (const [key, field] of Object.entries(schema)) {
    const value = state[key as keyof StateOf<S>] as ParamValue;
    if (value === field.default && field.alwaysWrite !== true) continue;
    params.set(key, field.format(value));
  }
  // URLSearchParams writes a bare flag as "spin=", so the "=" is stripped back off.
  return params.toString().replace(/=(?=&|$)/g, "");
}
