/**
 * PracticePanel (README §9/§10): transport bar with metronome + progression
 * editor. Chords can be typed as symbols ("Cm6", "Ab+", "F7sus4/Bb"), loaded
 * from the chord history, toggled in/out of the loop, and played back through
 * the Sequencer — to the on-screen keyboard (via NoteBus) and optionally out
 * the selected MIDI output port.
 */

import { Metronome, getMeter } from '../core/playback/metronome.ts';
import { Sequencer, buildSequence, newStep, type ProgressionStep } from '../core/playback/sequencer.ts';
import type { MidiEvent } from '../core/types.ts';
import type { WebMidiAdapter } from '../midi/WebMidiAdapter.ts';
import type { AppSettings } from './SettingsDialog.ts';
import { saveSettings } from './SettingsDialog.ts';

export interface PracticePanelDeps {
  settings: AppSettings;
  adapter: WebMidiAdapter;
  inject: (ev: MidiEvent) => void;         // feed events into the visualizer bus
  getHistorySymbols: () => string[];       // last-4 chord symbols for "load history"
}

export class PracticePanel {
  private root: HTMLElement;
  private deps: PracticePanelDeps;
  private metronome: Metronome;
  private sequencer: Sequencer;
  private steps: ProgressionStep[];
  private rafId = 0;
  private lastTs = 0;
  private beatDotsEl!: HTMLElement;
  private statusEl!: HTMLElement;
  private rowsEl!: HTMLElement;
  private playingChords = false;
  private clickOn = false;

  constructor(root: HTMLElement, deps: PracticePanelDeps) {
    this.root = root;
    this.deps = deps;
    this.steps = deps.settings.progression.map((s) => ({ ...s }));
    if (this.steps.length === 0) this.steps.push(newStep('', 4), newStep('', 4));

    this.metronome = new Metronome({
      bpm: deps.settings.bpm,
      meterId: deps.settings.meterId,
      onBeat: (slot, _bar, accent) => this.renderBeat(slot, accent),
    });
    this.sequencer = new Sequencer({
      bpm: deps.settings.bpm,
      loop: deps.settings.loopProgression,
      emit: (ev) => this.emitNote(ev.kind === 'on', ev.pitch, ev.velocity),
      onLoop: () => {},
    });

    this.buildDom();
    this.renderRows();
    requestAnimationFrame((t) => this.tick(t));
  }

  // ---- DOM -------------------------------------------------------------------

  private buildDom(): void {
    this.root.innerHTML = `
      <div class="practice-grid">
        <div class="transport card">
          <div class="panel-label">Metronome</div>
          <div class="row">
            <button id="btn-click" type="button" title="Toggle metronome click">🔊 Click</button>
            <label class="bpm"><span>BPM</span><input id="bpm" type="number" min="20" max="300" value="${this.deps.settings.bpm}" /></label>
          </div>
          <div id="beat-dots" class="beat-dots"></div>
        </div>
        <div class="progression card">
          <div class="panel-label">Progression editor <span class="hint-small">(type symbols like Cm6, Ab+, F7sus4/Bb)</span></div>
          <div id="prog-rows"></div>
          <div class="row">
            <button id="btn-add" type="button">＋ Add chord</button>
            <button id="btn-load-history" type="button" title="Load the last 4 analyzed chords">⤓ Load history</button>
            <span class="spacer"></span>
            <button id="btn-play-prog" type="button" class="primary">▶ Play progression</button>
          </div>
          <div id="practice-status" class="practice-status"></div>
        </div>
      </div>`;

    const $ = <T extends HTMLElement>(id: string) => this.root.querySelector(`#${id}`) as T;
    this.beatDotsEl = $('beat-dots');
    this.statusEl = $('practice-status');
    this.rowsEl = $('prog-rows');

    $<HTMLButtonElement>('btn-click').addEventListener('click', () => this.toggleClick());
    $<HTMLInputElement>('bpm').addEventListener('change', (e) => {
      const v = Number((e.target as HTMLInputElement).value);
      this.setBpm(v);
    });
    $<HTMLButtonElement>('btn-add').addEventListener('click', () => { this.steps.push(newStep('', 4)); this.renderRows(); this.persist(); });
    $<HTMLButtonElement>('btn-load-history').addEventListener('click', () => this.loadFromHistory());
    $<HTMLButtonElement>('btn-play-prog').addEventListener('click', () => this.togglePlay());
  }

  private renderRows(): void {
    this.rowsEl.innerHTML = '';
    this.steps.forEach((step, i) => {
      const row = document.createElement('div');
      row.className = 'prog-row';

      const chk = document.createElement('input');
      chk.type = 'checkbox';
      chk.checked = step.enabled;
      chk.title = 'Include this chord in playback';
      chk.addEventListener('change', () => { step.enabled = chk.checked; this.reloadSequence(); this.persist(); });

      const sym = document.createElement('input');
      sym.type = 'text';
      sym.className = 'sym-input';
      sym.placeholder = 'e.g. Cm6';
      sym.value = step.symbol;
      sym.addEventListener('change', () => { step.symbol = sym.value; this.reloadSequence(); this.persist(); });

      const beats = document.createElement('input');
      beats.type = 'number';
      beats.className = 'beats-input';
      beats.min = '0.25';
      beats.step = '0.25';
      beats.value = String(step.beats);
      beats.title = 'Duration in quarter-note beats';
      beats.addEventListener('change', () => { step.beats = Math.max(0.25, Number(beats.value) || 1); this.reloadSequence(); this.persist(); });

      const del = document.createElement('button');
      del.type = 'button';
      del.textContent = '✕';
      del.title = 'Remove';
      del.addEventListener('click', () => {
        this.steps.splice(i, 1);
        if (this.steps.length === 0) this.steps.push(newStep('', 4));
        this.renderRows(); this.reloadSequence(); this.persist();
      });

      row.append(chk, sym, beats, del);
      this.rowsEl.appendChild(row);
    });
  }

