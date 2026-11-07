# Changelog

All notable changes are listed here. Each entry is written from the Conventional Commit messages of that release (see [Releases](README.md#releases)). Versions follow [Semantic Versioning](https://semver.org/).

## [0.4.0] - 2026-11-07

### Features

- **cli:** add --help with commands, examples and tool ids (1fb67c8)

### Other

- build: push main with release.mjs ship, releasing only for feat, fix, perf, revert or breaking (6313591)
- ci: run pnpm/action-setup v6, which targets Node.js 24 (6e06d5c)

## [0.3.0] - 2026-11-07

### Features

- enhance routing and suggestion mechanisms with structured intent support (5881803)

### Other

- docs: list BLANK_ROWS_SKIPPED among the warning codes (708aa91)
- build: cut releases from main; pull requests are squash-merged (6e33d20)
- docs: name the release command in the project layout (5c9bbd0)

## [0.2.0] - 2026-11-07

### Breaking changes

- require Node.js 22 or newer (9957e6f)

## [0.1.2] - 2026-11-07

### Fixes

- **release:** release notes link the public commits (ea063ea)

## [0.1.1] - 2026-11-07

### Fixes

- **ci:** release job no longer needs pnpm (e2e360c)

## [0.1.0] - 2026-11-07

First public release.

### Features

- 14 deterministic tools: `extract-emails`, `extract-urls`, `extract-domains`, `extract-ip`, `clean-lines`, `remove-duplicates`, `filter-lines`, `split-columns`, `select-columns`, `list-to-csv`, `csv-to-json`, `base64`, `url-encode`, `json-format`.
- Local profiler that suggests tools from counts and flags only, plus `route()` for an optional AI re-rank with local fallback (`llmRouter` for any LLM, `jevRouter` for Jev).
- Input card for every tool (`accepts`, `signals`, `avoid`, `examples`), used in MCP and function-calling descriptions and in `routerCatalog()`.
- `@ptext/mcp`: MCP server over stdio and Web-standard Streamable HTTP (Cloudflare Workers, Deno, Bun).
- `@ptext/cli`: `ptext` command with JSON mode for PHP/Laravel, Python and shell.
- OpenAI and Anthropic tool schemas with `handleToolCall()`.
- Language-neutral golden fixtures for every tool, and a profiler benchmark corpus.
