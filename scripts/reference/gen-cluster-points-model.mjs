/*
 * gen-cluster-points-model.mjs — freeze a REAL cluster as the renderer's pinned input.
 *
 * ── WHY THIS EXISTS ──
 *
 * The first version of `check-cluster-points` invented its own star lattice: uniform sizes,
 * uniform alpha, and a hardcoded green channel. It was deterministic, which was the only property
 * it was designed for, and it was measurably nothing like a cluster:
 *
 *                        real (presets.default)      invented
 *   colour (b-r) p50     -0.46  warm, red-dominant   -0.05  neutral
 *   sizePx p50 / p90      1.35 / 2.40  steep tail     2.71 / 4.53  most stars LARGE
 *   alpha                 0.55-0.70    floored        0.30-1.00    uniform
 *
 * That is not merely an ugly picture. `clusterPoints` draws a `sizePx`-driven halo over a core and
 * FLOORS alpha so "the faint majority is always visible" — so a fixture whose stars are mostly
 * large and mostly opaque barely touches the regime that law exists for. A regression in the faint
 * tail would have passed the gate.
 *
 * ── WHY FREEZE IT RATHER THAN SAMPLE AT CHECK TIME ──
 *
 * Calling `sampleCluster` + `toRenderModel` inside the gate would couple the renderer's baseline to
 * the IMF sampler, the profile and `star()`. Then a deliberate physics change would fail a
 * RENDERER gate, which is how a gate earns a reputation for crying wolf and gets deleted.
 *
 * Freezing gets both: the numbers are physically real because they came from the real pipeline,
 * and the baseline is inert because it is now data. Regenerate ONLY when the pinned input should
 * genuinely change, and expect to re-pin the images in the same commit.
 *
 * Usage:
 *   node --experimental-strip-types scripts/reference/gen-cluster-points-model.mjs
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { scenario } from "../../src/novascope/core/dynamics/index.ts";
import { toRenderModel } from "../../src/novascope/state/index.ts";

/*
 * DYNAMICS' OWN CONFIGURATION, not census's.
 *
 * The pin protects /explore/dynamics, so it draws the cluster that page draws: the `cluster`
 * scenario at its shipped URL defaults (seed 2026, n 400, r_h 0.65 pc, gamma 5, alpha 2.3) with
 * SOFTENING_FRACTION 0.1 and CLUSTER_Z 0.02, exactly as DynamicsEngine builds it.
 *
 * t = 0, and that is not a shortcut. DynamicsEngine calls `toRenderModel` at t = 0 too, in its
 * words because "at this rung a star MOVES but does not evolve, so asking toRenderModel for an
 * age would claim evolution the backend cannot compute". It also means the capture reads the
 * scenario's INITIAL CONDITIONS — deterministic from the seed — and never integrates, so none of
 * the cross-engine divergence that rules out pinning a simulated frame can reach it.
 */
const DEFAULTS = { seed: 2026, n: 400, rHalfPc: 0.65, gamma: 5, alphaHigh: 2.3 };
const SOFTENING_FRACTION = 0.1;
const CLUSTER_Z = 0.02;
const T_MYR = 0;

const built = scenario("cluster").build({ ...DEFAULTS, softeningFraction: SOFTENING_FRACTION });
const st = built.state;
const latent = Array.from({ length: st.n }, (_, i) => ({
  id: i,
  mass: st.mass[i],
  Z: CLUSTER_Z,
  x: st.pos[3 * i], y: st.pos[3 * i + 1], z: st.pos[3 * i + 2],
  vx: st.vel[3 * i], vy: st.vel[3 * i + 1], vz: st.vel[3 * i + 2],
}));
const model = toRenderModel(latent, { t: T_MYR, selectedId: null, toggles: {} });

/* 6 decimals. The renderer quantises to 8-bit long before this matters, and full float64 text
   would triple the file for digits nothing can see. */
const r6 = (v) => Number(v.toFixed(6));

const payload = {
  _comment:
    "FROZEN input for the clusterPoints pin — a real cluster, captured once so the renderer's " +
    "baseline does not move when the physics does. Regenerate with " +
    "`node --experimental-strip-types scripts/reference/gen-cluster-points-model.mjs` only when " +
    "the pinned input should genuinely change, and re-pin the images in the same commit.",
  source: `toRenderModel(scenario("cluster").build(defaults).state, { t: ${T_MYR} })`,
  generatedFrom: { ...DEFAULTS, softeningFraction: SOFTENING_FRACTION, Z: CLUSTER_Z, tMyr: T_MYR },
  /* The scenario's own DERIVED view half-width, so the pin frames the cluster as the page does
     rather than as `maxR`'s 90th-percentile radius would. */
  viewPc: r6(built.viewPc),
  maxR: r6(model.maxR),
  /* Flat arrays, not objects: 1200 stars as records is mostly repeated key text. */
  n: model.stars.length,
  xyz: model.stars.flatMap((s) => [r6(s.x), r6(s.y), r6(s.z)]),
  rgb: model.stars.flatMap((s) => s.color.map(r6)),
  sizePx: model.stars.map((s) => r6(s.sizePx)),
  alpha: model.stars.map((s) => r6(s.alpha)),
  remnant: model.stars.map((s) => (s.isRemnant ? 1 : 0)),
};

const out = fileURLToPath(
  new URL("../../src/novascope/viz/__fixtures__/cluster-points-model.json", import.meta.url),
);
writeFileSync(out, `${JSON.stringify(payload)}\n`);

const q = (arr, p) => [...arr].sort((a, b) => a - b)[Math.floor(p * (arr.length - 1))];
console.log(`wrote ${out}`);
console.log(`  ${payload.n} stars, maxR ${payload.maxR} pc, ${payload.remnant.reduce((a, b) => a + b, 0)} remnant(s)`);
console.log(`  sizePx  p50 ${q(payload.sizePx, 0.5).toFixed(2)}  p90 ${q(payload.sizePx, 0.9).toFixed(2)}  max ${q(payload.sizePx, 1).toFixed(2)}`);
console.log(`  alpha   p50 ${q(payload.alpha, 0.5).toFixed(2)}  p90 ${q(payload.alpha, 0.9).toFixed(2)}`);
