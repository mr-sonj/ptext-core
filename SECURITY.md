# Security policy

## Supported versions

Only the latest release receives fixes.

## Reporting a vulnerability

Please do not open a public issue for a security problem. Report it privately through [GitHub private vulnerability reporting](https://github.com/mr-sonj/ptext-core/security/advisories/new). Include:

- the affected package and version
- input that reproduces the problem (a minimal case is best)
- what happens and what you expected

You should get a first answer within 7 days. Once a fix is released, the advisory is published with credit, unless you prefer not to be named.

## Scope

These are in scope:

- a tool that executes decoded content, makes a network call, or leaks raw text into the input profile
- input that makes a tool hang or exhaust memory despite the documented limits, for example catastrophic regex backtracking or unbounded recursion
- the MCP server or the Worker example returning data from another request

Text that an MCP client sends to its own model provider is outside PText's control and is not a PText vulnerability.
