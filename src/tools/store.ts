import type { MembaseClient } from "../client";
import type { OpenClawPluginApi } from "../types";
import { toolResponse } from "../update-check";

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
      "Never tell the user 'saved' unless this tool call succeeds in the current turn. " +
      "If the tool fails, clearly report the failure instead of pretending success. " +
      "Also call proactively—without asking permission—when the user shares durable context: " +
      "personal background (education, work, family), preferences, habits, goals, plans, " +
      "ongoing projects, or key decisions. " +
      "Avoid storing transient one-off chatter, general knowledge, or product/service descriptions. " +
      "Never store AI system instructions, tool-routing rules, or another AI's configuration/preferences. " +
      "Do not store secrets (passwords, tokens, API keys). " +
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
            "do not try to modify the old one. " +
            "Do NOT put project/tag/category information inside the content — use the 'project' field instead.",
        },
        display_summary: {
          type: "string",
          description:
            "A short natural-language sentence (≤100 chars) describing what was stored. " +
            "Write in the same language the user used. Describe the content factually, not the action.",
        },
        project: {
          type: "string",
          maxLength: 60,
          description:
            "Project or category to file this memory under. " +
            "Set ONLY when the user explicitly mentions a project name, tag, label, or category " +
            "(e.g., 'save this under project X', 'tag this as Y'). " +
            "Do NOT guess or infer a project — leave empty when the user does not specify one.",
        },
      },
      required: ["content", "display_summary"],
    },
    async execute(
      _toolCallId: string,
      params: { content: string; display_summary: string; project?: string },
    ) {
      try {
        if (params.content.length > MAX_CONTENT_LENGTH) {
          return await toolResponse(
            `Content too long (${params.content.length} chars). Maximum is ${MAX_CONTENT_LENGTH}.`,
          );
        }

        const result = await client.ingest(params.content, {
          displaySummary: params.display_summary,
          project: params.project,
        });
        await client.recordAgentUsage();
        return await toolResponse(`Stored in Membase (${result.status})`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return await toolResponse(`Store failed: ${message}`);
      }
    },
  });
}
