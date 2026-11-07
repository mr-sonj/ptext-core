# PText

**Paste text. Get a useful result.**

[![CI](https://github.com/mr-sonj/ptext-core/actions/workflows/ci.yml/badge.svg)](https://github.com/mr-sonj/ptext-core/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/mr-sonj/ptext-core?sort=semver)](https://github.com/mr-sonj/ptext-core/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Node](https://img.shields.io/badge/node-%E2%89%A5%2022-brightgreen)
![Core dependencies](https://img.shields.io/badge/core%20dependencies-0-brightgreen)

PText is a set of open-source text tools for everyday jobs: **remove duplicate lines, convert CSV to JSON, extract emails from text, format and validate JSON, and clean up messy text**, plus extracting URLs, domains and IP addresses, splitting and selecting columns, and Base64 and URL encoding. Paste text and PText suggests the right tool. Then deterministic code produces a result you can copy. **An AI may pick the tool, but code always produces the result**, so the output is exact, repeatable and testable.

One engine ships as a JavaScript/TypeScript library, an MCP server for AI assistants (Claude, Cursor, Codex…), a command-line tool and OpenAI/Anthropic tool schemas. A paste-and-go web app at **ptext.org**, built on this same core, is planned.

- **Zero runtime dependencies.** Pure ESM TypeScript, about 17 KB gzipped. The core uses no DOM and no Node APIs.
- **Runs anywhere JS runs:** browser, Cloudflare Workers, Node ≥ 22, Deno, Bun.
- **Private by design.** No network calls, no telemetry. The optional AI ranker sees only counts and flags, never your text.
- **Never loses data silently.** Anything skipped, guessed or changed is reported as a warning code.
- **Contract-tested.** Every tool has language-neutral golden fixtures that any port (PHP, Python…) can run.

## Contents

- [Why PText exists](#why-ptext-exists)
- [Tools](#tools)
- [Install](#install)
- [Quick start](#quick-start)
- [How to use PText for common tasks](#how-to-use-ptext-for-common-tasks)
- [What PText is not](#what-ptext-is-not)
- [Library](#library)
- [CLI](#cli)
- [MCP server](#mcp-server)
- [AI function calling](#ai-function-calling)
- [Choosing a tool with any AI](#choosing-a-tool-with-any-ai)
- [PHP / Laravel / other languages](#php--laravel--other-languages)
- [Privacy model](#privacy-model)
- [Project layout](#project-layout)
- [Development](#development)
- [Releases](#releases)
- [Contributing](#contributing) · [Security](#security) · [License](#license)

## Why PText exists

People paste text all day: a log excerpt, an email thread, a CRM export, a spreadsheet column, a chat history, an API response. Most of the time they need one small, exact thing from it: the email addresses, the list without duplicates, the CSV as JSON, the JSON made readable.

The usual ways to get there each have a cost:

- **Asking a chatbot.** The model *writes* the result, so a row can go missing or a value can change, and checking it takes longer than the task. Your text also goes to a model provider.
- **Single-purpose websites.** Each does one job, may upload what you paste, and rarely says what it skipped or changed.
- **Scripts and regex one-liners.** They are exact, but someone has to write, test and remember them.

**PText's mission is to make everyday text work exact, private and effortless: paste text, get a result you can trust.** Four rules follow from it:

1. **AI may choose the tool; code always does the work.** Every result comes from deterministic code. The same input gives the same output, every time.
2. **Your text stays where PText runs.** The core makes no network calls and sends no telemetry. An optional AI ranker sees counts and flags, never the text.
3. **Nothing is lost silently.** Anything skipped, guessed or changed comes back as a warning code next to the result.
4. **One engine everywhere.** The library, the CLI, the MCP server and AI function calling all run this core, and so will the planned ptext.org web app. Golden fixtures define each tool's contract, so every surface (and any port to PHP, Python…) must give the same answer.

This repository is that engine. It is open source on purpose: the code that touches your text should be readable, and its behavior should be testable by anyone.

## Tools

| Tool | Category | What it does |
| --- | --- | --- |
| `extract-emails` | extract | Find all email addresses in any text (logs, HTML, CSV, chat). Supports + tags and Unicode. |
| `extract-urls` | extract | Find http(s):// and www. links in text, trimming trailing punctuation and unbalanced brackets. |
| `extract-domains` | extract | Extract hostnames from URLs, emails and plain text. Returns full hostnames (subdomains kept); does not compute registrable domains. |
| `extract-ip` | extract | Find valid IPv4 and IPv6 addresses (incl. compressed IPv6, IPv4-mapped IPv6 and ip:port) in text. |
| `clean-lines` | clean | Trim lines, remove empty lines, collapse repeated spaces and strip invisible characters (zero-width, BOM). |
| `remove-duplicates` | clean | Remove duplicate lines while keeping the first occurrence and original order. |
| `filter-lines` | clean | Keep (or drop) lines that contain, start with, end with, equal, or match a regex pattern. |
| `split-columns` | columns | Split delimited lines (e.g. user\|pass\|mail, tab-separated, quoted CSV) into columns and output CSV. |
| `select-columns` | columns | Pick and reorder columns by 1-based index ("3,1", "2-4", "-1" = last cell of each row) from delimited text. |
| `list-to-csv` | convert | Turn a plain list (one item per line) into a single-column CSV, quoting values safely. |
| `csv-to-json` | convert | Convert CSV/TSV (quoted fields supported) into a JSON array of objects (with header) or arrays. |
| `base64` | encode | Encode text to Base64 or decode Base64 (standard or URL-safe) to UTF-8 text. Decoded content is only returned as text, never executed. |
| `url-encode` | encode | Percent-encode or decode text (component or full-URI mode). Decoding "+" as space is supported in form mode. |
| `json-format` | format | Validate JSON and pretty-print or minify it. Reports line and column of syntax errors. |

Every tool's options are plain JSON Schema with descriptions and defaults. To see the full catalog, including option schemas and input cards, run `ptext list` or call `listTools()`.

## Install

Pick the way you work:

| You want to… | Use | Package |
| --- | --- | --- |
| Let an AI assistant (Claude, Cursor, Codex…) run the tools | [MCP server](#mcp-server) | [`@ptext/mcp`](packages/mcp): `ptext-mcp` stdio bin, `createPTextServer()`, `createFetchHandler()` |
| Clean and convert text in a terminal or shell script | [CLI](#cli) | [`@ptext/cli`](packages/cli): `ptext` command, stdin → stdout, JSON mode |
| Call the tools from JavaScript or TypeScript (browser, Workers, Node, Deno, Bun) | [Library](#library) | [`@ptext/core`](packages/core): tools, catalog, profiler, router, AI adapters |
| Use them from PHP, Laravel, Python or another language | [PHP / Laravel](#php--laravel--other-languages) | `@ptext/cli` in JSON mode, or `@ptext/core` in your frontend |

```bash
npm install @ptext/core        # library
npm install -g @ptext/cli      # `ptext` command
npx -y @ptext/mcp              # MCP server over stdio
```

> **Not on npm yet.** Until the first npm release, build from source:
> ```bash
> git clone https://github.com/mr-sonj/ptext-core.git && cd ptext-core
> pnpm install && pnpm build
> node packages/cli/dist/cli.js list
> ```
> In the examples below, use `node packages/cli/dist/cli.js` wherever they say `ptext`.

## Quick start

```ts
import { suggestTools, runTool } from '@ptext/core';

const text = 'Contact sales@acme.io or Support@Acme.io, see https://acme.io/help.';

suggestTools(text).suggestions[0];   // { tool: 'extract-emails', score: …, reason: '…' }
runTool('extract-emails', text).output;   // "sales@acme.io\nSupport@acme.io"
```

```bash
echo 'a@x.com, b@y.io, a@x.com' | ptext run extract-emails
# a@x.com
# b@y.io
```

## How to use PText for common tasks

Each tool reads text on stdin and prints the result. Warnings go to stderr, so the output stays clean enough to pipe or copy. The same tools run from the [library](#library) (`runTool(id, text, options)`) and from AI assistants through the [MCP server](#mcp-server). Not sure which tool fits? `ptext suggest` (or `suggestTools(text)`) ranks the tools that match the shape of your text.

### Remove duplicate lines

Paste a list and keep each line once. The first occurrence stays where it was; nothing is sorted.

```bash
printf 'apple\nbanana\napple\nBanana\n  banana  \n' | ptext run remove-duplicates
# apple
# banana
# Banana
```

- Matching is case-sensitive and ignores spaces at the ends of a line. `--caseSensitive=false` also treats `Banana` as a duplicate of `banana`; `--trim=false` keeps `  banana  ` as its own line.
- Empty lines are dropped. `--keepEmpty=true` keeps them, and they are never deduplicated.
- It compares whole lines. It does not deduplicate spreadsheet rows by one column.

### Convert CSV to JSON

Paste CSV or TSV and get a JSON array you can copy.

```bash
printf 'name,email\nAnn,ann@example.com\n"Lee, Bo",bo@example.org\n' | ptext run csv-to-json
```

```json
[
  {
    "name": "Ann",
    "email": "ann@example.com"
  },
  {
    "name": "Lee, Bo",
    "email": "bo@example.org"
  }
]
```

- The first row is the header, so each row becomes an object. `--header=false` returns an array of cell arrays instead.
- The delimiter is detected. If the guess is wrong, set it: `--delimiter=tab`, `semicolon`, `pipe`, `comma` or a literal string. Quoted fields may contain the delimiter and escaped quotes.
- `--indent=0` minifies the JSON.
- Nothing is dropped quietly: a skipped blank row (`BLANK_ROWS_SKIPPED`), a renamed duplicate header (`a`, `a_2`: `DUPLICATE_HEADER`) and rows with the wrong number of cells (`RAGGED_ROWS`) all come back as warnings.
- There is no JSON → CSV tool yet.

### Extract emails from text

Pull every email address out of a message, a log, an HTML page, a CSV export or a chat history.

```bash
printf 'Hi, reach Ann at ann@Example.COM or sales+eu@acme.io.\nCc: ann@example.com\n' | ptext run extract-emails
# ann@example.com
# sales+eu@acme.io
```

- Plus tags (`sales+eu@`) and Unicode addresses are supported. Trailing punctuation is not part of the address.
- The domain part is lowercased (the local part is kept as written) and each address is listed once, in order of first appearance. Change that with `--lowercase=false`, `--unique=false` or `--sort=true`.
- No address found: the output is empty and a `NO_MATCH` warning explains why.
- It reads only the text you give it. It does not crawl websites, check that an address exists, or open any inbox.

### Format, validate or minify JSON

```bash
echo '{"name":"Ann","tags":["a","b"],"active":true}' | ptext run json-format
```

```json
{
  "name": "Ann",
  "tags": [
    "a",
    "b"
  ],
  "active": true
}
```

```bash
printf '{\n  "b": 1,\n  "a": [1, 2]\n}\n' | ptext run json-format --mode=minify
# {"b":1,"a":[1,2]}
```

- Modes: `beautify` (default), `minify` and `validate` (returns the input unchanged when it is valid). `--indent=4` and `--sortKeys=true` change the layout.
- Invalid JSON fails with exit code 3 and points at the line and column: `ptext: INVALID_INPUT: Invalid JSON: … (line 4 column 1)`.
- JSON Lines (one object per line) is not a single JSON document, so it is reported as invalid.

### Clean up messy text

Trim every line, drop blank lines and remove invisible characters (zero-width spaces, BOM) that break lookups and comparisons.

```bash
printf '  Ann  \n\n\xe2\x80\x8bBo\n\t Cy   Lee \n\n' | ptext run clean-lines --collapseSpaces=true
# Ann
# Bo
# Cy Lee
# stderr: ptext: warning INVISIBLE_REMOVED: Removed 1 invisible character(s).
```

- On by default: `--trim`, `--removeEmpty`, `--removeInvisible`. Off by default: `--collapseSpaces`, which squeezes runs of spaces and tabs into one space.
- It changes whitespace only. It never rewrites, corrects or reorders your words.

### More everyday jobs

```bash
printf 'user|pass|mail\nann|x1|a@x.com\n' | ptext run split-columns            # pipe-separated → CSV
printf 'id,name,mail\n1,Ann,a@x.com\n' | ptext run select-columns --columns=3,1  # → mail,id / a@x.com,1
cat access.log | ptext run extract-ip --version=4                                # unique IPv4 addresses
echo 'Docs: https://acme.io/help. Also (www.example.com/a).' | ptext run extract-urls
printf 'ERROR db down\nINFO ok\nerror disk full\n' | ptext run filter-lines --pattern=error
echo 'aGVsbG8gd29ybGQ=' | ptext run base64                                       # decodes by default → hello world
echo 'name%3DAnn%20Lee%26city%3DH%C3%A0%20N%E1%BB%99i' | ptext run url-encode    # → name=Ann Lee&city=Hà Nội
```

`ptext list` prints every option of every tool.

## What PText is not

- **Not an AI writer.** It never rewrites, paraphrases or "humanizes" text. Tools extract, clean, reshape, convert, encode or format, and say what they changed.
- **Not a scraper or an email verifier.** Extractors read only the text you give them.
- **Not a universal converter.** Each tool does one documented job, listed in [Tools](#tools). Missing one you need? [Open an issue](https://github.com/mr-sonj/ptext-core/issues) or [add it](CONTRIBUTING.md#adding-or-changing-a-tool).
- **Not a hosted API.** Everything runs in your browser, your process or a Worker you deploy yourself.

## Library

```ts
import { listTools, runTool, suggestTools, PTextError } from '@ptext/core';

const r = runTool('select-columns', 'id,name,mail\n1,Ann,a@x.com', { columns: '3,1' });
r.output;     // copy-ready text: "mail,id\na@x.com,1"
r.data;       // structured result when useful (list, rows, objects)
r.stats;      // { inputLines, outputLines, count?, removed? }
r.warnings;   // [{ code: 'RAGGED_ROWS', message, line? }, …], never silent

const { profile, suggestions } = suggestTools(text);   // local and deterministic, < 1 ms on typical input
```

`runTool(id, input, options?, { limits? })` throws a `PTextError` with a `code` from a closed set:

| Code | Meaning | CLI exit |
| --- | --- | --- |
| `UNKNOWN_TOOL` | No tool with that id | 2 |
| `INVALID_OPTION` | Option fails the schema, or the combination makes no sense | 2 |
| `INVALID_INPUT` | The tool cannot process this input (`details.line` when known) | 3 |
| `INPUT_TOO_LARGE` | Input exceeds `limits.maxInputChars` (default 5,000,000) | 3 |
| `INTERNAL` | A bug. Anything that is not a `PTextError`. Please report it | 1 |

`errorToJSON(e)` turns any error into `{ code, message, details? }`, the same shape the CLI, MCP server and Worker return.

## CLI

```
ptext <list|catalog|prompt|jev|suggest|run <tool>|exec> [--option=value] [--json]
```

| Command | Reads | Prints |
| --- | --- | --- |
| `ptext list` | | Every tool, with option schema and input card (JSON) |
| `ptext run <tool> [--opt=value]` | text on stdin | The tool's output. Warnings go to stderr. Add `--json` for the full result |
| `ptext suggest` | text on stdin | `{ profile, suggestions }` |
| `ptext exec` | `{"tool","input","options"?}` on stdin | `{ ok: true, …result }` or `{ ok: false, error }` |
| `ptext catalog` | | Profile field meanings and every tool's input card, for an AI ranker |
| `ptext prompt` | | The ranking prompt and reply schema for any LLM |
| `ptext jev` | | The static part of a Jev router request |
| `ptext --help` | | Commands, examples and tool ids |
| `ptext --version` | | Version |

```bash
printf 'user|pass|mail\nann|x1|a@x.com\n' | ptext run split-columns
cat access.log | ptext run extract-ip --version=4 --unique=true
echo '{"tool":"json-format","input":"{\"b\":1,\"a\":2}","options":{"sortKeys":true}}' | ptext exec
```

Exit codes: `0` ok · `2` usage or option error · `3` invalid input · `1` internal error.

## MCP server

Give Claude, Cursor, Windsurf, Codex or any other MCP client exact text tools: the model decides what to do, and PText's code does it. The server exposes every tool as `ptext_<id>` (for example `ptext_extract_emails`), plus `ptext_suggest` (profile and suggestions for a text) and `ptext_catalog` (field meanings and input cards). Each tool description includes `Use when: …` and `Not for: …` so the client's model can use the user's requested operation as well as the input. `ptext_suggest` checks input shape only; it cannot infer the user's goal.

### Local (stdio)

Claude Desktop, Cursor, Windsurf, Codex and any other client that reads an `mcpServers` config:

```json
{
  "mcpServers": {
    "ptext": { "command": "npx", "args": ["-y", "@ptext/mcp"] }
  }
}
```

Claude Code:

```bash
claude mcp add ptext -- npx -y @ptext/mcp
```

From a source checkout, use `"command": "node", "args": ["/absolute/path/to/ptext-core/packages/mcp/dist/stdio.js"]`.

### Remote (Streamable HTTP on Cloudflare Workers, Deno, Bun)

```ts
import { createFetchHandler } from '@ptext/mcp';
import { CfWorkerJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/cfworker';

const mcp = createFetchHandler({ path: '/mcp', jsonSchemaValidator: new CfWorkerJsonSchemaValidator() });
export default { fetch: (req: Request) => mcp(req) };
```

On Workers, pass `CfWorkerJsonSchemaValidator`. The default validator (Ajv) uses `new Function`, which Workers block. [`examples/cloudflare-worker`](examples/cloudflare-worker) adds a REST API next to MCP:

| Route | Body | Returns |
| --- | --- | --- |
| `POST /mcp` | MCP JSON-RPC | MCP Streamable HTTP (stateless) |
| `POST /api/run` | `{ tool, input, options? }` | Tool result |
| `POST /api/suggest` | `{ input }` | `{ profile, suggestions }` |
| `GET /api/tools` | | Tools with input cards |
| `GET /api/catalog` | | Field meanings and input cards |
| `GET /api/prompt` | | Ranking prompt and reply schema |

```bash
cd examples/cloudflare-worker && npx wrangler dev
```

## AI function calling

```ts
import { openAITools, anthropicTools, handleToolCall } from '@ptext/core';

// Pass openAITools() or anthropicTools() as `tools`. When the model calls one:
const result = handleToolCall(call.name, call.arguments);   // never throws, JSON-serializable
```

Each description comes from `modelDescription(tool)`: what the tool does, `Use when: …` and `Not for: …`. The MCP server uses the same text.

## Choosing a tool with any AI

```
input → profileInput()            counts, ratios and flags only (PROFILE_FIELDS describes each one)
      → compatibility gate       code keeps only eligible tools
      → each tool's suggest()     local scores within that set
      → route(input, { router })  optional: an AI ranks only eligible tools
```

Every tool carries an **input card**: `accepts` (what the input looks like), `signals` (profile fields that point to it), `avoid` (a look-alike and the tool to use instead) and `examples`. Rankers never see the raw text. Without an explicit intent, they get only the profile and input cards, so their output is a compatibility suggestion, not an instruction to run a tool automatically.

```ts
import { route, llmRouter } from '@ptext/core';

// Any model: send prompt.system + prompt.user, return the reply text.
const ai = llmRouter(async (prompt, signal) => callYourModel(prompt.system, prompt.user, signal));
const { suggestions, source, issues } = await route(text, { router: ai, timeoutMs: 1500 });
// If the app knows the goal, pass controlled labels rather than free-form user text:
const domains = await route(text, { router: ai, intent: { operation: 'extract', target: 'domains' } });
```

- Code computes `eligible` from the profile and optional intent before calling the router. If none qualify, the model is not called. The model may choose any eligible tool, including one without a local score.
- `intent` is optional and accepts only fixed operation and target labels. It is sent to the ranker without the raw input. A fully specified intent also limits suggestions and local fallback to the requested tool; the input profile still checks whether that tool fits.
- A valid empty ranking means no tool fits and stays empty. Profile-incompatible or malformed entries are dropped and listed in `issues`. A timeout, an error, or a reply that is not a ranking falls back to the local result, so routing never blocks.
- Generative models use `llmRouter(complete)` with the shared `rankPrompt()`, `rankResponseSchema()` and `parseRankResponse()`; pass `eligible` to `rankResponseSchema()` to narrow a structured-output enum. Decision models such as Jev ([TypeSafe System One](https://typesafe.ai)) use `jevRouter(post)`, whose question contains only eligible tools. In both cases your code makes the HTTP call and holds the key.
- Backends in other languages can fetch the same catalog and prompt with `ptext catalog` / `ptext prompt` or from the Worker at `GET /api/catalog` and `GET /api/prompt`.

## PHP / Laravel / other languages

Call the CLI with a JSON request:

```bash
echo '{"tool":"extract-emails","input":"a@x.com"}' | ptext exec
```

[`examples/laravel`](examples/laravel/README.md) shows both setups: `@ptext/core` in the frontend (Vite + Alpine), where text never leaves the browser, and a backend that calls the CLI through `Process`.

## Privacy model

- The core runs inside your process: browser tab, MCP process or Worker. It makes no network calls and sends no telemetry.
- `profileInput()` returns only counts, ratios and flags. A test checks that no raw text leaks into it.
- Decoded content (Base64, URL encoding) is returned as text and never executed.
- When PText runs as an MCP server inside an AI client, that client may still send your text to its own model provider. PText cannot make that whole chain offline, and does not claim to.

## Project layout

```
packages/core     tools/<category>/<id>.ts (one file per tool) · profiler · router · AI adapters
packages/mcp      transport-agnostic server · fetch handler (HTTP) · stdio bin
packages/cli      ptext command (runCli is a pure, tested function)
fixtures/         golden/<id>.json (tool contract) · suggest.json (profiler benchmark)
examples/         cloudflare-worker · laravel · browser (parity harness)
scripts/          new-tool.mjs (scaffold) · release.mjs (ship: release when due, push main)
```

## Development

Requirements: Node ≥ 22.12 (the test runner needs it; the packages need Node ≥ 22) and pnpm 10 (`corepack enable`).

```bash
pnpm install
pnpm build && pnpm test          # golden fixtures, catalog rules, profiler corpus, MCP parity, CLI, Worker
pnpm typecheck
pnpm test:tool extract-emails    # one tool's cases
```

Adding a tool takes two files: the tool and its fixture. Scaffold both with:

```bash
pnpm new-tool csv-to-yaml --category=convert
```

The scaffold stays red until the fixture cases, the input card and the README row are filled in. [CONTRIBUTING.md](CONTRIBUTING.md) lists the rules the tests enforce.

Browser parity harness: run `pnpm build`, serve the repo root (`npx serve .`), then open `/examples/browser/`.

## Releases

Versions follow [Semantic Versioning](https://semver.org/) and come from [Conventional Commits](https://www.conventionalcommits.org/): `feat!:` / `BREAKING CHANGE:` → major (minor while on `0.x`), `feat:` → minor, anything else → patch. Only `feat`, `fix`, `perf`, `revert` and breaking commits call for a release; `docs`, `test`, `chore`, `ci`, `build` and `refactor` commits go out with the next one.

The maintainer pushes `main` with `node scripts/release.mjs ship` (`--dry-run` previews it). When a release is due, it first writes the version to every `package.json` and to `VERSION`, adds a [CHANGELOG.md](CHANGELOG.md) section and commits that as `chore(release): vX.Y.Z`, tagged `vX.Y.Z`. CI builds and tests the tag, then publishes a [GitHub release](https://github.com/mr-sonj/ptext-core/releases) with that changelog section. Packages are not published to npm yet.

## Contributing

Issues and pull requests are welcome, especially a failing fixture case for output that looks wrong, and new tools for jobs people paste text for. Read [CONTRIBUTING.md](CONTRIBUTING.md) before you open a pull request that adds or changes a tool.

## Security

Please report vulnerabilities privately. See [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)
