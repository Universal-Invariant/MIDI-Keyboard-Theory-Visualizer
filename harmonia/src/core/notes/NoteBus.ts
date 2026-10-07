/**
 * NoteBus — the single source of truth for "what is sounding right now".
 *
 * Tracks held notes and recently-released "ghost" notes whose evidence decays
 * exponentially (README §6a: melody notes arriving after comping was released
 * should still inform the chord). Also emits events so UI panels can subscribe.
 */

import type { MidiEvent, MidiNoteEvent, NoteState, GhostNote } from '../types.ts';

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
  /** Notes kept alive by the sustain pedal (CC64) after finger release. */
  private sustained = new Map<number, { velocity: number; channel: number; since: number }>();
  private pedalDown = false;
  private listeners = new Set<Listener>();
  private opts: Required<NoteBusOptions>;
  private decayTimer: ReturnType<typeof setInterval> | null = null;

  constructor(opts: NoteBusOptions = {}) {
    this.opts = {
      ghostHalfLifeMs: opts.ghostHalfLifeMs ?? 750,
      ghostMaxAgeMs: opts.ghostMaxAgeMs ?? 1500,
    };
  }

  /** Reconfigure ghost memory at runtime (Settings dialog). */
  setGhostMemory(halfLifeMs: number, maxAgeMs: number): void {
    this.opts.ghostHalfLifeMs = Math.max(1, halfLifeMs);
    this.opts.ghostMaxAgeMs = Math.max(this.opts.ghostHalfLifeMs, maxAgeMs);
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

  handleEvent(ev: MidiEvent): void {
    const now = ev.timestamp;
    if (ev.name === 'control-change') {
      if (ev.controller === 64) this.setSustainPedal(ev.value >= 64, now);
      if (ev.controller === 123 || ev.controller === 120) this.allNotesOff(now); // All Notes Off / All Sound Off
      return;
    }
    const noteEv: MidiNoteEvent = ev;
    if (noteEv.name === 'note-on' && noteEv.velocity > 0) {
      this.held.set(ev.pitch, { velocity: ev.velocity, channel: ev.channel, since: now });
      // Re-triggered note removes its ghost and any stale pedal hold.
      this.released = this.released.filter((r) => r.pitch !== ev.pitch);
      this.sustained.delete(ev.pitch);
    } else {
      const h = this.held.get(ev.pitch);
      this.held.delete(ev.pitch);
      if (h) {
        if (this.pedalDown) {
          this.sustained.set(ev.pitch, h);   // pedal keeps it "held" until release
        } else {
          this.released.push({ pitch: ev.pitch, velocity: h.velocity, channel: h.channel, releasedAt: now });
        }
      }
    }
    this.emit();
  }

  /** Sustain pedal (CC64) state change. On release, held-by-pedal notes become ghosts. */
  setSustainPedal(down: boolean, now = performance.now()): void {
    if (down === this.pedalDown) return;
    this.pedalDown = down;
    if (!down) {
      for (const [pitch, h] of this.sustained) {
        this.released.push({ pitch, velocity: h.velocity, channel: h.channel, releasedAt: now });
      }
      this.sustained.clear();
      this.emit();
    }
  }

  get sustainPedalDown(): boolean { return this.pedalDown; }

  /** Panic: clear everything (e.g. on port disconnect / All-Notes-Off). */
  allNotesOff(now = performance.now()): void {
    this.held.clear();
    this.sustained.clear();
    this.released = [];
    void now;
    this.emit();
  }

  getState(now = performance.now()): NoteState {
    // Pedal-sustained notes count as held (slightly softer evidence than finger-held).
    const heldEntries = [...this.held.entries(), ...[...this.sustained.entries()].map(([p, v]) => [p, { ...v, sustained: true }] as const)];
    const seen = new Map<number, { velocity: number; channel: number; since: number }>();
    for (const [pitch, v] of heldEntries) {
      const prev = seen.get(pitch);
      if (!prev || v.velocity > prev.velocity) seen.set(pitch, v);
    }
    const held = [...seen.entries()]
      .map(([pitch, v]) => ({ pitch, velocity: v.velocity, channel: v.channel, since: v.since }))
      .sort((a, b) => a.pitch - b.pitch);

    const ghosts: GhostNote[] = [];
    if (this.opts.ghostMaxAgeMs > 0) {
      for (const r of this.released) {
        const age = now - r.releasedAt;
        if (age > this.opts.ghostMaxAgeMs) continue;
        const weight = Math.pow(0.5, age / this.opts.ghostHalfLifeMs);
        ghosts.push({ pitch: r.pitch, velocity: r.velocity, channel: r.channel, since: r.releasedAt, releasedAt: r.releasedAt, weight });
      }
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
