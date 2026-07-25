/*
 * check-url-state.mjs — the URL codec, and the star lab's schema on top of it.
 *
 * WHY THIS IS GATED RATHER THAN EYEBALLED. These links are meant to outlive the builds that
 * made them: a lecture bookmarked in September has to open in March, a talk is a set of
 * bookmarks that cannot be fumbled live, and an open-source bug report arrives as a URL that
 * must reproduce a state. Every one of those promises is a round-trip property, and every one
 * of them fails silently — a dropped field does not throw, it just shows the wrong picture.
 *
 * The two behaviours most worth pinning are the ones that are DECISIONS rather than mechanics:
 * defaults are omitted (so a shared link carries only what changed, and improving a default
 * still reaches old links), and a bad value degrades instead of throwing (so a stale bookmark
 * opens rather than breaking in front of a class).
 */
import {
  decode,
  encode,
  enumField,
  numberField,
  boolField,
} from "../src/novascope/core/params/urlState.ts";
import {
  LAB_SCHEMA,
  PASSTHROUGH_KEYS,
  POPULATION_ID,
} from "../src/novascope/viz/starfield/labParams.ts";
import { TRANSFER_IDS } from "../src/novascope/core/imaging/transfers.ts";
import { INSTRUMENTS } from "../src/novascope/core/photometry/instruments.ts";
import { COLOR_SCHEMES } from "../src/novascope/core/colorimetry/schemes.ts";
import { DEPTH_MAG_RANGE } from "../src/novascope/core/imaging/lupton.ts";

let failures = 0;
const ok = (cond, msg) => {
  console.log(`  ${cond ? "ok  " : "FAIL"}  ${msg}`);
  if (!cond) failures++;
};

console.log("url-state (controls in the query string, and back):");

/* ── 1. THE CODEC ── */
console.log("\n  codec:");
{
  const schema = {
    mode: enumField(["a", "b", "c"], "a"),
    gain: numberField(0, 10, 2, 2),
    flag: boolField(false),
  };

  const d0 = decode(schema, "");
  ok(
    d0.mode === "a" && d0.gain === 2 && d0.flag === false,
    "an empty query decodes to every default",
  );
  ok(
    Object.keys(d0).length === Object.keys(schema).length,
    "…and every key is present, so a consumer never branches on absence",
  );

  ok(encode(schema, d0) === "", "a state at its defaults encodes to the EMPTY string");
  ok(
    encode(schema, { ...d0, gain: 5 }) === "gain=5",
    "…and only the changed field is written",
  );

  const rt = decode(schema, encode(schema, { mode: "c", gain: 7.5, flag: true }));
  ok(rt.mode === "c" && rt.gain === 7.5 && rt.flag === true, "a full round trip is lossless");

  ok(encode(schema, { ...d0, flag: true }) === "flag", "a boolean writes bare, as ?flag");
  ok(decode(schema, "flag").flag === true, "…and reads back bare");
  ok(decode(schema, "flag=true").flag === true, "…and a hand-typed ?flag=true also works");
  ok(decode(schema, "flag=false").flag === false, "…and ?flag=false is honoured, not ignored");

  /* Degradation — the property that keeps a stale bookmark opening. */
  ok(decode(schema, "mode=nonsense").mode === "a", "an unknown enum value falls back to the default");
  ok(decode(schema, "gain=banana").gain === 2, "an unparseable number falls back to the default");
  ok(decode(schema, "gain=999").gain === 10, "an over-range number CLAMPS, keeping the intent's direction");
  ok(decode(schema, "gain=-5").gain === 0, "…and an under-range one clamps too");
  ok(decode(schema, "whoIsThis=42").mode === "a", "an unknown key is ignored rather than throwing");

  /* Float noise. A slider at 0.05 steps produces 0.15000000000000002; a URL should not. */
  ok(
    encode(schema, { ...d0, gain: 0.1 + 0.2 }) === "gain=0.3",
    "float noise is rounded on the way out (0.1+0.2 writes as 0.3)",
  );
  ok(
    encode(schema, { ...d0, gain: 2.5 }) === "gain=2.5",
    "…without leaving trailing zeros",
  );

  /* Passthrough — what stops the codec eating ?stars= and ?forceWebGL. */
  const withExtra = encode(schema, { ...d0, gain: 5 }, { stars: "1500" });
  ok(
    withExtra.includes("stars=1500") && withExtra.includes("gain=5"),
    "extra keys survive an encode alongside the schema's own",
  );
}

