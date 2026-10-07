import './style.css';
/**
 * Harmonia — app bootstrap (v0.1).
 *
 * Wiring: WebMidiAdapter → NoteBus → (KeyboardView, ChordPanel) + analyzer loop.
 * Also supports computer-keyboard play as a no-hardware fallback so the app is
 * usable immediately: A/K = C, W = C#, S/L = D, E = Eb, D/; = E … J = upper C.
 */

import type { MidiNoteEvent, NoteState } from './core/types.ts';
import { NoteBus } from './core/notes/NoteBus.ts';
import { analyzeChords } from './core/chords/analyzer.ts';
import { WebMidiAdapter } from './midi/WebMidiAdapter.ts';
import { KeyboardView } from './ui/KeyboardView.ts';
import { ChordPanel } from './ui/ChordPanel.ts';
import { SettingsDialog, loadSettings, saveSettings } from './ui/SettingsDialog.ts';
import type { AppSettings } from './ui/SettingsDialog.ts';

// ---- DOM refs ---------------------------------------------------------------
const keyboardRoot = document.getElementById('keyboard')!;
const currentEl = document.getElementById('current-chord')!;
const altsEl = document.getElementById('chord-alternatives')!;
const historyEl = document.getElementById('chord-history')!;
const midiStatusEl = document.getElementById('midi-status')!;
const keyBadgeEl = document.getElementById('key-badge')!;

// ---- Core state -------------------------------------------------------------
const settings: AppSettings = loadSettings();
const bus = new NoteBus();
const adapter = new WebMidiAdapter();
const keyboard = new KeyboardView(keyboardRoot);
const chordPanel = new ChordPanel(currentEl, altsEl, historyEl);

let lastCandidates = analyzeEmpty();
function analyzeEmpty() { return [] as ReturnType<typeof analyzeChords>; }

// ---- Analysis + render loop ---------------------------------------------------
let pendingCommit: { candidates: ReturnType<typeof analyzeChords>; pcs: number[] } | null = null;

function onNoteState(state: NoteState): void {
  keyboard.update(state);
  const candidates = analyzeChords(state, { key: settings.key, topN: 4 });
  lastCandidates = candidates;
  chordPanel.update(candidates);

  // History commit: when notes are released but ghosts still carry the chord,
  // remember the best interpretation of the group that just ended.
  if (state.held.length === 0 && state.ghosts.length > 0 && candidates.length > 0) {
    const pcs = [...new Set(state.ghosts.map((g) => g.pitch % 12))].sort((a, b) => a - b);
    pendingCommit = { candidates, pcs };
  } else if (state.held.length === 0 && state.ghosts.length === 0 && pendingCommit) {
    chordPanel.commitHistory(pendingCommit.candidates, pendingCommit.pcs, state.timestamp);
    pendingCommit = null;
  }
}

bus.subscribe(onNoteState);
bus.startDecayLoop(200);

// ---- MIDI wiring ------------------------------------------------------------
function applySettings(s: AppSettings): void {
  adapter.setInputPort(s.inputPortId);
  adapter.setOutputPort(s.outputPortId);
  if (keyboard.currentMode !== s.vizMode) keyboard.setMode(s.vizMode, s.baseOctave);
  else keyboard.setBaseOctave(s.baseOctave);
  keyBadgeEl.textContent = `${['C','Db','D','Eb','E','F','Gb','G','Ab','A','Bb','B'][s.key.tonic]} ${s.key.scale}`;
  updateMidiStatus();
}

function updateMidiStatus(): void {
  const inName = adapter.currentInputId
    ? adapter.listInputs().find((p) => p.id === adapter.currentInputId)?.name ?? '?'
    : 'none';
  midiStatusEl.textContent = `MIDI in: ${inName}`;
}

async function initMidi(): Promise<void> {
  const ok = await adapter.init(() => dialog?.refreshPorts());
  if (!ok) {
    midiStatusEl.textContent = 'Web MIDI unavailable — use Chrome/Edge, or play with your computer keyboard below.';
    return;
  }
  adapter.onNote((ev) => bus.handleEvent(ev));
  // Auto-select first input if none saved yet.
  if (!settings.inputPortId) {
    const first = adapter.listInputs()[0];
    if (first) { settings.inputPortId = first.id; saveSettings(settings); }
  }
  applySettings(settings);
}

const dialog = new SettingsDialog(document.body, adapter, settings, (s) => applySettings(s));
document.getElementById('btn-settings')!.addEventListener('click', () => dialog.show());
document.getElementById('btn-clear-history')!.addEventListener('click', () => chordPanel.clear());
void initMidi();

// ---- Computer-keyboard fallback ----------------------------------------------
// Two rows: lower row = octave base+0 starting at C, upper row = base+1.
const LOWER: Record<string, number> = { a: 0, w: 1, s: 2, e: 3, d: 4, f: 5, t: 6, g: 7, y: 8, h: 9, u: 10, j: 11, k: 12, o: 13, l: 14, p: 15, ';': 16 };
const keysDown = new Set<string>();

window.addEventListener('keydown', (e) => {
  if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
  const code = e.key.toLowerCase();
  if (!(code in LOWER)) return;
  e.preventDefault();
  keysDown.add(code);
  const pitch = 12 * (settings.baseOctave + 1) + LOWER[code]; // C4-based mapping honoring base octave
  inject({ name: 'note-on', pitch, velocity: 90, channel: 0, timestamp: performance.now() });
});

window.addEventListener('keyup', (e) => {
  const code = e.key.toLowerCase();
  if (!(code in LOWER) || !keysDown.has(code)) return;
  keysDown.delete(code);
  const pitch = 12 * (settings.baseOctave + 1) + LOWER[code];
  inject({ name: 'note-off', pitch, velocity: 0, channel: 0, timestamp: performance.now() });
});

function inject(ev: MidiNoteEvent): void {
  // Feed the bus directly; the hardware path (adapter.onNote → bus) stays clean
  // so real MIDI and simulated notes share one pipeline without double-handling.
  bus.handleEvent(ev);
}

// Clickable keys (nice for touch/mouse testing).
keyboardRoot.addEventListener('pointerdown', (e) => {
  const key = (e.target as HTMLElement).closest<HTMLElement>('.key');
  if (!key) return;
  const pitch = resolveKeyPitch(key);
  if (pitch === null) return;
  key.dataset.pointer = '1';
  inject({ name: 'note-on', pitch, velocity: 100, channel: 0, timestamp: performance.now() });
});
window.addEventListener('pointerup', () => {
  keyboardRoot.querySelectorAll<HTMLElement>('.key[data-pointer]').forEach((key) => {
    delete key.dataset.pointer;
    const pitch = resolveKeyPitch(key);
    if (pitch !== null) inject({ name: 'note-off', pitch, velocity: 0, channel: 0, timestamp: performance.now() });
  });
});

function resolveKeyPitch(key: HTMLElement): number | null {
  if (key.dataset.pitch) return Number(key.dataset.pitch);
  if (key.dataset.pc) {
    const strip = key.closest<HTMLElement>('.kb-octave');
    const band = strip ? Number(strip.dataset.band) : 0;
    return 12 * (settings.baseOctave + band) + Number(key.dataset.pc);
  }
  return null;
}

// Dev helper exposed on window for quick console testing / future tests.
(window as unknown as { __harmonia: unknown }).__harmonia = { bus, adapter, settings, chordPanel, get analysis() { return lastCandidates; }, analyze: analyzeChords };
