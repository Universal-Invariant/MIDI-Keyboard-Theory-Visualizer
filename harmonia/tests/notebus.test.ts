import { describe, expect, it } from 'vitest';
import { NoteBus } from '../src/core/notes/NoteBus.ts';

describe('NoteBus ghost notes', () => {
  it('keeps released notes as decaying ghosts', () => {
    const bus = new NoteBus({ ghostHalfLifeMs: 1000, ghostMaxAgeMs: 4000 });
    bus.handleEvent({ name: 'note-on', pitch: 60, velocity: 90, channel: 0, timestamp: 0 });
    bus.handleEvent({ name: 'note-on', pitch: 64, velocity: 90, channel: 0, timestamp: 10 });
    bus.handleEvent({ name: 'note-off', pitch: 60, velocity: 0, channel: 0, timestamp: 500 });
    const s500 = bus.getState(500);
    expect(s500.held.map((h) => h.pitch)).toEqual([64]);
    expect(s500.ghosts.length).toBe(1);
    expect(s500.ghosts[0].weight).toBeGreaterThan(0.6); // ~0.7 at half a half-life
    const s3000 = bus.getState(3000);
    expect(s3000.ghosts[0].weight).toBeLessThan(0.2);
    const s5000 = bus.getState(5000);
    expect(s5000.ghosts.length).toBe(0);
  });

  it('re-triggering a note removes its ghost', () => {
    const bus = new NoteBus();
    bus.handleEvent({ name: 'note-on', pitch: 60, velocity: 90, channel: 0, timestamp: 0 });
    bus.handleEvent({ name: 'note-off', pitch: 60, velocity: 0, channel: 0, timestamp: 100 });
    bus.handleEvent({ name: 'note-on', pitch: 60, velocity: 90, channel: 0, timestamp: 200 });
    const s = bus.getState(250);
    expect(s.ghosts.length).toBe(0);
    expect(s.held.length).toBe(1);
  });
});
