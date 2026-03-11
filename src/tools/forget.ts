import type { MembaseClient } from "../client";
import { formatBundle } from "../format";
import type { OpenClawPluginApi } from "../types";

export function registerForgetTool(
  api: OpenClawPluginApi,
  client: MembaseClient,
) {
  api.registerTool({
    name: "membase_forget",
    label: "Forget Membase Memory",
    description:
      "Delete a specific memory from Membase. " +
      "When confirm=false (default), returns the top matching memories so the user can pick one. " +
      "When confirm=true with a uuid, deletes that specific memory. " +
      "Always show the match to the user and get confirmation before deleting.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Natural-language description of the memory to forget. " +
            "Be as specific as possible to match the right memory.",
        },
        uuid: {
          type: "string",
          description:
            "UUID of the memory to delete. Only provide after the user confirms " +
            "which memory to remove from the search results.",
        },
        confirm: {
          type: "boolean",
          description:
            "Set to true to actually delete the memory identified by uuid. " +
            "Default is false (search-only mode).",
        },
      },
      required: ["query"],
    },
    async execute(
      _toolCallId: string,
      params: { query: string; uuid?: string; confirm?: boolean },
    ) {
      try {
        if (params.confirm && params.uuid) {
          await client.deleteMemory(params.uuid);
          return {
            content: [
              { type: "text", text: `Memory deleted (${params.uuid}).` },
            ],
          };
        }

        const bundles = await client.search(params.query, 5);
        if (bundles.length === 0) {
          return {
            content: [
              { type: "text", text: "No matching memory found to forget." },
            ],
          };
        }

        const formatted = bundles.map((b, i) => {
          const uuid = b.episode.uuid;
          return `${formatBundle(b, i)}\n   UUID: ${uuid}`;
        });

        return {
          content: [
            {
              type: "text",
              text:
                "Found these matching memories. Ask the user which one to delete, " +
                "then call membase_forget again with confirm=true and the uuid.\n\n" +
                formatted.join("\n\n"),
            },
          ],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Forget failed: ${message}` }],
        };
      }
    },
  });
}
