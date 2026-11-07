# @ptext/mcp

**An MCP server that gives AI assistants exact text tools.** Claude, Cursor, Windsurf, Codex and any other MCP client can remove duplicate lines, convert CSV to JSON, extract emails, URLs, domains and IP addresses, clean up lines, split and select columns, decode Base64 or URL encoding, and format or validate JSON, without the model rewriting your data. The model chooses the tool; [PText](https://github.com/mr-sonj/ptext-core)'s deterministic code produces the result.

Every PText tool is exposed as `ptext_<id>` (for example `ptext_remove_duplicates`), plus `ptext_suggest` and `ptext_catalog`. Runs over stdio (local clients) or Web-standard Streamable HTTP (Cloudflare Workers, Deno, Bun).

```json
{ "mcpServers": { "ptext": { "command": "npx", "args": ["-y", "@ptext/mcp"] } } }
```

```bash
claude mcp add ptext -- npx -y @ptext/mcp
```

On an edge runtime:

```ts
import { createFetchHandler } from '@ptext/mcp';
import { CfWorkerJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/cfworker';

const mcp = createFetchHandler({ path: '/mcp', jsonSchemaValidator: new CfWorkerJsonSchemaValidator() });
export default { fetch: (req: Request) => mcp(req) };
```

The server makes no network calls and sends no telemetry. Your MCP client may still send the conversation, including your text, to its own model provider.

Full documentation: [github.com/mr-sonj/ptext-core](https://github.com/mr-sonj/ptext-core#mcp-server). License: MIT.
