# @ptext/mcp

MCP server for [PText](https://github.com/mr-sonj/ptext-core): every PText tool as `ptext_<id>`, plus `ptext_suggest` and `ptext_catalog`. Runs over stdio (local clients) or Web-standard Streamable HTTP (Cloudflare Workers, Deno, Bun).

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

Full documentation: [github.com/mr-sonj/ptext-core](https://github.com/mr-sonj/ptext-core#mcp-server). License: MIT.
