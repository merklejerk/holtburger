import { FIRST_RUNTIME_SPAWN_FIXTURE } from "../runtime/runtime-spawn-fixtures";

export interface WeenieSpawnSeed {
	/** ACE weenie class id used as source identity, not runtime presentation identity. */
	readonly weenieClassId: number;
	/** Human-readable source name copied into the browser spawn form label. */
	readonly label: string;
	/** Setup model id resolved from source facts. */
	readonly setupModelId: number;
}

export interface WeenieSpawnSeedResolver {
	resolve(weenieClassId: number): WeenieSpawnSeed | null;
}

export const DEFAULT_WEENIE_SPAWN_SEEDS: readonly WeenieSpawnSeed[] = [
	{
		label: FIRST_RUNTIME_SPAWN_FIXTURE.label,
		setupModelId: FIRST_RUNTIME_SPAWN_FIXTURE.setupModelId,
		weenieClassId: FIRST_RUNTIME_SPAWN_FIXTURE.weenieClassId,
	},
];

export function createInMemoryWeenieSpawnSeedResolver(
	seeds: readonly WeenieSpawnSeed[] = DEFAULT_WEENIE_SPAWN_SEEDS,
): WeenieSpawnSeedResolver {
	const seedsByWeenieClassId = new Map<number, WeenieSpawnSeed>();
	for (const seed of seeds) {
		seedsByWeenieClassId.set(seed.weenieClassId, seed);
	}
	return {
		resolve(weenieClassId) {
			return seedsByWeenieClassId.get(weenieClassId) ?? null;
		},
	};
}
