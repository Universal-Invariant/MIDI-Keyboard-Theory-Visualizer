/**
 * Settings dialog (README §11): MIDI in/out ports, keyboard viz mode, key/mode.
 * v0.1 persists to localStorage; port lists refresh from the adapter on open and
 * whenever Web MIDI fires a statechange.
 */

import type { KeyboardVizMode, KeySignatureSetting } from '../core/types.ts';
import type { ProgressionStep } from '../core/playback/sequencer.ts';
import { NOTE_NAMES_FLAT } from '../core/theory/pitch.ts';
import { SCALES } from '../core/theory/scales.ts';
import { METERS } from '../core/playback/metronome.ts';
import type { WebMidiAdapter, PortInfo } from '../midi/WebMidiAdapter.ts';

export interface AppSettings {
  inputPortId: string | null;
  outputPortId: string | null;
  vizMode: KeyboardVizMode;
  baseOctave: number;         // for octave1 / octave2split modes
  key: KeySignatureSetting;
  /** Playback */
  bpm: number;
  meterId: string;
  loopProgression: boolean;
  playbackOctave: number;     // voicing octave for sequencer + history replay
  playToOutput: boolean;      // send MIDI out to hardware as well as on-screen
  progression: ProgressionStep[];
}

const STORAGE_KEY = 'harmonia.settings.v1';

export function loadSettings(): AppSettings {
  const defaults: AppSettings = {
    inputPortId: null,
    outputPortId: null,
    vizMode: 'full88',
    baseOctave: 4,
    key: { tonic: 0, scale: 'ionian' },
    bpm: 100,
    meterId: '4/4',
    loopProgression: true,
    playbackOctave: 4,
    playToOutput: true,
    progression: [],
  };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw);
    return { ...defaults, ...parsed, key: { ...defaults.key, ...parsed.key } };
  } catch {
    return defaults;
  }
}

export function saveSettings(s: AppSettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
}

export class SettingsDialog {
  private overlay: HTMLElement;
  private adapter: WebMidiAdapter;
  private settings: AppSettings;
  private onChange: (s: AppSettings) => void;

