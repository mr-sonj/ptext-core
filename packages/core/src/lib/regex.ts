import { PTextError } from '../types.js';

/**
 * Compile a user-supplied regex. JS regexes cannot be interrupted, so a pattern
 * that backtracks exponentially would hang the MCP process or burn Worker CPU.
 * Patterns that repeat a group which already repeats (`(a+)+`, `(\w*)*`,
 * `(?:x|y+){2,}`) are rejected. Overlapping alternation such as `(a|a)*` is not
 * detected (audit M4).
 */
export function compileUserRegex(pattern: string, flags: string, option = 'pattern'): RegExp {
  let re: RegExp;
  try {
    re = new RegExp(pattern, flags);
  } catch (e) {
    throw new PTextError('INVALID_OPTION', `Invalid regex: ${(e as Error).message}`, { option });
  }
  if (hasNestedQuantifier(pattern)) {
    throw new PTextError(
      'INVALID_OPTION',
      'Regex repeats a group that already repeats (e.g. "(a+)+"), which can hang on some inputs. Rewrite it without the nested repeat.',
      { option, reason: 'NESTED_QUANTIFIER' },
    );
  }
  return re;
}

interface Quantifier {
  len: number;
  /** `?`, `*`, `+`, `{n,}`, `{n,m}`: the number of repeats is not fixed. */
  variable: boolean;
  /** Can match its atom more than once. */
  repeats: boolean;
}

function readQuantifier(src: string, i: number): Quantifier | null {
  const ch = src[i];
  let q: Quantifier | null = null;
  if (ch === '*' || ch === '+') q = { len: 1, variable: true, repeats: true };
  else if (ch === '?') q = { len: 1, variable: true, repeats: false };
  else if (ch === '{') {
    const m = /^\{(\d+)(,(\d*))?\}/.exec(src.slice(i, i + 24));
    if (m) {
      const min = Number(m[1]);
      const max = m[2] === undefined ? min : m[3] === '' ? Infinity : Number(m[3]);
      q = { len: m[0].length, variable: max !== min, repeats: max > 1 };
    }
  }
  if (q && src[i + q.len] === '?') q.len++; // lazy
  return q;
}

/** Star height > 1: a quantified group whose body has a variable quantifier. Assumes `src` already compiled. */
function hasNestedQuantifier(src: string): boolean {
  // One entry per open group: does its body contain a variable repeat?
  const stack: boolean[] = [false];
  const mark = () => (stack[stack.length - 1] = true);
  let i = 0;
  while (i < src.length) {
    const ch = src[i]!;
    let atomEnd: number;
    if (ch === '\\') {
      // \p{L}, \P{L} and \u{1F600} carry braces that are not a quantifier.
      atomEnd = /[pPu]/.test(src[i + 1] ?? '') && src[i + 2] === '{' ? src.indexOf('}', i) + 1 : i + 2;
    } else if (ch === '[') {
      let j = i + 1;
      while (j < src.length && src[j] !== ']') j += src[j] === '\\' ? 2 : 1;
      atomEnd = j + 1;
    } else if (ch === '(') {
      stack.push(false);
      i++;
      if (src[i] === '?') i = src[i + 1] === '<' && src[i + 2] !== '=' && src[i + 2] !== '!' ? src.indexOf('>', i) + 1 : i + (src[i + 1] === '<' ? 3 : 2);
      continue;
    } else if (ch === ')') {
      const inner = stack.pop()!;
      const q = readQuantifier(src, i + 1);
      if (q && inner && q.repeats) return true;
      if (inner || q?.variable) mark();
      i += 1 + (q?.len ?? 0);
      continue;
    } else {
      atomEnd = i + 1;
    }
    const q = readQuantifier(src, atomEnd);
    if (q?.variable) mark();
    i = atomEnd + (q?.len ?? 0);
  }
  return false;
}
