#!/usr/bin/env node
// Scaffold a tool: pnpm new-tool <id> --category=<category>
// Creates packages/core/src/tools/<category>/<id>.ts and fixtures/golden/<id>.json with TODO
// placeholders (the catalog test fails until they are filled), registers the tool in
// tools/index.ts and adds a row to the README tools table.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const at = (p) => new URL(p, root);
const die = (msg) => {
  process.stderr.write(`new-tool: ${msg}\n`);
  process.exit(2);
};

const args = process.argv.slice(2);
const id = args.find((a) => !a.startsWith('--'));
const category = /^--category=(.+)$/.exec(args.find((a) => a.startsWith('--category=')) ?? '')?.[1];
const categories = JSON.parse(
  /TOOL_CATEGORIES = (\[[^\]]*\])/.exec(readFileSync(at('packages/core/src/types.ts'), 'utf8'))[1].replace(/'/g, '"'),
);

if (!id || !category) die(`usage: pnpm new-tool <id> --category=<${categories.join('|')}>`);
if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(id)) die(`"${id}" must be kebab-case, e.g. csv-to-yaml`);
if (!categories.includes(category)) die(`unknown category "${category}". Use one of ${categories.join(', ')}, or add it to TOOL_CATEGORIES in packages/core/src/types.ts first`);

const ident = id.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());
const toolPath = `packages/core/src/tools/${category}/${id}.ts`;
const fixturePath = `fixtures/golden/${id}.json`;
const indexPath = 'packages/core/src/tools/index.ts';
const index = readFileSync(at(indexPath), 'utf8');
if (existsSync(at(toolPath)) || existsSync(at(fixturePath)) || index.includes(`'./${category}/${id}.js'`)) die(`"${id}" already exists`);
if (new RegExp(`\\b${ident}\\b`).test(index)) die(`identifier "${ident}" is already used in ${indexPath}`);

const tool = `import { PTextError, type ToolWarning } from '../../types.js';
import { defineTool } from '../../lib/define.js';
import { countLines } from '../../lib/text.js';

export const ${ident} = defineTool({
  id: '${id}',
  title: 'TODO title',
  description: 'TODO: one sentence that tells an LLM when to pick this tool.',
  category: '${category}',
  options: {
    type: 'object',
    properties: {
      // indent: { type: 'integer', description: 'Spaces per level.', default: 2, minimum: 0, maximum: 8 },
    },
    additionalProperties: false,
  },
  // What AI clients and the remote router read to pick this tool. Be exact: they judge only as well as this card.
  input: {
    accepts: 'TODO: one sentence, what the pasted text looks like when this tool fits.',
    // Exactly the InputProfile fields suggest() reads, each with the value that points here (a test checks the set).
    // Leave {} if the tool has no suggest rule.
    signals: {},
    // avoid: 'TODO: the look-alike case → the tool to pick instead.',
    examples: ['TODO: a short real input (each one must fire suggest() and rank this tool top-3)'],
  },
  run(input, o) {
    const warnings: ToolWarning[] = [];
    // Input the tool cannot handle at all: throw new PTextError('INVALID_INPUT', '...', { line }).
    // Anything skipped, changed or guessed: push a warning code. Never drop data silently.
    const output = input;
    return {
      output,
      stats: { inputLines: countLines(input), outputLines: countLines(output) },
      warnings,
    };
  },
  // Auto-suggest from the profile (counts/flags only, never raw text). Needs a fixtures/suggest.json case,
  // and input.signals must then list the fields it reads, e.g. { jsonValid: 'true' }.
  // suggest: (p) => (p.jsonValid ? { score: 0.8, reason: 'Input is valid JSON' } : null),
});
`;

const fixture = {
  $schema: '../golden.schema.json',
  tool: id,
  cases: [
    { name: `${id}: TODO happy case`, input: ['TODO first line', 'second line'], expect: { output: 'TODO expected output' } },
    { name: `${id}: TODO edge case (empty, bad data, ambiguity)`, edge: true, input: '', expect: { output: 'TODO', warnings: [] } },
  ],
};

const importMarker = '// @new-tool:import';
const entryMarker = '  // @new-tool:entry';
if (!index.includes(importMarker) || !index.includes(entryMarker)) die(`markers missing in ${indexPath}`);
const nextIndex = index
  .replace(importMarker, `import { ${ident} } from './${category}/${id}.js';\n${importMarker}`)
  .replace(entryMarker, `  ${ident},\n${entryMarker}`);

// README: the tools table has one `| \`id\` | category | description |` row per tool, grouped in
// TOOL_CATEGORIES order. The new row goes after the last row of the same or an earlier category.
const readme = readFileSync(at('README.md'), 'utf8');
const lines = readme.split('\n');
const rowRe = /^\| `[a-z0-9-]+` \| ([a-z]+) \| .* \|$/;
const rows = lines.flatMap((l, i) => (rowRe.test(l) ? [{ i, rank: categories.indexOf(rowRe.exec(l)[1]) }] : []));
if (rows.length === 0) die('tools table not found in README.md');
const after = rows.filter((r) => r.rank <= categories.indexOf(category)).at(-1);
lines.splice(after ? after.i + 1 : rows[0].i, 0, `| \`${id}\` | ${category} | TODO: one sentence that tells an LLM when to pick this tool. |`);

mkdirSync(at(`packages/core/src/tools/${category}/`), { recursive: true });
writeFileSync(at(toolPath), tool);
writeFileSync(at(fixturePath), JSON.stringify(fixture, null, 2) + '\n');
writeFileSync(at(indexPath), nextIndex);
writeFileSync(at('README.md'), lines.join('\n'));

process.stdout.write(`Created ${toolPath}
Created ${fixturePath}
Registered in ${indexPath} and README.md

Next:
  1. Fill the fixture cases first, then run: pnpm test:tool ${id}   (fails until the TODOs are gone)
  2. Write run(), the options schema and the input card in ${toolPath}
  3. If it should be auto-suggested: add suggest(), its input.signals, and a fixtures/suggest.json case
  4. Copy the final description into the tool's README row, then: pnpm build && pnpm test
Guide: CONTRIBUTING.md
`);
