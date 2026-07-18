import type { MembaseClient } from "../client";
import { formatWikiCreateResult } from "../format";
import type { OpenClawPluginApi } from "../types";
import { toolResponse } from "../update-check";
import { looksSensitive } from "../utils";
import { knownProjectsHint, resolveWikiProjectInput } from "../wiki-project";

export function registerAddWikiTool(
  api: OpenClawPluginApi,
  client: MembaseClient,
  knownProjects?: string[],
) {
  api.registerTool({
    name: "membase_add_wiki",
    label: "Add Membase Wiki Document",
    description:
      "Add a complete document or knowledge artifact to the user's wiki knowledge base. " +
      "Use for factual documents, references, reports, documentation, and stable knowledge, not personal context. " +
      "Store the full artifact body unless the user explicitly asks to save a summary. " +
      'If the artifact is too long, split it into sequential wiki documents instead of dropping content. After success, tell the user the returned destination such as "Saved to Project: X" or "Saved to Basic".' +
      knownProjectsHint(knownProjects),
    parameters: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description:
            "Title of the wiki document itself. The Project is a Wiki filing location, separate from the title.",
        },
        content: {
          type: "string",
          description:
            "Full document body to store in Wiki. Preserve sections, details, examples, tables, and decisions. Do not summarize, condense, or omit material unless the user explicitly asks to save a summary.",
        },
        project: {
          type: "string",
          description:
            "Wiki filing location, separate from the title. New Projects are created on first use. Leave empty when the user does not specify a Project." +
            knownProjectsHint(knownProjects),
        },
        collection: {
          type: "string",
          description:
            "Legacy alias for project. Prefer project for new requests." +
            knownProjectsHint(knownProjects),
        },
      },
      required: ["title", "content"],
    },
    async execute(
      _toolCallId: string,
      params: {
        title: string;
        content: string;
        project?: string;
        collection?: string;
      },
    ) {
      try {
        const projectInput = resolveWikiProjectInput(params);
        if (projectInput.error) {
          return await toolResponse(`Add wiki failed: ${projectInput.error}`);
        }
        if (looksSensitive(params.content)) {
          return {
            content: [
              {
                type: "text" as const,
                text: "Add wiki failed: content appears to contain secrets or private credentials. Redact it before saving.",
              },
            ],
          };
        }
        const doc = await client.createWikiDocument(
          params.title,
          params.content,
          {
            project: projectInput.value ?? undefined,
          },
        );
        await client.recordAgentUsage();
        return await toolResponse(
          formatWikiCreateResult(doc, projectInput.value ?? undefined),
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return await toolResponse(`Add wiki failed: ${message}`);
      }
    },
  });
}
