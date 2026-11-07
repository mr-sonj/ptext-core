import { PTextError } from '../../types.js';
import { defineTool } from '../../lib/define.js';
import { splitLines } from '../../lib/text.js';

export const urlEncode = defineTool({
  id: 'url-encode',
  title: 'URL encode / decode',
  description: 'Percent-encode or decode text (component or full-URI mode). Decoding "+" as space is supported in form mode.',
  category: 'encode',
  options: {
    type: 'object',
    properties: {
      direction: { type: 'string', description: 'encode or decode.', enum: ['encode', 'decode'], default: 'decode' },
      mode: { type: 'string', description: 'component (encodeURIComponent), uri (encodeURI), form (+ = space).', enum: ['component', 'uri', 'form'], default: 'component' },
      perLine: { type: 'boolean', description: 'Process each line separately.', default: true },
    },
    additionalProperties: false,
  },
  input: {
    accepts: 'Percent-encoded text to decode, such as query strings, encoded URLs or form bodies (%20, %C3%A0, + as space in form mode). Also any text to encode (direction=encode).',
    signals: { percentEncodedCount: '≥ 2 → decode' },
    avoid: 'Base64 strings → base64. HTML entities such as &amp; are not percent-encoding.',
    examples: ['q=xin%20ch%C3%A0o%20b%E1%BA%A1n', 'https://example.com/search?q=a%2Bb%20c'],
  },
  run(input, o) {
    const items = o.perLine ? splitLines(input) : [input];
    const out = items.map((item, idx) => {
      if (o.direction === 'encode') {
        if (o.mode === 'uri') return encodeURI(item);
        const e = encodeURIComponent(item);
        return o.mode === 'form' ? e.replace(/%20/g, '+') : e;
      }
      const src = o.mode === 'form' ? item.replace(/\+/g, ' ') : item;
      try {
        return o.mode === 'uri' ? decodeURI(src) : decodeURIComponent(src);
      } catch {
        throw new PTextError('INVALID_INPUT', `Malformed percent-encoding${o.perLine ? ` (line ${idx + 1})` : ''}`, o.perLine ? { line: idx + 1 } : undefined);
      }
    });
    return {
      output: out.join('\n'),
      data: out,
      stats: { inputLines: splitLines(input).length, outputLines: out.length, count: out.length },
      warnings: [],
    };
  },
  suggest: (p) =>
    p.percentEncodedCount >= 2
      ? { score: 0.8, reason: `${p.percentEncodedCount} percent-encoded sequences`, options: { direction: 'decode' } }
      : null,
});
