/*
 * check-feedback.mjs — gates the internal consistency of the feedback core.
 *
 * r_ch, P_rad(r) and P_HII(r) are three expressions of ONE physical statement:
 * the radius where the two pressure terms of Krumholz & Matzner (2009)'s
 * thin-shell equation of motion balance. Nothing in the type system ties them
 * together, so a future edit to alpha_B, phi, T_II or the particle-count
 * convention would leave code that still runs and curves that still plot,
 * crossing at the wrong place. That is exactly the failure this gate exists to
 * make loud.
 */
import {
  characteristicRadius,
  radiationPressure,
  pressureComparison,
  trapIR,
  shellEffectiveTemperature,
  fTrapKM09,
  F_TRAP_FIDUCIAL,
} from "../src/novascope/core/feedback/radiation.ts";
import { hiiPressure } from "../src/novascope/core/feedback/photoionization.ts";

let failures = 0;
function check(label, got, want, rtol) {
  const ok = Math.abs(got - want) <= rtol * Math.abs(want);
  if (!ok) {
    failures++;
    console.error(`  FAIL ${label}: got ${got}, want ${want} (rtol ${rtol})`);
  } else {
    console.log(`  ok   ${label}: ${typeof got === "number" ? got.toPrecision(4) : got}`);
  }
}

console.log("feedback: KM09 pressure consistency");

/* 1. The published numerical evaluation. KM09 give r_ch = (9.2, 2.3)e-2 S_49 pc
 *    for (spherical, blister) at their fiducial alpha_B, phi, T_II, with
 *    f_trap = 2 and psi = 1. This anchors the whole normalization to a number
 *    in the paper rather than to a counting argument reconstructed here. */
check("r_ch spherical @ S=1e49, psi=1, f_trap=2", characteristicRadius(1e49, 1, 2, true), 9.2e-2, 5e-3);
check("r_ch blister   @ S=1e49, psi=1, f_trap=2", characteristicRadius(1e49, 1, 2, false), 2.3e-2, 5e-3);

/* 2. The crossing. P_rad ~ r^-2 and P_HII ~ r^(-3/2) meet exactly once, and
 *    that radius must BE r_ch. Swept across four decades of S and a range of
 *    f_trap so the check constrains the scalings, not one lucky point. */
for (const S of [1e47, 1e49, 1e51]) {
  for (const fTrap of [1, 2, 9]) {
    // psi = L/(S eps_0) = 1  =>  L in Lsun that makes psi exactly 1
    const EPS_0_ERG = 13.6 * 1.602176634e-12;
    const LSUN = 3.828e33;
    const lSun = (S * EPS_0_ERG) / LSUN;
    const rCh = characteristicRadius(S, 1, fTrap, true);
    const { ratio } = pressureComparison(lSun, S, rCh, fTrap);
    check(`P_rad/P_HII at r_ch (S=${S.toExponential(0)}, f_trap=${fTrap})`, ratio, 1, 1e-6);

    // and the crossing is a genuine crossing, not a tangency
    const inside = pressureComparison(lSun, S, rCh * 0.5, fTrap).ratio;
    const outside = pressureComparison(lSun, S, rCh * 2, fTrap).ratio;
    if (!(inside > 1 && outside < 1)) {
      failures++;
      console.error(`  FAIL dominance flips across r_ch: inside=${inside}, outside=${outside}`);
    }
  }
}

/* 3. The scalings themselves, stated independently of the formula above. */
const L0 = 1e5;
check("P_rad ~ r^-2", radiationPressure(L0, 2) / radiationPressure(L0, 4), 4, 1e-12);
check("P_rad ~ f_trap", radiationPressure(L0, 2, 4) / radiationPressure(L0, 2, 2), 2, 1e-12);
check("P_HII ~ r^-3/2", hiiPressure(1e49, 1) / hiiPressure(1e49, 4), 8, 1e-12);
check("P_HII ~ S^1/2", hiiPressure(4e49, 1) / hiiPressure(1e49, 1), 2, 1e-12);
check("r_ch ~ f_trap^2", characteristicRadius(1e49, 1, 4) / characteristicRadius(1e49, 1, 2), 4, 1e-12);
check("r_ch ~ psi^2", characteristicRadius(1e49, 2, 2) / characteristicRadius(1e49, 1, 2), 4, 1e-12);

