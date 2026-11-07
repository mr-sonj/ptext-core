import { PTextError, type ToolWarning } from '../../types.js';
import { defineTool } from '../../lib/define.js';
import { splitLines } from '../../lib/text.js';

// Runtime-neutral UTF-8 <-> Base64 (no Buffer, works in browser/Workers/Node/Deno/Bun).
const enc = new TextEncoder();

function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(bin);
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export const base64 = defineTool({
  id: 'base64',
  title: 'Base64 encode / decode',
  description: 'Encode text to Base64 or decode Base64 (standard or URL-safe) to UTF-8 text. Decoded content is only returned as text, never executed.',
  category: 'encode',
  options: {
    type: 'object',
    properties: {
      direction: { type: 'string', description: 'encode or decode.', enum: ['encode', 'decode'], default: 'decode' },
      urlSafe: { type: 'boolean', description: 'Use URL-safe alphabet (-_ and no padding) when encoding.', default: false },
      perLine: { type: 'boolean', description: 'Process each line separately.', default: false },
    },
    additionalProperties: false,
  },
  input: {
    accepts: 'A Base64 or Base64url string, one blob or wrapped over many lines (MIME, PEM body), that decodes to readable UTF-8 text. Also any text the user wants encoded (direction=encode).',
    signals: { base64DecodesToText: 'true → decode' },
    avoid: 'Hex hashes, UUIDs and binary payloads such as images (they do not decode to text). A whole JWT: it is three Base64url parts joined by dots, decode one part at a time.',
    examples: ['eGluIGNow6BvIMSR4bqhaQ==', 'SGVsbG8sIFBUZXh0IQ=='],
  },
  run(input, o) {
    const warnings: ToolWarning[] = [];
    const items = o.perLine ? splitLines(input) : [input];
    const out = items.map((item, idx) => {
      if (o.direction === 'encode') {
        let s = bytesToBase64(enc.encode(item));
        if (o.urlSafe) s = s.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
        return s;
      }
      const cleaned = item.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
      if (cleaned === '') return '';
      if (!/^[A-Za-z0-9+/]*={0,2}$/.test(cleaned) || cleaned.replace(/=+$/, '').length % 4 === 1) {
        throw new PTextError('INVALID_INPUT', `Not valid Base64${o.perLine ? ` (line ${idx + 1})` : ''}`, o.perLine ? { line: idx + 1 } : undefined);
      }
      const padded = cleaned.replace(/=+$/, '').padEnd(Math.ceil(cleaned.replace(/=+$/, '').length / 4) * 4, '=');
      const bytes = base64ToBytes(padded);
      const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
      if (text.includes('�')) {
        warnings.push({ code: 'NOT_UTF8', message: 'Decoded bytes are not valid UTF-8 (binary data?); invalid sequences shown as �.', ...(o.perLine ? { line: idx + 1 } : {}) });
      }
      return text;
    });
    return {
      output: out.join('\n'),
      data: out,
      stats: { inputLines: splitLines(input).length, outputLines: splitLines(out.join('\n')).length, count: out.length },
      warnings,
    };
  },
  suggest: (p) =>
    p.base64DecodesToText ? { score: 0.85, reason: 'Base64 that decodes to text', options: { direction: 'decode' } } : null,
});
