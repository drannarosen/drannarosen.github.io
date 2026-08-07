/*
 * scenarios.ts — bounded configurations, each carrying its own limits (Layer 0, pure).
 *
 * ── WHY THIS EXISTS RATHER THAN A PAGE FULL OF SLIDERS ──
 *
 * /dynamics-lab's first version was one sandbox with a softening slider, and its lowest rungs
 * turned out to describe fixed-step integrators failing rather than anything about stellar
 * dynamics. The page could not say so, because nothing in the model knew which combinations
 * were honest — the reader was free to build a configuration no scheme on offer could integrate,
 * and the page would show them the result as though it meant something.
 *
 * A scenario is the answer: a bounded configuration that states WHICH SCHEMES ARE HONEST FOR IT
 * and why. The page renders that; it does not decide it. This is the same reason
 * `chooseIntegrator` reports the scheme it picked instead of the one it was asked for.
 *
 * Anna, 2026-08-04: "This demo doesn't need to be able to model everything." Right — and saying
 * what it does NOT model is what makes the part it does model trustworthy.
 *
 * ── THE COST CONSTRAINT IS PHYSICS-SHAPED, WHICH IS WHY IT LIVES HERE ──
 *
 * `symmetric.ts` conserves five orders better than `hermite.ts` and costs 39x more (measured,
 * N = 200: 147806 force evaluations per crossing time against 3758). That is not a defect to
 * optimise away — one symmetric step is 8 force evaluations against 1 — so the scheme is
 * correct-and-interactive at N = 2 and correct-but-not-interactive at N = 200.
 *
 * So `schemes` is per scenario, and the two-body scenario is the one that offers the symmetric
 * integrator FIRST: at N = 2 it is free, it runs at exactly zero softening, and it can be run
 * backwards to its starting point. The demonstration the whole port exists for is the cheap one.
 */
import type { ForceModel, State } from "./types.ts";
import { createState } from "./types.ts";
import { createDirectForce, softeningForCluster } from "./direct/index.ts";
import { clusterState } from "./ic.ts";
import { crossingTime } from "./diagnostics.ts";
import { G_PC3_MSUN_MYR2 } from "../constants/index.ts";
import { defaultIdentity } from "../cluster/params.ts";
import { effRhOverA } from "../cluster/profiles.ts";

/*
 * Range of the EFF slope this scenario will integrate, matching the control range
 * /explore/census already offers so the two pages cannot describe different
 * clusters by the same number. Below ~2.5 the profile's mass diverges faster than
 * the 15a truncation can contain sensibly; above 6 it is Plummer-or-steeper and
 * the differences stop being visible.
 */
export const GAMMA_MIN = 2.5;
export const GAMMA_MAX = 6;

/* Half-mass radius range, matching /explore/census's own control. */
export const RHALF_MIN_PC = 0.3;
export const RHALF_MAX_PC = 5;
import type { Scheme } from "./choose.ts";

export type ScenarioId = "two-body" | "cluster" | "binary-in-cluster";

export interface ScenarioBuild {
  state: State;
  force: ForceModel;
  /** The natural clock for this configuration [Myr] — an orbital period or a crossing time. */
  timeUnit: number;
  /** What that unit is called, for a readout. */
  timeUnitLabel: string;
  /** Half-width of a view that holds the configuration [pc]. DERIVED, never chosen by eye. */
  viewPc: number;
  /**
   * Multiplier on the drawn marker radius. PRESENTATION ONLY — it asserts nothing physical.
   *
   * No star is resolved at any of these scales; a marker is a position, not a size. But the
   * right marker for a 200-star field is the wrong one for two bodies: mass^(1/3) sizing exists
   * so mass segregation is visible in a crowd, and applied to a two-body orbit it drew each star
   * 1.4 CSS pixels across — a demonstration of an orbit in which the orbiting bodies could not
   * be seen.
   *
   * It lives on the scenario because the scenario is what knows how crowded the frame is. The
   * page must not be choosing this, or the number drifts out of step with the configuration the
   * way a hardcoded view half-width already did once.
   */
  markerScale: number;
  /** Human-readable softening statement, for the status line. */
  softeningNote: string;
}

