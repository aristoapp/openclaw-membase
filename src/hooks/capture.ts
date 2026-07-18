import type { MembaseClient } from "../client";
import type { OpenClawPluginApi } from "../types";
import { extractTextContent, sanitizeMembaseText } from "../utils";

const SILENCE_TIMEOUT_MS = 5 * 60 * 1000;
const MAX_BUFFER_SIZE = 20;
const MIN_MESSAGES_TO_FLUSH = 2;
const MAX_WIKI_CAPTURE_CHARS = 95_000;
const HEARTBEAT_CONTROL_PATTERNS = [
  /^heartbeat$/i,
  /^heartbeat_ok$/i,
  /^heartbeat ok$/i,
  /^heartbeat:\s*(ok|idle|noop)$/i,
  /^heartbeat ping$/i,
  /^heartbeat check$/i,
  /\bcheck\s+heartbeat\.md\b/i,
];

interface BufferedMessage {
  role: "user" | "assistant";
  text: string;
}

const messageBuffers = new Map<string, BufferedMessage[]>();
const pendingDocumentBuffers = new Map<
  string,
  ReturnType<typeof buildCaptureDocuments>
>();
const silenceTimers = new Map<string, ReturnType<typeof setTimeout>>();
let flushSequence = 0;

function getChannelKey(event: Record<string, unknown>): string {
  // Prefer the top-level sessionKey from newer OpenClaw event payloads.
  // Fall back to the legacy session object shape, then to "default".
  if (typeof event.sessionKey === "string" && event.sessionKey) {
    return event.sessionKey;
  }
  const session = event.session as Record<string, unknown> | undefined;
  return (session?.channelId as string) || (session?.id as string) || "default";
}

function getLastTurn(messages: unknown[]): unknown[] {
  let lastUserIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i] as Record<string, unknown> | undefined;
    if (msg?.role === "user") {
      lastUserIdx = i;
      break;
    }
  }
  return lastUserIdx >= 0 ? messages.slice(lastUserIdx) : messages;
}

function isOperationalMessage(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return true;
  if (HEARTBEAT_CONTROL_PATTERNS.some((p) => p.test(trimmed))) return true;
  return false;
}

function normalizeCaptureRole(role: unknown): BufferedMessage["role"] | null {
  if (role === "user") return "user";
  if (role === "assistant" || role === "agent") return "assistant";
  return null;
}

function formatTranscript(messages: BufferedMessage[]): string {
  return messages
    .map((m) => `### ${m.role === "user" ? "User" : "Assistant"}\n${m.text}`)
    .join("\n\n");
}

function splitLongMessage(message: BufferedMessage): BufferedMessage[] {
  if (message.text.length <= MAX_WIKI_CAPTURE_CHARS / 2) return [message];
  const chunks: BufferedMessage[] = [];
  for (
    let start = 0;
    start < message.text.length;
    start += MAX_WIKI_CAPTURE_CHARS / 2
  ) {
    chunks.push({
      role: message.role,
      text: message.text.slice(start, start + MAX_WIKI_CAPTURE_CHARS / 2),
    });
  }
  return chunks;
}

function buildCaptureContent(
  capturedAt: string,
  messages: BufferedMessage[],
  part?: { index: number; total: number },
): string {
  return [
    "# OpenClaw Conversation Capture",
    "",
    `- Captured at: ${capturedAt}`,
    ...(part ? [`- Part: ${part.index} of ${part.total}`] : []),
    "",
    "## Transcript",
    "",
    formatTranscript(messages),
  ].join("\n");
}

function buildCaptureDocuments(messages: BufferedMessage[]) {
  const capturedAt = new Date().toISOString();
  const normalizedMessages = messages.flatMap(splitLongMessage);
  const chunks: BufferedMessage[][] = [];
  let current: BufferedMessage[] = [];
  for (const message of normalizedMessages) {
    const candidate = [...current, message];
    const content = buildCaptureContent(capturedAt, candidate);
    if (current.length > 0 && content.length > MAX_WIKI_CAPTURE_CHARS) {
      chunks.push(current);
      current = [message];
    } else {
      current = candidate;
    }
  }
  if (current.length > 0) chunks.push(current);

  return chunks.map((chunk, index) => {
    const multiPart = chunks.length > 1;
    return {
      title:
        `OpenClaw conversation capture - ${capturedAt}` +
        (multiPart ? ` part ${index + 1}` : ""),
      content: buildCaptureContent(
        capturedAt,
        chunk,
        multiPart ? { index: index + 1, total: chunks.length } : undefined,
      ),
      sourceMetadata: {
        capture_kind: "conversation_transcript",
        captured_at: capturedAt,
        part_index: index + 1,
        part_total: chunks.length,
      },
      messages: chunk,
    };
  });
}

