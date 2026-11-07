# Contributing to PText

Thanks for helping. Bug reports, fixture cases for wrong output, and new tools are all welcome.

## Setup

Requirements: Node ≥ 22.12 and pnpm 10 (`corepack enable`).

```bash
git clone https://github.com/mr-sonj/ptext-core.git && cd ptext-core
pnpm install
pnpm build && pnpm test
```

Run `pnpm build && pnpm test` before you open a pull request. CI runs the same commands on Node 22, 24 and 26, smoke-tests the built CLI and MCP server, and bundles the Cloudflare Worker example.

## Ground rules

- `packages/core` stays **zero-dependency and runtime-neutral**: no `node:*` imports, no DOM, no `Buffer` or `process`. It compiles without DOM and Node types, so `tsc` catches violations. Only the globals in `src/globals.d.ts` are available.
- Tools **never execute decoded content** and **never call the network**.
- Tools **never drop data silently**. Anything skipped, guessed or changed gets a warning code.
- The input profile (`profileInput`) holds **counts, flags and ratios only**, never raw text.
- Changing an existing tool's output changes its contract. Say so in the pull request and update its golden fixture.

## Commit messages

Use [Conventional Commits](https://www.conventionalcommits.org/). Releases read them to decide whether a release is due, to pick its version and to write the changelog:

| Prefix | Example | Release |
| --- | --- | --- |
| `feat:` | `feat(convert): add csv-to-yaml` | minor |
| `fix:` `perf:` `revert:` | `fix(extract-ip): reject 256.x octets` | patch |
| `docs:` `test:` `refactor:` `chore:` `ci:` `build:` … | `docs: clarify MCP setup` | none; listed in the next release |
| `feat!:` or a `BREAKING CHANGE:` footer | `feat!: rename stats.count` | major (minor while on 0.x) |

A dependency update that users should get is a `fix(deps):`.

Pull requests are squash-merged, so the pull request title becomes the commit message: write it in this form too.

## Adding or changing a tool

A tool is two files:

- `packages/core/src/tools/<category>/<id>.ts`: options schema, input card, `run`, and an optional `suggest` rule.
- `fixtures/golden/<id>.json`: its contract.

Everything else (catalog, MCP, CLI, AI adapters, Worker, browser harness) picks the tool up from the registry.

### 1. Scaffold

```bash
pnpm new-tool csv-to-yaml --category=convert
```

Categories: `extract · clean · columns · convert · encode · format` (`TOOL_CATEGORIES` in `src/types.ts`). A new category has to be added there first. The scaffold also registers the tool in `tools/index.ts` and adds a row to the README tools table.

Naming: kebab-case. Converters are named `<from>-to-<to>` (`csv-to-json`). Two-way codecs take a `direction` option (`base64`, `url-encode`).

### 2. Write the fixtures first and watch them fail

Edit `fixtures/golden/<id>.json` (schema: `fixtures/golden.schema.json`). It needs at least one happy case and at least one edge case (`"edge": true`, an `expectError`, or a case with warnings). `input` and `expect.output` can be arrays of lines for multi-line text. `expect.warnings` must list every warning code in order. Leaving it out means no warnings are expected.

```bash
pnpm test:tool csv-to-yaml     # red until the TODOs are gone and run() is right
```

Edge cases worth covering for a converter:

- input: empty, whitespace only, BOM, CRLF, a trailing newline
- characters: emoji (surrogate pairs), very long lines
- structure: malformed or ragged rows, duplicate keys, a `__proto__` key
- quoting: values that contain the delimiter or a quote
- round trip: when the reverse tool exists, `a-to-b` then `b-to-a` returns the input

### 3. Write `run()`

`defineTool()` infers the type of the options from the options schema. Enum options become unions. Options with no default and not marked `required` may be `undefined`.

- If the tool cannot process the input, throw `PTextError('INVALID_INPUT', msg, { line })`. If an option combination makes no sense, throw `PTextError('INVALID_OPTION', …, { option })`. Any other thrown error surfaces as `INTERNAL`, which means a bug.
- For anything skipped, guessed or changed, push a warning `{ code: 'SCREAMING_SNAKE', message, line? }`.
- Every user-supplied regex goes through `compileUserRegex()` (`lib/regex.ts`).
- Respect `maxInputChars` (default 5M). Never spread a per-row array into a call (`Math.max(...rows)` overflows the stack), and never recurse once per input level without a bound. Heavy tools need a size case in the `limits` tests.
- Options: every option has a `description`, every string option has a `maxLength`, and every option has a default unless it is truly required.
- Return `{ output, data?, stats: { inputLines, outputLines, count?, removed? }, warnings }`. `output` is the copy-ready text. `data` holds JSON-serializable structure when that is useful.

Reuse these helpers before you write your own:

| Need | Use |
| --- | --- |
| Lines, counts, dedupe, invisible characters | `lib/text.ts` (`splitLines`, `countLines`, `unique`, `INVISIBLE_RE`) |
| CSV/TSV parsing and writing, delimiter detection | `lib/csv.ts` (`parseDelimited`, `toCsv`, `detectDelimiter`, `resolveDelimiter`) |
| Delimited table input with warnings | `lib/table.ts` (`delimiterOpt`, `resolveInputDelimiter`, `readRows`, `raggedWarning`, `maxWidth`) |
| Extract-style list output | `lib/extract.ts` (`finishList`, `uniqueOpt`, `sortOpt`) |

Warning codes already in use. Reuse a code when the situation is the same: `NO_MATCH`, `FILENAME_LIKE_SKIPPED`, `INVISIBLE_REMOVED`, `DELIMITER_NOT_DETECTED`, `UNTERMINATED_QUOTE`, `RAGGED_ROWS`, `MISSING_CELLS`, `RANGE_CLAMPED`, `DUPLICATE_HEADER`, `BLANK_ROWS_SKIPPED`, `NOT_UTF8`.

### 4. Input card (every tool) and suggest rule (optional)

AI clients (MCP, function calling) and remote routers read the input card to pick a tool. A router never sees the text, so it can only judge as well as the card and the profile fields are exact.

```ts
input: {
  accepts: 'Text with IPv4 or IPv6 addresses in it: server logs, proxy lists (ip:port)…',   // what the paste looks like
  signals: { ipv4Count: '> 0, or ipv6Count > 0', ipv6Count: '> 0, or ipv4Count > 0' },     // field → value that points here
  avoid: 'To keep ip and port as two columns → split-columns.',                              // look-alike → other tool
  examples: ['192.168.1.10 - - [07/Nov/2026] "GET /"'],                                     // 1–3, ≤ 300 chars
},
suggest: (p) => (p.ipv4Count + p.ipv6Count > 0 ? { score: 0.8, reason: '…' } : null),
```

The tests enforce these rules:

- `signals` names **exactly** the profile fields `suggest` reads. A `Proxy` records which fields are read across every corpus, golden and example input. If a branch is never reached, add an example that reaches it. A tool without `suggest` has `signals: {}`.
- Every example fires the tool's own rule and ranks the tool in the top 3.
- `accepts` and `avoid` describe what `run()` really handles. They go into the model-facing description (`modelDescription`) and into `ptext catalog`.

Use only fields of `InputProfile`. To add a signal, add it to `InputProfile` (`src/types.ts`), describe it in `PROFILE_FIELDS` (`src/profiler.ts`; the code will not compile without that), and compute it in `profileInput()`. Count with the tool's own matcher (`lib/match.ts`), not a look-alike regex. A test checks that `emailCount`, `urlCount`, `hostnameCount`, `ipv4Count` and `ipv6Count` equal what the tools return.

Add a `fixtures/suggest.json` case whose `expectTop3` is the new tool. If the rule could fire on a look-alike (prose, logs, HTML, hashes), also add a case with `expectNotSuggested`.

### 5. README row and final check

Copy the tool's final `description` into its row in the README tools table. A test checks that the table matches the catalog. Then:

```bash
pnpm build && pnpm test
```

For every tool, the tests check that:

- the file is at `tools/<category>/<id>.ts`
- the tool has its own fixture file with a happy case and an edge case
- no `TODO` is left in the title, description, input card or cases
- every option has a description
- the input card has `accepts`, 1–3 short examples and real signal fields
- `signals` matches the fields `suggest` reads, and every example ranks the tool in the top 3
- a tool with `suggest` has a corpus case
- the README tools table has a matching row
- MCP returns the same output and error codes as core

## Pull requests

- Keep each pull request focused on one tool or one fix.
- Accepted pull requests are squash-merged into `main` with you as the commit author. The title becomes the commit message and the changelog line, so keep it a Conventional Commit; the maintainer may edit it before merging.
- For a bug in a tool's output, start with a failing golden case that reproduces it.
- Describe any change to existing output or warning codes.
- Do not add runtime dependencies to `@ptext/core`.
