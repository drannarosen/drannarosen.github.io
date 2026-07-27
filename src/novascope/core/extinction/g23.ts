/*
 * g23.ts — Gordon et al. (2023) R(V)-dependent extinction curve (Layer 0, pure).
 *
 *   Gordon, K. D., Clayton, G. C., Decleir, M., Fitzpatrick, E. L., Massa, D., Misselt, K. A.
 *   & Tollerud, E. J. 2023, ApJ, 950, 86
 *
 * PROVENANCE. Ported from fluxax's `photometry/extinction/laws.py` (Apache 2.0). Every
 * coefficient traces to a primary-source-verified equation digest: an independent verifier
 * confirmed Eqs 1 and 4-17 and every digit of Tables 2, 3 and 4 against the rendered PDF,
 * signs included. Two errata are applied and both are noted at their site below. Nothing here
 * was recalled or re-derived.
 *
 * WHY THIS IS THE DEFAULT rather than CCM89. It is valid from 912 A to 32 um, so it covers all
 * thirty of this repo's passbands — including JWST F444W and F770W, which sit beyond CCM89's
 * IR branch entirely, and HST F275W, which sits above its optical one. It also models the
 * mid-IR explicitly, with two silicate features; F770W at 7.663 um lies on the blue wing of
 * the 9.84 um feature, which no optical-NIR power law contains at all. Extrapolating there
 * would not be merely imprecise, it would be structurally wrong.
 *
 * THE MODEL. Linear in 1/R_V about the Milky Way pivot (Eq 1):
 *
 *     A(lambda)/A_V = a(lambda) + b(lambda) * [ 1/R_V - 1/3.1 ]
 *
 * with a and b each assembled piecewise across UV / optical / IR and blended by smoothsteps.
 *
 * NORMALIZATION IS APPROXIMATE, DELIBERATELY. The digest records A(lambda)/A(V) ~ 1 at
 * lambda ~ 550 nm as "a fit, not exact" — G23 is a global fit rather than a curve pinned to
 * unity at V, so it does not return exactly 1 there for any R_V. CCM89 does, at y = 0. The
 * test file asserts each law's own normalization property rather than imposing one on both.
 */

/** Milky Way average R(V) — the pivot of Eq 1, and the default everywhere. */
export const R_V_MW = 3.1;

/**
 * R(V) range the paper fits and fluxax refuses to leave (abstract; Fig 1 top axis).
 *
 * The curve is a fit over this interval; outside it the linear-in-1/R_V form is unconstrained.
 * `g23AOverAv` CLAMPS rather than extrapolating, which is what fluxax does — and the lab's
 * control is bounded to the same range so a reader cannot silently ask for a clamped value.
 */
export const G23_RV_RANGE = { min: 2.3, max: 5.6 } as const;

/** Wavelength validity [nm]: 912 A to 32 um. Covers every passband in this repo. */
export const G23_RANGE_NM = { min: 91.2, max: 32_000 } as const;

/* ── Table 2, UV (a_uv, b_uv): c1, c2, c3, c4 ── */
const UV_A = [0.81297, 0.2775, 1.06295, 0.11303];
const UV_B = [-2.97868, 1.89808, 3.10334, 0.65484];
const UV_X0 = 4.6; // um^-1, the 2175 A bump centre (shared)
const UV_GAMMA = 0.99; // um^-1, bump width (shared)

/* ── Table 3, optical: E0..E4 polynomial plus three intermediate-scale-structure Drudes ── */
const OPT_E_A = [-0.35848, 0.7122, 0.08746, -0.05403, 0.00674];
const OPT_E_B = [0.12354, -2.68335, 2.01901, -0.39299, 0.03355];
const OPT_F_A = [0.03893, 0.02965, 0.01747];
const OPT_F_B = [0.18453, 0.19728, 0.1713];
const OPT_XI = [2.288, 2.054, 1.587]; // um^-1 feature centres (Massa et al. 2020)
const OPT_GI = [0.243, 0.179, 0.243]; // um^-1 feature widths

/* ── Table 4, NIR/MIR ── */
const IR_A_G1 = 0.38526;
const IR_A_A1 = 1.68467;
const IR_A_A2 = 0.78791;
const IR_A_LB = 4.30578; // um, broken-power-law break
const IR_A_DELTA = 4.78338; // um, smoothstep width
/** Two silicate modified-Drude features: (S_i, lambda_o [um], gamma_o [um], a_i). */
const IR_SIL: readonly (readonly [number, number, number, number])[] = [
  [0.06652, 9.8434, 2.21205, -0.24703],
  [0.0267, 19.258294, 17.0, -0.27],
];
const IR_B_G1 = -1.01251;
const IR_B_A1 = -1.06099;

const poly = (c: readonly number[], x: number): number => {
  let v = 0;
  for (let i = c.length - 1; i >= 0; i--) v = v * x + c[i];
  return v;
};

/** Standard Drude, Eq 5. */
const drude = (x: number, x0: number, gamma: number): number =>
  (x * x) / ((x * x - x0 * x0) ** 2 + (x * gamma) ** 2);

