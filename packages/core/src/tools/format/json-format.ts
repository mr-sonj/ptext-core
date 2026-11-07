import { PTextError } from '../../types.js';
import { defineTool } from '../../lib/define.js';
import { splitLines } from '../../lib/text.js';

function sortDeep(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortDeep);
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortDeep((v as Record<string, unknown>)[k])]));
  }
  return v;
}

/** Best-effort line/column from engine-specific JSON.parse messages. */
function locateJsonError(input: string, err: Error): Record<string, unknown> | undefined {
  const m = /line (\d+) column (\d+)/i.exec(err.message);
  if (m) return { line: Number(m[1]), column: Number(m[2]) };
  const p = /position (\d+)/i.exec(err.message);
  if (p) {
    const pos = Number(p[1]);
    const before = input.slice(0, pos);
    const line = before.split('\n').length;
    const column = pos - before.lastIndexOf('\n');
    return { line, column, position: pos };
  }
  return undefined;
}

export const jsonFormat = defineTool({
  id: 'json-format',
  title: 'JSON validate / beautify / minify',
  description: 'Validate JSON and pretty-print or minify it. Reports line and column of syntax errors.',
  category: 'format',
  options: {
    type: 'object',
    properties: {
      mode: { type: 'string', description: 'beautify, minify or validate (returns input unchanged if valid).', enum: ['beautify', 'minify', 'validate'], default: 'beautify' },
      indent: { type: 'integer', description: 'Spaces per indent level for beautify.', default: 2, minimum: 1, maximum: 8 },
      sortKeys: { type: 'boolean', description: 'Sort object keys alphabetically.', default: false },
    },
    additionalProperties: false,
  },
  input: {
    accepts: 'One JSON document (object or array) to validate, pretty-print or minify, or broken JSON whose syntax error needs locating (line and column).',
    signals: {
      jsonValid: 'true → beautify (0.95)',
      looksLikeJson: 'true with jsonValid false → validate, to locate the error (0.7)',
      jsonLines: 'false; JSON Lines is many documents and json-format rejects it',
    },
    avoid: 'JSON Lines / NDJSON (one object per line, so not one document). CSV to JSON → csv-to-json.',
    examples: ['{"a":1,"b":[1,2,3]}', '{"a":1,}'],
  },
  run(input, o) {
    let value: unknown;
    try {
      value = JSON.parse(input.replace(/^﻿/, ''));
    } catch (e) {
      throw new PTextError('INVALID_INPUT', `Invalid JSON: ${(e as Error).message}`, locateJsonError(input, e as Error));
    }
    if (o.sortKeys) value = sortDeep(value);
    const output =
      o.mode === 'validate' ? input : o.mode === 'minify' ? JSON.stringify(value) : JSON.stringify(value, null, o.indent);
    return {
      output,
      data: value,
      stats: { inputLines: splitLines(input).length, outputLines: splitLines(output).length },
      warnings: [],
    };
  },
  suggest(p) {
    if (p.jsonValid) return { score: 0.95, reason: 'Input is valid JSON', options: { mode: 'beautify' } };
    if (p.looksLikeJson && !p.jsonLines) return { score: 0.7, reason: 'Looks like JSON but does not parse — validate to locate the error', options: { mode: 'validate' } };
    return null;
  },
});