  constructor(root: HTMLElement, adapter: WebMidiAdapter, settings: AppSettings, onChange: (s: AppSettings) => void) {
    this.adapter = adapter;
    this.settings = settings;
    this.onChange = onChange;

    this.overlay = document.createElement('div');
    this.overlay.className = 'modal-overlay hidden';
    this.overlay.innerHTML = `
      <div class="modal" role="dialog" aria-label="Settings">
        <h2>Settings</h2>
        <label>MIDI Input Port
          <select id="sel-input"></select>
        </label>
        <label>MIDI Output Port
          <select id="sel-output"></select>
        </label>
        <label>Keyboard View
          <select id="sel-viz">
            <option value="full88">Full 88 keys</option>
            <option value="octave1">1 Octave (wrapped, octave badges)</option>
            <option value="octave2split">2 Octaves (smart split)</option>
          </select>
        </label>
        <label>Base Octave (wrapped/split modes)
          <select id="sel-base-oct"></select>
        </label>
        <label>Key
          <select id="sel-key"></select>
        </label>
        <label>Mode / Scale
          <select id="sel-scale"></select>
        </label>
        <h3>Playback</h3>
        <label>Metronome Meter
          <select id="sel-meter"></select>
        </label>
        <label>Default Voicing Octave
          <select id="sel-play-oct"></select>
        </label>
        <label class="check"><input type="checkbox" id="chk-loop" /> Loop progression playback</label>
        <label class="check"><input type="checkbox" id="chk-out" /> Send playback to MIDI output port</label>
        <div class="modal-actions">
          <button id="btn-refresh" type="button">Rescan Ports</button>
          <button id="btn-close" type="button" class="primary">Done</button>
        </div>
      </div>`;
    root.appendChild(this.overlay);

    const $ = <T extends HTMLElement>(id: string) => this.overlay.querySelector(`#${id}`) as T;
    const selInput = $<HTMLSelectElement>('sel-input');
    const selOutput = $<HTMLSelectElement>('sel-output');
    const selViz = $<HTMLSelectElement>('sel-viz');
    const selBase = $<HTMLSelectElement>('sel-base-oct');
    const selKey = $<HTMLSelectElement>('sel-key');
    const selScale = $<HTMLSelectElement>('sel-scale');
    const selMeter = $<HTMLSelectElement>('sel-meter');
    const selPlayOct = $<HTMLSelectElement>('sel-play-oct');
    const chkLoop = $<HTMLInputElement>('chk-loop');
    const chkOut = $<HTMLInputElement>('chk-out');

    for (let o = 0; o <= 8; o++) addOption(selBase, String(o), `C${o}`);
    for (let o = 1; o <= 7; o++) addOption(selPlayOct, String(o), `C${o}`);
    NOTE_NAMES_FLAT.forEach((n, pc) => addOption(selKey, String(pc), n));
    SCALES.forEach((s) => addOption(selScale, s.id, s.name));
    METERS.forEach((m) => addOption(selMeter, m.id, m.name));

    selViz.value = this.settings.vizMode;
    selBase.value = String(this.settings.baseOctave);
    selKey.value = String(this.settings.key.tonic);
    selScale.value = this.settings.key.scale;
    selMeter.value = this.settings.meterId;
    selPlayOct.value = String(this.settings.playbackOctave);
    chkLoop.checked = this.settings.loopProgression;
    chkOut.checked = this.settings.playToOutput;

    const commit = () => {
      this.settings.inputPortId = selInput.value || null;
      this.settings.outputPortId = selOutput.value || null;
      this.settings.vizMode = selViz.value as KeyboardVizMode;
      this.settings.baseOctave = Number(selBase.value);
      this.settings.key = { tonic: Number(selKey.value), scale: selScale.value };
      this.settings.meterId = selMeter.value;
      this.settings.playbackOctave = Number(selPlayOct.value);
      this.settings.loopProgression = chkLoop.checked;
      this.settings.playToOutput = chkOut.checked;
      saveSettings(this.settings);
      this.onChange(this.settings);
    };
    [selInput, selOutput, selViz, selBase, selKey, selScale, selMeter, selPlayOct, chkLoop, chkOut]
      .forEach((el) => el.addEventListener('change', commit));

    $<HTMLButtonElement>('btn-refresh').addEventListener('click', () => this.refreshPorts());
    $<HTMLButtonElement>('btn-close').addEventListener('click', () => this.hide());
    this.overlay.addEventListener('click', (e) => { if (e.target === this.overlay) this.hide(); });

    this.refreshPorts();
  }

  refreshPorts(): void {
    const selInput = this.overlay.querySelector('#sel-input') as HTMLSelectElement;
    const selOutput = this.overlay.querySelector('#sel-output') as HTMLSelectElement;
    fillPorts(selInput, this.adapter.listInputs(), this.settings.inputPortId);
    fillPorts(selOutput, this.adapter.listOutputs(), this.settings.outputPortId);
  }

  show(): void {
    this.refreshPorts();
    this.overlay.classList.remove('hidden');
  }

  hide(): void {
    this.overlay.classList.add('hidden');
  }
}

function fillPorts(sel: HTMLSelectElement, ports: PortInfo[], selected: string | null): void {
  sel.innerHTML = '';
  addOption(sel, '', '(none)');
  for (const p of ports) {
    addOption(sel, p.id, `${p.name ?? p.id}${p.manufacturer ? ` — ${p.manufacturer}` : ''}${p.state !== 'connected' ? ` (${p.state})` : ''}`);
  }
  sel.value = selected && ports.some((p) => p.id === selected) ? selected : '';
}

function addOption(sel: HTMLSelectElement, value: string, label: string): void {
  const o = document.createElement('option');
  o.value = value;
  o.textContent = label;
  sel.appendChild(o);
}