/**
 * Hermite smoothstep W, Eqs 10/11.
 *
 * ERRATUM (digest §H, ERR-1): the published PDF literally prints `0` for the z > 1 branch,
 * confirmed at 6x zoom. It MUST be 1 — W blends one region into the next and must run 0 -> 1
 * like a CDF. With 0, the long-wavelength end of every transition would lose the incoming
 * region entirely.
 */
const smoothstep = (lamUm: number, lamB: number, delta: number): number => {
  const z = (lamUm - (lamB - 0.5 * delta)) / delta;
  if (z < 0) return 0;
  if (z > 1) return 1;
  return 3 * z * z - 2 * z * z * z;
};

/** UV region, Eq 4. F(x) = 0 below 5.9 um^-1 (Eq 6), which is every band in this repo. */
function uv(x: number): [number, number] {
  const d = drude(x, UV_X0, UV_GAMMA);
  const f = x >= 5.9 ? 0.5392 * (x - 5.9) ** 2 + 0.05644 * (x - 5.9) ** 3 : 0;
  return [
    UV_A[0] + UV_A[1] * x + UV_A[2] * d + UV_A[3] * f,
    UV_B[0] + UV_B[1] * x + UV_B[2] * d + UV_B[3] * f,
  ];
}

/** Optical region, Eq 7. The gamma_i^2 factor makes F_i the feature's central intensity. */
function optical(x: number): [number, number] {
  let a = poly(OPT_E_A, x);
  let b = poly(OPT_E_B, x);
  for (let i = 0; i < 3; i++) {
    const dg2 = drude(x, OPT_XI[i], OPT_GI[i]) * OPT_GI[i] ** 2;
    a += OPT_F_A[i] * dg2;
    b += OPT_F_B[i] * dg2;
  }
  return [a, b];
}

/** NIR/MIR, Eqs 8/9 (a: broken power law + silicates) and 14 (b: single power law). */
function infrared(lamUm: number): [number, number] {
  const w = smoothstep(lamUm, IR_A_LB, IR_A_DELTA);
  const pl1 = IR_A_G1 * lamUm ** -IR_A_A1;
  // lambda_b^(alpha2 - alpha1) enforces continuity where the two power laws join.
  const pl2 = IR_A_G1 * IR_A_LB ** (IR_A_A2 - IR_A_A1) * lamUm ** -IR_A_A2;
  let a = pl1 * (1 - w) + pl2 * w;

  for (const [s, lamO, gammaO, ai] of IR_SIL) {
    // Asymmetric width, Eq 13; modified Drude, Eq 12.
    const gamma = (2 * gammaO) / (1 + Math.exp(ai * (lamUm - lamO)));
    const ratio = lamUm / lamO - lamO / lamUm;
    a += (s * (gamma / lamO) ** 2) / (ratio ** 2 + (gamma / lamO) ** 2);
  }
  return [a, IR_B_G1 * lamUm ** -IR_B_A1];
}

/** Is this wavelength inside the published validity range? */
export function g23Covers(lambdaNm: number): boolean {
  return lambdaNm >= G23_RANGE_NM.min && lambdaNm <= G23_RANGE_NM.max;
}

/**
 * A(lambda)/A_V from Gordon et al. (2023). Returns NaN outside 912 A - 32 um.
 *
 * `rv` is clamped to `G23_RV_RANGE` — see that constant for why clamping rather than
 * extrapolating is the right guard for a fitted parameter.
 */
export function g23AOverAv(lambdaNm: number, rv: number): number {
  if (!g23Covers(lambdaNm)) return NaN;
  const lamUm = lambdaNm / 1000;
  const x = 1 / lamUm;

  const [aUv, bUv] = uv(x);
  const [aOpt, bOpt] = optical(x);
  const [aIr, bIr] = infrared(lamUm);

  /* Region assembly, Eq 15, with the two smoothstep blends of Eqs 16 and 17:
       UV        < 0.30 um
       UV->opt     0.30 - 0.33   W1(lambda_b = 0.315, delta = 0.03)
       optical     0.33 - 0.90
       opt->IR     0.90 - 1.10   W2(lambda_b = 1.0,   delta = 0.2)
       IR        > 1.10 */
  const assemble = (vUv: number, vOpt: number, vIr: number): number => {
    if (lamUm < 0.3) return vUv;
    if (lamUm < 0.33) {
      const w1 = smoothstep(lamUm, 0.315, 0.03);
      return (1 - w1) * vUv + w1 * vOpt;
    }
    if (lamUm < 0.9) return vOpt;
    if (lamUm < 1.1) {
      const w2 = smoothstep(lamUm, 1.0, 0.2);
      return (1 - w2) * vOpt + w2 * vIr;
    }
    return vIr;
  };

  const a = assemble(aUv, aOpt, aIr);
  const b = assemble(bUv, bOpt, bIr);
  const rvUsed = Math.min(Math.max(rv, G23_RV_RANGE.min), G23_RV_RANGE.max);
  return a + b * (1 / rvUsed - 1 / R_V_MW);
}
