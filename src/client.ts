import type { EpisodeBundle, Logger } from "./types";
import { MembaseApiError } from "./types";

const DEFAULT_TIMEOUT_MS = 15_000;

export type TokenRefreshCallback = (tokens: {
	accessToken: string;
	refreshToken: string;
}) => void;

export interface MembaseClientOptions {
	onTokenRefresh?: TokenRefreshCallback;
	debug?: boolean;
	logger?: Logger;
	timeoutMs?: number;
}

export class MembaseClient {
	private accessToken: string;
	private refreshToken: string;
	private clientId: string;
	private refreshPromise: Promise<void> | null = null;
	private readonly debug: boolean;
	private readonly logger: Logger | null;
	private readonly timeoutMs: number;
	private readonly onTokenRefresh?: TokenRefreshCallback;

	constructor(
		private readonly apiUrl: string,
		auth: {
			accessToken: string;
			refreshToken: string;
			clientId: string;
		},
		opts?: MembaseClientOptions,
	) {
		this.accessToken = auth.accessToken;
		this.refreshToken = auth.refreshToken;
		this.clientId = auth.clientId;
		this.onTokenRefresh = opts?.onTokenRefresh;
		this.debug = opts?.debug ?? false;
		this.logger = opts?.logger ?? null;
		this.timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	}

	private log(msg: string, ...args: unknown[]) {
		if (this.debug && this.logger) {
			this.logger.info(`membase: ${msg}`, ...args);
		}
	}

	private async refreshAccessToken(): Promise<void> {
		if (this.refreshPromise) return this.refreshPromise;
		this.refreshPromise = this.doRefresh().finally(() => {
			this.refreshPromise = null;
		});
		return this.refreshPromise;
	}

	private async doRefresh(): Promise<void> {
		if (!this.refreshToken || !this.clientId) {
			throw new MembaseApiError(
				"Session expired. Run 'openclaw membase login' to re-authenticate.",
				401,
			);
		}
		this.log("refreshing access token");
		const body = new URLSearchParams({
			grant_type: "refresh_token",
			refresh_token: this.refreshToken,
			client_id: this.clientId,
		});
		const response = await fetch(`${this.apiUrl}/oauth/token`, {
			method: "POST",
			headers: {
				"Content-Type": "application/x-www-form-urlencoded",
			},
			body: body.toString(),
			signal: AbortSignal.timeout(this.timeoutMs),
		});
		if (!response.ok) {
			const text = await response.text().catch(() => "");
			throw new MembaseApiError(
				`Token refresh failed (${response.status}). Run 'openclaw membase login' to re-authenticate.`,
				response.status,
				text,
			);
		}
		const data = (await response.json()) as {
			access_token: string;
			refresh_token?: string;
		};
		this.accessToken = data.access_token;
		if (data.refresh_token) {
			this.refreshToken = data.refresh_token;
		}
		this.log("token refreshed successfully");
		this.onTokenRefresh?.({
			accessToken: this.accessToken,
			refreshToken: this.refreshToken,
		});
	}

	isAuthenticated(): boolean {
		return Boolean(this.accessToken && this.clientId);
	}

	private doFetch(path: string, options: RequestInit = {}): Promise<Response> {
		return fetch(`${this.apiUrl}${path}`, {
			...options,
			signal: options.signal ?? AbortSignal.timeout(this.timeoutMs),
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${this.accessToken}`,
				...(options.headers ?? {}),
			},
		});
	}

	private async request<T>(
		path: string,
		options: RequestInit = {},
	): Promise<T> {
		this.log(`${options.method ?? "GET"} ${path}`);
		let response = await this.doFetch(path, options);

		if (response.status === 401 && this.refreshToken) {
			await response.body?.cancel();
			await this.refreshAccessToken();
			response = await this.doFetch(path, options);
		}

		if (!response.ok) {
			const text = await response.text().catch(() => "");
			throw new MembaseApiError(
				`Membase API error (${response.status}): ${text}`,
				response.status,
				text,
			);
		}

		const text = await response.text();
		this.log(`${path} → ${text.length} chars`);
		try {
			return JSON.parse(text) as T;
		} catch {
			throw new MembaseApiError(
				`Membase API returned non-JSON response: ${text.slice(0, 200)}`,
				response.status,
				text,
			);
		}
	}

	async search(
		query: string,
		limit = 10,
		offset?: number,
	): Promise<EpisodeBundle[]> {
		const qs = new URLSearchParams({
			query,
			limit: String(limit),
			format: "bundles",
		});
		if (offset !== undefined) {
			qs.set("offset", String(offset));
		}
		const data = await this.request<{ episodes: EpisodeBundle[] }>(
			`/memory/search?${qs.toString()}`,
		);
		return data.episodes ?? [];
	}

	async ingest(
		content: string,
		opts?: { displaySummary?: string },
	): Promise<{ status: string }> {
		const body: Record<string, unknown> = {
			content,
			source: "openclaw",
			channel: "api",
		};
		if (opts?.displaySummary) {
			body.display_summary = opts.displaySummary;
		}
		return this.request<{ status: string }>("/memory/ingest", {
			method: "POST",
			body: JSON.stringify(body),
		});
	}

	async getProfile(): Promise<{
		display_name?: string | null;
		role?: string | null;
		interests?: string | null;
		instructions?: string | null;
	}> {
		return this.request("/user/settings");
	}

	async deleteMemory(uuid: string): Promise<void> {
		await this.request(`/memory/episodes/${uuid}`, { method: "DELETE" });
	}

	async getUserProfileMemory(): Promise<EpisodeBundle | null> {
		try {
			const node = await this.request<Record<string, unknown>>(
				"/memory/user_profile",
			);
			if (node && typeof node === "object" && "uuid" in node) {
				return {
					episode: node as unknown as EpisodeBundle["episode"],
					edges: [],
				};
			}
			return null;
		} catch (error) {
			if (error instanceof MembaseApiError && error.status === 404) {
				return null;
			}
			throw error;
		}
	}

	async registerConnection(): Promise<void> {
		try {
			await this.request("/agents/connect", {
				method: "POST",
				body: JSON.stringify({ source: "openclaw" }),
			});
		} catch {
			// fire-and-forget: don't fail plugin startup for analytics
		}
	}
}
