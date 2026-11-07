import { describe, expect, it } from 'vitest';
import { runTool } from '@ptext/core';

describe('convert round trip', () => {
  for (const delimiter of ['comma', 'tab', 'semicolon', '||']) {
    it(`preserves one-column records with ${delimiter}`, () => {
      const items = ['plain', 'a,b', 'a\tb', 'a;b', 'a||b', 'a "quote"', ' leading', 'trailing ', '😀', '\uFEFFbom', '', 'last'];
      const csv = runTool('list-to-csv', items.join('\n'), { delimiter, removeEmpty: false });
      const json = runTool('csv-to-json', csv.output, { delimiter, header: false, indent: 0 });
      expect(json.data).toEqual(items.map((item) => [item]));
      expect(json.warnings).toEqual([]);
    });
  }

  it('preserves a long quoted field', () => {
    const item = `😀${'x'.repeat(100_000)},"end"`;
    const csv = runTool('list-to-csv', item);
    const json = runTool('csv-to-json', csv.output, { delimiter: 'comma', header: false, indent: 0 });
    expect(json.data).toEqual([[item]]);
  });
});
