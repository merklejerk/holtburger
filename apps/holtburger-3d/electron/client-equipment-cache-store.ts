import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import {
	equipmentCacheStageSchema,
	equipmentCacheTupleSchema,
	type EquipmentCacheEntry,
	type EquipmentCacheSnapshot,
	type EquipmentCacheTier,
} from "../src/client/client-equipment-cache-contract.js";
import { formatError } from "../src/lib/format-error.js";
import type { ClientLaunchConfiguration } from "./client-launch.js";
import { clientServerScope } from "./client-profile-key.js";
import { replaceLocalFile } from "./replace-local-file.js";

const EQUIPMENT_CACHE_VERSION = 1;
const MAX_EQUIPMENT_CACHE_ENTRIES = 8_192;

const diskEquipmentCacheSchema = z
	.object({
		version: z.literal(EQUIPMENT_CACHE_VERSION),
		serverScope: z.string().min(1),
		entries: z
			.array(equipmentCacheTupleSchema)
			.max(MAX_EQUIPMENT_CACHE_ENTRIES),
	})
	.strict();

function equipmentCachePath(directory: string, serverScope: string): string {
	const digest = createHash("sha256").update(serverScope).digest("hex");
	return join(directory, `${digest}.json`);
}

function isEnoent(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		(error as { code?: unknown }).code === "ENOENT"
	);
}

function insertBoundedLru(
	map: Map<number, EquipmentCacheTier>,
	guid: number,
	tier: EquipmentCacheTier,
	maxEntries: number,
): void {
	if (map.has(guid)) {
		map.delete(guid);
	} else if (map.size >= maxEntries) {
		const oldest = map.keys().next().value;
		if (oldest !== undefined) map.delete(oldest);
	}
	map.set(guid, tier);
}

/**
 * Persists per-server highest equipment cantrip tiers in Electron Main.
 * Concurrent writes serialize over monotonic stage revisions so newer appraisals
 * never get overwritten by an in-flight disk replacement.
 */
export class ClientEquipmentCacheStore {
	readonly #serverScope: string;
	readonly #path: string;
	readonly #writeDelayMs: number;
	readonly #maxEntries: number;
	readonly #onFailure: (message: string) => void;

	#loaded: Map<number, EquipmentCacheTier> | null = null;
	#loadPromise: Promise<Map<number, EquipmentCacheTier>> | null = null;
	#stagedBeforeLoad = new Map<number, EquipmentCacheTier>();
	#revision = 0;
	#persistedRevision = 0;
	#timer: ReturnType<typeof setTimeout> | null = null;
	#writeInFlight: Promise<void> | null = null;
	#closed = false;

	constructor(
		directory: string,
		startup: Pick<ClientLaunchConfiguration, "host" | "port">,
		writeDelayMs: number,
		onFailure: (message: string) => void = () => undefined,
		maxEntries: number = MAX_EQUIPMENT_CACHE_ENTRIES,
	) {
		this.#serverScope = clientServerScope(startup);
		this.#path = equipmentCachePath(directory, this.#serverScope);
		this.#writeDelayMs = Math.max(0, writeDelayMs);
		this.#maxEntries = Math.max(1, maxEntries);
		this.#onFailure = onFailure;
	}

	/** Reads the full cached map for this server scope. */
	async readAll(): Promise<EquipmentCacheSnapshot> {
		const map = await this.#ensureLoaded();
		const snapshot: Record<string, EquipmentCacheTier> = {};
		for (const [guid, tier] of map) {
			snapshot[String(guid)] = tier;
		}
		return snapshot;
	}

	/** Records one equipment cantrip verdict and schedules a debounced atomic save. */
	stage(entry: EquipmentCacheEntry): void {
		if (this.#closed) return;
		const parsed = equipmentCacheStageSchema.parse(entry);
		if (this.#loaded !== null) {
			if (
				this.#loaded.has(parsed.guid) &&
				this.#loaded.get(parsed.guid) === parsed.highestTier
			) {
				return;
			}
			insertBoundedLru(
				this.#loaded,
				parsed.guid,
				parsed.highestTier,
				this.#maxEntries,
			);
		} else {
			insertBoundedLru(
				this.#stagedBeforeLoad,
				parsed.guid,
				parsed.highestTier,
				this.#maxEntries,
			);
		}
		this.#revision += 1;
		this.#scheduleFlush();
	}

	/** Flushes all staged writes to disk, looping until the latest revision persists. */
	async flush(): Promise<void> {
		this.#clearTimer();
		while (this.#writeInFlight) {
			await this.#writeInFlight;
		}
		if (this.#revision <= this.#persistedRevision) return;
		this.#writeInFlight = this.#drainWrites();
		try {
			await this.#writeInFlight;
		} finally {
			this.#writeInFlight = null;
		}
	}

	/** Stops future staging and flushes pending writes before closing. */
	async close(): Promise<void> {
		this.#closed = true;
		await this.flush();
	}

	#ensureLoaded(): Promise<Map<number, EquipmentCacheTier>> {
		if (this.#loaded !== null) return Promise.resolve(this.#loaded);
		this.#loadPromise ??= this.#loadFromDisk();
		return this.#loadPromise;
	}

	async #loadFromDisk(): Promise<Map<number, EquipmentCacheTier>> {
		const map = new Map<number, EquipmentCacheTier>();
		try {
			const raw = await readFile(this.#path, "utf8");
			const parsed = diskEquipmentCacheSchema.parse(JSON.parse(raw));
			if (parsed.serverScope !== this.#serverScope) {
				throw new Error(
					`Equipment cache server scope mismatch: expected ${this.#serverScope}, got ${parsed.serverScope}`,
				);
			}
			for (const [guid, tier] of parsed.entries) {
				insertBoundedLru(map, guid, tier, this.#maxEntries);
			}
		} catch (error) {
			if (!isEnoent(error)) {
				this.#reportFailure(
					`Failed to load equipment cantrip cache: ${formatError(error)}`,
				);
			}
		}
		for (const [guid, tier] of this.#stagedBeforeLoad) {
			insertBoundedLru(map, guid, tier, this.#maxEntries);
		}
		this.#stagedBeforeLoad.clear();
		this.#loaded = map;
		return map;
	}

	#scheduleFlush(): void {
		if (this.#closed || this.#timer !== null) return;
		this.#timer = setTimeout(() => {
			this.#timer = null;
			void this.flush();
		}, this.#writeDelayMs);
	}

	#clearTimer(): void {
		if (this.#timer === null) return;
		clearTimeout(this.#timer);
		this.#timer = null;
	}

	async #drainWrites(): Promise<void> {
		const map = await this.#ensureLoaded();
		while (this.#revision > this.#persistedRevision) {
			const targetRevision = this.#revision;
			const payload = JSON.stringify({
				version: EQUIPMENT_CACHE_VERSION,
				serverScope: this.#serverScope,
				entries: Array.from(map.entries()),
			});
			try {
				await replaceLocalFile(this.#path, payload);
				this.#persistedRevision = targetRevision;
			} catch (error) {
				this.#reportFailure(
					`Failed to save equipment cantrip cache: ${formatError(error)}`,
				);
				return;
			}
		}
	}

	#reportFailure(message: string): void {
		try {
			this.#onFailure(message);
		} catch {
			// Best-effort diagnostics callback must never break shutdown or cache reads.
		}
	}
}
