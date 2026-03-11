export class MembaseApiError extends Error {
	constructor(
		message: string,
		public readonly status: number,
		public readonly body?: string,
	) {
		super(message);
		this.name = "MembaseApiError";
	}
}

export interface ToolResult {
	content: { type: string; text: string }[];
	details?: Record<string, unknown>;
}

export interface ToolDefinition {
	name: string;
	label: string;
	description: string;
	parameters: Record<string, unknown>;
	// biome-ignore lint: OpenClaw calls execute with tool-specific param shapes
	execute: (toolCallId: string, params: any) => Promise<ToolResult>;
}

export interface ServiceDefinition {
	id: string;
	start: () => void;
	stop: () => void | Promise<void>;
}

export interface OpenClawPluginApi {
	pluginConfig?: Record<string, unknown>;
	logger: {
		info: (...args: unknown[]) => void;
		warn: (...args: unknown[]) => void;
		error: (...args: unknown[]) => void;
	};
	registerTool: (tool: ToolDefinition, opts?: unknown) => void;
	registerCli: (registrar: unknown, opts?: unknown) => void;
	registerService: (service: ServiceDefinition) => void;
	on: (hookName: string, handler: unknown, opts?: unknown) => void;
}

export interface MembasePluginConfig {
	apiUrl: string;
	clientId: string;
	accessToken: string;
	refreshToken: string;
	autoRecall: boolean;
	autoCapture: boolean;
	maxRecallChars: number;
	debug: boolean;
}

export type Logger = OpenClawPluginApi["logger"];

// Aligned with API response (same shape as apps/mcp/src/client.ts)
export interface NodeResponse {
	uuid: string;
	name: string;
	labels?: string[];
	summary: string | null;
	source: string | null;
	created_at: string | null;
	valid_at?: string | null;
	attributes?: Record<string, unknown>;
}

export interface EdgeResponse {
	uuid: string;
	name: string;
	fact: string | null;
	source_node_uuid?: string;
	target_node_uuid?: string;
	created_at: string | null;
}

export interface EpisodeBundle {
	episode: NodeResponse;
	nodes?: NodeResponse[];
	edges: EdgeResponse[];
}
