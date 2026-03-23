const CASUAL_PATTERNS = [
  /^(hi|hey|hello|yo|sup|hola|howdy|hiya|heya)\b/,
  /^(good\s*(morning|afternoon|evening|night))\b/,
  /^(thanks|thank you|thx|ty)\b/,
  /^(ok|okay|sure|got it|sounds good|cool|nice|great|awesome|perfect)\b/,
  /^(bye|goodbye|see you|later|gn|ttyl)\b/,
  /^(yes|no|yep|nope|yeah|nah)\b/,
  /^(lol|lmao|haha|heh)\b/,
  /^(how are you|what's up|whats up|wassup)\b/,
];

const MEMORY_KEYWORDS = [
  "remember",
  "recall",
  "forgot",
  "forget",
  "last time",
  "previously",
  "before",
  "history",
  "decide",
  "decision",
  "chose",
  "choice",
  "plan",
  "goal",
  "project",
  "preference",
  "setting",
  "config",
  "deploy",
  "release",
  "migration",
  "refactor",
  "architecture",
  "deadline",
  "schedule",
  "budget",
  "fix",
  "bug",
  "issue",
  "error",
];

const METADATA_BLOCK_RE =
  /(sender|conversation info)\s*\(untrusted metadata\):\s*(?:```json[\s\S]*?```|json\s*\{[\s\S]*?\})/gi;
const MEMBASE_CONTEXT_BLOCK_RE =
  /<membase-context>[\s\S]*?<\/membase-context>\s*/gi;
const SIMPLE_TAG_RE = /<\/?final>/gi;
const HEARTBEAT_NOISE_LINE_PATTERNS = [
  /read heartbeat\.md if it exists \(workspace context\)/i,
  /when reading heartbeat\.md, use workspace file/i,
  /if nothing needs attention,\s*reply heartbeat_ok/i,
  /do not infer or repeat old tasks from prior chats/i,
  /^current time:/i,
  /^gateway reconnected\b/i,
  /^agent main \| session main \(heartbeat\)/i,
  /^[-─]{8,}$/i,
];
const SECRET_ASSIGNMENT_RE =
  /\b([A-Z0-9_]*(?:API_KEY|TOKEN|SECRET|PASSWORD)[A-Z0-9_]*)\s*=\s*[^\s`]+/gi;
// OpenClaw prepends a timestamp to every user message, e.g. "[Mon 2026-03-23 15:19 GMT+9] "
const OPENCLAW_TIMESTAMP_PREFIX_RE =
  /^\[[A-Za-z]{3}\s+\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}\s+GMT[+-]\d+\]\s*/;

function hasMemoryKeywords(text: string): boolean {
  return MEMORY_KEYWORDS.some((kw) => text.includes(kw));
}

export function isCasualChat(text: string): boolean {
  const lower = text.toLowerCase().trim();

  if (hasMemoryKeywords(lower) || lower.includes("?")) return false;

  for (const pattern of CASUAL_PATTERNS) {
    if (pattern.test(lower)) return true;
  }

  if (lower.length < 40) return true;

  return false;
}

export function extractTextContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return (content as Record<string, unknown>[])
      .filter((c) => c.type === "text")
      .map((c) => c.text as string)
      .join("\n");
  }
  return "";
}

export function sanitizeMembaseText(raw: string): string {
  let cleaned = raw;
  cleaned = cleaned.replace(MEMBASE_CONTEXT_BLOCK_RE, " ");
  cleaned = cleaned.replace(METADATA_BLOCK_RE, " ");
  cleaned = cleaned.replace(SIMPLE_TAG_RE, " ");

  const lines = cleaned
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter(
      (line) =>
        !HEARTBEAT_NOISE_LINE_PATTERNS.some((pattern) => pattern.test(line)),
    );

  return lines.join("\n").trim();
}

export function sanitizeRecallQuery(raw: string): string {
  let cleaned = raw.replace(OPENCLAW_TIMESTAMP_PREFIX_RE, "");
  cleaned = sanitizeMembaseText(cleaned);
  cleaned = cleaned.replace(SECRET_ASSIGNMENT_RE, "$1=[REDACTED]");
  cleaned = cleaned.replace(/```[\s\S]*?```/g, " ");
  cleaned = cleaned.replace(/\s+/g, " ").trim();
  return cleaned.slice(0, 240);
}

export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms);
    }),
  ]);
}

export function extractLastUserMessage(event: Record<string, unknown>): string {
  const messages = event.messages;
  if (Array.isArray(messages)) {
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i] as Record<string, unknown> | undefined;
      if (msg?.role === "user") {
        if (typeof msg.content === "string") return msg.content;
        if (Array.isArray(msg.content)) {
          return (msg.content as Record<string, unknown>[])
            .filter((c) => c.type === "text")
            .map((c) => c.text as string)
            .join(" ");
        }
      }
    }
  }

  if (typeof event.prompt === "string") return event.prompt;
  return "";
}
