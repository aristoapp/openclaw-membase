import type { MembaseClient } from "../client";
import { formatWikiUpdateResult } from "../format";
import type { OpenClawPluginApi } from "../types";
import { toolResponse } from "../update-check";
import { looksSensitive } from "../utils";
import { knownProjectsHint, resolveWikiProjectInput } from "../wiki-project";

export function registerUpdateWikiTool(
  api: OpenClawPluginApi,
  client: MembaseClient,
  knownProjects?: string[],
) {
  api.registerTool({
    name: "membase_update_wiki",
    label: "Update Membase Wiki Document",
    description:
      "Update an existing wiki document. Use membase_search_wiki first to find the document ID. " +
      'The content field replaces the full document body, so preserve the complete updated artifact unless the user explicitly asks for a summary. A Project is the document\'s Wiki filing location, separate from the title. If the result includes a destination such as "Moved to Project: X", "Moved to Basic", or "Current destination: Basic", tell the user that destination.' +
      knownProjectsHint(knownProjects),
    parameters: {
      type: "object",
      properties: {
        doc_id: {
          type: "string",
          description: "ID of the wiki document to update.",
        },
        title: {
          type: "string",
          description: "New title (optional).",
        },
        content: {
          type: "string",
          description:
            "Complete replacement body for the wiki document. Do not summarize, condense, or omit material unless the user explicitly requested a summary.",
        },
        project: {
          type: ["string", "null"],
          description:
            "Move the document to a different Wiki filing location by Project. New Projects are created on first use. Set null to move the document to Basic." +
            knownProjectsHint(knownProjects),
        },
        collection: {
          type: ["string", "null"],
          description:
            "Legacy alias for project. Prefer project for new requests. Set null to move the document to Basic." +
            knownProjectsHint(knownProjects),
        },
      },
      required: ["doc_id"],
    },
    async execute(
      _toolCallId: string,
      params: {
        doc_id: string;
        title?: string;
        content?: string;
        project?: string | null;
        collection?: string | null;
      },
    ) {
      try {
        const projectInput = resolveWikiProjectInput(params);
        if (projectInput.error) {
          return await toolResponse(
            `Update wiki failed: ${projectInput.error}`,
          );
        }
        if (
          params.title === undefined &&
          params.content === undefined &&
          projectInput.value === undefined
        ) {
          return await toolResponse(
            "At least one update field is required (title/content/project/collection).",
          );
        }
        if (
          typeof params.content === "string" &&
          looksSensitive(params.content)
        ) {
          return {
            content: [
              {
                type: "text" as const,
                text: "Update wiki failed: content appears to contain secrets or private credentials. Redact it before saving.",
              },
            ],
          };
        }

        const updates: Parameters<MembaseClient["updateWikiDocument"]>[1] = {
          title: params.title,
          content: params.content,
        };
        if (projectInput.value === null) {
          updates.collection_id = null;
        } else if (projectInput.value !== undefined) {
          updates.project = projectInput.value;
        }

        const doc = await client.updateWikiDocument(params.doc_id, {
          ...updates,
        });
        await client.recordAgentUsage();
        return await toolResponse(
          formatWikiUpdateResult(doc, projectInput.value),
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return await toolResponse(`Update wiki failed: ${message}`);
      }
    },
  });
}
