import type { MembaseClient } from "../client";
import { formatBundles } from "../format";
import type { OpenClawPluginApi } from "../types";

export function registerSearchTool(
  api: OpenClawPluginApi,
  client: MembaseClient,
) {
  api.registerTool({
    name: "membase_search",
    label: "Search Membase Memory",
    description:
      "Search long-term memory stored in Membase (persists across all sessions). " +
      "ALWAYS call this tool when the user explicitly asks you to recall, look up, find, " +
      "or retrieve something — even if the auto-injected context at session start did not " +
      "include it. The startup context is a small recent sample; this tool searches the " +
      "full memory store. Also call proactively when past context would improve your answer. " +
      "Returns episode-centric bundles (episodes with nearby nodes/edges).",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Natural-language semantic search query (not keyword matching). " +
            "Use empty string '' to fetch recent memories.",
        },
        limit: {
          type: "number",
          description:
            "Max results to return (default: 10). " +
            "Use smaller values to avoid huge responses; use offset to paginate.",
        },
        offset: {
          type: "number",
          description:
            "Pagination offset (default: 0). " +
            "Example: limit=10, offset=10 returns the next page.",
        },
      },
      required: ["query"],
    },
    async execute(
      _toolCallId: string,
      params: { query: string; limit?: number; offset?: number },
    ) {
      try {
        const bundles = await client.search(
          params.query,
          params.limit ?? 10,
          params.offset,
        );
        return {
          content: [{ type: "text", text: formatBundles(bundles) }],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Search failed: ${message}` }],
        };
      }
    },
  });
}
