import type { ToolWarning } from '../types.js';
import { countLines, unique } from './text.js';

export const uniqueOpt = { type: 'boolean', description: 'Remove duplicates (keeps first occurrence order).', default: true } as const;
export const sortOpt = { type: 'boolean', description: 'Sort results alphabetically.', default: false } as const;

/** Shared tail of every extract tool: dedupe, sort, stats and the NO_MATCH warning. */
export function finishList(
  input: string,
  items: string[],
  opts: { unique?: boolean; sort?: boolean },
  keyFn?: (s: string) => string,
  extraWarnings: ToolWarning[] = [],
) {
  const total = items.length;
  let out = opts.unique ? unique(items, keyFn) : items;
  if (opts.sort) out = [...out].sort((a, b) => a.localeCompare(b));
  const warnings: ToolWarning[] = out.length === 0 ? [{ code: 'NO_MATCH', message: 'No matches found.' }] : [];
  return {
    output: out.join('\n'),
    data: out,
    stats: { inputLines: countLines(input), outputLines: out.length, count: out.length, removed: total - out.length },
    warnings: [...warnings, ...extraWarnings],
  };
}

