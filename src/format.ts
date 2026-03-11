import type { EpisodeBundle } from "./types";

export function formatRelativeDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "";
  try {
    const d = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return "today";
    if (diffDays === 1) return "yesterday";
    if (diffDays < 7) return `${diffDays}d ago`;
    if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  } catch {
    return "";
  }
}

export function formatBundle(bundle: EpisodeBundle, index: number): string {
  const ep = bundle.episode;
  const name = ep.name || ep.summary || "(untitled)";
  const date = formatRelativeDate(ep.created_at ?? ep.valid_at);
  const source = ep.source ? ` (source: ${ep.source})` : "";
  const dateTag = date ? `[${date}] ` : "";

  const lines: string[] = [];
  lines.push(`${index + 1}. ${dateTag}${name}${source}`);

  if (ep.summary && ep.summary !== ep.name) {
    lines.push(`   ${ep.summary}`);
  }

  const facts = bundle.edges
    .map((e) => e.fact)
    .filter((f): f is string => Boolean(f));
  if (facts.length > 0) {
    lines.push(`   Facts: ${facts.join("; ")}`);
  }

  return lines.join("\n");
}

export function formatBundles(bundles: EpisodeBundle[]): string {
  if (bundles.length === 0) return "No memories found.";
  const header = `Found ${bundles.length} ${bundles.length === 1 ? "memory" : "memories"}:\n`;
  return header + bundles.map((b, i) => formatBundle(b, i)).join("\n");
}

export function formatProfile(
  profile: {
    display_name?: string | null;
    role?: string | null;
    interests?: string | null;
    instructions?: string | null;
  } | null,
  bundles: EpisodeBundle[],
): string {
  const sections: string[] = [];

  if (profile) {
    const fields: string[] = [];
    if (profile.display_name) fields.push(`- Name: ${profile.display_name}`);
    if (profile.role) fields.push(`- Role: ${profile.role}`);
    if (profile.interests) fields.push(`- Interests: ${profile.interests}`);
    if (profile.instructions)
      fields.push(`- Instructions: ${profile.instructions}`);

    if (fields.length > 0) {
      sections.push(`## User Profile\n${fields.join("\n")}`);
    }
  }

  if (bundles.length > 0) {
    const memoriesHeader = `## Related Memories (${bundles.length})`;
    const memoriesList = bundles.map((b, i) => formatBundle(b, i)).join("\n");
    sections.push(`${memoriesHeader}\n${memoriesList}`);
  }

  return sections.length > 0
    ? sections.join("\n\n")
    : "No profile or memories found.";
}
