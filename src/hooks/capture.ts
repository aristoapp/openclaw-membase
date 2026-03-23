import type { MembaseClient } from "../client";
import type { OpenClawPluginApi } from "../types";
import { extractTextContent, sanitizeMembaseText } from "../utils";

const SILENCE_TIMEOUT_MS = 5 * 60 * 1000;
const MAX_BUFFER_SIZE = 20;
const MIN_MESSAGES_TO_FLUSH = 2;
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
  text: string;
}

const messageBuffers = new Map<string, BufferedMessage[]>();
const silenceTimers = new Map<string, ReturnType<typeof setTimeout>>();

function getChannelKey(event: Record<string, unknown>): string {
  // Prefer the top-level sessionKey added in openclaw PR #44348.
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

async function flushBuffer(
  channelKey: string,
  client: MembaseClient,
  logger: OpenClawPluginApi["logger"],
): Promise<void> {
  const messages = messageBuffers.get(channelKey);
  if (!messages || messages.length === 0) {
    messageBuffers.delete(channelKey);
    return;
  }
  if (messages.length < MIN_MESSAGES_TO_FLUSH) {
    messageBuffers.delete(channelKey);
    return;
  }

  const content = messages.map((m) => m.text).join("\n\n");
  if (content.length < 50) {
    messageBuffers.delete(channelKey);
    return;
  }

  try {
    await client.ingest(content);
    messageBuffers.delete(channelKey);
  } catch (err) {
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
  const promises: Promise<void>[] = [];
  for (const [channelKey] of messageBuffers) {
    const timer = silenceTimers.get(channelKey);
    if (timer) {
      clearTimeout(timer);
      silenceTimers.delete(channelKey);
    }
    promises.push(flushBuffer(channelKey, client, logger));
  }
  return Promise.all(promises).then(() => {});
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
        if (m.role !== "user") continue;

        let text = extractTextContent(m.content);
        text = sanitizeMembaseText(text);
        if (isOperationalMessage(text)) continue;
        if (text.length >= 10) {
          newMessages.push({ text });
        }
      }

      if (newMessages.length === 0) return;

      if (!messageBuffers.has(channelKey)) {
        messageBuffers.set(channelKey, []);
      }
      const buffer = messageBuffers.get(channelKey) ?? [];
      buffer.push(...newMessages);
      messageBuffers.set(channelKey, buffer);

      const existingTimer = silenceTimers.get(channelKey);
      if (existingTimer) {
        clearTimeout(existingTimer);
      }

      if (buffer.length >= MAX_BUFFER_SIZE) {
        const toFlush = buffer.splice(0, buffer.length - MIN_MESSAGES_TO_FLUSH);
        const tempKey = `${channelKey}__flush`;
        messageBuffers.set(tempKey, toFlush);
        await flushBuffer(tempKey, client, logger);
        return;
      }

      silenceTimers.set(
        channelKey,
        setTimeout(async () => {
          silenceTimers.delete(channelKey);
          await flushBuffer(channelKey, client, logger);
        }, SILENCE_TIMEOUT_MS),
      );
    } catch (err) {
      logger.warn(
        "membase: auto-capture failed:",
        err instanceof Error ? err.message : String(err),
      );
    }
  });
}