export interface ScenarioParams {
  /** Two-body: orbital eccentricity. */
  eccentricity?: number;
  /** Two-body / binary-in-cluster: semi-major axis [pc]. */
  semiMajorPc?: number;
  /** Cluster: star count. */
  n?: number;
  /** Cluster: softening as a fraction of r_h N^(-1/3). */
  softeningFraction?: number;
  /**
   * Cluster: HALF-MASS radius [pc].
   *
   * The half-mass radius, not the scale radius `a`, because r_h is the physical
   * quantity — it is what the crossing time and the softening are defined
   * against, it is what the readout quotes, and it is what /explore/census's own
   * control exposes. `a` is then derived, `a = r_h / effRhOverA(gamma)`, so
   * changing gamma at a fixed r_h reshapes the cluster WITHOUT resizing it.
   *
   * Parameterising by `a` instead would have made the two controls interact: every
   * gamma change would also change the cluster's size, and neither slider would
   * mean what its label said.
   */
  rHalfPc?: number;
  /**
   * Cluster: EFF density slope gamma, rho ~ (1 + r^2/a^2)^(-gamma/2).
   *
   * 5 is the Plummer law and the default, so a caller that does not set it gets
   * the profile this scenario has always had. Shallower gamma is a more extended
   * halo (gamma ~ 3 is a typical young cluster); steeper is more concentrated.
   */
  gamma?: number;
  /*
   * Cluster: sampling seed. Without it every build returns the SAME cluster,
   * so a "new draw" control is inert — which is how one shipped: the button
   * fired, rebuilt, and produced byte-identical radii. Defaulted so existing
   * callers keep the fixed cluster they rely on.
   */
  seed?: number;
}

export interface Scenario {
  id: ScenarioId;
  label: string;
  /** One sentence: what this configuration is FOR. */
  blurb: string;
  /** What this scenario deliberately does not model. Rendered on the page, not hidden here. */
  limits: string;
  /** Schemes that are honest here, best first. */
  schemes: readonly Scheme[];
  defaultScheme: Scheme;
  build(params?: ScenarioParams): ScenarioBuild;
}

/** Clamp with the bound stated at the call site, so a limit is never silently exceeded. */
const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));

/**
 * Two equal 1 Msun stars on an eccentric orbit, at apoapsis, ZERO softening.
 *
 * ECCENTRICITY IS CAPPED AT 0.9, and the cap is interactivity rather than taste: the adaptive
 * step tracks 1/r-ish, so the ratio between the periapsis and apoapsis step grows steeply with
 * e. At e = 0.5 the measured spread is a factor of 99 (see `hermite.ts`); at e = 0.99 a browser
 * frame would spend its entire budget inside one periapsis passage. An unregularised scheme has
 * no answer for that, and offering a control that quietly stops working is worse than a bound.
 */
function buildTwoBody(p: ScenarioParams = {}): ScenarioBuild {
  const e = clamp(p.eccentricity ?? 0.5, 0, 0.9);
  const a = clamp(p.semiMajorPc ?? 0.01, 1e-4, 0.5);
  const m = 1;
  const mTot = 2 * m;

  const rApo = a * (1 + e);
  // Relative speed at apoapsis, vis-viva at r = a(1+e): v^2 = G M (2/r - 1/a).
  const vApo = Math.sqrt(G_PC3_MSUN_MYR2 * mTot * (2 / rApo - 1 / a));

  const s = createState(2);
  s.mass[0] = m;
  s.mass[1] = m;
  // Equal masses: each at half the separation, each at half the relative speed, about the COM.
  s.pos[0] = -rApo / 2;
  s.pos[3] = rApo / 2;
  s.vel[1] = -vApo / 2;
  s.vel[4] = vApo / 2;

  return {
    state: s,
    /* EXACTLY zero. Not small — zero. A two-body orbit has no close-pair pathology to
       regularise away, and softening here would silently change the orbit being shown. */
    force: createDirectForce({ softening: 0 }),
    timeUnit: 2 * Math.PI * Math.sqrt(a ** 3 / (G_PC3_MSUN_MYR2 * mTot)),
    timeUnitLabel: "orbit",
    viewPc: 1.35 * rApo,
    markerScale: 5, // two bodies in an empty frame: the orbit is the subject, so show them
    softeningNote: "ε = 0 (exact)",
  };
}

