#!/usr/bin/env node
/*
 * check-sun.mjs — validate the solar geometry behind the /now sky line.
 *
 * A wrong sun angle on an astronomer's page is worse than no sun angle, so
 * this checks the module against landmarks that are true by definition rather
 * than against a remembered number:
 *
 *   1. Declination at the solstices and equinoxes (±23.44°, 0°).
 *   2. Peak altitude on those days, which must equal 90° − |φ − δ|. This is
 *      the strongest test available offline: it ties declination, hour angle
 *      and the altitude formula together, and any sign error or bad sidereal
 *      rate breaks it.
 *   3. Round trip through hoursUntilDusk: evaluating the altitude at the
 *      returned time must give back the target altitude.
 *
 * Run: node --experimental-strip-types scripts/check-sun.mjs
 */

import { sunPosition, hoursUntilDusk, SAN_DIEGO } from "../src/lib/sunSanDiego.ts";

const problems = [];
const check = (label, actual, expected, tol) => {
  const off = Math.abs(actual - expected);
  const ok = off <= tol;
  console.log(
    `  ${ok ? "ok  " : "FAIL"}  ${label.padEnd(46)} ${actual.toFixed(3)} vs ${expected.toFixed(3)} (Δ ${off.toFixed(4)}, tol ${tol})`,
  );
  if (!ok) problems.push(label);
};

/* ── 1. declination at the quarter days ────────────────────────────────── */
console.log("\ndeclination at solstices and equinoxes:");
const QUARTERS = [
  { date: "2026-03-20T14:46:00Z", expect: 0, tol: 0.02, name: "March equinox" },
  { date: "2026-06-21T08:25:00Z", expect: 23.436, tol: 0.02, name: "June solstice" },
  { date: "2026-09-23T00:05:00Z", expect: 0, tol: 0.02, name: "September equinox" },
  { date: "2026-12-21T20:50:00Z", expect: -23.436, tol: 0.02, name: "December solstice" },
];
for (const q of QUARTERS) {
  check(q.name, sunPosition(new Date(q.date)).declinationDeg, q.expect, q.tol);
}

/* ── 2. peak altitude must equal 90 − |lat − dec| ──────────────────────── */
console.log("\npeak altitude over San Diego vs 90° − |φ − δ|:");
for (const q of QUARTERS) {
  const day = q.date.slice(0, 10);
  let best = { alt: -90, dec: 0 };
  // Sweep the day at one-minute steps and take the maximum.
  for (let m = 0; m < 1440; m++) {
    const t = new Date(`${day}T00:00:00Z`);
    t.setUTCMinutes(m);
    const p = sunPosition(t);
    if (p.altitudeDeg > best.alt) best = { alt: p.altitudeDeg, dec: p.declinationDeg };
  }
  const expected = 90 - Math.abs(SAN_DIEGO.latDeg - best.dec);
  check(`${q.name} noon altitude`, best.alt, expected, 0.02);
}

/* ── 3. hoursUntilDusk must land on the altitude it was asked for ──────── */
console.log("\nround trip through hoursUntilDusk:");
for (const target of [-0.833, -6, -12, -18]) {
  for (const day of ["2026-01-15", "2026-04-15", "2026-07-15", "2026-10-15"]) {
    const from = new Date(`${day}T19:00:00Z`); // ~noon local
    const hours = hoursUntilDusk(from, target);
    if (hours == null) {
      console.log(`  ok    ${target}° on ${day}: never reached (null)`);
      continue;
    }
    const at = new Date(from.getTime() + hours * 3_600_000);
    check(`${target}° on ${day} (+${hours.toFixed(2)} h)`, sunPosition(at).altitudeDeg, target, 0.05);
  }
}

if (problems.length > 0) {
  console.error(`\n[sun] ${problems.length} check(s) failed:\n  ${problems.join("\n  ")}\n`);
  process.exit(1);
}
console.log("\n[sun] ok — solar geometry matches its analytic landmarks\n");
