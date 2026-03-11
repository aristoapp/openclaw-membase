import type { MembaseClient } from "../client";
import { formatProfile } from "../format";
import type { EpisodeBundle, OpenClawPluginApi } from "../types";
import { withTimeout } from "../utils";

export function registerProfileTool(
	api: OpenClawPluginApi,
	client: MembaseClient,
) {
	api.registerTool({
		name: "membase_profile",
		label: "Get Membase Profile",
		description:
			"Retrieve the user's profile and related memories for context (persistent across sessions). " +
			"Use at the start of a new session or for an overview; " +
			"for targeted lookup, use membase_search instead.",
		parameters: {
			type: "object",
			properties: {},
		},
		async execute() {
			try {
				const seenUuids = new Set<string>();
				const allBundles: EpisodeBundle[] = [];

				const addBundle = (bundle: EpisodeBundle) => {
					const uuid = bundle.episode?.uuid;
					if (!uuid || seenUuids.has(uuid)) return;
					seenUuids.add(uuid);
					allBundles.push(bundle);
				};

				const [profileResult, userProfileResult, searchResult] =
					await Promise.allSettled([
						withTimeout(client.getProfile(), 10000),
						withTimeout(client.getUserProfileMemory(), 10000),
						withTimeout(client.search("user", 10), 10000),
					]);

				const profile =
					profileResult.status === "fulfilled" ? profileResult.value : null;

				if (
					userProfileResult.status === "fulfilled" &&
					userProfileResult.value
				) {
					addBundle(userProfileResult.value);
				}

				if (searchResult.status === "fulfilled") {
					for (const bundle of searchResult.value) {
						addBundle(bundle);
					}
				}

				const displayName = profile?.display_name;
				if (
					typeof displayName === "string" &&
					displayName.trim() &&
					displayName !== "user"
				) {
					const nameResult = await withTimeout(
						client.search(displayName, 10),
						5000,
					).catch(() => [] as EpisodeBundle[]);
					for (const bundle of nameResult) {
						addBundle(bundle);
					}
				}

				return {
					content: [{ type: "text", text: formatProfile(profile, allBundles) }],
				};
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				return {
					content: [
						{ type: "text", text: `Profile retrieval failed: ${message}` },
					],
				};
			}
		},
	});
}
