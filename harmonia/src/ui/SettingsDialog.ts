/**
 * Settings dialog (README §11): MIDI in/out ports, keyboard viz mode, key/mode.
 * v0.1 persists to localStorage; port lists refresh from the adapter on open and
 * whenever Web MIDI fires a statechange.
 */

import type { KeyboardVizMode, KeySignatureSetting } from '../core/types.ts';
import type { PaletteMode } from '../core/palette.ts';
import { PALETTE_MODES, PC_COLORS, FUNCTION_COLORS } from '../core/palette.ts';
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
  /** Ghost-note memory: how long released notes keep informing the analysis. */
  ghostMemoryMs: number;      // drop ghosts entirely after this age
  ghostHalfLifeMs: number;    // evidence half-life (derived from ghostMemoryMs)
  /** Chord palette (keyboard highlight colors). */
  paletteMode: PaletteMode;
  /** Custom per-pitch-class colors (index 0..11; null = scheme default). */
  pcColors: (string | null)[];
  /** Custom colors keyed by function label (I..VII, NONDIATONIC). */
  functionColors: Record<string, string>;
  /** Chord mode: color per chord quality id ('', 'm', 'dim', '+', '7', 'maj7', …). */
  qualityColors: Record<string, string>;
  /** Chord mode: color per exact symbol ("Ab7#5"); wins over the quality color. */
  symbolColors: Record<string, string>;
  /** Playback */
  bpm: number;
  meterId: string;
  loopProgression: boolean;
  playbackOctave: number;     // voicing octave for sequencer + history replay
  playToOutput: boolean;      // send MIDI out to hardware as well as on-screen
  progression: ProgressionStep[];
  /** User-resized keyboard panel height in px (null = layout default). */
  keyboardHeightPx: number | null;
}

const QUALITY_SWATCHES: { id: string; label: string }[] = [
  { id: '', label: 'maj' }, { id: 'm', label: 'min' }, { id: 'dim', label: 'dim' },
  { id: '+', label: 'aug' }, { id: '7', label: '7' }, { id: 'maj7', label: 'maj7' },
  { id: 'm7', label: 'm7' }, { id: 'm7♭5', label: 'm7♭5' }, { id: 'dim7', label: 'dim7' },
  { id: '6', label: '6' }, { id: 'm6', label: 'm6' }, { id: 'sus4', label: 'sus4' },
  { id: 'sus2', label: 'sus2' },
];

const STORAGE_KEY = 'harmonia.settings.v1';

