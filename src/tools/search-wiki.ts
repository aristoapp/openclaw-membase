import type { MembaseClient } from "../client";
import { formatWikiDocuments } from "../format";
import type { OpenClawPluginApi } from "../types";
import { toolResponse } from "../update-check";
import { knownProjectsHint, resolveWikiProjectInput } from "../wiki-project";

export function registerSearchWikiTool(
  api: OpenClawPluginApi,
  client: MembaseClient,
  knownProjects?: string[],
) {
  api.registerTool({
    name: "membase_search_wiki",
    label: "Search Membase Wiki",
    description:
      "Search the user's knowledge wiki using hybrid semantic and keyword matching. " +
      "Use this for factual knowledge, references, and stable documentation. " +
      "For personal preferences, habits, or timeline recall, use membase_search." +
      knownProjectsHint(knownProjects),
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Search query for the knowledge wiki. Use empty string to fetch recent wiki documents.",
        },
        limit: {
          type: "number",
          description: "Max results to return (default: 10, max: 20).",
        },
        project: {
          type: "string",
          description:
            "Optional Wiki filing location to scope the search. Separate from the document title. Prefer this over legacy collection." +
            knownProjectsHint(knownProjects),
        },
        collection: {
          type: "string",
          description:
            "Legacy alias for project. Prefer project for new requests." +
            knownProjectsHint(knownProjects),
        },
      },
      required: ["query"],
    },
    async execute(
      _toolCallId: string,
      params: {
        query: string;
        limit?: number;
        project?: string;
        collection?: string;
      },
    ) {
      try {
        const projectInput = resolveWikiProjectInput(params);
        if (projectInput.error) {
          return await toolResponse(
            `Wiki search failed: ${projectInput.error}`,
          );
        }
        const result = await client.searchWiki(
          params.query,
          params.limit ?? 10,
          { project: projectInput.value ?? undefined },
        );
        await client.recordAgentUsage();
        return await toolResponse(formatWikiDocuments(result.documents));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return await toolResponse(`Wiki search failed: ${message}`);
      }
    },
  });
}
