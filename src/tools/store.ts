import type { MembaseClient } from "../client";
import type { OpenClawPluginApi } from "../types";

const MAX_CONTENT_LENGTH = 50_000;

export function registerStoreTool(
  api: OpenClawPluginApi,
  client: MembaseClient,
) {
  api.registerTool({
    name: "membase_store",
    label: "Store in Membase",
    description:
      "Store long-term memory (persistent across sessions). " +
      "ALWAYS call this tool immediately when the user explicitly asks to save, remember, " +
      "store, or record something. Do NOT assume auto-capture will handle it — auto-capture " +
      "is delayed and unreliable for explicit requests. Call this tool first, then respond. " +
      "Also call proactively when the user shares durable context worth remembering " +
      "(preferences, habits, goals, ongoing projects) even without an explicit request. " +
      "Avoid storing transient one-off states unless the user explicitly asks. " +
      "If previously stored information needs correction, store the corrected version as a new memory.",
    parameters: {
      type: "object",
      properties: {
        content: {
          type: "string",
          maxLength: MAX_CONTENT_LENGTH,
          description:
            "Long-term memory content (persistent across sessions). " +
            "If the user explicitly asks to save something, pass the user-confirmed fact here verbatim. " +
            "Store durable user context such as preferences, background, " +
            "recurring patterns/habits, goals/plans, ongoing projects, constraints, " +
            "and stable technical context. " +
            "Avoid transient one-off states/events unless the user explicitly asks to remember them " +
            "or they are likely to matter later. " +
            "Do not store secrets (tokens, passwords). Avoid duplicates. " +
            "If previously stored information has changed, store the updated version as a new memory — " +
            "do not try to modify the old one.",
        },
        display_summary: {
          type: "string",
          description:
            "A natural sentence (≤100 chars) describing this memory. " +
            "Start with 'The user' or equivalent in the user's language.",
        },
      },
      required: ["content", "display_summary"],
    },
    async execute(
      _toolCallId: string,
      params: { content: string; display_summary: string },
    ) {
      try {
        if (params.content.length > MAX_CONTENT_LENGTH) {
          return {
            content: [
              {
                type: "text",
                text: `Content too long (${params.content.length} chars). Maximum is ${MAX_CONTENT_LENGTH}.`,
              },
            ],
          };
        }

        const result = await client.ingest(params.content, {
          displaySummary: params.display_summary,
        });
        return {
          content: [
            { type: "text", text: `Stored in Membase (${result.status})` },
          ],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Store failed: ${message}` }],
        };
      }
    },
  });
}
