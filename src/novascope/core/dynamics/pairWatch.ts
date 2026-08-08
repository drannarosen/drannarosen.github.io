/*
 * pairWatch.ts — is there a binary, is it still the same one, and has it just swapped a
 * companion? (Layer 0, pure.)
 *
 * ── WHY THIS IS A MODULE AND NOT SIX LINES IN THE ENGINE ──
 *
 * It was six lines in the engine, and it was wrong twice in ways only a 25-crossing-time run
 * showed. The rule has four distinct transitions and every one of them is a physical claim the
 * page then makes out loud — a banner, a contextual tab, a slowed clock, and in one case ENDING
 * THE RUN. None of that was reachable from a test, because it lived in an `.astro` script block.
 *
 * ── THE TWO BUGS THIS SHAPE EXISTS TO PREVENT ──
 *
 * 1. ENTERING ON A FLYBY. A bare "is it tight?" threshold fires on any close passage. Measured on
 *    seed 2028, it announced a hard binary at t/t_cr 5.3 for a 2 + 38 M☉ pair that was gone moments
 *    later. Hence `persistTcross`: an unbound pair separates on roughly its own encounter
 *    timescale, so surviving half a crossing time together is what distinguishes a binary from
 *    two stars passing. That is a physical criterion, not a debounce.
 *
 * 2. LEAVING ON THE SAME THRESHOLD. `a` oscillates around the orbit and stepsPerOrbit goes as
 *    a^3/2, so a confirmed pair wanders back above the watch threshold with nothing physical
 *    happening. Measured over 25 crossing times at N = 400:
 *
 *      seed 2026   un-confirmed at t/t_cr 15.1 (spo 421) and 19.2 (505)
 *      seed 2027   at 8.4 (524), 12.8 (651), 16.7 (877), 20.2 (469)
 *      seed 2029   at 9.2 (1584)
 *
 *    The pair was the same two stars and still hard — hardness 160 to 235 through all of it —
 *    and the page dropped its banner, its readouts and its clock slow-down for between 0.56 and
 *    3.97 crossing times each time. So RELEASE is a statement about the binary (replaced, or no
 *    longer hard in Heggie's sense) rather than about the integrator's resolution of it.
 *
 * ── AND THE ONE THIS SHAPE MAKES VISIBLE ──
 *
 * An EXCHANGE swaps one companion and keeps the other. Measured on three of four seeds — at
 * t/t_cr 21.9, 18.7, and 19.8 and 21.8. Keyed on the raw `i:j` pair it reads as a brand-new
 * binary, so the persistence clock restarted and the binary vanished from the page for ~1
 * crossing time at the exact moment the most interesting thing happened to it. Sharing one star
 * is a CONTINUATION: the clock is not restarted, and the caller is told, so a plot can draw the
 * swap as a jump rather than as a gap.
 */

/** What the watch needs from a pair. `hardestBoundPair`'s result satisfies it structurally. */
export interface WatchedPair {
  i: number;
  j: number;
  /** Orbital periods per integrator step. NaN when the scheme sizes its own step. */
  stepsPerOrbit: number;
  /** Binding energy in units of the mean stellar kinetic energy. */
  hardness: number;
}

export interface PairWatchOptions {
  /** Tight enough to be worth announcing, in steps per orbit. */
  watchSteps?: number;
  /** How long a pair must hold that before it counts as a binary, in crossing times. */
  persistTcross?: number;
  /**
   * Below this hardness a confirmed pair is released.
   *
   * 1 is Heggie's own boundary: a binary less bound than a passing star's kinetic energy is one
   * an encounter breaks up rather than tightens, which is exactly when it stops being the object
   * the page is talking about. Measured hardness on a confirmed pair runs 160 to 235, so this
   * does not fire by accident.
   */
  releaseHardness?: number;
}

export interface PairWatchResult {
  /** Is there a binary the page may talk about? */
  confirmed: boolean;
  /** Bumped on confirmation and on every exchange. A plot colours by this. */
  segment: number;
  /** True on the single update where a companion was swapped. */
  exchanged: boolean;
  /** True on the single update where confirmation was gained or lost. */
  changed: boolean;
}

export interface PairWatch {
  /**
   * Advance the state machine.
   *
   * `pair` is null when there is no bound pair, or when the scheme reports no step size — both
   * mean "no claim available", and both release. `t` and `tCross` are model time and the
   * crossing time, in the same units.
   */
  update(pair: WatchedPair | null, t: number, tCross: number): PairWatchResult;
  reset(): void;
  readonly confirmed: boolean;
  readonly segment: number;
  /** The confirmed pair's indices, or null. Survives an exchange, by design. */
  readonly members: readonly [number, number] | null;
}

export function createPairWatch(opts: PairWatchOptions = {}): PairWatch {
  const watchSteps = opts.watchSteps ?? 400;
  const persistTcross = opts.persistTcross ?? 0.5;
  const releaseHardness = opts.releaseHardness ?? 1;

  let confirmed = false;
  let segment = 0;
  let members: [number, number] | null = null;
  let since = Infinity;
  let key = "";

  const clear = () => {
    confirmed = false;
    members = null;
    since = Infinity;
    key = "";
  };

  return {
    get confirmed() {
      return confirmed;
    },
    get segment() {
      return segment;
    },
    get members() {
      return members;
    },
    reset() {
      clear();
      segment = 0;
    },
    update(pair, t, tCross) {
      const was = confirmed;
      let exchanged = false;

      /* No pair, or no step size to judge one by. Both are "the watch has nothing to say", and
         saying nothing means releasing rather than holding the last claim. */
      if (!pair || !Number.isFinite(pair.stepsPerOrbit)) {
        clear();
        return { confirmed, segment, exchanged, changed: was !== confirmed };
      }

      const k = `${pair.i}:${pair.j}`;
      const shared = members
        ? (members.includes(pair.i) ? 1 : 0) + (members.includes(pair.j) ? 1 : 0)
        : 0;

      if (confirmed) {
        /* STAY, unless the binary itself ended: replaced outright, or no longer hard. */
        if (shared === 0 || pair.hardness < releaseHardness) {
          clear();
        } else if (shared === 1) {
          segment++;
          exchanged = true;
          members = [pair.i, pair.j];
          key = k;
        }
      } else {
        /* ENTER: tight, and holding, on the same pair. */
        if (pair.stepsPerOrbit < watchSteps) {
          if (k !== key) {
            key = k;
            since = t;
          }
        } else {
          key = "";
          since = Infinity;
        }
        if (t - since >= persistTcross * tCross) {
          confirmed = true;
          members = [pair.i, pair.j];
          segment++;
        }
      }
      return { confirmed, segment, exchanged, changed: was !== confirmed };
    },
  };
}
