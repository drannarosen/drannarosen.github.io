/*
 * check-render.mjs — build gate for the render-model selectors
 * (src/novascope/state/render.ts, Architecture §9.4). Validates that the ONE
 * physics→pixel mapping is well-formed and physically sensible, so the dumb
 * canvas renderers can trust it: finite positive sizes, remnants leaving the HR
 * diagram, determinism, and hot massive stars landing upper-left.
 */
import { toRenderModel, toHRModel, toIMFHistogram, defaultView, HR_TEFF_RANGE } from "../src/novascope/state/index.ts";
import { sampleCluster, defaultIdentity } from "../src/novascope/core/cluster/index.ts";

let failures = 0;
const ok = (cond, msg) => {
  console.log(`  ${cond ? "ok  " : "FAIL"}  ${msg}`);
  if (!cond) failures++;
};

console.log("render-model selectors (§9.4):");

const id = defaultIdentity({ seed: 3, sampling: { mode: "count", target: 1500 }, imf: { mMin: 0.1, mMax: 100, alphaHigh: 2.0 } });
const latent = sampleCluster(id);

// t = 0: all alive.
const rm0 = toRenderModel(latent, defaultView({ t: 0 }));
ok(rm0.stars.length === latent.length, "render model has one star per latent star");
ok(rm0.stars.every((s) => s.sizePx > 0 && Number.isFinite(s.x) && Number.isFinite(s.z)), "all sizes positive, positions finite");
ok(rm0.stars.every((s) => s.alpha >= 0 && s.alpha <= 1), "alpha within [0,1]");
ok(rm0.maxR > 0, "maxR positive");
ok(rm0.stars.every((s) => !s.isRemnant), "no remnants at t=0");

const hr0 = toHRModel(latent, defaultView({ t: 0 }));
ok(hr0.points.length === latent.length, "every living star is on the HR diagram at t=0");
ok(
  hr0.points.every((p) => Number.isFinite(p.logTeff) && Number.isFinite(p.logL) && p.sizePx > 0),
  "HR points finite with positive size",
);

// Determinism.
const hr0b = toHRModel(latent, defaultView({ t: 0 }));
ok(JSON.stringify(hr0) === JSON.stringify(hr0b), "selectors are deterministic");

// t = 100 Myr: massive stars are remnants → drop off the HR diagram.
const rm100 = toRenderModel(latent, defaultView({ t: 100 }));
const hr100 = toHRModel(latent, defaultView({ t: 100 }));
ok(rm100.stars.some((s) => s.isRemnant), "some stars are remnants at t=100 Myr");
ok(hr100.points.length < latent.length, "remnants leave the HR diagram");

// Physical: the most massive LIVING star sits upper-left (hot + luminous).
const hottest = hr0.points.reduce((a, b) => (b.logTeff > a.logTeff ? b : a));
ok(hottest.logTeff > Math.log10(20000), "hottest star is a hot (>20 kK) O/B star");
ok(hottest.logL > 3, "…and highly luminous (log L/L☉ > 3), i.e. upper-left of the HRD");
ok(HR_TEFF_RANGE[0] < HR_TEFF_RANGE[1], "HR Teff bounds well-ordered");

// IMF histogram: counts conserved, law normalized, slope knob works.
const imf = toIMFHistogram(latent, id);
const totalCount = imf.bins.reduce((t, b) => t + b.count, 0);
const totalExpected = imf.bins.reduce((t, b) => t + b.expected, 0);
ok(totalCount === latent.length, "sampled bin counts sum to N");
ok(Math.abs(totalExpected - latent.length) / latent.length < 0.02, "analytic expectation integrates to ≈ N");
ok(imf.maxCount > 0 && imf.bins.every((b) => b.expected >= 0 && b.count >= 0), "histogram well-formed");
// Flattening the high-mass slope must raise the expected count in the top bin.
const steep = toIMFHistogram(sampleCluster(defaultIdentity({ seed: 3, sampling: { mode: "count", target: 1500 }, imf: { mMin: 0.1, mMax: 100, alphaHigh: 2.8 } })), defaultIdentity({ imf: { mMin: 0.1, mMax: 100, alphaHigh: 2.8 } }));
const flat = toIMFHistogram(sampleCluster(defaultIdentity({ seed: 3, sampling: { mode: "count", target: 1500 }, imf: { mMin: 0.1, mMax: 100, alphaHigh: 1.7 } })), defaultIdentity({ imf: { mMin: 0.1, mMax: 100, alphaHigh: 1.7 } }));
const topExpected = (m) => m.bins[m.bins.length - 1].expected;
ok(topExpected(flat) > topExpected(steep), "flatter high-mass slope predicts more massive stars");

if (failures) {
  console.error(`\n[render] ${failures} check(s) FAILED.`);
  process.exit(1);
}
console.log("\n[render] ok — selectors well-formed, remnants drop off, hot stars land upper-left.");
