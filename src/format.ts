import type { EpisodeBundle } from "./types";

const DAY_MS = 1000 * 60 * 60 * 24;

function localDayStart(date: Date): number {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
  ).getTime();
}

function dayDiffFromToday(date: Date): number {
  const todayStart = localDayStart(new Date());
  const targetStart = localDayStart(date);
  return Math.round((targetStart - todayStart) / DAY_MS);
}

function isSameLocalDay(
  lhs: string | null | undefined,
  rhs: string | null | undefined,
): boolean {
  if (!lhs || !rhs) return false;
  try {
    return localDayStart(new Date(lhs)) === localDayStart(new Date(rhs));
  } catch {
    return false;
  }
}

export function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "";

  try {
    const date = new Date(dateStr);
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, "0");
    const dd = String(date.getDate()).padStart(2, "0");
    const exactDate = `${yyyy}-${mm}-${dd}`;

    const diffDays = dayDiffFromToday(date);
    let relative = "";
    if (diffDays === 0) relative = " (today)";
    else if (diffDays === -1) relative = " (yesterday)";
    else if (diffDays === 1) relative = " (tomorrow)";

    return `${exactDate}${relative}`;
  } catch {
    return "";
  }
}

export function formatBundle(bundle: EpisodeBundle, index: number): string {
  const ep = bundle.episode;
  const name = ep.name || ep.summary || "(untitled)";
  const eventDate = formatDate(ep.valid_at);
  const capturedDate = formatDate(ep.created_at);
  const dateParts: string[] = [];

  if (eventDate) {
    dateParts.push(`event: ${eventDate}`);
  }
  if (
    capturedDate &&
    (!eventDate || !isSameLocalDay(ep.valid_at, ep.created_at))
  ) {
    dateParts.push(`captured: ${capturedDate}`);
  }

  const dateTag = dateParts.length > 0 ? `[${dateParts.join(", ")}] ` : "";

  const lines: string[] = [`${index + 1}. ${dateTag}${name}`];

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
