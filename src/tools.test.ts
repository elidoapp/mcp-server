// Run with: node --test packages/mcp-server/src/tools.test.ts (after build)
// Pure dispatch tests — no network, no stdio. Mocks the ApiClient and asserts
// each tool calls the right path with the right body shape.

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { dispatchTool, listTools, type ApiClient } from "./tools.js";

interface Recorded {
  method: string;
  path: string;
  body?: unknown;
}

function stub(
  routes: Record<string, unknown>,
  workspaceID = 7,
): { client: ApiClient; calls: Recorded[] } {
  const calls: Recorded[] = [];
  const client: ApiClient = {
    async call(method, path, body) {
      calls.push({ method, path, body });
      const k = `${method} ${path}`;
      if (k in routes) return routes[k];
      // Match without query string for endpoints with dynamic params.
      const base = path.split("?")[0];
      const stripped = `${method} ${base}`;
      if (stripped in routes) return routes[stripped];
      throw new Error(`unstubbed ${k}`);
    },
    async workspaceID() {
      return workspaceID;
    },
  };
  return { client, calls };
}

describe("listTools", () => {
  it("exposes all five tools", () => {
    const names = listTools().map((t) => t.name);
    assert.deepEqual(names.sort(), [
      "create_link",
      "generate_qr",
      "list_links",
      "list_workspaces",
      "query_analytics",
    ]);
  });

  it("every tool has a JSON schema with type=object", () => {
    for (const t of listTools()) {
      assert.equal(t.inputSchema.type, "object", `${t.name} schema type`);
    }
  });
});

describe("dispatchTool", () => {
  it("list_workspaces hits /v1/workspaces directly", async () => {
    const { client, calls } = stub({ "GET /v1/workspaces": { items: [] } });
    await dispatchTool(client, "list_workspaces", {});
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.path, "/v1/workspaces");
  });

  it("create_link auto-fills domain_id from workspace's domains", async () => {
    const { client, calls } = stub({
      "GET /v1/workspaces/7/domains": { items: [{ id: 42 }] },
      "POST /v1/workspaces/7/links": { id: 1 },
    });
    await dispatchTool(client, "create_link", {
      destination_url: "https://example.com",
    });
    const linkCreate = calls.find((c) => c.method === "POST")!;
    assert.equal(linkCreate.path, "/v1/workspaces/7/links");
    assert.deepEqual(linkCreate.body, {
      destination_url: "https://example.com",
      domain_id: 42,
    });
  });

  it("create_link respects explicit domain_id (no domain lookup)", async () => {
    const { client, calls } = stub({
      "POST /v1/workspaces/7/links": { id: 1 },
    });
    await dispatchTool(client, "create_link", {
      destination_url: "https://example.com",
      domain_id: 99,
    });
    assert.equal(calls.length, 1, "no domain lookup expected");
    assert.deepEqual(calls[0]?.body, {
      destination_url: "https://example.com",
      domain_id: 99,
    });
  });

  it("list_links scopes to workspace and forwards pagination", async () => {
    const { client, calls } = stub({
      "GET /v1/workspaces/7/links": { items: [] },
    });
    await dispatchTool(client, "list_links", { limit: 50, offset: 100 });
    assert.match(calls[0]!.path, /\/v1\/workspaces\/7\/links\?/);
    assert.match(calls[0]!.path, /limit=50/);
    assert.match(calls[0]!.path, /offset=100/);
  });

  it("query_analytics threads ?tz= through to the timeseries endpoint", async () => {
    const { client, calls } = stub({
      "GET /v1/workspaces/7/analytics/timeseries": { items: [] },
    });
    await dispatchTool(client, "query_analytics", {
      from: "2026-04-01",
      to: "2026-05-01",
      interval: "day",
      tz: "Europe/Berlin",
    });
    assert.match(calls[0]!.path, /tz=Europe%2FBerlin/);
    assert.match(calls[0]!.path, /interval=day/);
  });

  it("generate_qr posts to the workspace-scoped /qr", async () => {
    const { client, calls } = stub({
      "POST /v1/workspaces/7/qr": { url: "https://x" },
    });
    await dispatchTool(client, "generate_qr", { link_id: 5 });
    assert.equal(calls[0]?.path, "/v1/workspaces/7/qr");
    assert.deepEqual(calls[0]?.body, { link_id: 5, format: "svg", size: 512 });
  });

  it("rejects unknown tool names", async () => {
    const { client } = stub({});
    await assert.rejects(
      () => dispatchTool(client, "nope", {}),
      /unknown tool/,
    );
  });
});
