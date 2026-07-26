/*
 * check-lab-field.mjs — a lab URL and the page must describe the SAME image.
 *
 * WHAT THIS PROTECTS. The lab's state lives entirely in its query string, which is what makes a
 * shared link reproduce a picture and what makes a measurement checkable. That only holds while
 * there is ONE translation from state to render options. There were two — the page built them
 * inline from the DOM, and anything measuring the page rebuilt the mapping by hand — and the
 * second one was wrong in a way nothing could catch: it passed `instrument: "rubin"` to
 * `prepareStarField`, which has no such option, so the value was dropped and the field came back
 * in POPULATION mode. A full analysis of photometric colour ran on a temperature ramp. Every
 * number was self-consistent; one of them was nearly reported as a renderer bug.
 *
 * A typo'd option name is an excess-property error only for object LITERALS, so a structural type
 * cannot catch this. What can is having one mapping and asserting what comes out of it.
 */
import {
  fieldFromLabUrl,
  labStateFromUrl,
  assertLabField,
  LAB_DEFAULT_STAR_COUNT,
} from "../src/novascope/viz/starfield/labField.ts";
import { labStateToPrepareOptions, LAB_SCHEMA } from "../src/novascope/viz/starfield/labParams.ts";
import { decode } from "../src/novascope/core/params/urlState.ts";
import { INSTRUMENTS } from "../src/novascope/core/photometry/instruments.ts";

let failures = 0;
const ok = (cond, msg) => {
  console.log(`  ${cond ? "ok  " : "FAIL"}  ${msg}`);
  if (!cond) failures++;
};

console.log("lab-field (a URL and the page describe the same image):");

/* ── 1. THE MODE, which is the one that actually went wrong ── */
console.log("\n  colour mode follows the instrument, and nothing else:");
{
  const pop = fieldFromLabUrl("?depth=16", { count: 400 });
  ok(pop.stats.colorMode === "population", 'no instrument -> "population" (a temperature ramp)');

  for (const inst of INSTRUMENTS) {
    const f = fieldFromLabUrl(`?instrument=${inst.id}&depth=16`, { count: 400 });
    if (f.stats.colorMode !== "photometric") {
      ok(false, `instrument=${inst.id} came back ${f.stats.colorMode}`);
    }
  }
  ok(true, `all ${INSTRUMENTS.length} instruments produce a PHOTOMETRIC field`);

  /*
   * THE DYNAMIC RANGE IS THE TELL, and it is what makes this more than a label check. Population
   * mode carries an already-compressed amplitude (hue times an asinh signal) while photometric
   * carries linear band flux, so the two differ by orders of magnitude in spread. That is exactly
   * the symptom that was nearly filed as a bug: 1.71 magnitudes where the population spans ~20.
   */
  const range = (f) => {
    let lo = Infinity;
    let hi = 0;
    for (let i = 0; i < f.count; i++) {
      const v = (f.bandFlux[i * 3] + f.bandFlux[i * 3 + 1] + f.bandFlux[i * 3 + 2]) / 3;
      if (v > 0) {
        lo = Math.min(lo, v);
        hi = Math.max(hi, v);
      }
    }
    return hi > 0 && lo < Infinity ? -2.5 * Math.log10(lo / hi) : 0;
  };
  const phot = fieldFromLabUrl("?instrument=rubin&depth=24", { count: 400 });
  const popRange = range(pop);
  const photRange = range(phot);
  ok(
    photRange > 3 * popRange,
    `photometric spans ${photRange.toFixed(1)} mag against population's ${popRange.toFixed(1)} — ` +
      "the two modes are distinguishable by their SPREAD, not just by a label",
  );
}

/* ── 2. THE ASSERTION ITSELF HAS TEETH ── */
console.log("\n  the mismatch check fails when it should:");
{
  const state = labStateFromUrl("?instrument=rubin&depth=16");
  const wrong = fieldFromLabUrl("?depth=16", { count: 200 }); // population field…
  let threw = false;
  try {
    assertLabField(wrong, state); // …asserted against a photometric URL
  } catch {
    threw = true;
  }
  ok(threw, "a population field asserted against a photometric URL throws");

  let ok2 = true;
  try {
    assertLabField(fieldFromLabUrl("?instrument=rubin&depth=16", { count: 200 }), state);
  } catch {
    ok2 = false;
  }
  ok(ok2, "…and the matching pair does not");
}

/* ── 3. EVERY SCHEMA FIELD REACHES THE OPTIONS ── */
/*
 * Not a restatement of the mapping: this asserts that CHANGING each control changes the options
 * object. A field that is silently dropped — the whole failure mode — produces an identical
 * object, and that is what this catches.
 */
console.log("\n  every control reaches prepare:");
{
  const base = decode(LAB_SCHEMA, "");
  const baseOpts = JSON.stringify(labStateToPrepareOptions(base));
  const probes = {
    instrument: "rubin",
    scheme: "blackbody",
    band: "V",
    transfer: "agx",
    depth: 12,
    curve: 12,
    sky: 0.01,
    skyauto: true,
    bloom: 0.9,
    aureole: 0,
    spikes: 0,
    exposure: 2,
    minmass: 1,
    dist: 1200,
  };
  for (const [key, value] of Object.entries(probes)) {
    const changed = JSON.stringify(labStateToPrepareOptions({ ...base, [key]: value }));
    if (changed === baseOpts) ok(false, `changing "${key}" did not change the render options`);
  }
  ok(true, `all ${Object.keys(probes).length} controls change what prepare receives`);
  /*
   * `band` is the exception worth naming rather than skipping: an instrument overrides it, so it
   * only has an effect in population mode. Asserting that explicitly stops someone "fixing" the
   * loop above by always passing the control's value, which would make a composite's brightness
   * band depend on a control the page hides.
   */
  const withInst = labStateToPrepareOptions({ ...base, instrument: "rubin", band: "V" });
  ok(
    withInst.band === "LSST_r",
    `an instrument overrides the band control (got "${withInst.band}", not "V")`,
  );
}

/* ── 4. THE STAR COUNT MATCHES THE PAGE'S OWN DEFAULT ── */
/*
 * A measurement at a different population size is not comparable to the rendered frame: the summed
 * sky and the white point both move with it. `initStarLab` owns this default and does not export
 * it, so this is the gate that keeps the copy honest.
 */
console.log("\n  the default population matches the page:");
{
  const src = await import("node:fs").then((fs) =>
    fs.readFileSync("src/novascope/viz/starfield/scene.ts", "utf8"),
  );
  const m = src.match(/target:\s*opts\.count\s*\?\?\s*([\d_]+)/);
  const pageDefault = m ? Number(m[1].replace(/_/g, "")) : NaN;
  ok(
    pageDefault === LAB_DEFAULT_STAR_COUNT,
    `scene.ts renders ${pageDefault.toLocaleString()} stars by default and labField says ${LAB_DEFAULT_STAR_COUNT.toLocaleString()}`,
  );
}

if (failures) {
  console.error(`\n✗ lab-field — ${failures} failure(s)`);
  process.exit(1);
}
console.log("\n✓ lab-field ok");
