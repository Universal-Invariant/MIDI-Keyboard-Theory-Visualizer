/**
 * Web MIDI adapter — port enumeration, selection, and note-event plumbing.
 * Also exposes a simple MIDI-out sender for future playback features (README §9).
 *
 * Requires a Chromium-based browser (navigator.requestMIDIAccess). Safari users
 * need the midi-plugin-for-webkit shim or the native fallback bridge (README §5).
 */

import type { MidiNoteEvent, MidiCCEvent, MidiEvent } from '../core/types.ts';

export interface PortInfo {
  id: string;
  name: string | null;
  manufacturer: string | null;
  state: 'connected' | 'disconnected' | 'pending';
}

export type NoteEventListener = (ev: MidiNoteEvent) => void;
export type CCListener = (ev: MidiCCEvent) => void;

export class WebMidiAdapter {
  private access: MIDIAccess | null = null;
  private inputListeners = new Set<NoteEventListener>();
  private ccListeners = new Set<CCListener>();
  private activeInputId: string | null = null;
  private activeOutputId: string | null = null;
  private onPortsChanged: (() => void) | null = null;

  /** Returns false if Web MIDI is unavailable (e.g. Safari without the shim). */
  async init(onPortsChanged?: () => void): Promise<boolean> {
    if (!('requestMIDIAccess' in navigator)) return false;
    this.access = await navigator.requestMIDIAccess({ sysex: false });
    this.onPortsChanged = onPortsChanged ?? null;
    this.access.onstatechange = () => this.onPortsChanged?.();
    return true;
  }

  listInputs(): PortInfo[] {
    if (!this.access) return [];
    return [...this.access.inputs.values()].map(toPortInfo);
  }

  listOutputs(): PortInfo[] {
    if (!this.access) return [];
    return [...this.access.outputs.values()].map(toPortInfo);
  }

  setInputPort(id: string | null): void {
    // Detach previous handler.
    if (this.activeInputId && this.access) {
      const prev = this.access.inputs.get(this.activeInputId);
      if (prev) prev.onmidimessage = null;
    }
    this.activeInputId = id;
    if (!id || !this.access) return;
    const input = this.access.inputs.get(id);
    if (!input) return;
    input.onmidimessage = (msg: MIDIMessageEvent) => {
      if (!(msg.data instanceof Uint8Array)) return;
      const ev = parseMidiMessage(msg.data, msg.timeStamp);
      if (!ev) return;
      if (ev.name === 'control-change') for (const fn of this.ccListeners) fn(ev);
      else for (const fn of this.inputListeners) fn(ev);
    };
  }

  setOutputPort(id: string | null): void {
    this.activeOutputId = id;
  }

  get currentInputId(): string | null { return this.activeInputId; }
  get currentOutputId(): string | null { return this.activeOutputId; }

  onNote(fn: NoteEventListener): () => void {
    this.inputListeners.add(fn);
    return () => this.inputListeners.delete(fn);
  }

  onCC(fn: CCListener): () => void {
    this.ccListeners.add(fn);
    return () => this.ccListeners.delete(fn);
  }

  /** Send a note on/off to the selected output (used by playback later). */
  sendNote(name: 'note-on' | 'note-off', pitch: number, velocity: number, channel = 0): void {
    if (!this.access || !this.activeOutputId) return;
    const out = this.access.outputs.get(this.activeOutputId);
    if (!out) return;
    const status = (name === 'note-on' ? 0x90 : 0x80) | (channel & 0x0f);
    out.send([status, pitch & 0x7f, velocity & 0x7f]);
  }

  /** Send an arbitrary raw message to the selected output. */
  send(data: number[]): void {
    if (!this.access || !this.activeOutputId) return;
    const out = this.access.outputs.get(this.activeOutputId);
    if (out) out.send(data);
  }

  /** Simulate notes as if they came from hardware (computer-keyboard input). */
  injectNote(ev: MidiEvent): void {
    if (ev.name === 'control-change') for (const fn of this.ccListeners) fn(ev);
    else for (const fn of this.inputListeners) fn(ev);
  }
}

function toPortInfo(p: MIDIInput | MIDIOutput): PortInfo {
  return { id: p.id, name: p.name, manufacturer: p.manufacturer, state: p.state };
}

/** Parse Channel Voice messages for note on/off and control change; ignore the rest. */
export function parseMidiMessage(data: Uint8Array, timeStamp: number): MidiEvent | null {
  if (data.length < 3) return null;
  const status = data[0];
  const kind = status & 0xf0;
  const channel = status & 0x0f;
  const d1 = data[1] & 0x7f;
  const d2 = data[2] & 0x7f;
  if (kind === 0x90 && d2 > 0) return { name: 'note-on', pitch: d1, velocity: d2, channel, timestamp: timeStamp };
  if (kind === 0x80 || (kind === 0x90 && d2 === 0)) {
    return { name: 'note-off', pitch: d1, velocity: d2, channel, timestamp: timeStamp };
  }
  if (kind === 0xb0) return { name: 'control-change', controller: d1, value: d2, channel, timestamp: timeStamp };
  return null; // program change, pitch bend etc. — future work.
}

/** Back-compat alias used in earlier tests. */
export const parseNoteMessage = parseMidiMessage;
