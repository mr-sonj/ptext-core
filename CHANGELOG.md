# Changelog

All notable changes are listed here. Each entry is written from the Conventional Commit messages of that release (see [Releases](README.md#releases)). Versions follow [Semantic Versioning](https://semver.org/).

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