export function loadSettings(): AppSettings {
  const defaults: AppSettings = {
    inputPortId: null,
    outputPortId: null,
    vizMode: 'full88',
    baseOctave: 4,
    key: { tonic: 0, scale: 'ionian' },
    ghostMemoryMs: 1200,
    ghostHalfLifeMs: 600,
    paletteMode: 'mono',
    pcColors: PC_COLORS.map(() => null),
    functionColors: { ...FUNCTION_COLORS },
    qualityColors: {},
    symbolColors: {},
    bpm: 100,
    meterId: '4/4',
    loopProgression: true,
    playbackOctave: 4,
    playToOutput: true,
    progression: [],
    keyboardHeightPx: null,
  };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw);
    const s: AppSettings = {
      ...defaults, ...parsed,
      key: { ...defaults.key, ...parsed.key },
      pcColors: Array.isArray(parsed.pcColors) && parsed.pcColors.length === 12
        ? parsed.pcColors : defaults.pcColors,
      functionColors: { ...defaults.functionColors, ...(parsed.functionColors ?? {}) },
      qualityColors: { ...(parsed.qualityColors ?? {}) },
      symbolColors: { ...(parsed.symbolColors ?? {}) },
    };
    // Re-derive half-life from the configured memory window (≈2 half-lives to fade).
    if (parsed.ghostMemoryMs && !parsed.ghostHalfLifeMs) s.ghostHalfLifeMs = Math.max(100, s.ghostMemoryMs / 2);
    return s;
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
        <label>Released-note memory (ghost notes)
          <select id="sel-ghost">
            <option value="0">Off — only currently held notes</option>
            <option value="400">Very short · 0.4 s</option>
            <option value="800">Short · 0.8 s</option>
            <option value="1200">Medium · 1.2 s</option>
            <option value="2000">Long · 2 s</option>
            <option value="4000">Very long · 4 s</option>
          </select>
        </label>
        <h3>Chord Palette (keyboard colors)</h3>
        <label>Color scheme
          <select id="sel-palette"></select>
        </label>
        <div id="palette-editor" class="palette-editor"></div>
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
    const selGhost = $<HTMLSelectElement>('sel-ghost');
    const selPalette = $<HTMLSelectElement>('sel-palette');
    const paletteEditor = $<HTMLElement>('palette-editor');
    const chkLoop = $<HTMLInputElement>('chk-loop');
    const chkOut = $<HTMLInputElement>('chk-out');

    for (let o = 0; o <= 8; o++) addOption(selBase, String(o), `C${o}`);
    for (let o = 1; o <= 7; o++) addOption(selPlayOct, String(o), `C${o}`);
    NOTE_NAMES_FLAT.forEach((n, pc) => addOption(selKey, String(pc), n));
    SCALES.forEach((s) => addOption(selScale, s.id, s.name));
    METERS.forEach((m) => addOption(selMeter, m.id, m.name));
    PALETTE_MODES.forEach((p) => addOption(selPalette, p.id, p.name));

    selViz.value = this.settings.vizMode;
    selBase.value = String(this.settings.baseOctave);
    selKey.value = String(this.settings.key.tonic);
    selScale.value = this.settings.key.scale;
    selMeter.value = this.settings.meterId;
    selPlayOct.value = String(this.settings.playbackOctave);
    selPalette.value = this.settings.paletteMode;
    // Snap stored value to the nearest available option.
    selGhost.value = ghostOptionFor(this.settings.ghostMemoryMs);
    chkLoop.checked = this.settings.loopProgression;
    chkOut.checked = this.settings.playToOutput;

    /** Rebuild the color swatch grid for the selected palette mode. */
    const renderPaletteEditor = () => {
      paletteEditor.innerHTML = '';
      const mode = selPalette.value as PaletteMode;
      if (mode === 'mono') {
        const hint = document.createElement('div');
        hint.className = 'palette-hint';
        hint.textContent = 'All active keys share one highlight color.';
        paletteEditor.appendChild(hint);
        return;
      }
      if (mode === 'chord') {
        const hint = document.createElement('div');
        hint.className = 'palette-hint';
        hint.textContent = 'Keys take the color of the recognized chord. Default: major uses the root\'s hue, minor/dim/aug are shaded variants. Override per quality or per exact symbol below; uncolored symbols fall back to the auto scheme.';
        paletteEditor.appendChild(hint);
        const grid = document.createElement('div');
        grid.className = 'swatch-grid';
        for (const q of QUALITY_SWATCHES) {
          grid.appendChild(swatch(q.label || 'maj', this.settings.qualityColors[q.id] ?? '', (c) => {
            this.settings.qualityColors[q.id] = c;
          }));
        }
        for (const [sym, color] of Object.entries(this.settings.symbolColors)) {
          grid.appendChild(swatch(sym, color, (c) => { this.settings.symbolColors[sym] = c; }));
        }
        paletteEditor.appendChild(grid);
        const row = document.createElement('div');
        row.className = 'swatch-add';
        const inp = document.createElement('input');
        inp.type = 'text';
        inp.placeholder = 'symbol e.g. Ab7#5';
        inp.size = 10;
        const pick = document.createElement('input');
        pick.type = 'color';
        pick.value = '#8e4ec6';
        const addBtn = document.createElement('button');
        addBtn.type = 'button';
        addBtn.textContent = 'Add color';
        addBtn.addEventListener('click', () => {
          const sym = inp.value.trim();
          if (!sym) return;
          this.settings.symbolColors[sym] = pick.value;
          renderPaletteEditor();
          commit();
        });
        const clearBtn = document.createElement('button');
        clearBtn.type = 'button';
        clearBtn.textContent = 'Clear overrides';
        clearBtn.addEventListener('click', () => {
          this.settings.qualityColors = {};
          this.settings.symbolColors = {};
          renderPaletteEditor();
          commit();
        });
        row.append(inp, pick, addBtn, clearBtn);
        paletteEditor.appendChild(row);
        return;
      }
      const grid = document.createElement('div');
      grid.className = 'swatch-grid';
      if (mode === 'pc') {
        NOTE_NAMES_FLAT.forEach((name, pc) => {
          grid.appendChild(swatch(name, this.settings.pcColors[pc] ?? PC_COLORS[pc], (c) => {
            this.settings.pcColors[pc] = c;
          }));
        });
      } else {
        for (const [label, def] of Object.entries(FUNCTION_COLORS)) {
          grid.appendChild(swatch(label === 'NONDIATONIC' ? 'χ out-of-key' : label, this.settings.functionColors[label] ?? def, (c) => {
            this.settings.functionColors[label] = c;
          }));
        }
      }
      paletteEditor.appendChild(grid);
      const reset = document.createElement('button');
      reset.type = 'button';
      reset.textContent = 'Reset colors';
      reset.addEventListener('click', () => {
        if (mode === 'pc') this.settings.pcColors = PC_COLORS.map(() => null);
        else this.settings.functionColors = { ...FUNCTION_COLORS };
        renderPaletteEditor();
        commit();
      });
      paletteEditor.appendChild(reset);
    };

    const commit = () => {
      this.settings.inputPortId = selInput.value || null;
      this.settings.outputPortId = selOutput.value || null;
      this.settings.vizMode = selViz.value as KeyboardVizMode;
      this.settings.baseOctave = Number(selBase.value);
      this.settings.key = { tonic: Number(selKey.value), scale: selScale.value };
      this.settings.meterId = selMeter.value;
      this.settings.playbackOctave = Number(selPlayOct.value);
      this.settings.ghostMemoryMs = Number(selGhost.value);
      this.settings.paletteMode = selPalette.value as PaletteMode;
      // ~2 half-lives until a ghost fades below visible/usable evidence.
      this.settings.ghostHalfLifeMs = Math.max(100, this.settings.ghostMemoryMs / 2);
      this.settings.loopProgression = chkLoop.checked;
      this.settings.playToOutput = chkOut.checked;
      saveSettings(this.settings);
      this.onChange(this.settings);
    };
    [selInput, selOutput, selViz, selBase, selKey, selScale, selMeter, selPlayOct, selGhost, selPalette, chkLoop, chkOut]
      .forEach((el) => el.addEventListener('change', commit));
    selPalette.addEventListener('change', renderPaletteEditor);

    renderPaletteEditor();

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

const GHOST_OPTIONS = [0, 400, 800, 1200, 2000, 4000];

/** Nearest ghost-memory option to a stored value (handles legacy defaults). */
function ghostOptionFor(ms: number): string {
  let best = GHOST_OPTIONS[0];
  for (const o of GHOST_OPTIONS) if (Math.abs(o - ms) < Math.abs(best - ms)) best = o;
  return String(best);
}

/** One editable color swatch with label; onPick receives the new css color. */
function swatch(label: string, color: string, onPick: (c: string) => void): HTMLElement {
  const wrap = document.createElement('label');
  wrap.className = 'swatch';
  const input = document.createElement('input');
  input.type = 'color';
  input.value = color;
  input.addEventListener('input', () => onPick(input.value));
  const text = document.createElement('span');
  text.textContent = label;
  wrap.append(input, text);
  return wrap;
}
