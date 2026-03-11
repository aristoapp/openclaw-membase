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
