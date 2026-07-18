import type {
  EpisodeBundle,
  WikiDocumentResponse,
  WikiDocumentRoutingInfo,
  WikiSearchDocument,
  WikiSourceReference,
} from "./types";

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

function safeScore(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  return value;
}

function stringAttribute(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeProjectName(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

export function formatSearchProjectName(
  collectionId: string | null | undefined,
  collectionName: string | null | undefined,
): string {
  return (
    normalizeProjectName(collectionName) || (collectionId ? "Unknown" : "Basic")
  );
}

export function appendResultSentence(base: string, sentence?: string): string {
  return sentence ? `${base}. ${sentence}` : base;
}

export function formatSavedDestination(
  routing: WikiDocumentRoutingInfo | null | undefined,
  collectionId: string | null | undefined,
  explicitProject?: string,
): string | undefined {
  if (routing?.fallback) {
    return "Saved to Basic because no confident Project was found.";
  }

  const routedProjectName = normalizeProjectName(routing?.collection_name);
  if (routedProjectName) {
    return `Saved to Project: ${routedProjectName}.`;
  }

  const explicitProjectName = normalizeProjectName(explicitProject);
  if (explicitProjectName && collectionId) {
    return `Saved to Project: ${explicitProjectName}.`;
  }

  if (!collectionId) {
    return "Saved to Basic.";
  }

  return undefined;
}

export function formatMovedDestination(
  project: string | null | undefined,
  collectionId: string | null | undefined,
): string | undefined {
  if (project === undefined) return undefined;
  if (project === null) {
    return !collectionId ? "Moved to Basic." : undefined;
  }

  const projectName = normalizeProjectName(project);
  if (!projectName) return undefined;

  return collectionId
    ? `Moved to Project: ${projectName}.`
    : "Current destination: Basic.";
}

export function formatWikiCreateResult(
  doc: WikiDocumentResponse,
  explicitProject?: string,
): string {
  return appendResultSentence(
    `Wiki document created: "${doc.title}" (ID: ${doc.id})`,
    formatSavedDestination(doc.routing, doc.collection_id, explicitProject),
  );
}

export function formatWikiUpdateResult(
  doc: WikiDocumentResponse,
  project: string | null | undefined,
): string {
  return appendResultSentence(
    `Wiki document updated: "${doc.title}" (ID: ${doc.id})`,
    formatMovedDestination(project, doc.collection_id),
  );
}

function formatEpisodeTags(episode: EpisodeBundle["episode"]): string {
  const tags: string[] = [];
  if (episode.source && episode.source !== "unknown") {
    tags.push(`source: ${episode.source}`);
  }

  const project = stringAttribute(episode.attributes?.project);
  if (project) {
    tags.push(`project: ${project}`);
  }

  return tags.length > 0 ? `[${tags.join(", ")}] ` : "";
}

function formatEdgeTemporal(edge: EpisodeBundle["edges"][number]): string {
  const parts: string[] = [];
  if (edge.valid_at) parts.push(`valid_at=${edge.valid_at}`);
  if (edge.invalid_at) parts.push(`invalid_at=${edge.invalid_at}`);
  if (edge.expired_at) parts.push(`expired_at=${edge.expired_at}`);
  return parts.length > 0 ? ` (${parts.join(", ")})` : "";
}

export function formatWikiDocumentDetails(doc: {
  source?: string | null;
  source_status?: string | null;
  source_warning?: string | null;
  source_last_checked_at?: string | null;
  source_references?: WikiSourceReference[] | null;
  created_at?: string | null;
  updated_at?: string | null;
}): string {
  const parts: string[] = [];
  const sourceReferences = formatSourceReferences(doc.source_references);
  if (sourceReferences) {
    parts.push(sourceReferences);
  } else if (doc.source) {
    parts.push(`source: ${doc.source}`);
  }
  if (doc.source_status && doc.source_status !== "active") {
    parts.push(`source_status: ${doc.source_status}`);
  }
  if (doc.source_warning) {
    parts.push(`source_warning: ${doc.source_warning}`);
  }

  const sourceChecked = formatDate(doc.source_last_checked_at);
  if (sourceChecked && doc.source_status && doc.source_status !== "active") {
    parts.push(`source_checked: ${sourceChecked}`);
  }

  const created = formatDate(doc.created_at);
  if (created) {
    parts.push(`created: ${created}`);
  }
  const updated = formatDate(doc.updated_at);
  if (updated) {
    parts.push(`updated: ${updated}`);
  }

  return parts.join("; ");
}

function formatSourceName(source: string | null | undefined): string {
  if (!source) return "Source";
  return source
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatSourceReference(ref: WikiSourceReference): string {
  const label = formatSourceName(ref.source);
  const title = ref.title?.trim();
  const base = ref.url
    ? `${title ? `${label} - ${title}` : label} (${ref.url})`
    : title
      ? `${label} - ${title}`
      : label;

  if (ref.status && ref.status !== "active") {
    return ref.warning
      ? `${base} [${ref.status}: ${ref.warning}]`
      : `${base} [${ref.status}]`;
  }

  return base;
}

const SOURCE_REFERENCE_PRIORITY: Record<
  WikiSourceReference["link_type"],
  number
> = {
  primary: 0,
  updated: 1,
  supporting: 2,
  derived: 3,
};

function formatSourceReferences(
  refs: WikiSourceReference[] | null | undefined,
): string {
  const sortedRefs = [...(refs ?? [])]
    .filter((ref) => ref?.source)
    .sort(
      (a, b) =>
        (SOURCE_REFERENCE_PRIORITY[a.link_type] ?? 99) -
        (SOURCE_REFERENCE_PRIORITY[b.link_type] ?? 99),
    );
  const primary = sortedRefs[0];
  if (!primary) return "";
  const extraCount = sortedRefs.length - 1;
  const suffix =
    extraCount > 0
      ? `; +${extraCount} additional reference${extraCount === 1 ? "" : "s"}`
      : "";
  return `Source: ${formatSourceReference(primary)}${suffix}`;
}

export function formatBundle(bundle: EpisodeBundle, index: number): string {
  const ep = bundle.episode;
  const name = ep.name || ep.summary || "(untitled)";
  const eventDate = formatDate(ep.valid_at);
  const capturedDate = formatDate(ep.created_at);
  const dateParts: string[] = [];
  const rawScore = safeScore(bundle.relevance_score);

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
  const relevanceTag = rawScore ? `[relevance: ${rawScore.toFixed(4)}] ` : "";
  const episodeTag = formatEpisodeTags(ep);

  const lines: string[] = [
    `${index + 1}. ${relevanceTag}${dateTag}${episodeTag}${name}`,
  ];

  if (ep.summary && ep.summary !== ep.name) {
    lines.push(`   ${ep.summary}`);
  }

  const facts = bundle.edges
    .map((e) => {
      if (!e.fact) return null;
      return `${e.fact}${formatEdgeTemporal(e)}`;
    })
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

export function formatWikiDocument(
  doc: WikiSearchDocument,
  index: number,
): string {
  const project = ` [Project: ${formatSearchProjectName(
    doc.collection_id,
    doc.collection_name,
  )}]`;
  const similarity =
    typeof doc.similarity === "number"
      ? ` [similarity: ${doc.similarity.toFixed(3)}]`
      : "";
  const lines: string[] = [`${index + 1}. ${doc.title}${project}${similarity}`];
  lines.push(`   ID: ${doc.id}`);
  const details = formatWikiDocumentDetails(doc);
  if (details) {
    lines.push(`   ${details}`);
  }
  if (doc.content) {
    lines.push(`   ${doc.content}`);
  }
  return lines.join("\n");
}

export function formatWikiDocuments(documents: WikiSearchDocument[]): string {
  if (documents.length === 0) return "No wiki documents found.";
  const header = `Found ${documents.length} wiki ${documents.length === 1 ? "document" : "documents"}:\n`;
  return (
    header + documents.map((doc, i) => formatWikiDocument(doc, i)).join("\n\n")
  );
}
