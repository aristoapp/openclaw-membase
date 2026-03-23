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
      "Call when the user asks to recall something not present in the current conversation, " +
      "or proactively when past context would improve your response. " +
      "Use a single focused natural-language phrase — do NOT list keywords. " +
      "For broad questions, call this tool multiple times with different angles " +
      "(e.g. 'meetings with Mashup Ventures', then 'emails from Mashup Ventures'). " +
      "When the user mentions a time window (today, yesterday, this week, a date range), " +
      "set date_from and/or date_to as ISO 8601. " +
      "Returns episode-centric bundles (episodes with nearby nodes/edges).",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Single focused natural-language semantic query (not keyword matching). " +
            "Write as a phrase or sentence describing what you are looking for. " +
            "Examples: 'meetings with investors last week', " +
            "'emails about the pitch deck', 'user preferences for coding style'. " +
            "Use empty string '' to fetch recent memories.",
        },
        limit: {
          type: "number",
          description:
            "Max results to return (default: 10, max: 30). Use offset to paginate.",
        },
        offset: {
          type: "number",
          description:
            "Pagination offset (default: 0). Example: limit=10, offset=10 returns the next page.",
        },
        date_from: {
          type: "string",
          description:
            "Optional. ISO 8601 start date (inclusive). " +
            "For relative phrases (today, yesterday, this week), convert using current date and user timezone. " +
            "Examples: '2026-03-05', '2026-03-05T00:00:00+09:00'.",
        },
        date_to: {
          type: "string",
          description:
            "Optional. ISO 8601 end date (inclusive). Use end-of-day in user timezone for a calendar day. " +
            "Examples: '2026-03-05', '2026-03-05T23:59:59+09:00'.",
        },
        timezone: {
          type: "string",
          description:
            "Optional IANA timezone (e.g. 'Asia/Seoul') for interpreting date_from/date_to when they are date-only.",
        },
      },
      required: ["query"],
    },
    async execute(
      _toolCallId: string,
      params: {
        query: string;
        limit?: number;
        offset?: number;
        date_from?: string;
        date_to?: string;
        timezone?: string;
      },
    ) {
      try {
        const bundles = await client.search(
          params.query,
          params.limit ?? 10,
          params.offset,
          params.date_from,
          params.date_to,
          params.timezone,
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