/* 4. KM09 eq (34) IR trapping. Checked against the paper's own qualitative
 *    statement -- trapping "can be quite significant" for Sigma_sh >~ 1 with a
 *    warm shell, and is negligible for the cold, low-column shells we ship --
 *    plus the monotonicity that makes it a compactness diagnostic at all. */
console.log("feedback: KM09 eq (34) IR trapping");
check("f_trap,IR cold thin shell (0.4 g/cm2, 45 K) is negligible", trapIR(0.4, 44.8) < 0.01, true, 0);
check("f_trap,IR warm thick shell (3 g/cm2, 100 K) is order unity+", trapIR(3, 100) > 1, true, 0);
// rises with BOTH column and shell temperature
check("f_trap,IR increases with Sigma_sh", trapIR(3, 100) > trapIR(1, 100), true, 0);
check("f_trap,IR increases with T_eff,sh", trapIR(3, 100) > trapIR(3, 60), true, 0);
// T_eff,sh ~ (L/r^2)^(1/4): quadrupling r at fixed L halves it
check("T_eff,sh ~ r^-1/2", shellEffectiveTemperature(1e6, 1) / shellEffectiveTemperature(1e6, 4), 2, 1e-12);

/* 5. Our f_trap must NOT reproduce KM09's fiducial 2, because that includes
 *    f_trap,w and winds are a separate channel here. A future edit that
 *    "restores" 2 would silently double-count the wind bubble. */
const fOurs = fTrapKM09(28.55e6, 2, 0.396); // the shipped `compact` environment
check("f_trap for compact is ~1, not the fiducial 2", fOurs, 1, 0.05);
if (fOurs >= F_TRAP_FIDUCIAL) {
  failures++;
  console.error(`  FAIL f_trap reached the wind-inclusive fiducial (${fOurs}) — winds would be double-counted`);
}

/* 6. Two-stage gas-expulsion verdict. Stage 1 measures against the GAS mass, not
 *    the whole cloud; stage 2 is the first-principles energy criterion q<1. */
console.log("feedback: two-stage gas-expulsion verdict");
const { gasExpulsionVerdict } = await import("../src/novascope/core/feedback/ledger.ts");
// M_cloud=2e4, SFE=0.2 -> M_gas=1.6e4; v_esc=8.4 -> threshold=1.344e5 Msun km/s
const gv = (p, q) => gasExpulsionVerdict(p, 2e4, 0.2, 8.4, 0.3, 1.64, q);
check("threshold uses M_gas = M_cloud(1-SFE)", gv(1e5, 0.02).gasMomentumNeeded, 1.6e4 * 8.4, 1e-9);
check("gas expelled when p exceeds M_gas v_esc", gv(2e5, 0.02).gasExpelled, true, 0);
check("gas retained when p below threshold", gv(5e4, 0.02).gasExpelled, false, 0);
// stage 2 is the energy criterion, independent of stage 1
check("cold cluster (q=0.03) survives", gv(2e5, 0.03).survivalLabel === "survives", true, 0);
check("super-virial (q=0.7) expands but bound", gv(2e5, 0.7).survivalLabel === "expands", true, 0);
check("q=0.7 still counts as surviving (bound)", gv(2e5, 0.7).clusterSurvives, true, 0);
check("unbound (q=1.5) dissolves", gv(2e5, 1.5).survivalLabel === "dissolves", true, 0);
check("q=1.5 does NOT survive", gv(2e5, 1.5).clusterSurvives, false, 0);
// the survives/dissolves line is exactly q=1 (sign of total energy)
check("survival boundary is q=1", gv(2e5, 0.999).clusterSurvives && !gv(2e5, 1.001).clusterSurvives, true, 0);

if (failures) {
  console.error(`\nfeedback: ${failures} check(s) failed`);
  process.exit(1);
}
console.log("feedback: all checks passed");
