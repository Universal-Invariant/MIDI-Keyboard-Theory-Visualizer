/**
 * Sequencer — drives progression playback and metronome-synced chord loops
 * (README §9). Pure logic: given a list of steps (chord symbols + durations in
 * beats) it computes note on/off events; the caller supplies an emitter so this
 * works with Web MIDI out, the internal NoteBus (on-screen feedback), or tests.
 */

import { parseChordSymbol, voicingFor } from './chordVoicings.ts';

export interface ProgressionStep {
  id: number;
  symbol: string;       // e.g. "Cm6", "Ab+", "F7sus4/Bb"
  beats: number;        // duration in quarter notes
  enabled: boolean;     // toggle individual chords in/out of the loop
}

export interface NoteOnOff {
  atBeat: number;       // absolute beat position in the loop
  pitch: number;
  velocity: number;
  kind: 'on' | 'off';
}

export interface SequenceResult {
  events: NoteOnOff[];
  totalBeats: number;
}

let nextId = 1;
export function newStep(symbol = '', beats = 4): ProgressionStep {
  return { id: nextId++, symbol, beats, enabled: true };
}

/** Build all note events for one pass of the progression (enabled steps only). */
export function buildSequence(steps: ProgressionStep[], octaveBase = 4, velocity = 88): SequenceResult {
  const events: NoteOnOff[] = [];
  let beat = 0;
  for (const s of steps) {
    if (!s.enabled || !s.symbol.trim()) continue;
    const parsed = parseChordSymbol(s.symbol);
    const pitches = voicingFor(parsed, octaveBase);
    for (const p of pitches) events.push({ atBeat: beat, pitch: p, velocity, kind: 'on' });
    // Release just before the next chord to avoid mud (0.15 beat overlap guard).
    const offBeat = beat + Math.max(0.25, s.beats - 0.15);
    for (const p of pitches) events.push({ atBeat: offBeat, pitch: p, velocity: 0, kind: 'off' });
    beat += s.beats;
  }
  events.sort((a, b) => a.atBeat - b.atBeat || (a.kind === 'off' ? -1 : 1));
  return { events, totalBeats: beat };
}

export interface SequencerOptions {
  bpm: number;
  loop: boolean;
  /** Where to send each event (MIDI out and/or inject into the visualizer bus). */
  emit: (ev: NoteOnOff, loopIteration: number) => void;
  /** Called at the end of every full pass (for UI "bar counter"/sync with metronome). */
  onLoop?: (iteration: number) => void;
}

/**
 * Beat-clock sequencer. `tick(dt)` is advanced externally (by rAF or by the
 * metronome's scheduler callback) so tempo/meter stay in one place.
 */
export class Sequencer {
  private events: NoteOnOff[] = [];
  private idx = 0;
  private beatPos = 0;
  private iteration = 0;
  private opts: SequencerOptions;
  private active = false;

  constructor(opts: SequencerOptions) {
    this.opts = opts;
  }

  setBpm(bpm: number): void { this.opts.bpm = Math.min(300, Math.max(20, bpm)); }
  get running(): boolean { return this.active; }
  get currentBeat(): number { return this.beatPos; }

  load(result: SequenceResult): void {
    this.events = result.events;
    this.idx = 0;
    this.beatPos = 0;
    this.iteration = 0;
  }

  start(): void {
    if (this.events.length === 0) return;
    this.active = true;
    this.beatPos = 0;
    this.idx = 0;
  }

  stop(): void {
    this.active = false;
  }

  /** Advance by real elapsed seconds (call from rAF). Fires any crossed events. */
  advanceSeconds(dt: number): void {
    if (!this.active) return;
    const beatsPerSec = this.opts.bpm / 60;
    const target = this.beatPos + dt * beatsPerSec;
    this.runUpTo(target);
  }

  /** Jump directly to a beat position (used when syncing to an external beat clock). */
  runUpTo(beatTarget: number): void {
    const total = this.events.length
      ? Math.max(...this.events.map((e) => e.atBeat))
      : 0;
    const loopLen = Math.max(total + 0.25, 0.0001);

    while (this.beatPos < beatTarget) {
      if (this.idx >= this.events.length) {
        if (!this.opts.loop) { this.active = false; return; }
        this.idx = 0;
        this.iteration++;
        this.opts.onLoop?.(this.iteration);
        // Wrap positions relative to loop length handled below via virtual beats.
      }
      const ev = this.events[this.idx];
      const baseBeat = this.iteration * loopLen;
      const evBeat = baseBeat + ev.atBeat;
      if (evBeat <= beatTarget) {
        this.opts.emit(ev, this.iteration);
        this.idx++;
      } else {
        this.beatPos = Math.min(beatTarget, evBeat - 0.000001);
        break;
      }
      this.beatPos = evBeat;
    }
    if (this.beatPos < beatTarget) this.beatPos = beatTarget;
  }
}
