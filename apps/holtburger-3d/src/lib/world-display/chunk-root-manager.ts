import type { Vec3Dto } from "../host/contracts";
import type { RenderChunkTransform } from "./render-anchor";
import type { RenderChunkKey } from "./render-chunks";

export interface RenderChunkRootRecord<TRoot> {
	chunkKey: RenderChunkKey;
	chunkLandblockId: number;
	root: TRoot;
}

export interface RenderChunkRootAdapter<TRoot> {
	createRoot(transform: RenderChunkTransform): TRoot;
	updateRootPosition(root: TRoot, offset: Vec3Dto): void;
	disposeRoot(root: TRoot): void;
}

export function syncRenderChunkRootRecords<TRoot>(
	records: Map<RenderChunkKey, RenderChunkRootRecord<TRoot>>,
	transforms: readonly RenderChunkTransform[],
	adapter: RenderChunkRootAdapter<TRoot>,
): void {
	const activeChunkKeys = new Set(
		transforms.map((transform) => transform.chunkKey),
	);

	for (const [chunkKey, record] of records.entries()) {
		if (activeChunkKeys.has(chunkKey)) {
			continue;
		}

		adapter.disposeRoot(record.root);
		records.delete(chunkKey);
	}

	for (const transform of transforms) {
		const existing = records.get(transform.chunkKey);
		if (existing) {
			adapter.updateRootPosition(existing.root, transform.offset);
			continue;
		}

		const root = adapter.createRoot(transform);
		adapter.updateRootPosition(root, transform.offset);
		records.set(transform.chunkKey, {
			chunkKey: transform.chunkKey,
			chunkLandblockId: transform.chunkLandblockId,
			root,
		});
	}
}
