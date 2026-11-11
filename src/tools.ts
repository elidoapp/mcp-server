// tool surface for @elido/mcp-server. Lives in its own file so
// tests can verify dispatch shape without spinning up the JSON-RPC loop in
// index.ts. Tools follow the Bitly/Dub naming convention (snake_case verb_
// noun) so MCP clients that auto-generate UI labels stay readable.

export interface ApiClient {
  call(method: string, path: string, body?: unknown): Promise<unknown>;
  workspaceID(): Promise<number>;
}

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export const tools: ToolDef[] = [
  {
    name: "create_link",
    description:
      "Shorten a URL on the configured workspace. Returns the short URL plus the canonical link record.",
    inputSchema: {
      type: "object",
      required: ["destination_url"],
      properties: {
        destination_url: { type: "string", format: "uri" },
        slug: { type: "string", description: "Optional custom slug." },
        domain_id: {
          type: "integer",
          description:
            "Domain to use. Defaults to the workspace's first verified domain.",
        },
        title: { type: "string" },
        tags: { type: "array", items: { type: "string" } },
      },
    },
  },
  {
    name: "list_links",
    description:
      "List recent links in the workspace. Use limit/offset for pagination.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "integer", minimum: 1, maximum: 100, default: 20 },
        offset: { type: "integer", minimum: 0, default: 0 },
      },
    },
  },
  {
    name: "query_analytics",
    description:
      "Click-count timeseries for a workspace or single link. Buckets in the supplied IANA timezone.",
    inputSchema: {
      type: "object",
      properties: {
        link_id: {
          type: "integer",
          description:
            "Optional. Restricts the timeseries to one link; otherwise returns the workspace total.",
        },
        from: {
          type: "string",
          format: "date",
          description: "ISO date YYYY-MM-DD. Inclusive.",
        },
        to: {
          type: "string",
          format: "date",
          description: "ISO date YYYY-MM-DD. Inclusive.",
        },
        interval: { type: "string", enum: ["hour", "day"], default: "day" },
        tz: {
          type: "string",
          description: "IANA name, e.g. Europe/Berlin. Default UTC.",
        },
      },
    },
  },
  {
    name: "generate_qr",
    description:
      "Generate a QR code for an existing link slug. Returns the artifact URL plus PNG/SVG bytes when small.",
    inputSchema: {
      type: "object",
      required: ["link_id"],
      properties: {
        link_id: { type: "integer" },
        format: { type: "string", enum: ["svg", "png"], default: "svg" },
        size: { type: "integer", minimum: 64, maximum: 2048, default: 512 },
      },
    },
  },
  {
    name: "list_workspaces",
    description: "Enumerate workspaces this API key has access to.",
    inputSchema: { type: "object", properties: {} },
  },
];

export function listTools(): ToolDef[] {
  return tools;
}

export async function dispatchTool(
  client: ApiClient,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  switch (name) {
    case "list_workspaces":
      // Doesn't need a workspace — the call itself answers "which workspaces".
      return client.call("GET", "/v1/workspaces");

    case "create_link": {
      const wsID = await client.workspaceID();
      const body: Record<string, unknown> = {
        destination_url: args.destination_url,
      };
      if (args.slug != null) body.slug = args.slug;
      if (args.domain_id != null) body.domain_id = args.domain_id;
      if (args.title != null) body.title = args.title;
      if (Array.isArray(args.tags)) body.tags = args.tags;
      // domain_id is required by the API; if the agent didn't supply one,
      // pull the workspace's domain list and pick the first (typically
      // f.elido.me / s.elido.me / b.elido.me).
      if (body.domain_id == null) {
        const ws = (await client.call(
          "GET",
          `/v1/workspaces/${wsID}/domains`,
        )) as { items?: Array<{ id: number }> } | null;
        const first = ws?.items?.[0]?.id;
        if (first == null) {
          throw new Error(
            "no domain available for this workspace — pass domain_id explicitly",
          );
        }
        body.domain_id = first;
      }
      return client.call("POST", `/v1/workspaces/${wsID}/links`, body);
    }

    case "list_links": {
      const wsID = await client.workspaceID();
      const limit = Number(args.limit ?? 20);
      const offset = Number(args.offset ?? 0);
      const qs = new URLSearchParams({
        limit: String(limit),
        offset: String(offset),
      });
      return client.call(
        "GET",
        `/v1/workspaces/${wsID}/links?${qs.toString()}`,
      );
    }

    case "query_analytics": {
      const wsID = await client.workspaceID();
      const qs = new URLSearchParams();
      if (typeof args.from === "string") qs.set("from", args.from);
      if (typeof args.to === "string") qs.set("to", args.to);
      if (typeof args.interval === "string") qs.set("interval", args.interval);
      if (typeof args.tz === "string") qs.set("tz", args.tz);
      if (typeof args.link_id === "number")
        qs.set("link_id", String(args.link_id));
      // Analytics is served under /v1/workspaces/.../analytics on the same
      // host, so only ELIDO_API_BASE is needed.
      return client.call(
        "GET",
        `/v1/workspaces/${wsID}/analytics/timeseries?${qs.toString()}`,
      );
    }

    case "generate_qr": {
      const wsID = await client.workspaceID();
      const body = {
        link_id: args.link_id,
        format: args.format ?? "svg",
        size: args.size ?? 512,
      };
      return client.call("POST", `/v1/workspaces/${wsID}/qr`, body);
    }

    default:
      throw new Error(`unknown tool: ${name}`);
  }
}
