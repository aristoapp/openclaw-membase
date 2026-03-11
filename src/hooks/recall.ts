import type { MembaseClient } from "../client";
import { formatBundle } from "../format";
import type { MembasePluginConfig, OpenClawPluginApi } from "../types";
import { extractLastUserMessage, isCasualChat } from "../utils";

const RECALL_INTRO =
  "The following is background context about the user from long-term memory. " +
  "Use this context silently to inform your understanding — only reference it " +
  "when the user's message is directly related.";
const RECALL_DISCLAIMER =
  "Do not proactively bring up memories. Only use them when the conversation naturally calls for it.";

export function registerRecallHook(
  api: OpenClawPluginApi,
  client: MembaseClient,
  cfg: MembasePluginConfig,
) {
  api.on(
    "before_agent_start",
    async (event: Record<string, unknown>) => {
      try {
        const userMessage = extractLastUserMessage(event);
        if (!userMessage || userMessage.length < 30) return {};
        if (isCasualChat(userMessage)) return {};

        const bundles = await client.search(userMessage.slice(0, 500), 5);
        if (bundles.length === 0) return {};

        const overhead = RECALL_INTRO.length + RECALL_DISCLAIMER.length + 60;
        const charBudget = cfg.maxRecallChars - overhead;

        const lines: string[] = [];
        let used = 0;
        for (let i = 0; i < bundles.length; i++) {
          const bundle = bundles[i];
          if (!bundle) continue;
          const line = formatBundle(bundle, i);
          if (used + line.length > charBudget) break;
          lines.push(line);
          used += line.length;
        }

        if (lines.length === 0) return {};

        const header = `Found ${lines.length} ${lines.length === 1 ? "memory" : "memories"}:\n`;
        const formatted = header + lines.join("\n");

        return {
          prependContext: `<membase-context>\n${RECALL_INTRO}\n\n${formatted}\n\n${RECALL_DISCLAIMER}\n</membase-context>`,
        };
      } catch {
        return {};
      }
    },
    { priority: 10 },
  );
}
