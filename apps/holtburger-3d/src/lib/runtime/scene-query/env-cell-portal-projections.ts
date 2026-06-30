import type {
	StaticPortalApertureResource,
	StaticPortalGraphRecord,
	StaticPortalInteriorRecord,
	StaticPortalProjectionRecord,
} from "../../static/contracts";
import {
	createEnvCellPortalProjectionRoot,
	createStaticPortalProjection,
	createStaticPortalProjectionSourceKey,
} from "../../static/portal-graphs";
import type { CachedEnvCellPortalProjection } from "./static-query-state";

/** Cache for portal projections keyed by landblock and start env-cell root. */
export class EnvCellPortalProjectionCache {
	readonly #cacheByRootKey = new Map<string, CachedEnvCellPortalProjection>();

	clear(): void {
		this.#cacheByRootKey.clear();
	}

	invalidate(landblockIds: ReadonlySet<number>): void {
		for (const cacheKey of this.#cacheByRootKey.keys()) {
			const landblockId =
				parseEnvCellPortalProjectionCacheKeyLandblockId(cacheKey);
			if (landblockId !== null && landblockIds.has(landblockId)) {
				this.#cacheByRootKey.delete(cacheKey);
			}
		}
	}

	invalidateLandblock(landblockId: number): void {
		this.invalidate(new Set([landblockId >>> 0]));
	}

	query(options: {
		readonly landblockId: number;
		readonly portalApertureResources: readonly StaticPortalApertureResource[];
		readonly portalGraphs: readonly StaticPortalGraphRecord[];
		readonly portalInteriorRecords: readonly StaticPortalInteriorRecord[];
		readonly startEnvCellId: number;
	}): StaticPortalProjectionRecord | null {
		const landblockId = options.landblockId >>> 0;
		const startEnvCellId = options.startEnvCellId >>> 0;
		const root = createEnvCellPortalProjectionRoot({
			envCellId: startEnvCellId,
			landblockId,
		});
		const sourceKey = createStaticPortalProjectionSourceKey({
			landblockId,
			portalApertureResources: options.portalApertureResources,
			portalGraphs: options.portalGraphs,
			portalInteriorRecords: options.portalInteriorRecords,
			root,
		});
		const cacheKey = createEnvCellPortalProjectionCacheKey({
			landblockId,
			startEnvCellId,
		});
		const cached = this.#cacheByRootKey.get(cacheKey);
		if (cached?.sourceKey === sourceKey) {
			return cached.projection;
		}
		const projection = createStaticPortalProjection({
			landblockId,
			portalApertureResources: options.portalApertureResources,
			portalGraphs: options.portalGraphs,
			portalInteriorRecords: options.portalInteriorRecords,
			root,
		});
		this.#cacheByRootKey.set(cacheKey, {
			projection,
			sourceKey,
		});
		return projection;
	}
}

function createEnvCellPortalProjectionCacheKey(options: {
	readonly landblockId: number;
	readonly startEnvCellId: number;
}): string {
	return `${options.landblockId >>> 0}:${options.startEnvCellId >>> 0}`;
}

function parseEnvCellPortalProjectionCacheKeyLandblockId(
	cacheKey: string,
): number | null {
	const [landblockIdPart] = cacheKey.split(":", 1);
	if (!landblockIdPart) {
		return null;
	}
	const landblockId = Number(landblockIdPart);
	return Number.isFinite(landblockId) ? landblockId >>> 0 : null;
}
