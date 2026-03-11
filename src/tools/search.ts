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
			"Search stored memories (persistent across sessions) by semantic similarity. " +
			"Use when the user asks to recall something not present in the current conversation " +
			"(especially across sessions), or proactively when past context would improve your response. " +
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
