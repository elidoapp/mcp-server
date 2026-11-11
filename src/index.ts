#!/usr/bin/env node
/**
 * Elido MCP server. Speaks the Model Context Protocol over stdio so any
 * MCP-aware client (Claude Desktop, Cursor, Continue.dev, Claude Code,
 * custom agents) can drive Elido's link, QR, and analytics APIs.
 *
 * The transport is line-delimited JSON-RPC 2.0 on stdin/stdout (the MCP
 * stdio transport). Hand-rolled instead of the official
 * @modelcontextprotocol/sdk because (a) the wire is small and (b) it lets
 * us keep the package fully dependency-free — easier to audit.
 *
 * Workspace resolution (because every meaningful endpoint is workspace-
 * scoped):
 *
 *   1. ELIDO_WORKSPACE_ID env var — explicit, wins.
 *   2. /v1/workspaces list with exactly one result — auto-pick.
 *   3. otherwise the first call that needs a workspace returns an error
 *      explaining how to set it.
 */

import { createInterface } from "node:readline";

import { dispatchTool, type ApiClient, listTools } from "./tools.js";

const API_BASE =
  process.env.ELIDO_API_BASE?.replace(/\/$/, "") ?? "https://api.elido.app";
const API_KEY = process.env.ELIDO_API_KEY ?? "";
const WORKSPACE_ID_ENV = process.env.ELIDO_WORKSPACE_ID;

if (!API_KEY) {
  // Don't exit — MCP clients sometimes spawn before secrets are wired.
  // Fail at request time so the user sees the error in the agent UI
  // instead of a silent dead process.
  process.stderr.write(
    "[elido-mcp] WARNING: ELIDO_API_KEY is not set. Tool calls will fail.\n",
  );
}

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

function buildClient(): ApiClient {
  let workspaceID: number | null = WORKSPACE_ID_ENV
    ? Number.parseInt(WORKSPACE_ID_ENV, 10)
    : null;

  async function callAPI(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<unknown> {
    const res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${API_KEY}`,
        "User-Agent": "elido-mcp-server/0.1.0",
      },
      body: body == null ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = { raw: text };
    }
    if (!res.ok) {
      throw new Error(
        `api ${method} ${path} -> ${res.status}: ${text.slice(0, 400)}`,
      );
    }
    return parsed;
  }

  async function workspaceID_(): Promise<number> {
    if (workspaceID !== null && Number.isFinite(workspaceID))
      return workspaceID;
    // Auto-resolve when the API key has access to exactly one workspace.
    // Supplying ELIDO_WORKSPACE_ID is still recommended — it skips the
    // round-trip and keeps tool calls deterministic for keys that later
    // gain access to a second workspace.
    const list = (await callAPI("GET", "/v1/workspaces")) as {
      items?: Array<{ id: number }>;
    } | null;
    const items = list?.items ?? [];
    if (items.length === 1) {
      workspaceID = items[0]!.id;
      return workspaceID;
    }
    throw new Error(
      `Multiple or zero workspaces visible to this API key. ` +
        `Set ELIDO_WORKSPACE_ID in the MCP client config to pin one.`,
    );
  }

  return { call: callAPI, workspaceID: workspaceID_ };
}

async function handle(
  req: JsonRpcRequest,
  client: ApiClient,
): Promise<JsonRpcResponse | null> {
  const id = req.id ?? null;
  try {
    switch (req.method) {
      case "initialize":
        return {
          jsonrpc: "2.0",
          id,
          result: {
            protocolVersion: "2024-11-05",
            capabilities: { tools: {} },
            serverInfo: { name: "elido", version: "0.1.0" },
          },
        };
      case "tools/list":
        return { jsonrpc: "2.0", id, result: { tools: listTools() } };
      case "tools/call": {
        const params = req.params as
          | { name?: string; arguments?: Record<string, unknown> }
          | undefined;
        const name = params?.name ?? "";
        const args = params?.arguments ?? {};
        const out = await dispatchTool(client, name, args);
        return {
          jsonrpc: "2.0",
          id,
          result: {
            content: [{ type: "text", text: JSON.stringify(out, null, 2) }],
          },
        };
      }
      // Notifications carry no id; the spec says we MUST NOT respond.
      case "notifications/initialized":
        return null;
      default:
        return {
          jsonrpc: "2.0",
          id,
          error: { code: -32601, message: `method not found: ${req.method}` },
        };
    }
  } catch (err) {
    return {
      jsonrpc: "2.0",
      id,
      error: {
        code: -32000,
        message: err instanceof Error ? err.message : "internal error",
      },
    };
  }
}

function main(): void {
  const client = buildClient();
  const rl = createInterface({ input: process.stdin });
  rl.on("line", (line) => {
    if (!line.trim()) return;
    let req: JsonRpcRequest;
    try {
      req = JSON.parse(line) as JsonRpcRequest;
    } catch {
      process.stdout.write(
        JSON.stringify({
          jsonrpc: "2.0",
          id: null,
          error: { code: -32700, message: "parse error" },
        }) + "\n",
      );
      return;
    }
    void handle(req, client).then((res) => {
      if (res) process.stdout.write(JSON.stringify(res) + "\n");
    });
  });
}

// Run only when invoked as the entrypoint (vs imported by tests).
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { handle, buildClient };