  // ---- Transport ---------------------------------------------------------------

  setBpm(bpm: number): void {
    const v = Math.min(300, Math.max(20, bpm));
    this.deps.settings.bpm = v;
    this.metronome.setBpm(v);
    this.sequencer.setBpm(v);
    this.persist();
  }

  setMeter(id: string): void {
    this.deps.settings.meterId = id;
    this.metronome.setMeter(id);
    this.renderBeat(-1, 0);
    this.persist();
  }

  toggleClick(): void {
    this.clickOn = !this.clickOn;
    const btn = this.root.querySelector('#btn-click')!;
    btn.classList.toggle('active-toggle', this.clickOn);
    if (this.clickOn) this.metronome.start();
    else this.metronome.stop();
  }

  togglePlay(): void {
    this.playingChords = !this.playingChords;
    const btn = this.root.querySelector<HTMLButtonElement>('#btn-play-prog')!;
    if (this.playingChords) {
      this.reloadSequence();
      if (!this.sequencer.running) this.sequencer.start();
      btn.textContent = '⏸ Stop';
      btn.classList.add('playing');
    } else {
      this.sequencer.stop();
      // Release any notes we might have left hanging.
      for (const p of this.currentSoundingPitches) this.inject(true, p, 0);
      btn.textContent = '▶ Play progression';
      btn.classList.remove('playing');
    }
  }

  /** Called when settings changed elsewhere (meter/octave/loop). */
  applySettings(): void {
    const s = this.deps.settings;
    this.metronome.setBpm(s.bpm);
    this.metronome.setMeter(s.meterId);
    this.sequencer.setBpm(s.bpm);
    this.reloadSequence();
  }

  loadFromHistory(): void {
    const syms = this.deps.getHistorySymbols().filter(Boolean);
    if (syms.length === 0) {
      this.flashStatus('History is empty — play some chords first.');
      return;
    }
    this.steps = syms.map((symbol) => newStep(symbol, 4));
    this.renderRows();
    this.reloadSequence();
    this.persist();
  }

  private reloadSequence(): void {
    const wasRunning = this.sequencer.running;
    const result = buildSequence(this.steps, this.deps.settings.playbackOctave);
    this.sequencer.load(result);
    if (wasRunning) this.sequencer.start();
    this.updateStatus();
  }

  // ---- note routing -------------------------------------------------------------

  private currentSoundingPitches = new Set<number>();

  private emitNote(isOn: boolean, pitch: number, velocity: number): void {
    if (isOn) this.currentSoundingPitches.add(pitch);
    else this.currentSoundingPitches.delete(pitch);
    this.inject(isOn, pitch, velocity);
    if (this.deps.settings.playToOutput) {
      this.deps.adapter.sendNote(isOn ? 'note-on' : 'note-off', pitch, isOn ? velocity : 64);
    }
  }

  private inject(isOn: boolean, pitch: number, velocity: number): void {
    this.deps.inject({
      name: isOn ? 'note-on' : 'note-off',
      pitch, velocity, channel: 0, timestamp: performance.now(),
    });
  }

  /** Replay a single history entry (called when a history card is clicked). */
  replayPitches(pitches: number[], holdMs = 1200): void {
    const t0 = performance.now();
    for (const p of pitches) this.emitNote(true, p, 92);
    setTimeout(() => {
      for (const p of pitches) this.emitNote(false, p, 0);
    }, Math.max(200, holdMs));
    void t0;
  }

  // ---- rAF loop ------------------------------------------------------------------

  private tick(ts: number): void {
    if (this.lastTs !== 0) {
      const dt = Math.min(0.1, (ts - this.lastTs) / 1000);
      this.sequencer.advanceSeconds(dt);
      this.updateStatus();
    }
    this.lastTs = ts;
    this.rafId = requestAnimationFrame((t) => this.tick(t));
  }

  private updateStatus(): void {
    const beats = this.steps.filter((s) => s.enabled && s.symbol.trim()).reduce((a, s) => a + s.beats, 0);
    const bars = (beats / this.deps.settings.bpm).toFixed(1);
    this.statusEl.textContent = this.playingChords
      ? `Looping ${Math.round(beats)} beats (${bars} s)`
      : `${Math.round(beats)} beats in progression`;
  }

  private flashStatus(msg: string): void {
    this.statusEl.textContent = msg;
  }

  private renderBeat(slot: number, accent: number): void {
    const meter = getMeter(this.deps.settings.meterId);
    const n = meter.slots.length;
    if (this.beatDotsEl.childElementCount !== n) {
      this.beatDotsEl.innerHTML = '';
      for (let i = 0; i < n; i++) this.beatDotsEl.appendChild(document.createElement('span'));
    }
    [...this.beatDotsEl.children].forEach((dot, i) => {
      dot.classList.toggle('on', i === slot && accent > 0);
      dot.classList.toggle('strong', i === slot && accent === 2);
    });
  }

  private persist(): void {
    this.deps.settings.progression = this.steps.map((s) => ({ ...s }));
    saveSettings(this.deps.settings);
  }

  destroy(): void {
    cancelAnimationFrame(this.rafId);
    this.metronome.stop();
    this.sequencer.stop();
  }
}