async function flushBuffer(
  channelKey: string,
  client: MembaseClient,
  logger: OpenClawPluginApi["logger"],
): Promise<void> {
  const pendingDocuments = pendingDocumentBuffers.get(channelKey);
  const messages = messageBuffers.get(channelKey);
  if (
    (!pendingDocuments || pendingDocuments.length === 0) &&
    (!messages || messages.length === 0)
  ) {
    messageBuffers.delete(channelKey);
    pendingDocumentBuffers.delete(channelKey);
    return;
  }
  if (
    (!pendingDocuments || pendingDocuments.length === 0) &&
    messages &&
    messages.length < MIN_MESSAGES_TO_FLUSH
  ) {
    messageBuffers.delete(channelKey);
    return;
  }

  const documents =
    pendingDocuments && pendingDocuments.length > 0
      ? pendingDocuments
      : buildCaptureDocuments(messages ?? []);
  if (
    documents.length === 0 ||
    documents.every((doc) => doc.content.length < 50)
  ) {
    if (!pendingDocuments || pendingDocuments.length === 0) {
      messageBuffers.delete(channelKey);
    }
    pendingDocumentBuffers.delete(channelKey);
    return;
  }

  let completedDocumentCount = 0;
  try {
    for (const doc of documents) {
      if (doc.content.length < 50) {
        completedDocumentCount += 1;
        continue;
      }
      await client.createWikiDocument(doc.title, doc.content, {
        sourceMetadata: doc.sourceMetadata,
      });
      completedDocumentCount += 1;
    }
    pendingDocumentBuffers.delete(channelKey);
    if (!pendingDocuments || pendingDocuments.length === 0) {
      messageBuffers.delete(channelKey);
    }
  } catch (err) {
    if (completedDocumentCount > 0) {
      const remainingDocuments = documents.slice(completedDocumentCount);
      if (remainingDocuments.length > 0) {
        pendingDocumentBuffers.set(channelKey, remainingDocuments);
      } else {
        pendingDocumentBuffers.delete(channelKey);
      }
      if (!pendingDocuments || pendingDocuments.length === 0) {
        messageBuffers.delete(channelKey);
      }
    }
    logger.warn(
      "membase: auto-capture flush failed (messages retained for retry):",
      err instanceof Error ? err.message : String(err),
    );
  }
}

export function flushAllBuffers(
  client: MembaseClient,
  logger: OpenClawPluginApi["logger"],
): Promise<void> {
  const channelKeys = new Set([
    ...messageBuffers.keys(),
    ...pendingDocumentBuffers.keys(),
  ]);
  const promises: Promise<void>[] = [];
  for (const channelKey of channelKeys) {
    const timer = silenceTimers.get(channelKey);
    if (timer) {
      clearTimeout(timer);
      silenceTimers.delete(channelKey);
    }
    promises.push(
      (async () => {
        await flushBuffer(channelKey, client, logger);
        if (
          !pendingDocumentBuffers.has(channelKey) &&
          messageBuffers.has(channelKey)
        ) {
          await flushBuffer(channelKey, client, logger);
        }
      })(),
    );
  }
  return Promise.all(promises).then(() => {});
}

function scheduleSilenceFlush(
  channelKey: string,
  client: MembaseClient,
  logger: OpenClawPluginApi["logger"],
): void {
  const existingTimer = silenceTimers.get(channelKey);
  if (existingTimer) {
    clearTimeout(existingTimer);
  }
  silenceTimers.set(
    channelKey,
    setTimeout(async () => {
      silenceTimers.delete(channelKey);
      await flushBuffer(channelKey, client, logger);
      if (
        pendingDocumentBuffers.has(channelKey) ||
        messageBuffers.has(channelKey)
      ) {
        scheduleSilenceFlush(channelKey, client, logger);
      }
    }, SILENCE_TIMEOUT_MS),
  );
}

export function registerCaptureHook(
  api: OpenClawPluginApi,
  client: MembaseClient,
  logger: OpenClawPluginApi["logger"],
) {
  api.on("agent_end", async (event: Record<string, unknown>) => {
    try {
      if (!event.success) return;
      if (!Array.isArray(event.messages) || event.messages.length === 0) return;

      const channelKey = getChannelKey(event);
      const lastTurn = getLastTurn(event.messages);
      const newMessages: BufferedMessage[] = [];

      for (const msg of lastTurn) {
        const m = msg as Record<string, unknown> | undefined;
        if (!m) continue;
        const role = normalizeCaptureRole(m.role);
        if (!role) continue;

        let text = extractTextContent(m.content);
        text = sanitizeMembaseText(text);
        if (isOperationalMessage(text)) continue;
        if (text.length >= 10) {
          newMessages.push({ role, text });
        }
      }

      if (newMessages.length === 0) return;

      if (!messageBuffers.has(channelKey)) {
        messageBuffers.set(channelKey, []);
      }
      const buffer = messageBuffers.get(channelKey) ?? [];
      buffer.push(...newMessages);
      messageBuffers.set(channelKey, buffer);

      if (buffer.length >= MAX_BUFFER_SIZE) {
        const toFlush = buffer.splice(0, buffer.length - MIN_MESSAGES_TO_FLUSH);
        const tempKey = `${channelKey}__flush_${++flushSequence}`;
        messageBuffers.set(tempKey, toFlush);
        await flushBuffer(tempKey, client, logger);
        if (
          pendingDocumentBuffers.has(tempKey) ||
          messageBuffers.has(tempKey)
        ) {
          scheduleSilenceFlush(tempKey, client, logger);
        }
        scheduleSilenceFlush(channelKey, client, logger);
        return;
      }

      scheduleSilenceFlush(channelKey, client, logger);
    } catch (err) {
      logger.warn(
        "membase: auto-capture failed:",
        err instanceof Error ? err.message : String(err),
      );
    }
  });
}
