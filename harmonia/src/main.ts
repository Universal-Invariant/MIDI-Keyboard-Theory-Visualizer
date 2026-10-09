import './style.css';
/**
 * Harmonia — app bootstrap (v0.1).
 *
 * Wiring: WebMidiAdapter → NoteBus → (KeyboardView, ChordPanel) + analyzer loop.
 * Also supports computer-keyboard play as a no-hardware fallback so the app is
 * usable immediately: A/K = C, W = C#, S/L = D, E = Eb, D/; = E … J = upper C.
 *
 * Layout notes:
 *  - The keyboard lives in its own panel with a user-resizable height
 *    (KeyboardPanel) persisted across reloads — it no longer scales with the
 *    browser window.
 *  - The current chord symbol is centered with the recent-chord history strip
 *    above it (see index.html / style.css).
 *  - The scale that the analysis is weighted toward (root + mode) is selectable
 *    directly in the top bar; ⚙ Settings has the same controls.
 */

import type { MidiNoteEvent, NoteState } from './core/types.ts';
import type { PaletteContext } from './core/palette.ts';
import { NoteBus } from './core/notes/NoteBus.ts';
import { analyzeChords } from './core/chords/analyzer.ts';
import { WebMidiAdapter } from './midi/WebMidiAdapter.ts';
import { KeyboardView } from './ui/KeyboardView.ts';
import { KeyboardPanel } from './ui/KeyboardPanel.ts';
import { ChordPanel } from './ui/ChordPanel.ts';
import { PracticePanel } from './ui/PracticePanel.ts';
import { SettingsDialog, loadSettings, saveSettings } from './ui/SettingsDialog.ts';
import type { AppSettings } from './ui/SettingsDialog.ts';
import { NOTE_NAMES_FLAT } from './core/theory/pitch.ts';
import { SCALES, keyLabel } from './core/theory/scales.ts';

// ---- DOM refs ---------------------------------------------------------------
const keyboardRoot = document.getElementById('keyboard')!;
const keyboardPanelEl = document.getElementById('keyboard-panel')!;
const keyboardScrollEl = document.getElementById('keyboard-scroll')!;
const kbResizeHandle = document.getElementById('kb-resize-handle')!;
const currentEl = document.getElementById('current-chord')!;
const altsEl = document.getElementById('chord-alternatives')!;
const historyEl = document.getElementById('chord-history')!;
const historyDetailEl = document.getElementById('history-detail')!;
const currentStaffEl = document.getElementById('current-staff')!;
const practiceRoot = document.getElementById('practice');
const midiStatusEl = document.getElementById('midi-status')!;
const selAnalysisRoot = document.getElementById('sel-analysis-root') as HTMLSelectElement;
const selAnalysisScale = document.getElementById('sel-analysis-scale') as HTMLSelectElement;

// ---- Core state -------------------------------------------------------------
const settings: AppSettings = loadSettings();
const bus = new NoteBus({ ghostHalfLifeMs: settings.ghostHalfLifeMs, ghostMaxAgeMs: settings.ghostMemoryMs });
const adapter = new WebMidiAdapter();
const keyboard = new KeyboardView(keyboardRoot, settings.vizMode, settings.baseOctave);
const keyboardPanel = new KeyboardPanel({
  panel: keyboardPanelEl,
  scrollEl: keyboardScrollEl,
  handle: kbResizeHandle,
  defaultPx: 180,
  loadHeight: () => settings.keyboardHeightPx ?? null,
  saveHeight: (px) => { settings.keyboardHeightPx = px; saveSettings(settings); },
});
const chordPanel = new ChordPanel(currentEl, altsEl, historyEl);
chordPanel.attachLiveStaff(currentStaffEl);
chordPanel.attachDetailPanel(historyDetailEl);

let lastCandidates = analyzeEmpty();
function analyzeEmpty() { return [] as ReturnType<typeof analyzeChords>; }

// ---- Palette context ----------------------------------------------------------
function paletteCtx(): PaletteContext {
  const best = lastCandidates[0] ?? null;
  return {
    mode: settings.paletteMode,
    key: settings.key,
    currentSymbol: best?.symbol ?? null,
    currentChordPcs: best?.pcs ?? [],
    pcColors: settings.pcColors,
    functionColors: settings.functionColors,
    qualityColors: settings.qualityColors,
    symbolColors: settings.symbolColors,
  };
}

// ---- Analysis + render loop ---------------------------------------------------
let pendingCommit: { candidates: ReturnType<typeof analyzeChords>; pcs: number[]; pitches: number[] } | null = null;

function onNoteState(state: NoteState): void {
  const candidates = analyzeChords(state, { key: settings.key, topN: 4 });
  lastCandidates = candidates;
  keyboard.setPalette(paletteCtx());
  keyboard.update(state);
  // Live notation shows what is actually sounding (held + still-relevant ghosts).
  chordPanel.setLivePitches(state.held.map((n) => n.pitch), state.ghosts.filter((g) => g.weight > 0.25).map((g) => g.pitch));
  chordPanel.update(candidates);

  // History commit: when notes are released but ghosts still carry the chord,
  // remember the best interpretation of the group that just ended.
  if (state.held.length === 0 && state.ghosts.length > 0 && candidates.length > 0) {
    const pitches = [...new Set(state.ghosts.map((g) => g.pitch))].sort((a, b) => a - b);
    const pcs = [...new Set(pitches.map((p) => p % 12))].sort((a, b) => a - b);
    pendingCommit = { candidates, pcs, pitches };
  } else if (state.held.length === 0 && state.ghosts.length === 0 && pendingCommit) {
    chordPanel.commitHistory(pendingCommit.candidates, pendingCommit.pcs, state.timestamp, pendingCommit.pitches);
    pendingCommit = null;
  }
}

bus.subscribe(onNoteState);
bus.startDecayLoop(200);

// ---- MIDI wiring ------------------------------------------------------------
function applySettings(s: AppSettings): void {
  adapter.setInputPort(s.inputPortId);
  adapter.setOutputPort(s.outputPortId);
  bus.setGhostMemory(s.ghostHalfLifeMs, s.ghostMemoryMs);
  if (keyboard.currentMode !== s.vizMode) keyboard.setMode(s.vizMode, s.baseOctave);
  else keyboard.setBaseOctave(s.baseOctave);
  keyBadgeEl.textContent = `${['C','Db','D','Eb','E','F','Gb','G','Ab','A','Bb','B'][s.key.tonic]} ${s.key.scale}`;
  practice?.applySettings();
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

// ---- Practice panel (metronome + progression editor + playback) ---------------
let practice: PracticePanel | null = null;

function initPractice(): void {
  if (!practiceRoot) return;
  practice = new PracticePanel(practiceRoot, {
    settings,
    adapter,
    inject: (ev) => bus.handleEvent(ev),
    getHistorySymbols: () => chordPanel.getHistory().map((h) => h.symbol),
  });
  // Clicking a history card replays that voicing through the same pipeline.
  chordPanel.onReplay = (pitches) => practice?.replayPitches(pitches);
}

const dialog = new SettingsDialog(document.body, adapter, settings, (s) => applySettings(s));
document.getElementById('btn-settings')!.addEventListener('click', () => dialog.show());
document.getElementById('btn-clear-history')!.addEventListener('click', () => chordPanel.clear());
void initMidi();
initPractice();

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
