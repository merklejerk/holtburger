import { z } from "zod";
import { clientServerScope } from "./client-profile-key.js";
import { launcherServerSchema } from "../src/launcher/launcher-contract.js";
import type { LauncherServer } from "../src/launcher/launcher-contract.js";
import type {
	DirectoryServer,
	ServerDirectory,
} from "../src/launcher/server-directory-contract.js";

/** Fixed public directory; callers cannot turn this command into arbitrary URL fetching. */
export const TREE_STATS_DIRECTORY_URL = "https://treestats.net/servers.json";
const DIRECTORY_TIMEOUT_MS = 10_000;
const rowSchema = z.object({
	name: z.string().trim().min(1),
	description: z.string(),
	type: z.string(),
	software: z.string(),
	host: z.string().trim().min(1),
	port: z
		.union([z.string().regex(/^\d+$/).transform(Number), z.number()])
		.pipe(z.number().int().min(1).max(65535)),
	players: z
		.object({
			count: z.number().int().nonnegative(),
			updated_at: z.string().min(1),
		})
		.optional(),
});

/** Application-local cache, populated only when the user opens or refreshes the browser. */
export class ServerDirectoryCatalog {
	#catalog: { servers: DirectoryServer[]; unavailableEntries: number } | null =
		null;
	#pending: Promise<void> | null = null;
	constructor(private readonly request: typeof fetch) {}

	async load(refresh: boolean): Promise<void> {
		if (this.#pending !== null) return this.#pending;
		if (!refresh && this.#catalog !== null) return;
		const pending = this.#fetch();
		this.#pending = pending;
		try {
			await pending;
		} finally {
			this.#pending = null;
		}
	}
	async #fetch(): Promise<void> {
		const response = await this.request(TREE_STATS_DIRECTORY_URL, {
			signal: AbortSignal.timeout(DIRECTORY_TIMEOUT_MS),
			headers: { Accept: "application/json" },
			credentials: "omit",
		});
		if (!response.ok)
			throw new Error(`TreeStats returned HTTP ${response.status}.`);
		const rows = z.array(z.unknown()).parse(await response.json());
		const servers = new Map<string, DirectoryServer>();
		let unavailableEntries = 0;
		for (const row of rows) {
			const parsed = rowSchema.safeParse(row);
			if (!parsed.success) {
				unavailableEntries++;
				continue;
			}
			const value = parsed.data;
			const endpoint = { host: value.host, port: value.port };
			const key = clientServerScope(endpoint);
			if (servers.has(key)) {
				unavailableEntries++;
				continue;
			}
			servers.set(key, {
				key,
				name: value.name,
				endpoint,
				description: value.description,
				kind: value.type,
				software: value.software,
				players:
					value.players === undefined
						? null
						: {
								count: value.players.count,
								updatedAt: value.players.updated_at,
							},
			});
		}
		if (rows.length > 0 && servers.size === 0)
			throw new Error("TreeStats returned no usable server entries.");
		this.#catalog = {
			servers: [...servers.values()].sort((a, b) =>
				a.name.localeCompare(b.name),
			),
			unavailableEntries,
		};
	}
	/** The saved catalog is read after the network request, so duplicate flags cannot use an old snapshot. */
	view(saved: readonly LauncherServer[]): ServerDirectory {
		const catalog = this.#requireCatalog();
		const endpoints = new Set(
			saved.map((server) => clientServerScope(server.endpoint)),
		);
		return {
			...catalog,
			servers: catalog.servers.map((server) => ({
				...server,
				alreadyAdded: endpoints.has(server.key),
			})),
		};
	}
	/** Resolve selected identities against validated native data; renderer metadata is never imported. */
	select(input: unknown): Pick<LauncherServer, "name" | "endpoint"> {
		const key = z.string().min(1).parse(input);
		const server = this.#requireCatalog().servers.find(
			(value) => value.key === key,
		);
		if (server === undefined)
			throw new Error(
				"Selected server is no longer in the TreeStats directory. Refresh and add it again.",
			);
		return launcherServerSchema
			.omit({ id: true })
			.parse({ name: server.name, endpoint: server.endpoint });
	}
	#requireCatalog() {
		if (this.#catalog === null)
			throw new Error("Load the TreeStats directory before selecting servers.");
		return this.#catalog;
	}
}
