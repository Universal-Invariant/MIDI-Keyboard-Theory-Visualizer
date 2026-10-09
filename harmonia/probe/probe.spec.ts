import { it, expect } from 'vitest';
import { parseUcss } from '../src/core/theory/ucss.ts';

it('dbg', () => {
  const c = parseUcss('C7 /3');
  console.log(JSON.stringify({ anchor: c.anchor, ext: c.extension, add: c.add, rem: c.rem, raw: c.raw }));
  const d = parseUcss('Cø7');
  console.log(JSON.stringify({ anchor: d.anchor, ext: d.extension, q: d.quality }));
  expect(true).toBe(true);
});