/**
 * A Plummer cluster, uniformly softened — the original /dynamics-lab configuration.
 *
 * N IS CAPPED AT 512, which is `direct/index.ts`'s measured interactive ceiling and not a round
 * number: at N = 2048 a single leapfrog step already costs twice a frame budget.
 */
function buildCluster(p: ScenarioParams = {}): ScenarioBuild {
  /*
   * 800, raised from 512. The old cap was "the measured interactive ceiling" for
   * ONE force evaluation per frame; /explore/dynamics now takes two (a halved
   * step, for accuracy), which alone made 512 cost what 724 used to.
   *
   * Re-measured, direct N^2 with two steps plus a diagnostics pass, per frame:
   *   N=200 0.87 ms | N=400 3.93 | N=512 6.32 | N=800 ~15 (extrapolated on N^2,
   *   which the 400->512 ratio confirms: 1.61 measured against 1.64 predicted).
   *
   * ~15 ms is a 60 fps budget in node and comfortably interactive in a browser
   * with rendering on top. Past ~1000 this needs a different force model —
   * `meanField/` exists — at the cost of no longer resolving the two-body
   * relaxation that mass segregation IS.
   */
  const n = Math.round(clamp(p.n ?? 200, 20, 800));
  const fraction = clamp(p.softeningFraction ?? 0.5, 0, 1);
  /*
   * EFF (Elson+1987) everywhere, with gamma the knob: rho ~ (1 + r^2/a^2)^(-gamma/2),
   * which AT GAMMA = 5 IS the Plummer law. One profile path rather than two, and the
   * same one `/explore/census` drives.
   *
   * r_h/a MUST come from `effRhOverA(gamma)`, never the Plummer constant. This line
   * read `scalePc * 1.305` — correct only at gamma = 5, and silently wrong for every
   * other value. It is not a display number: it feeds `softeningForCluster`, and the
   * softening sets the energy error. Measured on this scenario, halving the softening
   * takes the drift from 3.95e-4 to 3.1e-1, past the trust limit by 300x. A
   * mis-derived r_h would move it the same way with nothing to show for it.
   *
   * `effRhOverA` exists for exactly this — its own docstring says it "lets a UI quote
   * a real half-mass radius for any gamma instead of assuming the Plummer ratio".
   */
  const gamma = clamp(p.gamma ?? 5, GAMMA_MIN, GAMMA_MAX);
  /* r_h is the input and `a` is derived, so gamma reshapes at fixed size. The
     default reproduces the scale radius this scenario has always used: 0.5 pc at
     gamma = 5, i.e. r_h = 0.5 * effRhOverA(5). */
  const rHalf = clamp(p.rHalfPc ?? 0.5 * effRhOverA(5), RHALF_MIN_PC, RHALF_MAX_PC);
  const scalePc = rHalf / effRhOverA(gamma);
  const softening = softeningForCluster(rHalf, n, fraction);

  const force = createDirectForce({ softening });
  /* The IC's virial scaling must use the SAME force law that will step it, or the cluster
     starts at a Q it is not actually at. */
  const state = clusterState(
    defaultIdentity({
      seed: p.seed ?? 2026,
      sampling: { mode: "count", target: n },
      profile: { kind: "eff", scaleRadius: scalePc, gamma },
      kinematics: { virialRatio: 0.5 },
    }),
    force,
  );

  return {
    state,
    force,
    timeUnit: crossingTime(state),
    timeUnitLabel: "t_cross",
    viewPc: 4 * rHalf,
    markerScale: 1, // a crowded frame: mass^(1/3) alone, so segregation stays readable
    softeningNote:
      fraction === 0
        ? "ε = 0 (fixed-step schemes will fail here — that is the point)"
        : `ε = ${softening.toFixed(4)} pc = ${fraction} · r_h N^(−1/3)`,
  };
}

/**
 * A binary at ZERO softening inside a softened background cluster.
 *
 * THIS IS WHAT PER-PARTICLE SOFTENING IS FOR, and it is the only configuration here that could
 * not be built before it existed. The two binary members carry eps = 0, so every pair they are
 * in is exact; the background carries the cluster's usual eps. Because eps_ij is a constant of
 * the pair's IDENTITY and never a function of separation, the force is still exactly the
 * gradient of the potential and the energy readout still means what it says — see
 * `direct/index.ts` on why the separation-dependent version is not offered.
 *
 * The binary is placed at the cluster centre with its orbit in the plane of the view, so what a
 * reader watches is the thing under discussion rather than a projection of it.
 */
