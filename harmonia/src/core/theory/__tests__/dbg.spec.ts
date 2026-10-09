import { it } from 'vitest';
import { parseUcss } from '../ucss.ts';
it('dbg', () => {
  for (const s of ['C7/3','C7 ♯11/3','C7 /3','C /9','Cm7','C7(#11, no 3)']) {
    const c = parseUcss(s, { key: null });
    console.log(JSON.stringify(s), 'ext:', c.extension, 'qual:', c.quality, 'add:', JSON.stringify(c.add), 'rem:', JSON.stringify(c.rem));
  }
});
