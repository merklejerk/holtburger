import {
	countPreparedAssetRecordsByKind,
	countPreparedAssetsByKind,
} from "./asset-cache-diagnostics";
import type { PreparedAssetCachePrunePlan } from "./asset-cache-policy";
import type {
	AssetChannelState,
	PreparedAssetCacheDiagnostics,
	PreparedAssetCacheMetadata,
	PreparedAssetRecord,
} from "./types";

export type PreparedAssetChangeEvent =
	| {
			type: "prepared-assets-updated";
			assets: readonly PreparedAssetChangeDescriptor[];
			preparedRevision: number;
			cacheMetadataRevision: number;
	  }
	| {
			type: "prepared-assets-evicted";
			assets: readonly PreparedAssetChangeDescriptor[];
			preparedRevision: number;
			cacheMetadataRevision: number;
	  }
	| {
			type: "cache-metadata-updated";
			cacheMetadataRevision: number;
	  };

export interface PreparedAssetChangeDescriptor {
	assetId: string;
	kind: PreparedAssetRecord["payload"]["kind"];
}

export interface PreparedAssetResolver {
	get(assetId: string): PreparedAssetRecord | null;
	has(assetId: string): boolean;
	entries(): IterableIterator<[string, PreparedAssetRecord]>;
	values(): IterableIterator<PreparedAssetRecord>;
	keys(): IterableIterator<string>;
	getCacheMetadata(assetId: string): PreparedAssetCacheMetadata | null;
	cacheMetadataEntries(): IterableIterator<
		[string, PreparedAssetCacheMetadata]
	>;
	getCacheDiagnostics(): PreparedAssetCacheDiagnostics | null;
	getPreparedRevision(): number;
	getCacheMetadataRevision(): number;
	getPreparedCount(): number;
	subscribe(listener: PreparedAssetChangeListener): () => void;
}

export interface PreparedAssetPresentationSnapshot {
	preparedRevision: number;
	cacheMetadataRevision: number;
	preparedCounts: ReturnType<typeof countPreparedAssetsByKind>;
	cacheDiagnostics: PreparedAssetCacheDiagnostics | null;
}

export interface PreparedAssetLegacySnapshot {
	preparedByAssetId: Record<string, PreparedAssetRecord>;
	cacheMetadataByAssetId: Record<string, PreparedAssetCacheMetadata>;
	cacheDiagnostics: PreparedAssetCacheDiagnostics | null;
}

export type PreparedAssetChangeListener = (
	event: PreparedAssetChangeEvent,
) => void;

export class PreparedAssetStore {
	private readonly preparedByAssetId = new Map<string, PreparedAssetRecord>();
	private readonly cacheMetadataByAssetId = new Map<
		string,
		PreparedAssetCacheMetadata
	>();
	private readonly listeners = new Set<PreparedAssetChangeListener>();
	private cacheDiagnostics: PreparedAssetCacheDiagnostics | null = null;
	private preparedRevision = 0;
	private cacheMetadataRevision = 0;

	readonly resolver: PreparedAssetResolver = {
		get: (assetId) => this.preparedByAssetId.get(assetId) ?? null,
		has: (assetId) => this.preparedByAssetId.has(assetId),
		entries: () => this.preparedByAssetId.entries(),
		values: () => this.preparedByAssetId.values(),
		keys: () => this.preparedByAssetId.keys(),
		getCacheMetadata: (assetId) =>
			this.cacheMetadataByAssetId.get(assetId) ?? null,
		cacheMetadataEntries: () => this.cacheMetadataByAssetId.entries(),
		getCacheDiagnostics: () => this.cacheDiagnostics,
		getPreparedRevision: () => this.preparedRevision,
		getCacheMetadataRevision: () => this.cacheMetadataRevision,
		getPreparedCount: () => this.preparedByAssetId.size,
		subscribe: (listener) => this.subscribe(listener),
	};

	applyPreparedAssets(
		assets: readonly PreparedAssetRecord[],
		nowMs = Date.now(),
	): void {
		if (assets.length === 0) {
			return;
		}

		for (const asset of assets) {
			this.preparedByAssetId.set(asset.request.assetId, asset);
			this.cacheMetadataByAssetId.set(asset.request.assetId, {
				lastPreparedAtMs: nowMs,
				lastRetainedAtMs: nowMs,
			});
		}

		this.preparedRevision += 1;
		this.cacheMetadataRevision += 1;
		this.emit({
			type: "prepared-assets-updated",
			assets: assets.map((asset) => ({
				assetId: asset.request.assetId,
				kind: asset.payload.kind,
			})),
			preparedRevision: this.preparedRevision,
			cacheMetadataRevision: this.cacheMetadataRevision,
		});
	}

