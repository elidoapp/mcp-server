# @elido/mcp-server

Model Context Protocol server for Elido. Exposes link, QR, and analytics
tools to any MCP-aware client (Claude Desktop, Cursor, Continue.dev,
Claude Code, custom agents).

> **Status:** beta (0.1.x). Expect additive changes; existing tool
> inputs will not break inside 0.1.x.

## Install

Add the server to your client's MCP config. For Claude Desktop, edit
`~/Library/Application Support/Claude/claude_desktop_config.json` (macOS)
or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "elido": {
      "command": "npx",
      "args": ["-y", "@elido/mcp-server"],
      "env": {
        "ELIDO_API_KEY": "elido_…",
        "ELIDO_WORKSPACE_ID": "42"
      }
    }
  }
}
```

For Cursor, drop the same `mcpServers` block into `.cursor/mcp.json`
inside your project. Restart the client and Elido tools appear in the
agent's tool list.

## Configuration

| Variable             | Required? | Description                                                                                                                              |
| -------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `ELIDO_API_KEY`      | yes       | API key (`elido_…`) from Settings → API Keys. Sent as `Authorization: Bearer …`.                                                         |
| `ELIDO_WORKSPACE_ID` | optional  | Numeric workspace id. When omitted, the server picks the only workspace the key sees. Set this when the key has access to more than one. |
| `ELIDO_API_BASE`     | optional  | Override the API host. Default `https://api.elido.app`. Useful for self-host.                                                            |

## Tools

| Tool              | Description                                                             |
| ----------------- | ----------------------------------------------------------------------- |
| `create_link`     | Shorten a URL with optional slug, domain, title, and tags.              |
| `list_links`      | List recent links in the workspace (paginated).                         |
| `query_analytics` | Click-count timeseries for the workspace or a single link, TZ-bucketed. |
| `generate_qr`     | Generate a QR code (SVG or PNG) for an existing link.                   |
| `list_workspaces` | Enumerate workspaces this API key has access to.                        |

`query_analytics` accepts `tz` (IANA name).
Pass `Europe/Berlin` and the day buckets line up with the user's local
clock instead of cluster-UTC.

## Transport

`stdio` by default — the canonical MCP wire format. SSE transport is on
the roadmap.

## Build / develop

```bash
npm install
npm run build
npm test
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' \
  | ELIDO_API_KEY=test node dist/index.js
```

## Source

Issues and PRs welcome at <https://github.com/elidoapp/mcp-server>.
Releases are published to npm with
[provenance](https://docs.npmjs.com/generating-provenance-statements) so the
artifact is verifiable against the commit it was built from.

## Links

- Documentation: <https://elido.app/docs>
- Issues: <https://github.com/elidoapp/mcp-server/issues>
- Changelog: [CHANGELOG.md](./CHANGELOG.md)

## License

[MIT](./LICENSE) (c) Elido. The Elido service itself is a separate, hosted
product; this repository contains only the client library.
