import type { MembaseClient } from "../client";
import type { OpenClawPluginApi } from "../types";

export function registerAddWikiTool(
  api: OpenClawPluginApi,
  client: MembaseClient,
) {
  api.registerTool({
    name: "membase_add_wiki",
    label: "Add Membase Wiki Document",
    description:
      "Add a document to the user's wiki knowledge base. Use for factual documents and references, not personal context.",
    parameters: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "Title of the wiki document.",
        },
        content: {
          type: "string",
          description:
            "Markdown content for the wiki document. Use [[wikilinks]] to reference related topics.",
        },
        collection_id: {
          type: "string",
          description: "Optional collection ID to place the document in.",
        },
        summarize: {
          type: "boolean",
          description:
            "If true, the backend will summarize content into structured markdown.",
        },
      },
      required: ["title", "content"],
    },
    async execute(
      _toolCallId: string,
      params: {
        title: string;
        content: string;
        collection_id?: string;
        summarize?: boolean;
      },
    ) {
      try {
        const doc = await client.createWikiDocument(
          params.title,
          params.content,
          params.collection_id,
          params.summarize,
        );
        return {
          content: [
            {
              type: "text",
              text: `Wiki document created: "${doc.title}" (ID: ${doc.id})`,
            },
          ],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Add wiki failed: ${message}` }],
        };
      }
    },
  });
}