	applyPrunePlan(prunePlan: PreparedAssetCachePrunePlan): void {
		const retainedAssetIds = new Set(prunePlan.retainedAssetIds);
		let evictedAnyAsset = false;
		const evictedAssets: PreparedAssetChangeDescriptor[] = [];

		for (const assetId of [...this.preparedByAssetId.keys()]) {
			if (retainedAssetIds.has(assetId)) {
				continue;
			}
			const asset = this.preparedByAssetId.get(assetId);
			if (asset) {
				evictedAssets.push({
					assetId,
					kind: asset.payload.kind,
				});
			}
			this.preparedByAssetId.delete(assetId);
			evictedAnyAsset = true;
		}

		this.cacheMetadataByAssetId.clear();
		for (const [assetId, metadata] of Object.entries(
			prunePlan.cacheMetadataByAssetId,
		)) {
			this.cacheMetadataByAssetId.set(assetId, metadata);
		}
		this.cacheDiagnostics = prunePlan.diagnostics;
		this.cacheMetadataRevision += 1;

		if (evictedAnyAsset) {
			this.preparedRevision += 1;
			this.emit({
				type: "prepared-assets-evicted",
				assets: evictedAssets,
				preparedRevision: this.preparedRevision,
				cacheMetadataRevision: this.cacheMetadataRevision,
			});
			return;
		}

		this.emit({
			type: "cache-metadata-updated",
			cacheMetadataRevision: this.cacheMetadataRevision,
		});
	}

	createPresentationSnapshot(): PreparedAssetPresentationSnapshot {
		return {
			preparedRevision: this.preparedRevision,
			cacheMetadataRevision: this.cacheMetadataRevision,
			preparedCounts: countPreparedAssetRecordsByKind(
				this.preparedByAssetId.values(),
			),
			cacheDiagnostics: this.cacheDiagnostics,
		};
	}

	createLegacySnapshot(): PreparedAssetLegacySnapshot {
		return {
			preparedByAssetId: Object.fromEntries(this.preparedByAssetId),
			cacheMetadataByAssetId: Object.fromEntries(this.cacheMetadataByAssetId),
			cacheDiagnostics: this.cacheDiagnostics,
		};
	}

	createLegacyAssetStateSnapshot(
		baseState: AssetChannelState,
	): AssetChannelState {
		const legacySnapshot = this.createLegacySnapshot();
		return {
			...baseState,
			preparedByAssetId: legacySnapshot.preparedByAssetId,
			cacheMetadataByAssetId: legacySnapshot.cacheMetadataByAssetId,
			cacheDiagnostics: legacySnapshot.cacheDiagnostics,
		};
	}

	private subscribe(listener: PreparedAssetChangeListener): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	private emit(event: PreparedAssetChangeEvent): void {
		for (const listener of this.listeners) {
			listener(event);
		}
	}
}

export function createPreparedAssetLegacySnapshotFromResolver(
	resolver: PreparedAssetResolver,
): PreparedAssetLegacySnapshot {
	return {
		preparedByAssetId: Object.fromEntries(resolver.entries()),
		cacheMetadataByAssetId: Object.fromEntries(resolver.cacheMetadataEntries()),
		cacheDiagnostics: resolver.getCacheDiagnostics(),
	};
}

export function createAssetChannelStateSnapshotFromResolver(
	baseState: AssetChannelState,
	resolver: PreparedAssetResolver,
): AssetChannelState {
	const legacySnapshot = createPreparedAssetLegacySnapshotFromResolver(resolver);
	return {
		...baseState,
		preparedByAssetId: legacySnapshot.preparedByAssetId,
		cacheMetadataByAssetId: legacySnapshot.cacheMetadataByAssetId,
		cacheDiagnostics: legacySnapshot.cacheDiagnostics,
	};
}

export function createPreparedAssetResolverFromRecordSnapshot(options: {
	preparedByAssetId: Readonly<Record<string, PreparedAssetRecord>>;
	cacheMetadataByAssetId?: Readonly<
		Record<string, PreparedAssetCacheMetadata>
	>;
	cacheDiagnostics?: PreparedAssetCacheDiagnostics | null;
	preparedRevision?: number;
	cacheMetadataRevision?: number;
}): PreparedAssetResolver {
	const preparedByAssetId = options.preparedByAssetId;
	const cacheMetadataByAssetId = options.cacheMetadataByAssetId ?? {};
	const cacheDiagnostics = options.cacheDiagnostics ?? null;
	const preparedRevision = options.preparedRevision ?? 0;
	const cacheMetadataRevision = options.cacheMetadataRevision ?? 0;
	return {
		get: (assetId) => preparedByAssetId[assetId] ?? null,
		has: (assetId) => preparedByAssetId[assetId] !== undefined,
		entries: function* () {
			yield* Object.entries(preparedByAssetId);
		},
		values: function* () {
			yield* Object.values(preparedByAssetId);
		},
		keys: function* () {
			yield* Object.keys(preparedByAssetId);
		},
		getCacheMetadata: (assetId) => cacheMetadataByAssetId[assetId] ?? null,
		cacheMetadataEntries: function* () {
			yield* Object.entries(cacheMetadataByAssetId);
		},
		getCacheDiagnostics: () => cacheDiagnostics,
		getPreparedRevision: () => preparedRevision,
		getCacheMetadataRevision: () => cacheMetadataRevision,
		getPreparedCount: () => Object.keys(preparedByAssetId).length,
		subscribe: () => () => {},
	};
}

export function countPreparedAssetsByKindFromResolver(
	resolver: PreparedAssetResolver,
): ReturnType<typeof countPreparedAssetsByKind> {
	return countPreparedAssetRecordsByKind(resolver.values());
}
