# 🎹 Harmonia — MIDI Keyboard Visualizer with Bayesian Chord & Harmony Analysis

A browser-based (TypeScript + Web MIDI API) virtual keyboard that doesn't just show which
notes you're playing — it tells you **what chord you're actually playing**, using
probabilistic harmonic analysis informed by key, mode/scale, chord history, and note
context. Built for practicing sophisticated real-world harmony (e.g., Art Tatum-style
changes, bebop voicings, enharmonic ambiguities) rather than just triads in C major.

---

## Table of Contents

1. [Why This App Exists](#why-this-app-exists)
2. [Feature Overview](#feature-overview)
3. [Architecture & Tech Stack](#architecture--tech-stack)
4. [MIDI I/O (Browser vs Native)](#midi-io)
5. [Keyboard Visualization Modes](#keyboard-visualization-modes)
6. [Chord Analysis Engine (The Core)](#chord-analysis-engine)
7. [Key / Mode / Scale Settings](#key--mode--scale-settings)
8. [Chord History & Notation Display](#chord-history--notation-display)
9. [Playback, Progression Editor & MIDI Out](#playback-progression-editor--midi-out)
10. [Recording & Metronome](#recording--metronome)
11. [Settings Dialog](#settings-dialog)
12. [UI Layout](#ui-layout)
13. [Data Models & Types](#data-models--types)
14. [Suggested Enhancements / Roadmap](#suggested-enhancements--roadmap)
15. [Getting Started (Planned)](#getting-started-planned)
16. [References & Prior Art](#references--prior-art)

---

## Why This App Exists

Most MIDI visualizers answer *"which keys are down?"* — we want to answer
***"what are you actually playing, harmonically speaking?"***

When working through a real jazz score, harmony is rarely unambiguous:

- **Ab → Ab+** on paper (root movement 5th → #5th) is *also* legitimately an
  **E augmented triad** depending on the voicing/register.
- A **Cm6** (C–Eb–G–Bb) is enharmonically and functionally entangled with
  **A♭maj6/C**, **Eb9 without root**, etc.
- Melody notes often arrive *after* the comping notes were released; a naive
  "currently held notes only" analyzer loses the chord. We keep recently-released
  notes as **"ghost notes"** contributing decaying evidence.

Our solution: a **Bayesian chord recognizer** that scores every plausible chord name
against the observed pitch content, weighted by key/mode priors, voice-leading
continuity from previous chords, sustain/decay of released notes, and optional bass
clue ("C/E" slash-chord detection). The UI then shows the **top interpretations with
probability weights** so *you* can confirm you're playing what the score says — or
discover what you're accidentally playing.

---

## Feature Overview

| # | Feature | Status |
|---|---------|--------|
| 1 | Web MIDI input from selectable external device/port | Planned (v0.1) |
| 2 | Virtual keyboard: full 88-key, 1-octave (wrapped w/ octave badge), 2-octave smart-split | Planned (v0.1–v0.2) |
| 3 | Live key highlight on note-down/up, velocity shading | Planned (v0.1) |
| 4 | Bayesian chord recognition with top-N weighted interpretations | Planned (v0.3) |
| 5 | Chord symbol display + staff notation of last 4 chords + current chord panel | Planned (v0.3–v0.4) |
| 6 | Key/mode/scale selection strongly influencing analysis | Planned (v0.3) |
| 7 | Ghost-note memory for released notes (melody-over-chord context) | Planned (v0.3) |
| 8 | Slash-chord/bass detection (inversions, C/E) | Planned (v0.4) |
| 9 | Playback of chord history; select which chords to replay | Planned (v0.5) |
| 10 | Progression editor (type chords → play via MIDI out, loop for improv practice) | Planned (v0.5) |
| 11 | Audio recording + metronome with meters (4/4, 3/4, 6/8, latin clave patterns…) | Planned (v0.6) |
| 12 | Settings dialog: MIDI in/out ports, viz mode, analysis params, persistence | Planned (v0.2) |

---

## Architecture & Tech Stack

**Primary recommendation: run it in the browser.** The **Web MIDI API** provides direct,
low-latency access to hardware MIDI ports with no drivers or native dependencies on
Chrome/Edge (Firefox support varies; Safari needs a shim — see [MIDI I/O](#midi-io)).
Everything else (rendering, audio, storage) is first-class in the browser too.

```
┌─────────────────────────────────────────────────────────────┐
│                     UI Layer (Preact/React)                 │
│  KeyboardView · ChordPanel · HistoryStrip · StaffNotation   │
│  ProgressionEditor · SettingsDialog · TransportBar          │
└───────────────▲─────────────────────────────┬───────────────┘
                │ state (zustand store)        │ commands
┌───────────────┴─────────────────────────────▼───────────────┐
│                    Core Domain (pure TS)                    │
│  NoteBus (held/ghost notes)                                 │
│  ChordVocabulary (pitch-class-set → candidate names)        │
│  BayesianAnalyzer (priors, likelihoods, posterior ranking)  │
│  KeyModel (keys × modes × scales, diatonic tables)          │
│  VoiceLeading (transition costs between chords)             │
│  NotationMapper (chord → spelled pitches → staff glyphs)    │
└───────────────▲─────────────────────────────┬───────────────┘
                │ events                       │ SysEx/CC/Notes
┌───────────────┴─────────────────────────────▼────────────────┐
│                  Platform Adapters                           │
│  WebMidiAdapter (input/output ports)                        │
│  AudioEngine (WebAudio metronome, optional synth playback)  │
│  Recorder (MediaRecorder) · Persistence (IndexedDB/localStorage)│
└──────────────────────────────────────────────────────────────┘
```

- **Language:** TypeScript (strict mode).
- **Build:** Vite. **Package manager:** pnpm.
- **UI:** Preact (or React) + CSS Modules/Tailwind. Keyboard rendered with plain DOM/SVG
  (fast enough); staff notation via **VexFlow**.
- **State:** zustand (small pub/sub store) — the analyzer runs off a `note-state` slice.
- **Persistence:** localStorage for settings; IndexedDB for recordings/progressions.
- **Optional native fallback:** Python (`mido`/`rtmidi`) + local WebSocket bridge, or a
  Tauri app, for browsers without Web MIDI (Safari). See [MIDI I/O](#midi-io).

### Suggested project layout

```
src/
  midi/           WebMidiAdapter.ts, portManager.ts, messages.ts
  core/
    notes/        NoteBus.ts, heldNotes.ts, ghostNotes.ts
    theory/       KeyModel.ts, scales.ts, modes.ts, spellings.ts
    chords/       vocabulary.ts, analyzer.ts, priors.ts, voiceLeading.ts
  ui/
    KeyboardView/ Full88.tsx, Octave1.tsx, Octave2Split.tsx, keyGeometry.ts
    ChordPanel/   CurrentChord.tsx, HistoryStrip.tsx, StaffView.tsx
    Editors/      ProgressionEditor.tsx, SettingsDialog.tsx, Transport.tsx
  audio/          metronome.ts, clickPatterns.ts, playbackSynth.ts
  recorder/       audioRecorder.ts, midiSequencer.ts
  store/          useAppStore.ts
```

---

## MIDI I/O

### Browser path (preferred)

- `navigator.requestMIDIAccess()` → enumerate `inputs` / `outputs`.
- Settings dialog lists friendly port names (`input.port.name`), lets the user pick one
  or more inputs (merge streams) and one output.
- Handle **hot-plug**: listen to `MIDIAccess.onstatechange`, refresh port list.
- Message handling: Note On (0x90, with 0x9n 0xvv 0x00 == Note Off normalization),
  Note Off (0x80), Channel Aftertouch/CC passthrough, Program Change, SysEx ignored
  for now. (The UA already decodes running status.)
- Latency: Web MIDI delivers events at ~sub-10 ms; render highlights via
  `requestAnimationFrame` batching to avoid per-message DOM churn.

### Compatibility notes / fallbacks

- **Chrome/Edge/Opera:** works today; HTTPS or localhost required for permissions.
- **Firefox:** check current Web MIDI support status; provide the shim below otherwise.
- **Safari:** no Web MIDI → offer a tiny companion:
  - **Python bridge** (`python-rtmidi`/`mido` reading a chosen port, forwarding JSON over
    WebSocket to the page), or
  - **Tauri v2 build** with native MIDI bindings — same TS core reused.
- Keep a thin `MidiTransport` interface so adapters are swappable and the core is
  testable with a **virtual/Mock MIDI source**. An on-screen computer-keyboard mapping
  (QWERTY→piano) also serves as a zero-hardware demo mode.

### MIDI Out

- Used by: chord-history playback, progression editor, optional echo/thru mode (mirror
  live playing to a synth/module), later MIDI clock.
- Respect selected output channel; support multi-output fan-out later.

---

## Keyboard Visualization Modes

Three selectable layouts (Settings → Visualization):

### A. Full 88-key

- Classic A0–C8 range, scrollable/auto-centered on the played region.
- Optional "follow latest note" smooth scrolling; C-keys labeled (`C1…C8`; toggleable
  octave-numbering convention — scientific middle-C=C4 vs Yamaha middle-C=C3).

### B. Single-octave wrapped (chromatic 12-key strip)

- Pitch class `p mod 12` maps to a key; **octave badge** drawn on each active key from
  `floor(p / 12)` (+ offset per octave-numbering convention).
- Multiple simultaneous notes of the same pitch class but different octaves stack their
  badges (e.g., `6` and `8` both on the E key) — instantly reveals octave doubling.
- Color-coding options: hue by octave, or shade by distance from current key center.
- Great for drilling chord *shapes* independent of register.

### C. Two-octave "smart split"

- Window of 24 semitones. Lower-register notes → bottom row; higher → top row.
- **Optimization heuristic** (keep it simple and predictable):
  1. Maintain a floating window `[base, base+23]`.
  2. Track the centroid (weighted mean pitch) of currently-held notes and recent ghosts.
  3. Snap the window so the centroid falls near the boundary between rows, biased so
     *bass* notes stay low even when melody jumps (asymmetric hysteresis: move up fast
     for new highs, drift back slowly).
  4. Notes outside the window wrap into the nearest edge key with an ↑/↓ octave arrow
     badge (never lose a note; always show its octave).
- Alternative deterministic mode: fixed two octaves around the selected key tonic.

### Rendering details (all modes)

- Held keys: filled accent color + subtle glow; velocity → brightness.
- Ghost/released-but-active-in-memory keys: fading outline (decay over `ghostWindowMs`).
- Chord-membership tint: while analyzing, optionally overlay which physical keys belong
  to the winning chord interpretation (dotted border) vs ambiguous extras (dimmed).
- Computer-keyboard mapping (QWERTY→piano) for demo/testing without hardware.

---

## Chord Analysis Engine

This is the heart of the app. Design goals: **explainable, tunable, fast (<1 ms/update).**

### 1. Input evidence

At time *t*, the analyzer sees a multiset of notes:

- **Held notes** `{pitch, velocity, t_on}` — weight `w_held = 1.0`.
- **Ghost notes** (released within `ghostWindow`, default ~1.5 s, configurable, with
  exponential decay `e^(-Δt/τ)`) — captures the case: *"I comped Am9, released, then
  played the melody F# — still clearly Am9."*
- **Lowest held/ghost note** flagged as potential **bass** for slash-chord detection.
- Optional: damper-pedal CC64 state extends the ghost window dramatically (pedal holds
  everything — treat sustained-as-held).

Evidence is reduced to a **pitch-class profile** `pcp[12]` (sum of weights per pitch
class) plus register info (min/max/octave spread) and total-note-count.

### 2. Chord vocabulary

A curated dictionary mapping **pitch-class sets → candidate chord symbols** with
metadata. Coverage targets (each entry stores: symbol, root, quality, required/optional
PCs, typical contexts):

- Triads + inversions (maj, min, dim, aug) — remember **augmented ambiguity**: {0,4,8}
  matches Ab+, C+, E+ equally; the vocabulary returns all three and lets priors decide.
- 7ths: maj7, 7, m7, m7♭5, dim7, mMaj7, 7♯5/♭5, sus2/sus4, 5 (power).
- Extensions/alterations: 6, m6, 6/9, 9, ♯9, ♭9, 11, 13, ♯11, 13♭9, quartal stacks
  (so-called "So What" chords), cluster tone-bundles.
- Common jazz equivalences registered as *separate candidates sharing a PC set*:
  e.g. {0,3,7,10} = Cm7 / Eb6 / Gm7/C… ranked by context.
- Upper-structure/triads-over-bass detection for poly chords (D triad over C ≈ Cmaj9♯11).

Spelling table per symbol (for staff notation): proper letter names & accidentals chosen
by key context (Eb not D#, F# vs Gb depends on function).

### 3. Bayesian scoring

For each candidate chord `c`:

```
P(c | observations) ∝ P(obs | c) · P(c)

P(obs | c) = Π_over_pc  Likelihood(pcp[i], expected(i, c))
             + bonus(voice_leading(prev_chord, c))
             + bonus(bass_matches(c.root_or_specified_bass))
             − penalty(unexplained_notes_ratio)   // stray notes

P(c) = prior(key_context, c)            // diatonicity + corpus-flavored priors
```

Concrete, tunable components:

- **Likelihood:** Gaussian-ish fit of observed PC weights to the chord's member PCs
  (expected set + tolerated extensions like 9/11/6 treated as "optional members" with
  small positive weight rather than penalties). Stray non-member PCs reduce likelihood
  proportional to weight — unless they match a listed extension (a melody note that's
  the 13th should *increase* the probability of the 13th-chord interpretation).
- **Partial-evidence robustness:** missing root (shell voicings!) — vocabulary entries
  mark `rootOptional: true` for dominant 9/13, m7♭5 in ii-V, etc. Missing 5th likewise.
- **Key/mode prior:** `P(c)` boosted by diatonic membership in the selected key/mode
  (Roman-numeral table), mildly boosted by common borrowed chords (secondary dominants,
  ♭VII, ♭VI, IVm, tritone subs) — a small hand-tuned prior matrix, later trainable.
- **Voice-leading transition model:** log-prob bonus from average absolute semitone
  movement between consecutive chord tones + functional-pattern bonus (V→I, ii→V,
  descending roots, cycle-of-fifths adjacency). This is the *"sort of neural network"*
  flavor: practically, a Markov chain over chord classes seeded from jazz progressions
  (Real Book-style corpus), pluggable for a learned model later.
- **Octave/register weighting:** low registers anchor root perception (psychomusicology:
  roots heard in bass dominate); mid registers weigh most for chord identity; very high
  sparse notes weigh less.
- **Normalization & display:** posteriors normalized to 1; UI shows top 3–4 with % bars,
  e.g. `Ab+ 62% · E+ 21% · Abmaj7♯5 (no G) 9% · …`. Also show a **"simplified" alias**
  (e.g., recommend thinking of it as `E+` when E is in the bass).

### 4. Temporal stability & phrasing

- Analysis updates on every note event but **commits** to history only when the posterior
  is stable (entropy below threshold) for `commitMs` (~250 ms) or when all notes release
  (then finalize using ghosts before they expire). Prevents flicker during fast runs.
- **Melody-over-chord rule:** single high-register late notes above a committed chord
  don't spawn a new history entry; they re-rank the current chord's interpretation
  (adds 9/11/13 variants) — exactly the "release the chord, play the line" workflow.

### 5. Explainability panel (cheap to build, huge UX win)

Hover/tap a chord suggestion → show *why*: matched PCs, explained/unexplained notes,
prior contributions, voice-leading delta from previous chord. Users learn the theory
while using the tool — aligns with the app's educational mission.

---

## Key / Mode / Scale Settings

Quick-access control in the header (plus in Settings dialog):

- **Key:** 12 tonics (with sharp/flat preference toggle).
- **Mode/Scale selector:** Major, Natural/Harmonic/Melodic Minor, Dorian, Phrygian,
  Lydian, Mixolydian, Locrian (+ ♮2/♯6 variants), Whole-tone, Diminished (HW/WH),
  Augmented, Blues, Bebop Dominant/Major, Pentatonic major/minor, Messiaen modes,
  Custom (12-step bitmask editor).
- Effects:
  1. Chord priors — diatonic chords get Roman-numeral labels shown alongside symbols
     (`Dm7 = ii7 in C`).
  2. Non-diatonic notes get a subtle red tint on the keyboard ("outside" indicator) —
     toggleable; in-scale = green family.
  3. Staff spelling preferences follow the key.
- **Auto-suggest key** (stretch): detect key from recent committed chords via template
  matching against cadence patterns (Krumhansl-style correlation as fallback).

---

## Chord History & Notation Display

- **Current chord panel** (large, primary focus of the screen):
  - Big chord symbol (winning interpretation) + runner-up chips with probabilities.
  - Simplified/alias suggestion line ("think: E+/Ab").
  - Roman numeral in selected key, constituent notes (correctly spelled), and a mini
    piano diagram of the actual voicing played.
- **History strip:** last **4** committed chords, newest rightmost, each card showing:
  - Chord symbol + confidence bar + timestamp/duration + Roman numeral.
  - **Staff notation** of the actual voicing (VexFlow) — not just the symbol — so you can
    compare against your Tatum score note-for-note.
  - Click a card → menu: *Replay*, *Replay & Loop*, *Add to progression editor*, *Pin*.
- Scrolling further back available in a drawer (history buffer ≥ 64 chords, persisted per
  session).
- Export: copy history as text (`| Dm9 | G13♭9 | Cmaj7 |`) or as chord-progression JSON;
  future: MusicXML snippet export.

---

## Playback, Progression Editor & MIDI Out

- **Replay history:** press play on the transport → sends the last N chords (selectable
  cards) to the chosen MIDI output (voicing preserved as played, including ghost-context
  notes), quantized to the metronome grid, at adjustable tempo, loopable.
- **Progression editor:**
  - Grid of bars/beats; cells hold chord symbols entered as text
    (`Cmaj7`, `Ab+`, `F#m7b5`, `G7#9/B`, `N.C.`), parsed by the same vocabulary engine
    (autocomplete + validity feedback).
  - Each chord expands to a voicing: last-used voicing, compact rootless voicing, or
    user-edited (drag notes on a mini-keyboard per cell).
  - Controls: loop count/∞, per-bar rests, transpose whole progression (± semitones, or
    "move to key X"), send to MIDI out, and/or play through a built-in WebAudio poly
    synth for headphones-only practice.
  - Improv mode: loop the progression while the keyboard visualization keeps analyzing
    *your* live notes over it — dual pane: "score chord" vs "detected chord" side-by-side
    diff.
- **Import/export:** JSON progression files; paste lead-sheet style (`ii V I` or symbol
  text); later: import from iRealPro-ish CSV / MuseScore XML (stretch).

---

## Recording & Metronome

- **Metronome:**
  - Meters: 2/4, 3/4, 4/4, 5/4, 6/8, 7/8, 12/8 + **Latin/world patterns**: son clave
    (3-2 & 2-3), rumba clave, bossa pattern, samba shaker, 6/8 afro/bembé, waltz accent.
  - Sound: synthesized clicks (WebAudio, sample-accurate scheduling via lookahead
    clock — do NOT drive timing with `setInterval` alone), distinct downbeat sound,
    optional chord-cue tick on bar changes during loops.
  - Tap-tempo button; subdivision controls.
- **Recording:**
  - **MIDI capture:** record raw note timeline (pitch, velocity, deltas) → replay/edit;
    stored as JSON clips; clips can be fed through the analyzer offline (analysis of a
    recorded solo).
  - **Audio capture:** MediaRecorder mic/line-in over the metronome/loop for quick
    practice takes; waveform thumbnail, basic loop A/B points.
- **Practice flow example:** load Tatum changes into the progression editor → loop 4 bars
  at 60% tempo with ride clave → play along → watch detected-vs-written chord diffs →
  record a take → review.

---

## Settings Dialog

Tabs (persisted to localStorage, JSON import/export of all settings):

1. **MIDI:** input port(s) multi-select, output port, channel filter, thru/echo toggle,
   latency smoothing, hot-plug status indicator.
2. **Keyboard:** visualization mode (88 / 1-octave wrap / 2-octave split), octave
   numbering convention (Scientific: middle C=C4 · Yamaha: C3 · ISO), key colors,
   ghost fade duration, note-name language (C–H vs solfège Do-Re).
3. **Analysis:** ghost window & decay τ, commit stability time, max suggestions shown,
   enable voice-leading prior, strictness of stray-note penalty, pedal behavior.
4. **Key/Scale:** global key + mode (also mirrored in header quick-picker).
5. **Audio/Transport:** metronome on/off, pattern, volume, playback synth on/off, tempo.
6. **About/Reset.**

---

## UI Layout

```
┌──────────────────────────────────────────────────────────────────────┐
│ Header: [Key: C ▾][Mode: Major ▾]  Tempo ●  Metronome ▶  ⚙ Settings  │
├──────────────────────────────────────────────────────────────────────┤
│  CURRENT CHORD                              HISTORY (last 4)         │
│  ┌───────────────┐   ┌──────┬──────┬──────┬──────────────────────┐   │
│  │   Ab+   62%   │   │ Dm9  │ G13♭9│ Cmaj7│  Ab+   ← newest      │   │
│  │ think: E+     │   │staff │ staff│ staff│  staff + probs       │   │
│  │ alt: E+ 21%   │   └──────┴──────┴──────┴──────────────────────┘   │
│  └───────────────┘                                                   │
│                                                                      │
│  ═══════════ VIRTUAL KEYBOARD (selected mode) ═══════════            │
│   white/black keys, highlights, octave badges, in-scale tint         │
│                                                                      │
│  Transport: ▶ Play History  ⟳ Loop  ✎ Progression  ⏺ Record  🎚 Vol  │
└──────────────────────────────────────────────────────────────────────┘
```

Design principles: the chord panel is visually dominant (this is a *harmony* app, not a
key-light app); dark theme default; everything reachable by mouse + keyboard; responsive
down to tablet width.

---

## Data Models & Types (sketch)

```ts
interface MidiNoteEvent { type:'on'|'off'; channel:number; pitch:number; velocity:number; t:number; }
interface HeldNote  { pitch:number; velocity:number; onset:number; }
interface GhostNote extends HeldNote { release:number; }

interface ChordCandidate {
  id:string;              // 'Ab+'
  symbol:string;          // display
  aliases:string[];       // ['E+/Ab','Abaug']
  pcs:number[];           // [8,0,4]
  root:number; quality:string; extensions:string[];
  bassOptional:boolean; rootOptional:boolean;
  romanTemplate:(key:Key)=>string|null;
  spelling:NoteSpelling;  // letter names for staff
}

interface AnalysisResult {
  ranked: { chord:ChordCandidate; prob:number; explanation:EvidenceBreakdown }[];
  simplified?: string;    // pedagogical alias
  bass?: number;
  entropy:number; stable:boolean;
  snapshot:{ held:HeldNote[]; ghosts:GhostNote[] };
}

interface CommittedChord { result:AnalysisResult; start:number; end:number; voicing:number[]; }
interface ProgressionBar { beats:number; chordSymbol:string; parsed?:ChordCandidate; voicing?:number[]; }
```

---

## Suggested Enhancements / Roadmap

Beyond the requested scope — worth considering because they're cheap wins or big
differentiators:

1. **Interval training mode:** quiz "what chord did I just play?" hiding the answer until
   you guess; spaced-repetition scoring.
2. **Score comparison mode:** import a chart (from the progression editor) and get a live
   traffic-light per beat: correct chord / wrong inversion / wrong notes.
3. **Learned priors:** replace the hand-tuned transition matrix with a small model
   trained on an open jazz corpus (iReal exports, ABC notation, ROMPA). Even
   logistic-regression weights would improve ambiguity resolution (Ab+ vs E+!). Ship
   the hand-tuned version first; keep the interface pluggable. *(This satisfies the
   "neural network" ambition pragmatically.)*
4. **Voicing coach:** after detecting a chord, suggest standard left-hand rootless
   voicings (A- and B-shapes) to reach it, displayed on the mini-keyboard.
5. **Split-hand analysis:** analyze RH/LH separately (channel or pitch-range split) —
   useful for piano reading skills.
6. **MIDI clock sync** (send/receive) to drive hardware from our metronome.
7. **Stage mode:** larger fonts, footswitch-friendly touch targets for
   tablet-on-piano-rig use; dark/light themes.
8. **PWA + offline**; installable; also a **Tauri desktop build** reusing the TS core for
   Safari/Windows-native reliability.
9. **Session analytics:** time-in-key histogram, most-confused chord pairs, accuracy vs
   tempo over time.
10. **Community chord-vocabulary packs:** JSON-defined extra chord dictionaries
    (contemporary classical clusters, synth patch names, non-Western collections…).

### Explicit non-goals (for now)

- Full DAW functionality, effects, mixing.
- Automatic transcription to sheet music.
- Mobile-native apps (responsive web covers tablets).

---

## Getting Started

All commands run from the `harmonia/` directory (plain npm — no pnpm required):

```bash
cd harmonia
npm install
npm run dev         # http://localhost:5173 (Chrome/Edge for Web MIDI)
npm test            # vitest — theory/palette/playback engines are pure & unit-tested
npm run typecheck   # tsc --noEmit (src) ; also: npx tsc -p tsconfig.node.json
npm run build       # tsc && vite build -> dist/ (sourcemaps on)
npm run preview     # serve the production build
```

### Dev server with the `b` rebuild shortcut (`vite.config.ts`)

The Vite config registers a custom CLI shortcut, mirroring the PatternsGuru setup:

- **`npm run dev:loop`** (recommended) — runs `rerun.mjs`, which starts the dev
  server in a loop. Press **`b`** in the terminal and it writes an action marker
  (`vite_action_<project-hash>.tmp` in your OS temp dir), closes Vite, then does
  `git pull --ff-only` → `npm run build` → restarts the server. Ctrl-C exits the
  loop cleanly. The marker filename is keyed by a base64url hash of the project
  directory, so several projects can use this pattern simultaneously without
  colliding.
- **`npm run dev`** — plain Vite; pressing `b` still writes the marker and shuts
  the server down (restart manually). This matches the reference behavior where
  the plugin only signals the action; the wrapper script is what loops.

Notes on adapting the reference config to this project: Harmonia is vanilla
TypeScript (no React), so `@vitejs/plugin-react` was dropped; there are no
workspaces, so `optimizeDeps.exclude` (@mpg/*) was removed; `host: true`,
`port: 5173`, `outDir: dist`, and `sourcemap: true` were kept. Node built-ins
(`fs/path/os`) used by the config are typed via `@types/node` +
`tsconfig.node.json`.

Development order (each step independently useful):

1. **v0.1** Web MIDI adapter + full-88 keyboard view + highlight. *(Instant gratification.)*
2. **v0.2** Settings dialog, 1-octave & 2-octave modes, persistence, mock-input tests.
3. **v0.3** Chord vocabulary + Bayesian analyzer + current-chord panel + key/mode picker.
4. **v0.4** History strip + staff notation + slash chords + explainability.
5. **v0.5** Progression editor + MIDI-out playback + looping.
6. **v0.6** Metronome patterns + MIDI/audio recording.
7. **v0.7+** Learned priors, practice modes, PWA/desktop packaging.

Testing strategy: golden-file tests for the analyzer (input note-sets → expected ranked
output), property tests for spelling/inversion logic, and a hardware checklist doc for
MIDI smoke tests.

---

## References & Prior Art

- Web MIDI API spec & MDN (`navigator.requestMIDIAccess`).
- VexFlow (browser music engraving).
- Krumhansl-Schmuckler key-profile correlations (key-detection heuristics).
- Literature on automatic chord recognition (chroma features, HMM approaches) — our
  pitch-class-profile likelihood is a lightweight cousin.
- Existing visualizers (Synthesia, PianoBooster, Keyspace) — none do probabilistic
  *named-chord* analysis with context; that's our wedge.
- iReal Pro (progression backing tracks) — inspiration for the editor/transport UX.
- Real Book / Art Tatum transcriptions — our dogfooding dataset for ambiguous chords.

---

*Status: v0.1–v0.5 implemented in `harmonia/` (MIDI in/out, 3 keyboard modes, Bayesian
triad analyzer with key/mode priors + ghost-note memory, staff notation, chord palette
system, metronome/sequencer/practice panel). 37 unit tests passing. Next up per the
roadmap above: extended chord vocabulary (7ths/6ths/sus), learned priors, recording.*
