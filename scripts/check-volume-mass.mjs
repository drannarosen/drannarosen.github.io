/*
 * check-volume-mass.mjs — the density cubes must still mean Msun/pc^3.
 *
 * ── WHY THIS EXISTS ──
 *
 * `meta.json` records `volume_encoding` as "uint8 log10(rho) rescaled 0..255, C-order (i,j,k), cube
 * of side box_pc" and stops. It never says what rho is IN. That was survivable while the cube was
 * only ever a picture — a display colorbar windows to a floor and a max and never needs an
 * absolute unit — and it stops being survivable the moment optical depth is computed from it,
 * because tau = INTEGRAL kappa rho dl does need one.
 *
 * The unit is recoverable rather than declarable: decode each cube, integrate over the box, and
 * compare against `env_m_cloud_actual_msun`. It closes in Msun/pc^3. This gate is what keeps that
 * true, because it is now a load-bearing assumption of the illumination and nothing else states it.
 *
 * ── WHAT IS BOUNDED, AND WHY NOT THE OBVIOUS NUMBER ──
 *
 * NOT the raw closure ratio. Measured across the six shipped realizations it runs 0.9991 to 1.0974
 * and tracks Mach number, because everything below `volume_log_min` is clamped UP to the floor
 * rather than to zero, and 70-87% of cells sit outside the truncated cloud:
 *
 *   name                 mach   ratio %cells@floor %mass@floor  ratio_excl_floor
 *   diffuse               3.8  0.9991        70.28        2.54            0.9737
 *   orion                13.1  1.0326        78.66        5.92            0.9714
 *   compact              32.8  1.0974        86.74       11.71            0.9689
 *   orion-solenoidal     13.1  1.0168        74.93        4.33            0.9727
 *   orion-compressive    13.1  1.0767        84.93        9.98            0.9692
 *   orion-shallow        13.1  1.0141        75.38        4.07            0.9728
 *
 * That floor mass is fictitious and grows with the density contrast: a wider lognormal puts more
 * volume in deep voids, which then get floored. Excluding it leaves 0.969-0.974 across a factor of
 * NINE in Mach — a 0.5% spread, which is the signature of the 128^3 grid under-integrating a cuspy
 * EFF profile. A resolution effect, expected, and tight enough to bound.
 *
 * So the bound is on `ratio_excl_floor`. It also SURVIVES THE REPAIR, which matters more than
 * tightness — a gate that fails once you fix the bug it was watching is a gate people delete. If
 * the exporter gains a zero sentinel, `v === 0` still means empty; if it widens the log window
 * instead, those cells decode to negligible density and excluding them changes nothing.
 *
 * The floor mass itself is REPORTED rather than bounded, so the export defect stays visible until
 * it is fixed instead of being silently normalised away.
 */
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../public/data/gravoturb/", import.meta.url));

/** Bounds on the floor-excluded closure. Measured 0.9689-0.9737; these sit well outside. */
const CLOSURE = { min: 0.96, max: 0.98 };

const r = { failures: 0 };
const ok = (cond, msg) => {
  console.log(`  ${cond ? "ok  " : "FAIL"}  ${msg}`);
  if (!cond) r.failures++;
};

console.log("volume mass closure (the cubes must still mean Msun/pc^3):");

const manifest = JSON.parse(readFileSync(`${root}manifest.json`, "utf8"));
let checked = 0;

for (const real of manifest.realizations) {
  const dir = real.path === "/data/gravoturb" ? root : `${root}${real.name}/`;
  const metaPath = `${dir}meta.json`;
  const volPath = `${dir}volume.u8`;
  if (!existsSync(metaPath) || !existsSync(volPath)) {
    ok(false, `${real.name}: missing meta.json or volume.u8 at ${dir}`);
    continue;
  }
  const meta = JSON.parse(readFileSync(metaPath, "utf8"));
  const vol = new Uint8Array(readFileSync(volPath).buffer.slice(0));
  const { volume_log_min: lo, volume_log_max: hi, volume_ngrid: ng, box_pc: box } = meta;
  const mCloud = meta.env_m_cloud_actual_msun;

  if (vol.length !== ng ** 3) {
    ok(false, `${real.name}: volume.u8 is ${vol.length} bytes, expected ${ng}^3 = ${ng ** 3}`);
    continue;
  }

  const cell = (box / ng) ** 3;
  const span = hi - lo;
  /* One exp per DISTINCT byte, not per cell: 256 values against 2.1M cells. */
  const rhoFor = new Float64Array(256);
  for (let b = 0; b < 256; b++) rhoFor[b] = 10 ** (lo + (b / 255) * span);

  let total = 0;
  let floorMass = 0;
  let floorCells = 0;
  for (let i = 0; i < vol.length; i++) {
    const rho = rhoFor[vol[i]];
    total += rho;
    if (vol[i] === 0) {
      floorMass += rho;
      floorCells++;
    }
  }
  total *= cell;
  floorMass *= cell;

  const ratio = total / mCloud;
  const exclFloor = (total - floorMass) / mCloud;
  const pctCells = (100 * floorCells) / vol.length;
  const pctMass = (100 * floorMass) / total;

  ok(
    exclFloor >= CLOSURE.min && exclFloor <= CLOSURE.max,
    `${real.name.padEnd(18)} closure(excl. floor) ${exclFloor.toFixed(4)} in ` +
      `[${CLOSURE.min}, ${CLOSURE.max}]  (raw ${ratio.toFixed(4)})`,
  );
  /* Reported, never bounded — see the header. This is the export defect, kept visible. */
  console.log(
    `        floor: ${pctCells.toFixed(1)}% of cells carrying ${pctMass.toFixed(1)}% of the ` +
      `integrated mass, all of it fictitious`,
  );
  checked++;
}

/* Guards a vacuous pass: an empty manifest agrees with every bound perfectly. */
ok(checked >= 6, `every shipped realization was checked (${checked})`);

if (r.failures) {
  console.error(
    `\n✗ volume mass closure — ${r.failures} failure(s).\n` +
      "  If the export changed deliberately, re-derive the bound from the new cubes and say so;\n" +
      "  the illumination reads rho as Msun/pc^3 and nothing else states that.",
  );
  process.exit(1);
}
console.log("\n✓ volume mass closure ok — rho is Msun/pc^3 across every realization");
