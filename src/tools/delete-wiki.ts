import type { MembaseClient } from "../client";
import { formatWikiDocument } from "../format";
import type { OpenClawPluginApi } from "../types";

export function registerDeleteWikiTool(
  api: OpenClawPluginApi,
  client: MembaseClient,
) {
  api.registerTool({
    name: "membase_delete_wiki",
    label: "Delete Membase Wiki Document",
    description:
      "Delete a wiki document. When confirm=false, returns matches so the user can pick one. " +
      "When confirm=true with doc_id, deletes that specific document.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Natural-language description to find the wiki document to delete.",
        },
        doc_id: {
          type: "string",
          description:
            "Document ID to delete. Provide after the user confirms a specific match.",
        },
        confirm: {
          type: "boolean",
          description:
            "Set to true to delete immediately when doc_id is provided. Default false.",
        },
        collection_id: {
          type: "string",
          description: "Optional collection filter used during search mode.",
        },
      },
      required: ["query"],
    },
    async execute(
      _toolCallId: string,
      params: {
        query: string;
        doc_id?: string;
        confirm?: boolean;
        collection_id?: string;
      },
    ) {
      try {
        if (params.confirm && params.doc_id) {
          await client.deleteWikiDocument(params.doc_id);
          return {
            content: [
              {
                type: "text",
                text: `Wiki document deleted (ID: ${params.doc_id})`,
              },
            ],
          };
        }

        const result = await client.searchWiki(
          params.query,
          5,
          params.collection_id,
        );
        if (result.documents.length === 0) {
          return {
            content: [
              { type: "text", text: "No matching wiki document found." },
            ],
          };
        }

        const lines = result.documents.map((doc, index) =>
          formatWikiDocument(doc, index),
        );
        return {
          content: [
            {
              type: "text",
              text:
                "Found these matching wiki documents. Ask the user which one to delete, then call again with confirm=true and doc_id.\n\n" +
                lines.join("\n\n"),
            },
          ],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Delete wiki failed: ${message}` }],
        };
      }
    },
  });
}
