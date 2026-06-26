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
  tokenFile: string;
  accessToken: string;
  refreshToken: string;
  autoRecall: boolean;
  autoWikiRecall: boolean;
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
  valid_at?: string | null;
  invalid_at?: string | null;
  expired_at?: string | null;
}

export interface EpisodeBundle {
  episode: NodeResponse;
  relevance_score?: number | null;
  nodes?: NodeResponse[];
  edges: EdgeResponse[];
}

export interface WikiSearchDocument {
  id: string;
  title: string;
  content: string;
  metadata: Record<string, unknown>;
  source: string;
  source_status?: string | null;
  source_warning?: string | null;
  source_last_checked_at?: string | null;
  source_references?: WikiSourceReference[];
  collection_id: string | null;
  collection_name: string | null;
  similarity: number | null;
  created_at: string | null;
  updated_at: string | null;
  recent_at?: string | null;
  routing?: WikiDocumentRoutingInfo | null;
  merged_into_document_id?: string | null;
  merged_at?: string | null;
  merged_by_proposal_id?: string | null;
}

export interface WikiSourceReference {
  id?: string | null;
  source: string;
  source_category?: string | null;
  import_format?: string | null;
  external_id?: string | null;
  url?: string | null;
  source_path?: string | null;
  title?: string | null;
  status?: string | null;
  warning?: string | null;
  last_seen_at?: string | null;
  last_synced_at?: string | null;
  source_created_at?: string | null;
  source_last_edited_at?: string | null;
  truncated?: boolean;
  link_type: "primary" | "supporting" | "derived" | "updated";
}

export interface WikiDocumentRoutingInfo {
  collection_id?: string | null;
  collection_name?: string | null;
  routing_source?:
    | "collection_id"
    | "explicit_project"
    | "legacy_collection"
    | "auto_route"
    | "fallback_uncategorized";
  reason?: string | null;
  fallback?: boolean;
  confidence?: number | null;
}

export interface WikiSearchResponse {
  documents: WikiSearchDocument[];
  total_count: number;
}

export interface WikiDocumentResponse {
  id: string;
  user_id: string;
  collection_id: string | null;
  title: string;
  content: string;
  metadata: Record<string, unknown>;
  status: string;
  source: string;
  source_status?: string | null;
  source_warning?: string | null;
  source_last_checked_at?: string | null;
  source_references?: WikiSourceReference[];
  routing?: WikiDocumentRoutingInfo | null;
  recent_at?: string | null;
  merged_into_document_id?: string | null;
  merged_at?: string | null;
  merged_by_proposal_id?: string | null;
  created_at: string;
  updated_at: string;
}
