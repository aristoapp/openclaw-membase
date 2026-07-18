const MAX_KNOWN_PROJECTS = 12;

export function knownProjectsHint(knownProjects?: string[]): string {
  const normalized = [...new Set((knownProjects ?? []).map((p) => p.trim()))]
    .filter(Boolean)
    .slice(0, MAX_KNOWN_PROJECTS);
  return normalized.length > 0
    ? ` Known Projects: ${normalized.join(", ")}.`
    : "";
}

function normalizeProjectValue(
  value: string | null | undefined,
): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

export function resolveWikiProjectInput(args: {
  project?: string | null;
  collection?: string | null;
}): { value?: string | null; error?: string } {
  const project = normalizeProjectValue(args.project);
  const collection = normalizeProjectValue(args.collection);

  if (project === undefined && collection === undefined) return {};
  if (project !== undefined && collection !== undefined) {
    if (project !== collection) {
      return {
        error:
          "project and legacy collection must match when both are provided",
      };
    }
    return { value: project };
  }

  return { value: project !== undefined ? project : collection };
}
