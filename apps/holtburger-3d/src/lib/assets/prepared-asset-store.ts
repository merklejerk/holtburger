import { countPreparedAssetsByKind } from "./asset-cache-diagnostics";
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
			assetIds: readonly string[];
			preparedRevision: number;
			cacheMetadataRevision: number;
	  }
	| {
			type: "prepared-assets-evicted";
			assetIds: readonly string[];
			preparedRevision: number;
			cacheMetadataRevision: number;
	  }
	| {
			type: "cache-metadata-updated";
			cacheMetadataRevision: number;
	  };

export interface PreparedAssetResolver {
	get(assetId: string): PreparedAssetRecord | null;
	has(assetId: string): boolean;
	entries(): IterableIterator<[string, PreparedAssetRecord]>;
	values(): IterableIterator<PreparedAssetRecord>;
	keys(): IterableIterator<string>;
	getCacheMetadata(assetId: string): PreparedAssetCacheMetadata | null;
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
			assetIds: assets.map((asset) => asset.request.assetId),
			preparedRevision: this.preparedRevision,
			cacheMetadataRevision: this.cacheMetadataRevision,
		});
	}

	applyPrunePlan(prunePlan: PreparedAssetCachePrunePlan): void {
		const retainedAssetIds = new Set(prunePlan.retainedAssetIds);
		let evictedAnyAsset = false;

		for (const assetId of [...this.preparedByAssetId.keys()]) {
			if (retainedAssetIds.has(assetId)) {
				continue;
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
				assetIds: prunePlan.evictedAssetIds,
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
			preparedCounts: countPreparedAssetsByKind(
				this.createLegacySnapshot().preparedByAssetId,
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
