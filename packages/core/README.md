# @ptext/core

Deterministic text tools (extract, clean, columns, convert, encode, format) with a local profiler that suggests the right tool. Zero dependencies. Runs in the browser, Cloudflare Workers, Node ≥ 22, Deno and Bun.

```bash
npm install @ptext/core
```

```ts
import { suggestTools, runTool } from '@ptext/core';

suggestTools('Mail a@x.com or b@y.io').suggestions[0].tool;   // 'extract-emails'
runTool('extract-emails', 'Mail a@x.com or b@y.io').output;   // 'a@x.com\nb@y.io'
```

Also included: `openAITools()` / `anthropicTools()` / `handleToolCall()` for function calling, and `route()` / `llmRouter()` / `jevRouter()` for AI tool choice that never sees raw text. `route()` can pass allowlisted operation and target labels as an optional intent.

Full documentation: [github.com/mr-sonj/ptext-core](https://github.com/mr-sonj/ptext-core#readme). License: MIT.
