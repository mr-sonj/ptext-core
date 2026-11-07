# @ptext/core

**Deterministic text tools for JavaScript and TypeScript.** Remove duplicate lines, convert CSV to JSON, extract emails, URLs, domains and IP addresses from text, clean up lines, split and select columns, Base64 and URL encode/decode, and format, validate or minify JSON. A local profiler looks at the text and suggests the right tool. Zero dependencies. Runs in the browser, Cloudflare Workers, Node ≥ 22, Deno and Bun.

This is the engine of [PText](https://github.com/mr-sonj/ptext-core) (paste text, get a useful result). An AI may pick the tool, but code always produces the result: the same input gives the same output, nothing leaves your process, and anything skipped or changed comes back as a warning.

```bash
npm install @ptext/core
```

```ts
import { suggestTools, runTool } from '@ptext/core';

suggestTools('Mail a@x.com or b@y.io').suggestions[0].tool;   // 'extract-emails'
runTool('extract-emails', 'Mail a@x.com or b@y.io').output;   // 'a@x.com\nb@y.io'

runTool('remove-duplicates', 'apple\nbanana\napple').output;   // 'apple\nbanana'
runTool('csv-to-json', 'name,age\nAnn,31', { indent: 0 }).output;   // '[{"name":"Ann","age":"31"}]'
runTool('json-format', '{"b":1,"a":[1,2]}', { mode: 'minify' }).output;   // '{"b":1,"a":[1,2]}'
```

Every result has `output` (copy-ready text), `data` (structure when useful), `stats` and `warnings`. Invalid input or options throw a `PTextError` with a stable `code`.

Tools: `extract-emails`, `extract-urls`, `extract-domains`, `extract-ip`, `clean-lines`, `remove-duplicates`, `filter-lines`, `split-columns`, `select-columns`, `list-to-csv`, `csv-to-json`, `base64`, `url-encode`, `json-format`. `listTools()` returns each one with its JSON Schema options.

Also included: `openAITools()` / `anthropicTools()` / `handleToolCall()` for function calling, and `route()` / `llmRouter()` / `jevRouter()` for AI tool choice that never sees raw text. `route()` can pass allowlisted operation and target labels as an optional intent.

Full documentation and how-to guides: [github.com/mr-sonj/ptext-core](https://github.com/mr-sonj/ptext-core#readme). License: MIT.