function buildBinaryInCluster(p: ScenarioParams = {}): ScenarioBuild {
  const nTotal = Math.round(clamp(p.n ?? 120, 20, 300));
  const a = clamp(p.semiMajorPc ?? 0.02, 1e-3, 0.2);
  const base = buildCluster({ n: nTotal - 2, softeningFraction: 0.5 });
  const bg = base.state;
  const nBg = bg.n;
  const n = nBg + 2;

  const s = createState(n);
  s.mass.set(bg.mass, 2);
  s.pos.set(bg.pos, 6);
  s.vel.set(bg.vel, 6);

  // Two 5 Msun stars: massive enough to stay a recognisable pair against the background.
  const m = 5;
  const mTot = 2 * m;
  const vCirc = Math.sqrt((G_PC3_MSUN_MYR2 * mTot) / a);
  s.mass[0] = m;
  s.mass[1] = m;
  s.pos[0] = -a / 2;
  s.pos[3] = a / 2;
  s.vel[1] = -vCirc / 2;
  s.vel[4] = vCirc / 2;

  /* eps = 0 for the pair, the cluster's eps for everything else. The geometric mean makes every
     binary-background pair exact too (sqrt(0 * eps) = 0), which is deliberate: those encounters
     are the ones that harden or ionise the binary, and softening them would suppress the
     mechanism the scenario exists to show. */
  const bgSoftening = softeningForCluster(0.5 * 1.305, nBg, 0.5);
  const eps = new Float64Array(n).fill(bgSoftening);
  eps[0] = 0;
  eps[1] = 0;

  return {
    state: s,
    force: createDirectForce({ softening: eps }),
    timeUnit: base.timeUnit,
    timeUnitLabel: "t_cross",
    viewPc: base.viewPc,
    /* Between the two: the background is a crowd, but the pair must be findable inside it. The
       pair is also 5 Msun against ~0.5, so mass^(1/3) already separates them by ~2x. */
    markerScale: 1.6,
    softeningNote: `ε = 0 for the pair, ${bgSoftening.toFixed(4)} pc for the background`,
  };
}

export const SCENARIOS: readonly Scenario[] = [
  {
    id: "two-body",
    label: "Two-body orbit",
    blurb:
      "Two stars, one exact orbit, no softening at all. The cheapest place to see whether a " +
      "scheme conserves — and the only one where you can run time backwards.",
    limits:
      "Two bodies only. Eccentricity is capped at 0.9, because an unregularised scheme cannot " +
      "take the step a near-radial periapsis demands.",
    schemes: ["symmetric", "hermite", "fsi4", "leapfrog"],
    defaultScheme: "symmetric",
    build: buildTwoBody,
  },
  {
    id: "cluster",
    label: "Star cluster",
    blurb:
      "A few hundred stars sampled from a Plummer profile. Every star feels every other, so " +
      "relaxation and mass segregation emerge rather than being imposed.",
    limits:
      "N ≤ 800, the measured interactive ceiling for direct N². No regularisation: a hard binary stops the " +
      "run rather than being resolved. The symmetric scheme is correct here but not interactive.",
    schemes: ["fsi4", "hermite", "symmetric", "leapfrog"],
    defaultScheme: "fsi4",
    build: buildCluster,
  },
  {
    id: "binary-in-cluster",
    label: "Binary in a cluster",
    blurb:
      "A binary at exactly zero softening inside a softened cluster — the encounters that " +
      "harden or ionise it are the ones being modelled exactly.",
    limits:
      "N ≤ 300. The binary is a single pair, not a hierarchy, and nothing here regularises it " +
      "if it hardens beyond what the timestep can follow.",
    schemes: ["fsi4", "hermite", "symmetric", "leapfrog"],
    defaultScheme: "fsi4",
    build: buildBinaryInCluster,
  },
];

export function scenario(id: ScenarioId): Scenario {
  const found = SCENARIOS.find((s) => s.id === id);
  if (!found) throw new Error(`unknown scenario: ${id}`);
  return found;
}
