// Test-only loader for the golden contract (Node). Format: fixtures/golden.schema.json.
import { readdirSync, readFileSync } from 'node:fs';

type Text = string | string[];

interface RawCase {
  name: string;
  tool?: string;
  edge?: boolean;
  input: Text;
  options?: Record<string, unknown>;
  expect?: { output: Text; warnings?: string[] };
  expectError?: string;
}

export interface GoldenCase {
  name: string;
  tool: string;
  /** File the case came from, relative to fixtures/. */
  file: string;
  edge: boolean;
  input: string;
  options?: Record<string, unknown>;
  expect?: { output: string; warnings: string[] };
  expectError?: string;
}

const dir = new URL('./golden/', import.meta.url);
const CASE_KEYS = new Set(['name', 'tool', 'edge', 'input', 'options', 'expect', 'expectError']);
const text = (t: Text) => (Array.isArray(t) ? t.join('\n') : t);

/** Every golden case, normalised: line arrays joined, `warnings` defaulted to [], `tool` filled from the file. */
export function loadGolden(): GoldenCase[] {
  const out: GoldenCase[] = [];
  const names = new Set<string>();
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.json')).sort()) {
    const file = `golden/${f}`;
    const doc = JSON.parse(readFileSync(new URL(f, dir), 'utf8')) as { tool?: string; cases: RawCase[] };
    if (doc.tool !== undefined && `${doc.tool}.json` !== f) throw new Error(`${file}: "tool" must match the file name`);
    for (const c of doc.cases) {
      const where = `${file} › ${c.name}`;
      for (const k of Object.keys(c)) if (!CASE_KEYS.has(k)) throw new Error(`${where}: unknown key "${k}"`);
      if (!c.expect === !c.expectError) throw new Error(`${where}: needs exactly one of "expect" or "expectError"`);
      const tool = c.tool ?? doc.tool;
      if (!tool) throw new Error(`${where}: no tool (set "tool" on the file or the case)`);
      if (names.has(c.name)) throw new Error(`${where}: duplicate case name`);
      names.add(c.name);
      out.push({
        name: c.name,
        tool,
        file,
        edge: !!c.edge || !!c.expectError || (c.expect?.warnings?.length ?? 0) > 0,
        input: text(c.input),
        ...(c.options ? { options: c.options } : {}),
        ...(c.expect ? { expect: { output: text(c.expect.output), warnings: c.expect.warnings ?? [] } } : {}),
        ...(c.expectError ? { expectError: c.expectError } : {}),
      });
    }
  }
  return out;
}

export interface SuggestCase {
  name: string;
  input: string;
  /** This tool must be in the top-3 suggestions. */
  expectTop3?: string;
  /** None of these tools may be suggested at all. */
  expectNotSuggested?: string[];
}

export function loadSuggestCorpus(): SuggestCase[] {
  const cases = JSON.parse(readFileSync(new URL('./suggest.json', import.meta.url), 'utf8')).cases as SuggestCase[];
  for (const c of cases) {
    if (!c.expectTop3 && !c.expectNotSuggested?.length) throw new Error(`suggest.json › ${c.name}: needs "expectTop3" or "expectNotSuggested"`);
  }
  return cases;
}
