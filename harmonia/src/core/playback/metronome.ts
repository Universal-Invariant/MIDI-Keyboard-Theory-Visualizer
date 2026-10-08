/**
 * Metronome (README §10): Web Audio click with selectable meters and feel
 * patterns — plain 4/4, 3/4, 6/8, son clave, bossa clave, tango… v0.5 ships a
 * lookahead scheduler; per-beat accents come from pattern arrays where
 *   2 = strong accent, 1 = normal click, 0 = silent (rest).
 */

export interface MeterPattern {
  id: string;
  name: string;
  /** Clicks per bar (grid slots). */
  slots: number[];
  /** Accent level per slot: 0 = rest, 1 = weak, 2 = strong. Same length as slots. */
  accents: number[];
  /** Beats per bar in quarter-note terms (for display). */
  beatsPerBar: number;
}

const M = (id: string, name: string, slots: number[], accents: number[], beatsPerBar: number): MeterPattern =>
  ({ id, name, slots, accents, beatsPerBar });

export const METERS: MeterPattern[] = [
  M('4/4',        '4/4',                [1, 1, 1, 1],           [2, 0, 1, 0],          4),
  M('3/4',        '3/4 (waltz)',        [1, 1, 1],              [2, 0, 0],             3),
  M('6/8',        '6/8',                [1, 1, 1, 1, 1, 1],     [2, 0, 0, 1, 0, 0],    2),
  M('2/4',        '2/4 (march)',        [1, 1],                 [2, 0],                2),
  M('5/4',        '5/4 (3+2)',          [1, 1, 1, 1, 1],        [2, 0, 1, 0, 0],       5),
  M('7/8',        '7/8 (2+2+3)',        [1, 1, 1, 1, 1, 1, 1],  [2, 0, 1, 0, 1, 0, 0], 7),
  // Latin feels — "slots" subdivide the bar; accents place the clave hits.
  M('son-3-2',    'Son clave (3-2)',    [1, 1, 1, 1, 1, 1, 1, 1], [2, 0, 1, 0, 1, 0, 2, 0], 4),
  M('son-2-3',    'Son clave (2-3)',    [1, 1, 1, 1, 1, 1, 1, 1], [2, 0, 1, 0, 0, 1, 0, 2], 4),
  M('rumba',      'Rumba clave (3-2)',  [1, 1, 1, 1, 1, 1, 1, 1], [2, 0, 1, 0, 0, 2, 0, 1], 4),
  M('bossa',      'Bossa nova',         [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
                                          [2, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1], 4),
  M('tango',      'Tango',              [1, 1, 1, 1, 1, 1, 1, 1], [2, 0, 0, 1, 0, 1, 0, 1], 4),
];

export function getMeter(id: string): MeterPattern {
  return METERS.find((m) => m.id === id) ?? METERS[0];
}

export interface MetronomeOptions {
  bpm: number;            // quarter-note BPM
  meterId: string;
  volume?: number;        // 0..1
  onBeat?: (slot: number, bar: number, accent: number) => void;
}

/**
 * Scheduler with 25ms lookahead timer (Chris Wilson's "A Tale of Two Clocks").
 * Works headless too: pass a fake AudioContext-like object in tests.
 */
export class Metronome {
  private ctx: AudioContext | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private nextSlotTime = 0;
  private slotIdx = 0;
  private bar = 0;
  private opts: Required<Pick<MetronomeOptions, 'bpm' | 'meterId' | 'volume'>> & MetronomeOptions;
  private running = false;

  constructor(opts: MetronomeOptions) {
    this.opts = { volume: 0.5, ...opts };
  }

  setBpm(bpm: number): void { this.opts.bpm = Math.min(300, Math.max(20, bpm)); }
  setMeter(id: string): void { this.opts.meterId = id; }
  setVolume(v: number): void { this.opts.volume = v; }
  get isRunning(): boolean { return this.running; }

  start(ctx?: AudioContext): void {
    if (this.running) return;
    this.ctx = ctx ?? this.ctx ?? new AudioContext();
    void this.ctx.resume?.();
    this.running = true;
    this.slotIdx = 0;
    this.bar = 0;
    this.nextSlotTime = this.ctx.currentTime + 0.06;
    this.timer = setInterval(() => this.schedule(), 25);
  }

  stop(): void {
    this.running = false;
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  /** Seconds per grid slot for the current meter at the current tempo. */
  slotSeconds(): number {
    const meter = getMeter(this.opts.meterId);
    const quarter = 60 / this.opts.bpm;
    // slots are assumed eighth-note subdivisions when count == 2*beatsPerBar, else quarters.
    const subdiv = meter.slots.length === meter.beatsPerBar * 2 ? 0.5 : 1;
    return quarter * subdiv;
  }

  private schedule(): void {
    if (!this.ctx || !this.running) return;
    const meter = getMeter(this.opts.meterId);
    const dur = this.slotSeconds();
    while (this.nextSlotTime < this.ctx.currentTime + 0.12) {
      const slot = this.slotIdx % meter.slots.length;
      const accent = meter.accents[slot];
      if (accent > 0) this.click(this.nextSlotTime, accent);
      this.opts.onBeat?.(slot, this.bar, accent);
      this.nextSlotTime += dur;
      this.slotIdx++;
      if (this.slotIdx % meter.slots.length === 0) this.bar++;
    }
  }

  private click(time: number, accent: number): void {
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.frequency.value = accent === 2 ? 1600 : 1100;
    const v = this.opts.volume * (accent === 2 ? 1 : 0.6);
    gain.gain.setValueAtTime(v, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.05);
    osc.connect(gain).connect(this.ctx.destination);
    osc.start(time);
    osc.stop(time + 0.06);
  }
}
