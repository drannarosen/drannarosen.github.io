/*
 * feedback.ts — Layer 1 state: load a realization and run the budget.
 *
 * Bridges the shipped realization data to the pure Layer-0 feedback core. It
 * fetches only what the BUDGET needs (meta + the per-star arrays + the gas
 * enclosed-mass profile) and returns the computed ledger and time trajectory.
 * It does NOT touch the render volume or the WebGL engine: the page composes
 * this with viz/loadScene separately, so state depends on core alone and the
 * import-boundary gate stays satisfied (the browser caches the shared meta.json
 * and stars.f32 fetches, so the split costs no extra network).
 */
import {
  computeLedger,
  type Ledger,
  type LedgerInput,
  type LeakageKnobs,
} from "../core/feedback/ledger.ts";
import {
  momentumTrajectory,
  type MomentumTrajectory,
} from "../core/feedback/trajectory.ts";
import type { WindPrescription } from "../core/feedback/winds.ts";

export interface FeedbackRealization {
  /** Directory name (the root realization is the empty string). */
  name: string;
  /** The raw export metadata, for page copy that must quote the dataset. */
  meta: Record<string, number | string>;
  /** The ledger input, retained so knobs can be re-applied without refetching. */
  input: LedgerInput;
  ledger: Ledger;
  trajectory: MomentumTrajectory;
  /**
   * M_gas(<r)/M_gas on a uniform radial grid 0..gasMencRMaxPc — the enclosed gas
   * fraction the evacuation reads: clearing costs more where more gas lies
   * inside, so it stalls in the dense core and breaks out through the tenuous
   * edge. Same profile binding.ts integrates, so the animation and the E_bind
   * bar share one source of truth.
   */
  gasMencFrac: Float32Array;
  gasMencRMaxPc: number;
}

export interface FeedbackOptions {
  leakage?: Partial<LeakageKnobs>;
  enabled?: { winds?: boolean; photoionization?: boolean; radiation?: boolean };
  prescription?: WindPrescription;
  /** Time samples for the trajectory (default 60). */
  nSteps?: number;
}

/** Build a LedgerInput from fetched meta + arrays. Exported for reuse/testing. */
export function feedbackInputFromParts(
  meta: Record<string, number>,
  stars: Float32Array,
  localDensity: Float32Array,
  opts: FeedbackOptions = {},
): LedgerInput {
  const n = meta.n_stars;
  const mass = new Float64Array(n);
  const teff = new Float64Array(n);
  const radius = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    mass[i] = stars[i * 6 + 3]!;
    teff[i] = stars[i * 6 + 4]!;
    radius[i] = stars[i * 6 + 5]!;
  }
  return {
    mass,
    teff,
    radius,
    localDensity,
    mCloud: meta.env_m_cloud_actual_msun!,
    rCloudPc: meta.env_radius_pc!,
    effGamma: meta.eff_gamma!,
    effAPc: meta.eff_a_pc!,
    vEscCloud: meta.env_v_esc_km_s!,
    sfe: meta.sfe_ic!,
    tCrossMyr: meta.t_cross_myr!,
    qVirialStarsOnly: meta.q_virial_stars_only!,
    leakage: opts.leakage,
    enabled: opts.enabled,
    prescription: opts.prescription,
  };
}

/**
 * Load one realization and compute its budget. `name` is the export directory
 * (omit for the root/fiducial); `opts` overrides the leakage knobs, channel
 * switches and wind prescription, and sets the trajectory resolution.
 */
export async function loadFeedbackRealization(
  name?: string,
  opts: FeedbackOptions = {},
): Promise<FeedbackRealization> {
  const base = name ? `/data/gravoturb/${name}` : "/data/gravoturb";
  const [meta, starBuf, ldBuf, mencBuf] = await Promise.all([
    fetch(`${base}/meta.json`).then((r) => r.json() as Promise<Record<string, number>>),
    fetch(`${base}/stars.f32`).then((r) => r.arrayBuffer()),
    fetch(`${base}/local_density.f32`).then((r) => r.arrayBuffer()),
    fetch(`${base}/gas_menc.f32`).then((r) => r.arrayBuffer()),
  ]);
  const stars = new Float32Array(starBuf);
  const localDensity = new Float32Array(ldBuf);
  const input = feedbackInputFromParts(meta, stars, localDensity, opts);
  return {
    name: name ?? "",
    meta,
    input,
    ledger: computeLedger(input),
    trajectory: momentumTrajectory(input, opts.nSteps ?? 60),
    gasMencFrac: new Float32Array(mencBuf),
    gasMencRMaxPc: meta.gas_menc_r_max_pc!,
  };
}

/** Recompute the budget after a knob change, reusing the already-loaded arrays. */
export function recomputeFeedback(
  realization: FeedbackRealization,
  opts: FeedbackOptions = {},
): FeedbackRealization {
  const input: LedgerInput = {
    ...realization.input,
    leakage: opts.leakage ?? realization.input.leakage,
    enabled: opts.enabled ?? realization.input.enabled,
    prescription: opts.prescription ?? realization.input.prescription,
  };
  return {
    ...realization,
    input,
    ledger: computeLedger(input),
    trajectory: momentumTrajectory(input, opts.nSteps ?? 60),
  };
}
