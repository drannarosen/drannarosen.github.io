/*
 * check-cluster.mjs — a build gate for the canonical cluster sampler
 * (src/novascope/core/cluster). Validates the invariants Architecture §9.3
 * promises, so a refactor can't silently break reproducibility or the physics:
 *
 *   1. Determinism      — same identity ⇒ identical population.
 *   2. Sub-stream indep. — growing the star COUNT leaves the earlier stars
 *                          byte-identical (mass/position sub-streams don't
 *                          reshuffle when another quantity's count changes).
 *   3. Physical sanity   — masses in-bounds; Plummer half-mass radius ≈ 1.305 a.
 *
 * Self-consistent checks (no external fixture needed): the invariants hold by
 * construction, so this pins them against regressions.
 */
import {
  defaultIdentity,
  sampleCluster,
  PLUMMER_RH_OVER_A,
} from "../src/novascope/core/cluster/index.ts";

let failures = 0;
const ok = (cond, msg) => {
  console.log(`  ${cond ? "ok  " : "FAIL"}  ${msg}`);
  if (!cond) failures++;
};

console.log("cluster sampler invariants:");

// 1. Determinism.
const idA = defaultIdentity({ seed: 123, sampling: { mode: "count", target: 500 } });
const s1 = sampleCluster(idA);
const s2 = sampleCluster(idA);
ok(JSON.stringify(s1) === JSON.stringify(s2), "same identity ⇒ identical population");

// 2. Sub-stream independence: first N stars stable as the count grows.
const id800 = defaultIdentity({ seed: 77, sampling: { mode: "count", target: 800 } });
const id1600 = defaultIdentity({ seed: 77, sampling: { mode: "count", target: 1600 } });
const a800 = sampleCluster(id800);
const b1600 = sampleCluster(id1600);
ok(a800.length === 800 && b1600.length === 1600, "count mode yields the requested N");
ok(
  JSON.stringify(a800) === JSON.stringify(b1600.slice(0, 800)),
  "growing the count leaves the first 800 stars byte-identical (§9.3)",
);

// 3. Physical sanity on a large draw.
const big = defaultIdentity({
  seed: 5,
  sampling: { mode: "count", target: 20000 },
  imf: { mMin: 0.1, mMax: 100, alphaHigh: 2.3 },
  profile: { kind: "plummer", scaleRadius: 1 },
});
const stars = sampleCluster(big);
const inBounds = stars.every((s) => s.mass >= 0.1 - 1e-9 && s.mass <= 100 + 1e-9);
ok(inBounds, "every mass within [mMin, mMax]");
ok(
  stars.every((s) => Number.isFinite(s.x) && Number.isFinite(s.y) && Number.isFinite(s.z)),
  "all positions finite (3-D)",
);

// Half-mass radius: positions are mass-independent in Plummer, so half-mass ≈
// half-number ≈ 1.305 a. Sort by radius, find where cumulative mass hits 50%.
const totalMass = stars.reduce((t, s) => t + s.mass, 0);
const byR = stars
  .map((s) => ({ r: Math.hypot(s.x, s.y, s.z), m: s.mass }))
  .sort((p, q) => p.r - q.r);
let cum = 0;
let rHalf = 0;
for (const { r, m } of byR) {
  cum += m;
  if (cum >= 0.5 * totalMass) {
    rHalf = r;
    break;
  }
}
const ratio = rHalf / big.profile.scaleRadius;
ok(
  Math.abs(ratio - PLUMMER_RH_OVER_A) < 0.15,
  `Plummer half-mass radius ≈ ${PLUMMER_RH_OVER_A} a (got ${ratio.toFixed(3)} a)`,
);

// 4. Mass segregation (McLuster/Küpper via progenax): λ=1 pins massive stars to
// small radii (mass↔radius anti-correlated); λ=0 is random (≈0 correlation).
const spearman = (stars) => {
  const n = stars.length;
  const rank = (key) => {
    const order = [...stars.keys()].sort((a, b) => key(stars[a]) - key(stars[b]));
    const r = new Array(n);
    order.forEach((idx, i) => (r[idx] = i));
    return r;
  };
  const rm = rank((s) => s.mass);
  const rr = rank((s) => Math.hypot(s.x, s.y, s.z));
  const mean = (n - 1) / 2;
  let cov = 0;
  let vm = 0;
  let vr = 0;
  for (let i = 0; i < n; i++) {
    cov += (rm[i] - mean) * (rr[i] - mean);
    vm += (rm[i] - mean) ** 2;
    vr += (rr[i] - mean) ** 2;
  }
  return cov / Math.sqrt(vm * vr);
};
const base = { seed: 4, sampling: { mode: "count", target: 1500 }, profile: { kind: "plummer", scaleRadius: 1 } };
const segFull = spearman(sampleCluster(defaultIdentity({ ...base, segregation: 1 })));
const segNone = spearman(sampleCluster(defaultIdentity({ ...base, segregation: 0 })));
ok(segFull < -0.9, `λ=1 → massive stars in the core (mass–radius corr ${segFull.toFixed(3)} ≈ −1)`);
ok(Math.abs(segNone) < 0.15, `λ=0 → random pairing (mass–radius corr ${segNone.toFixed(3)} ≈ 0)`);

if (failures) {
  console.error(`\n[cluster] ${failures} invariant(s) FAILED.`);
  process.exit(1);
}
console.log("\n[cluster] ok — determinism, sub-stream independence, and Plummer physics hold.");
