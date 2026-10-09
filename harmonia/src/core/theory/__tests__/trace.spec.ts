import { it } from 'vitest';
import { parseUcss, intervalsOf, toLinear } from '../ucss.ts';
it('trace', () => {
  for (const s of ['Cm7','Cmaj7','C9','C7/3','C7 ♯11/3','C7(#11, no 3)','C /9','Csus4','C7sus4']) {
    const c = parseUcss(s, { key: null });
    console.log(JSON.stringify(s), '| ext:', c.extension, 'qual:', c.quality, 'sus:', c.susMarker, c.susDigit, 'add:', JSON.stringify(c.add), 'rem:', JSON.stringify(c.rem), 'intervals:', JSON.stringify(intervalsOf(c)), 'lin:', toLinear(c, {}));
  }
});