/* ── 2. THE SCHEMA MATCHES THE REGISTRIES ── */
console.log("\n  the lab schema is derived, not listed:");
{
  const s = decode(LAB_SCHEMA, "");
  ok(s.instrument === POPULATION_ID, `instrument defaults to "${POPULATION_ID}"`);
  /* Defaults changed 2026-07-25 on Anna's judgement of the rendered images — asserted so the
   * change is deliberate and a future edit has to mean it. */
  ok(s.transfer === "asinh", 'transfer defaults to "asinh" in both modes');
  ok(s.band === "bolometric", 'band defaults to "bolometric" — total light, not an instrument');
  ok(
    s.depth === DEPTH_MAG_RANGE.max,
    `depth defaults to the maximum (${DEPTH_MAG_RANGE.max} mag) so every star clears the floor`,
  );
  /*
   * MOTION IS TRI-STATE, and this is the assertion that keeps it that way. A boolean here
   * conflated "unset" with "off", so the URL writer recorded whatever the renderer happened to be
   * doing — putting `?spin` on every link, which would then override the setting of a visitor who
   * had asked their system for stillness.
   */
  ok(s.motion === "auto", 'motion defaults to "auto" — the VIEWER\'s prefers-reduced-motion decides');
  /*
   * Asserts MOTION's absence specifically, not that the whole query is empty — `depth` is
   * alwaysWrite, so an empty-query test would be testing two unrelated things at once and would
   * fail for the wrong reason. It did, which is how this comment came to exist.
   */
  ok(
    !encode(LAB_SCHEMA, s).includes("motion"),
    "…so a link stays silent about motion unless someone deliberately chose",
  );
  ok(
    decode(LAB_SCHEMA, "motion=on").motion === "on" && decode(LAB_SCHEMA, "motion=off").motion === "off",
    "…and BOTH overrides are expressible, which a boolean could not do",
  );

  /*
   * EVERY registry value must be reachable through the URL. This is the check that catches a
   * new transfer, instrument or scheme being added and the schema quietly not offering it —
   * which would look like a working page with an option that silently does nothing.
   */
  for (const id of TRANSFER_IDS) {
    const got = decode(LAB_SCHEMA, `transfer=${id}`).transfer;
    if (got !== id) ok(false, `transfer=${id} did not survive the round trip (got ${got})`);
  }
  ok(true, `all ${TRANSFER_IDS.length} transfers are reachable through ?transfer=`);

  for (const i of INSTRUMENTS) {
    const got = decode(LAB_SCHEMA, `instrument=${i.id}`).instrument;
    if (got !== i.id) ok(false, `instrument=${i.id} did not survive (got ${got})`);
  }
  ok(true, `all ${INSTRUMENTS.length} instruments are reachable, plus "${POPULATION_ID}"`);

  for (const c of COLOR_SCHEMES) {
    const got = decode(LAB_SCHEMA, `scheme=${c.id}`).scheme;
    if (got !== c.id) ok(false, `scheme=${c.id} did not survive (got ${got})`);
  }
  ok(true, `all ${COLOR_SCHEMES.length} colour schemes are reachable`);

  /* The depth bounds are IMPORTED, not restated — a restated range is what caused the depth bug. */
  ok(
    decode(LAB_SCHEMA, `depth=${DEPTH_MAG_RANGE.min - 5}`).depth === DEPTH_MAG_RANGE.min,
    `depth clamps to DEPTH_MAG_RANGE.min (${DEPTH_MAG_RANGE.min})`,
  );
  ok(
    decode(LAB_SCHEMA, `depth=${DEPTH_MAG_RANGE.max + 5}`).depth === DEPTH_MAG_RANGE.max,
    `…and to DEPTH_MAG_RANGE.max (${DEPTH_MAG_RANGE.max})`,
  );
}

/* ── 2b. THE MODE-DEPENDENT DEFAULT, which broke the round trip ── */
/*
 * A REGRESSION TEST FOR A MEASURED LIE. `depth` means a different parameter in each colour mode,
 * and the page forces the mode's own default when the URL is silent. So omitting it at the SCHEMA
 * default (16, which is population's) produced a photometric link that reopened at 8: the sender
 * saw one picture and the recipient another, with nothing to signal it. Caught in a browser, not
 * by reading — the codec round-tripped perfectly on its own terms.
 *
 * The fix is `alwaysWrite`, and this is what stops someone "tidying" it away later.
 */
console.log("\n  depth is always written (a field whose default depends on the mode cannot be omitted):");
{
  const atDefault = decode(LAB_SCHEMA, "");
  const q = encode(LAB_SCHEMA, atDefault);
  ok(q === `depth=${LAB_SCHEMA.depth.default}`, `an otherwise-default state still carries depth: "${q}"`);
  ok(LAB_SCHEMA.depth.alwaysWrite === true, "…because the field is marked alwaysWrite");
  ok(
    decode(LAB_SCHEMA, encode(LAB_SCHEMA, { ...atDefault, instrument: "rubin" })).depth ===
      atDefault.depth,
    "a PHOTOMETRIC link at the population default survives the round trip — the case that lied",
  );
  /* And no other field acquired the flag by accident, which would bloat every link. */
  const always = Object.entries(LAB_SCHEMA).filter(([, f]) => f.alwaysWrite === true).map(([k]) => k);
  ok(
    always.length === 1 && always[0] === "depth",
    `exactly one field is alwaysWrite (${always.join(", ") || "none"}) — it is an escape hatch, not a habit`,
  );
}

/* ── 3. A REALISTIC LINK ── */
console.log("\n  a link of the kind a lecture would use:");
{
  const state = {
    ...decode(LAB_SCHEMA, ""),
    instrument: "rubin",
    transfer: "agx",
    depth: 8,
    sky: 0.002,
  };
  const q = encode(LAB_SCHEMA, state, { stars: "1500" });
  ok(q.length < 90, `stays short and readable: ?${q}`);
  const back = decode(LAB_SCHEMA, q);
  ok(
    back.instrument === "rubin" && back.transfer === "agx" && back.depth === 8 && back.sky === 0.002,
    "…and every field survives the round trip",
  );
  ok(
    !q.includes("bloom") && !q.includes("exposure") && !q.includes("minmass"),
    "…while untouched controls stay out of it entirely (depth excepted, by design)",
  );
  for (const k of PASSTHROUGH_KEYS) {
    if (k === "stars") ok(q.includes("stars=1500"), `passthrough key "${k}" survives`);
  }
}

if (failures) {
  console.error(`\n✗ url-state — ${failures} failure(s)`);
  process.exit(1);
}
console.log("\n✓ url-state ok");
