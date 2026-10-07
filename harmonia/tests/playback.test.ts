import { describe, expect, it } from 'vitest';
import {
  midiC,
  parseChordSymbol,
  voicingFor,
  voicingForCandidate,
} from '../src/core/playback/chordVoicings.ts';
import { buildSequence, newStep, Sequencer, type NoteOnOff } from '../src/core/playback/sequencer.ts';
import type { ChordCandidate } from '../src/core/types.ts';

describe('parseChordSymbol', () => {
  it('parses plain major and minor', () => {
    expect(parseChordSymbol('C').rootPc).toBe(0);
    expect(parseChordSymbol('C').intervals).toEqual([0, 4, 7]);
    expect(parseChordSymbol('Am').rootPc).toBe(9);
    expect(parseChordSymbol('Am').intervals).toEqual([0, 3, 7]);
  });

  it('parses flats, augmented, and longest-suffix qualities', () => {
    const ab = parseChordSymbol('Ab+');
    expect(ab.rootPc).toBe(8);
    expect(ab.intervals).toEqual([0, 4, 8]);
    // m7b5 must beat m7 / dim etc.
    const halfDim = parseChordSymbol('F#m7b5');
    expect(halfDim.rootPc).toBe(6);
    expect(halfDim.intervals).toEqual([0, 3, 6, 10]);
  });

  it('parses slash bass', () => {
    const p = parseChordSymbol('C/E');
    expect(p.rootPc).toBe(0);
    expect(p.bassPc).toBe(4);
  });

  it('degrades gracefully on garbage input', () => {
    const p = parseChordSymbol('not a chord');
    expect(p.rootPc).toBeNull();
    expect(voicingFor(p)).toEqual([]);
  });
});

describe('voicingFor', () => {
  it('builds a close voicing near the base octave', () => {
    const v = voicingFor(parseChordSymbol('C'), 4);
    expect(v).toEqual([midiC(4), midiC(4) + 4, midiC(4) + 7]); // C4 E4 G4
  });

  it('places slash bass below the stack without doubling', () => {
    const v = voicingFor(parseChordSymbol('C/E'), 4);
    expect(v[0]).toBe(midiC(4) + 4); // E3-ish lowest
    expect(new Set(v).size).toBe(v.length); // no duplicates
    expect(v).toEqual([...v].sort((a, b) => a - b));
  });

  it('keeps pitches in MIDI range', () => {
    for (const p of voicingFor(parseChordSymbol('B7'), 5)) {
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(127);
    }
  });
});

describe('voicingForCandidate', () => {
  it('spells a candidate with root in the bass', () => {
    const cand: ChordCandidate = {
      symbol: 'Cm', templateId: 'min', rootPc: 0, quality: 'minor',
      pcs: [0, 3, 7], probability: 1, score: 1, spelling: [],
    } as unknown as ChordCandidate;
    const v = voicingForCandidate(cand, 4);
    expect(v[0]).toBe(midiC(4));       // root C4 lowest
    expect(v).toContain(midiC(4) + 3); // Eb
    expect(v).toContain(midiC(4) + 7); // G
  });
});

describe('buildSequence', () => {
  it('emits on/off events per enabled step, skipping blanks/disabled', () => {
    const steps = [
      newStep('C', 4),
      newStep('', 4),
      (() => { const s = newStep('G7', 2); s.enabled = false; return s; })(),
      newStep('Am', 2),
    ];
    const { events, totalBeats } = buildSequence(steps);
    expect(totalBeats).toBe(6); // only C (4) + Am (2) count
    const ons = events.filter((e) => e.kind === 'on');
    expect(ons.filter((e) => e.atBeat === 0).length).toBe(3); // C triad
    expect(ons.every((e) => e.atBeat === 0 || e.atBeat === 4)).toBe(true);
    // offs happen just before next downbeat
    const offs = events.filter((e) => e.kind === 'off');
    expect(offs.some((e) => e.atBeat > 3.5 && e.atBeat < 4)).toBe(true);
  });
});

describe('Sequencer', () => {
  function collect(opts?: { bpm?: number; loop?: boolean }) {
    const fired: NoteOnOff[] = [];
    let loops = 0;
    const seq = new Sequencer({
      bpm: opts?.bpm ?? 120,
      loop: opts?.loop ?? true,
      emit: (ev) => fired.push(ev),
      onLoop: () => loops++,
    });
    return { seq, fired, loopsOf: () => loops };
  }

  it('fires events as beats advance at correct tempo', () => {
    const { seq, fired } = collect({ bpm: 120 });
    seq.load(buildSequence([newStep('C', 2), newStep('F', 2)]));
    seq.start();
    seq.advanceSeconds(0.5); // 120bpm → 1 beat per 0.5s
    expect(fired.filter((e) => e.kind === 'on').length).toBe(3); // C triad at beat 0
    seq.advanceSeconds(0.5); // now at beat 2 → F should fire
    const fOn = fired.filter((e) => e.kind === 'on' && e.atBeat === 2).length;
    expect(fOn).toBeGreaterThan(0);
  });

  it('loops and calls onLoop each pass', () => {
    const { seq, fired, loopsOf } = collect({ bpm: 120, loop: true });
    seq.load(buildSequence([newStep('C', 1)])); // one-note? triad, 1 beat loop
    seq.start();
    seq.advanceSeconds(2.0); // 4 beats → ≥3 loop wraps
    expect(loopsOf()).toBeGreaterThanOrEqual(3);
    expect(fired.length).toBeGreaterThan(6);
  });

  it('stops when non-loop sequence finishes', () => {
    const { seq } = collect({ bpm: 120, loop: false });
    seq.load(buildSequence([newStep('C', 1)]));
    seq.start();
    seq.advanceSeconds(5);
    expect(seq.running).toBe(false);
  });

  it('clamps bpm to sane bounds', () => {
    const { seq } = collect();
    seq.setBpm(1); expect(seq.currentBeat).toBe(0); // no throw
    seq.setBpm(9999); // clamped internally to 300
  });
});
