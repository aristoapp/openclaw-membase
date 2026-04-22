import type { MembaseClient } from "../client";
import type { OpenClawPluginApi } from "../types";
import { toolResponse } from "../update-check";

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
        collection: {
          type: "string",
          description:
            "Collection name to file the document under. Set ONLY when the user explicitly names a collection or category (e.g., 'save to Work wiki'). New collections are created on first use. Do not guess or invent a name.",
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
        collection?: string;
        summarize?: boolean;
      },
    ) {
      try {
        const doc = await client.createWikiDocument(
          params.title,
          params.content,
          params.collection,
          params.summarize,
        );
        return await toolResponse(
          `Wiki document created: "${doc.title}" (ID: ${doc.id})`,
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return await toolResponse(`Add wiki failed: ${message}`);
      }
    },
  });
}
