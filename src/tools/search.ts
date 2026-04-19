import type { MembaseClient } from "../client";
import { formatBundles } from "../format";
import type { OpenClawPluginApi } from "../types";

const MEMORY_SOURCES = [
  "cursor",
  "claude-desktop",
  "claude-code",
  "vscode",
  "chatgpt",
  "gemini-cli",
  "opencode",
  "poke",
  "openclaw",
  "google-calendar",
  "gmail",
  "slack",
  "chatgpt-import",
  "claude-import",
  "gemini-import",
  "web-dashboard",
  "api-direct",
  "unknown",
] as const;

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
      "IMPORTANT — date ranges: when the user specifies a date or range (e.g. 'Feb 2–19', 'last week', 'today'), " +
      "you MUST set date_from and date_to as ISO 8601 dates. " +
      "Do NOT embed temporal references in the query — the query describes WHAT to find, not WHEN. " +
      "Examples: 'schedule from Feb 2 to 19' → query='', date_from='2026-02-02', date_to='2026-02-19T23:59:59'. " +
      "'meetings this week' → query='meeting', date_from=<this Monday>, date_to=<this Sunday>. " +
      "For broad topic questions without a date, call this tool multiple times with different angles. " +
      "Returns episode-centric bundles (episodes with nearby nodes/edges). " +
      "For factual knowledge or reference docs, also call membase_search_wiki alongside this tool.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Semantic search query describing WHAT to look for — topic or entity only. " +
            "Never include temporal references (this week, today, last month, etc.) — those belong in date_from/date_to. " +
            "Examples: 'team meeting', 'project deadline', 'user preferences'. " +
            "Use empty string '' for broad date-range retrieval (when date_from/date_to are set).",
        },
        limit: {
          type: "number",
          description:
            "Max results to return (default: 20, max: 30). " +
            "Use 20-30 for comprehensive timeline/date-range answers. Use offset to paginate.",
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
        sources: {
          type: "array",
          items: { type: "string", enum: MEMORY_SOURCES },
          description:
            "Optional. Filter results to specific memory sources. " +
            "Integrations: 'slack', 'gmail', 'google-calendar'. " +
            "AI clients: 'cursor', 'claude-desktop', 'claude-code', 'vscode', 'chatgpt', 'gemini-cli', 'opencode', 'poke', 'openclaw'. " +
            "Imports: 'chatgpt-import', 'claude-import', 'gemini-import'. " +
            "Other: 'web-dashboard', 'api-direct'. " +
            "Example: ['slack', 'gmail'] returns only Slack and Gmail memories.",
        },
        project: {
          type: "string",
          maxLength: 60,
          description:
            "Optional. Restrict search to one project slug (exact match). " +
            "Use only when the user explicitly asks for a project/category scope.",
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
        sources?: string[];
        project?: string;
      },
    ) {
      try {
        const bundles = await client.search(
          params.query,
          params.limit ?? 20,
          params.offset,
          params.date_from,
          params.date_to,
          params.timezone,
          params.sources,
          params.project,
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
