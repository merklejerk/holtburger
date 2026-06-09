import {
	countPreparedAssetRecordsByKind,
	countPreparedAssetsByKind,
} from "./asset-cache-diagnostics";
import type { PreparedAssetCachePruneBatchPlan } from "./asset-cache-policy";
import type {
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
	scanPreparedAssets(
		options: PreparedAssetScanOptions,
	): PreparedAssetScanPage;
	subscribe(listener: PreparedAssetChangeListener): () => void;
}

export interface PreparedAssetScanOptions {
	cursorAssetId: string | null;
	limit: number;
}

export interface PreparedAssetScanEntry {
	assetId: string;
	asset: PreparedAssetRecord;
	cacheMetadata: PreparedAssetCacheMetadata | null;
}

export interface PreparedAssetScanPage {
	entries: readonly PreparedAssetScanEntry[];
	nextCursorAssetId: string | null;
	preparedCount: number;
}

export interface PreparedAssetPresentationSnapshot {
	preparedRevision: number;
	cacheMetadataRevision: number;
	preparedCounts: ReturnType<typeof countPreparedAssetsByKind>;
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
		scanPreparedAssets: (options) => this.scanPreparedAssets(options),
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

	applyPruneBatch(prunePlan: PreparedAssetCachePruneBatchPlan): void {
		let metadataChanged = false;
		for (const [assetId, metadata] of Object.entries(
			prunePlan.retainedMetadataByAssetId,
		)) {
			const previous = this.cacheMetadataByAssetId.get(assetId);
			if (
				previous?.lastPreparedAtMs === metadata.lastPreparedAtMs &&
				previous.lastRetainedAtMs === metadata.lastRetainedAtMs
			) {
				continue;
			}
			this.cacheMetadataByAssetId.set(assetId, metadata);
			metadataChanged = true;
		}

		const evictedAssets: PreparedAssetChangeDescriptor[] = [];
		for (const assetId of prunePlan.evictedAssetIds) {
			const asset = this.preparedByAssetId.get(assetId);
			if (!asset) {
				continue;
			}
			evictedAssets.push({
				assetId,
				kind: asset.payload.kind,
			});
			this.preparedByAssetId.delete(assetId);
			this.cacheMetadataByAssetId.delete(assetId);
			metadataChanged = true;
		}

		if (!metadataChanged) {
			return;
		}

		this.cacheMetadataRevision += 1;
		if (evictedAssets.length > 0) {
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

	private scanPreparedAssets(
		options: PreparedAssetScanOptions,
	): PreparedAssetScanPage {
		const limit = Math.max(1, Math.trunc(options.limit));
		const entries: PreparedAssetScanEntry[] = [];
		let foundCursor = options.cursorAssetId === null;
		let nextCursorAssetId: string | null = null;

		for (const [assetId, asset] of this.preparedByAssetId.entries()) {
			if (!foundCursor) {
				foundCursor = assetId === options.cursorAssetId;
				if (!foundCursor) {
					continue;
				}
			}

			if (entries.length >= limit) {
				nextCursorAssetId = assetId;
				break;
			}

			entries.push({
				assetId,
				asset,
				cacheMetadata: this.cacheMetadataByAssetId.get(assetId) ?? null,
			});
		}

		if (!foundCursor && options.cursorAssetId !== null) {
			return this.scanPreparedAssets({ cursorAssetId: null, limit });
		}

		return {
			entries,
			nextCursorAssetId,
			preparedCount: this.preparedByAssetId.size,
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

export function countPreparedAssetsByKindFromResolver(
	resolver: PreparedAssetResolver,
): ReturnType<typeof countPreparedAssetsByKind> {
	return countPreparedAssetRecordsByKind(resolver.values());
}
