import type { MembaseClient } from "../client";
import { formatWikiDocuments } from "../format";
import type { OpenClawPluginApi } from "../types";

export function registerSearchWikiTool(
  api: OpenClawPluginApi,
  client: MembaseClient,
) {
  api.registerTool({
    name: "membase_search_wiki",
    label: "Search Membase Wiki",
    description:
      "Search the user's knowledge wiki using hybrid semantic and keyword matching. " +
      "Use this for factual knowledge, references, and stable documentation. " +
      "For personal preferences, habits, or timeline recall, use membase_search.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Search query for the knowledge wiki. Use empty string to fetch recent wiki documents.",
        },
        limit: {
          type: "number",
          description: "Max results to return (default: 10, max: 20).",
        },
        collection_id: {
          type: "string",
          description: "Optional collection ID to narrow results.",
        },
      },
      required: ["query"],
    },
    async execute(
      _toolCallId: string,
      params: { query: string; limit?: number; collection_id?: string },
    ) {
      try {
        const result = await client.searchWiki(
          params.query,
          params.limit ?? 10,
          params.collection_id,
        );
        return {
          content: [
            { type: "text", text: formatWikiDocuments(result.documents) },
          ],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Wiki search failed: ${message}` }],
        };
      }
    },
  });
}
