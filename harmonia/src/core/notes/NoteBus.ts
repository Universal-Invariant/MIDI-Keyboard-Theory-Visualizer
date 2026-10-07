/**
 * NoteBus — the single source of truth for "what is sounding right now".
 *
 * Tracks held notes and recently-released "ghost" notes whose evidence decays
 * exponentially (README §6a: melody notes arriving after comping was released
 * should still inform the chord). Also emits events so UI panels can subscribe.
 */

import type { MidiNoteEvent, NoteState, GhostNote } from '../types.ts';

type Listener = (state: NoteState) => void;

export interface NoteBusOptions {
  /** Half-life of ghost-note evidence in ms. */
  ghostHalfLifeMs?: number;
  /** Ghosts older than this are dropped entirely. */
  ghostMaxAgeMs?: number;
}

export class NoteBus {
  private held = new Map<number, { velocity: number; channel: number; since: number }>();
  private released: { pitch: number; velocity: number; channel: number; releasedAt: number }[] = [];
  private listeners = new Set<Listener>();
  private opts: Required<NoteBusOptions>;
  private decayTimer: ReturnType<typeof setInterval> | null = null;

  constructor(opts: NoteBusOptions = {}) {
    this.opts = {
      ghostHalfLifeMs: opts.ghostHalfLifeMs ?? 1500,
      ghostMaxAgeMs: opts.ghostMaxAgeMs ?? 4000,
    };
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Start periodic re-evaluation so ghost decay keeps analysis fresh. */
  startDecayLoop(intervalMs = 200): void {
    this.stopDecayLoop();
    this.decayTimer = setInterval(() => this.emit(), intervalMs);
  }

  stopDecayLoop(): void {
    if (this.decayTimer !== null) {
      clearInterval(this.decayTimer);
      this.decayTimer = null;
    }
  }

  handleEvent(ev: MidiNoteEvent): void {
    const now = ev.timestamp;
    if (ev.name === 'note-on' && ev.velocity > 0) {
      this.held.set(ev.pitch, { velocity: ev.velocity, channel: ev.channel, since: now });
      // Re-triggered note removes its ghost.
      this.released = this.released.filter((r) => r.pitch !== ev.pitch);
    } else {
      const h = this.held.get(ev.pitch);
      this.held.delete(ev.pitch);
      if (h) {
        this.released.push({ pitch: ev.pitch, velocity: h.velocity, channel: h.channel, releasedAt: now });
      }
    }
    this.emit();
  }

  /** Panic: clear everything (e.g. on port disconnect / All-Notes-Off). */
  allNotesOff(now = performance.now()): void {
    this.held.clear();
    this.released = [];
    void now;
    this.emit();
  }

  getState(now = performance.now()): NoteState {
    const held = [...this.held.entries()]
      .map(([pitch, v]) => ({ pitch, ...v }))
      .sort((a, b) => a.pitch - b.pitch);

    const ghosts: GhostNote[] = [];
    for (const r of this.released) {
      const age = now - r.releasedAt;
      if (age > this.opts.ghostMaxAgeMs) continue;
      const weight = Math.pow(0.5, age / this.opts.ghostHalfLifeMs);
      ghosts.push({ pitch: r.pitch, velocity: r.velocity, channel: r.channel, since: r.releasedAt, releasedAt: r.releasedAt, weight });
    }

    return { held, ghosts, timestamp: now };
  }

  private emit(): void {
    const state = this.getState();
    // Prune expired ghosts from storage as well.
    const now = state.timestamp;
    this.released = this.released.filter((r) => now - r.releasedAt <= this.opts.ghostMaxAgeMs);
    for (const fn of this.listeners) fn(state);
  }
}
