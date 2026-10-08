/**
 * Harmonic priors — the pluggable "prior" half of the Bayesian analyzer.
 *
 * v0.1: simple, transparent priors (key/scale diatonicity + bass-root hint).
 * Later phases (README §6) will add: voice-leading transition costs from
 * previous chords, a Markov chord-progression model trained on jazz corpora,
 * and learned embeddings. Everything is funneled through this one interface so
 * `analyzer.ts` never has to change when the priors get smarter.
 */

import type { KeySignatureSetting } from '../types.ts';
import { scalePitchClasses, getScale } from '../theory/scales.ts';
import { pitchClass } from '../theory/pitch.ts';

export interface PriorContext {
  key: KeySignatureSetting;
  /** Lowest held pitch — roots in the bass are strong evidence (later: slash chords). */
  bassPitch?: number;
}

export class Priors {
  private scalePcs: Set<number>;

  constructor(ctx: PriorContext) {
    this.scalePcs = scalePitchClasses(ctx.key.tonic, getScale(ctx.key.scale));
    this.bassRootBonus = ctx.bassPitch !== undefined ? Priors.BASS_ROOT_LOG_BONUS : 0;
    this.bassPc = ctx.bassPitch !== undefined ? pitchClass(ctx.bassPitch) : -1;
  }

  /** log-prior boost for chords whose tones all sit inside the selected key/scale. */
  static readonly DIATONIC_LOG_BONUS = Math.log(2.5);
  /** per out-of-key chord tone penalty. */
  static readonly OUT_OF_KEY_LOG_PENALTY = Math.log(0.75);
  /** log-prior boost when the candidate root matches the bass note's pitch class. */
  static readonly BASS_ROOT_LOG_BONUS = Math.log(1.8);

  private bassRootBonus: number;
  private bassPc: number;

  /** Returns log-prior for a candidate with pitch classes `pcs`. */
  logPrior(pcs: Iterable<number>): number {
    let lp = 0;
    for (const pc of pcs) {
      if (!this.scalePcs.has(pc)) lp += Priors.OUT_OF_KEY_LOG_PENALTY;
    }
    const allIn = [...pcs].every((pc) => this.scalePcs.has(pc));
    if (allIn) lp += Priors.DIATONIC_LOG_BONUS;
    if (this.bassPc >= 0 && [...pcs][0] === this.bassPc) lp += this.bassRootBonus;
    return lp;
  }
}
