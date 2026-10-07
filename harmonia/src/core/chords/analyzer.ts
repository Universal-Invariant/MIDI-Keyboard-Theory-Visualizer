/**
 * Bayesian chord analyzer — v0.1 (triads only).
 *
 * posterior ∝ likelihood(observed pitch content | chord) × prior(chord | key, bass)
 *
 * Likelihood model: each observed pitch class contributes evidence with a weight
 * (held notes = 1, ghost notes = decaying weight). For a candidate chord:
 *   - matched chord tones raise the score (weighted by how strongly observed),
 *   - unmatched observations ("foreign" notes) lower it,
 *   - unobserved chord tones cost a little (missing-tone penalty).
 * Scores are log-space; softmax over candidates gives normalized probabilities.
 *
 * TODO(v0.3+, README §6): interval-based templates beyond triads, root detection
 * from voicings (omitted roots, 5th-in-bass), slash-chord output, voice-leading
 * transition prior, note-order/velocity weighting, polyphonic segmentation.
 */

import type { ChordCandidate, NoteState, KeySignatureSetting } from '../types.ts';
import { enumerateCandidates, chordPcs } from './vocabulary.ts';
import { Priors } from './priors.ts';
import { pcName, QUALITY_SUFFIX } from '../theory/pitch.ts';

export interface AnalyzeOptions {
  key: KeySignatureSetting;
  /** How many top candidates to return. */
  topN?: number;
}

const CANDIDATES = enumerateCandidates();

/** Softmax with temperature so probability spreads reflect relative log-scores. */
function softmax(scores: number[], temperature = 1): number[] {
  const max = Math.max(...scores);
  const exps = scores.map((s) => Math.exp((s - max) / temperature));
  const sum = exps.reduce((a, b) => a + b, 0);
  return exps.map((e) => e / sum);
}

export function analyzeChords(state: NoteState, opts: AnalyzeOptions): ChordCandidate[] {
  // Weighted multiset of observed pitch classes: held=1.0, ghosts decay 1.0→0.
  const observed = new Map<number, number>();
  for (const n of state.held) {
    const pc = n.pitch % 12;
    observed.set(pc, (observed.get(pc) ?? 0) + 1);
  }
  for (const g of state.ghosts) {
    const pc = g.pitch % 12;
    observed.set(pc, (observed.get(pc) ?? 0) + g.weight * 0.6);
  }

  if (observed.size === 0) return [];

  const totalWeight = [...observed.values()].reduce((a, b) => a + b, 0);
  const bassPitch = state.held.length
    ? Math.min(...state.held.map((n) => n.pitch))
    : undefined;
  const priors = new Priors({ key: opts.key, bassPitch });

  const raw: { cand: Omit<ChordCandidate, 'probability' | 'score' | 'reason'>; logScore: number; reason: string }[] = [];

  for (const { rootPc, template, pcs } of CANDIDATES) {
    const chordPcList = chordPcs(rootPc, template);
    let matchW = 0;      // observed weight on chord tones
    let foreignW = 0;    // observed weight NOT in the chord
    let missingTones = 0;
    for (const [pc, w] of observed) {
      if (pcs.has(pc)) matchW += w;
      else foreignW += w;
    }
    for (const pc of chordPcList) {
      if (!observed.has(pc)) missingTones++;
    }

    // Log-likelihood: reward coverage, penalize foreign & missing tones.
    const coverage = matchW / totalWeight;            // 0..1
    const purity = matchW / (matchW + foreignW || 1); // 0..1
    let logLik =
      4.0 * coverage +          // most of what you played should be in the chord
      4.0 * purity -            // none of what you played should be outside it
      1.2 * missingTones;       // prefer chords fully spelled by your notes

    const logPrior = priors.logPrior(chordPcList);
    const logScore = logLik + logPrior;

    const symbol = pcName(rootPc) + (QUALITY_SUFFIX[template.quality] ?? '?');
    const reason =
      `covers ${(coverage * 100).toFixed(0)}% of notes, ` +
      `${(purity * 100).toFixed(0)}% pure` +
      (missingTones ? `, ${missingTones} tone(s) missing` : ', complete') +
      (logPrior > 0 ? ', in key' : logPrior < 0 ? ', out of key' : '');

    raw.push({
      cand: { symbol, rootPc, quality: template.quality, pcs: chordPcList },
      logScore,
      reason,
    });
  }

  raw.sort((a, b) => b.logScore - a.logScore);
  const top = raw.slice(0, opts.topN ?? 4);
  const probs = softmax(top.map((r) => r.logScore));

  return top.map((r, i) => ({ ...r.cand, score: r.logScore, probability: probs[i], reason: r.reason }));
}
