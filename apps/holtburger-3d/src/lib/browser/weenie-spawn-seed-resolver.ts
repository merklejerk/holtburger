import { FIRST_RUNTIME_SPAWN_FIXTURE } from "../runtime/runtime-spawn-fixtures";
import type { WeenieLookupCapabilityDto, WeenieSpawnSeedDto } from "../host/contracts";
import {
	getWeenieLookupCapability,
	resolveWeenieSpawnSeed,
} from "../host/tauri";

export interface WeenieSpawnSeed {
	/** ACE weenie class id used as source identity, not runtime presentation identity. */
	readonly weenieClassId: number;
	/** Human-readable source name copied into the browser spawn form label. */
	readonly label: string;
	/** Setup model id resolved from source facts. */
	readonly setupModelId: number;
	/** ACE catalog/source class name, when known. */
	readonly className?: string;
	/** ACE weenie type, when known. */
	readonly weenieType?: number;
	/** Optional default source scale from ACE `PropertyFloat.DefaultScale`. */
	readonly defaultScale?: number;
	/** Optional shade source fact retained for later appearance composition. */
	readonly shade?: number;
	/** Optional direct ObjDesc-style appearance rows resolved from ACE world data. */
	readonly appearance?: WeenieSpawnSeedDto["appearance"];
	/** Additional visual source facts that Phase 12E preserves but may not consume yet. */
	readonly sourceDids?: WeenieSpawnSeedDto["sourceDids"];
	/** Additional source int facts that Phase 12E preserves but may not consume yet. */
	readonly sourceInts?: WeenieSpawnSeedDto["sourceInts"];
}

export interface WeenieSpawnSeedResolver {
	resolve(weenieClassId: number): Promise<WeenieSpawnSeed | null>;
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
		async resolve(weenieClassId) {
			return seedsByWeenieClassId.get(weenieClassId) ?? null;
		},
	};
}

export interface TauriWeenieSpawnSeedResolverOptions {
	readonly fallback?: WeenieSpawnSeedResolver;
}

export interface TauriWeenieSpawnSeedResolver extends WeenieSpawnSeedResolver {
	capability(): Promise<WeenieLookupCapabilityDto>;
}

export function createTauriWeenieSpawnSeedResolver(
	options: TauriWeenieSpawnSeedResolverOptions = {},
): TauriWeenieSpawnSeedResolver {
	const fallback = options.fallback ?? createInMemoryWeenieSpawnSeedResolver();
	return {
		async capability() {
			try {
				return await getWeenieLookupCapability();
			} catch (error) {
				return {
					available: false,
					reason: error instanceof Error ? error.message : String(error),
				};
			}
		},
		async resolve(weenieClassId) {
			const capability = await this.capability();
			if (!capability.available) {
				return fallback.resolve(weenieClassId);
			}
			try {
				const seed = await resolveWeenieSpawnSeed({ weenieClassId });
				return seed === null ? null : convertTauriWeenieSpawnSeed(seed);
			} catch (error) {
				console.warn(
					`[holtburger-3d][weenie-resolver] failed to resolve WCID ${weenieClassId}:`,
					error,
				);
				return null;
			}
		},
	};
}

function convertTauriWeenieSpawnSeed(seed: WeenieSpawnSeedDto): WeenieSpawnSeed {
	return {
		appearance: hasAppearanceFacts(seed.appearance) ? seed.appearance : undefined,
		className: seed.className,
		defaultScale: seed.defaultScale ?? undefined,
		label: seed.label,
		setupModelId: seed.sourceDids.setupModelId,
		shade: seed.shade ?? undefined,
		sourceDids: seed.sourceDids,
		sourceInts: seed.sourceInts,
		weenieClassId: seed.weenieClassId,
		weenieType: seed.weenieType,
	};
}

function hasAppearanceFacts(appearance: WeenieSpawnSeedDto["appearance"]): boolean {
	return (
		appearance.paletteId !== null ||
		appearance.subPalettes.length > 0 ||
		appearance.textureChanges.length > 0 ||
		appearance.animPartChanges.length > 0
	);
}
