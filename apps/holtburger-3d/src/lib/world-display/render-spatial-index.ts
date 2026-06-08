import type { RenderSpatialItemId } from "./render-spatial-ids";
import type { PortalOverlayTargetStatus } from "./debug-overlays";
import type { RenderChunkTransform } from "./render-anchor";
import type { RenderChunkKey } from "./render-chunks";
import { pickRenderShape, type RenderPickShape } from "./render-picking-math";
import {
	addRenderVec3,
	distanceBetweenRenderVec3,
	intersectRayRenderBounds,
	renderBoundsIntersectsFrustum,
	subtractRenderVec3,
	translateRenderBounds,
	type RenderBounds,
	type RenderFrustum,
	type RenderRay,
	type RenderVec3,
} from "./render-spatial-math";

const MIN_PICK_DISTANCE = 1e-4;

export type {
	RenderBounds,
	RenderVec3,
} from "./render-spatial-math";

export type RenderSpatialItemKind =
	| "terrain"
	| "structured-cell"
	| "portal"
	| "outdoor-static"
	| "building"
	| "indoor-static";

export type RenderSpatialMetadata =
	| {
			kind: "terrain";
			landblockId: number;
			assetId: string;
			terrainQuad: {
				row: number;
				col: number;
				quadIndex: number;
				triangleIndices: [number, number];
			} | null;
	  }
	| {
			kind: "structured-cell";
			envCellId: number;
			renderKey: string;
			isFocus: boolean;
	  }
	| {
			kind: "portal";
			portalId: string;
			sourceEnvCellId: number;
			targetEnvCellId: number | null;
			targetStatus: PortalOverlayTargetStatus;
			polygonId: number;
			otherPortalId: number;
			flags: number;
	  }
	| {
			kind: "static-renderable";
			renderKey: string;
			instanceId: string;
			staticKind:
				| "indoor-static"
				| "scenery"
				| "building"
				| "generated-scenery";
			renderDomain: string;
			owningLandblockId: number;
			owningEnvCellId: number | null;
			sourceAssetId: string;
			gfxObjAssetId: string;
			gfxObjId: number;
			partIndex: number;
			materialSignature: string;
			materialSlotCount: number;
			detailRoleKind: string;
			detailSignature: string;
			textureVelocitySignature: string;
			artifactCoverage?: {
				sourcePartHintCount: number;
				sourcePartIndices: readonly number[];
				sourceMaterialSlotCount: number;
				emittedDirectEntryCount: number;
				emittedCompactedBatchCount: number;
				emittedGeometryEntryCount: number;
				emittedDirectTriangleCount: number;
				emittedCompactedBatchTriangleCount: number;
				emittedZeroTriangleEntryCount: number;
				zeroTriangleMaterialRecordKeys: readonly string[];
				materialRecordKeys: readonly string[];
				materialFamilyKeys: readonly string[];
			};
	  };

export interface RenderSpatialItem {
	id: RenderSpatialItemId;
	kind: RenderSpatialItemKind;
	ownerKey: string;
	chunkKey: RenderChunkKey;
	broadphaseBounds: RenderBounds;
	pickShape?: RenderPickShape;
	metadata: RenderSpatialMetadata;
}

export interface RenderSpatialPick {
	item: RenderSpatialItem;
	distance: number;
	point: RenderVec3;
}

interface RenderSpatialIndexSink {
	clearOwner(ownerKey: string): void;
	replaceOwnerItems(ownerKey: string, items: RenderSpatialItem[]): void;
	upsertItem(item: RenderSpatialItem): void;
	removeItem(itemId: RenderSpatialItemId): void;
}

interface RenderSpatialChunkSink {
	replaceChunkTransforms(transforms: RenderChunkTransform[]): void;
	removeChunkTransform(chunkKey: RenderChunkKey): void;
}

export interface RenderSpatialIndexQuery {
	hasItem(itemId: RenderSpatialItemId): boolean;
	pickRay(
		ray: RenderRay,
		mask: ReadonlySet<RenderSpatialItemKind>,
		ownerKeys?: ReadonlySet<string>,
		acceptItem?: (item: RenderSpatialItem) => boolean,
	): RenderSpatialPick | null;
	queryFrustum(
		frustum: RenderFrustum,
		mask: ReadonlySet<RenderSpatialItemKind>,
	): RenderSpatialItem[];
}

export interface RenderSpatialIndex
	extends
		RenderSpatialIndexSink,
		RenderSpatialChunkSink,
		RenderSpatialIndexQuery {}

export function createLinearRenderSpatialIndex(): RenderSpatialIndex {
	const itemsById = new Map<RenderSpatialItemId, RenderSpatialItem>();
	const itemIdsByOwner = new Map<string, Set<RenderSpatialItemId>>();
	const chunkTransformsByKey = new Map<RenderChunkKey, RenderChunkTransform>();

	function removeItemFromOwner(item: RenderSpatialItem): void {
		const ownerItemIds = itemIdsByOwner.get(item.ownerKey);
		if (!ownerItemIds) {
			return;
		}
		ownerItemIds.delete(item.id);
		if (ownerItemIds.size === 0) {
			itemIdsByOwner.delete(item.ownerKey);
		}
	}

	return {
		clearOwner(ownerKey) {
			const ownerItemIds = itemIdsByOwner.get(ownerKey);
			if (ownerItemIds) {
				for (const itemId of ownerItemIds) {
					itemsById.delete(itemId);
				}
				itemIdsByOwner.delete(ownerKey);
			}
		},
		replaceOwnerItems(ownerKey, items) {
			const nextItemIds = new Set(items.map((item) => item.id));
			const ownerItemIds = itemIdsByOwner.get(ownerKey);
			if (ownerItemIds) {
				for (const itemId of ownerItemIds) {
					if (!nextItemIds.has(itemId)) {
						itemsById.delete(itemId);
					}
				}
			}

			itemIdsByOwner.set(ownerKey, nextItemIds);
			for (const item of items) {
				const previousItem = itemsById.get(item.id);
				if (previousItem && previousItem.ownerKey !== ownerKey) {
					removeItemFromOwner(previousItem);
				}
				itemsById.set(item.id, item);
			}

			if (nextItemIds.size === 0) {
				itemIdsByOwner.delete(ownerKey);
			}
		},
		upsertItem(item) {
			const previousItem = itemsById.get(item.id);
			if (previousItem) {
				removeItemFromOwner(previousItem);
			}
			itemsById.set(item.id, item);
			const ownerItemIds = itemIdsByOwner.get(item.ownerKey) ?? new Set();
			ownerItemIds.add(item.id);
			itemIdsByOwner.set(item.ownerKey, ownerItemIds);
		},
		removeItem(itemId) {
			const item = itemsById.get(itemId);
			if (!item) {
				return;
			}
			itemsById.delete(itemId);
			removeItemFromOwner(item);
		},
		replaceChunkTransforms(transforms) {
			chunkTransformsByKey.clear();
			for (const transform of transforms) {
				chunkTransformsByKey.set(transform.chunkKey, transform);
			}
		},
		removeChunkTransform(chunkKey) {
			chunkTransformsByKey.delete(chunkKey);
		},
		hasItem(itemId) {
			return itemsById.has(itemId);
		},
		pickRay(ray, mask, ownerKeys, acceptItem) {
			let nearestPick: RenderSpatialPick | null = null;
			for (const item of itemsById.values()) {
				if (!mask.has(item.kind)) {
					continue;
				}
				if (ownerKeys && !ownerKeys.has(item.ownerKey)) {
					continue;
				}
				if (acceptItem && !acceptItem(item)) {
					continue;
				}
				const transform = resolveItemChunkTransform(item, chunkTransformsByKey);
				const queryRay = rendererRayToChunkLocal(ray, transform.offset);
				const broadphaseDistance = intersectRayRenderBounds(
					queryRay,
					item.broadphaseBounds,
				);
				if (broadphaseDistance === null) {
					continue;
				}

				const precisePick = pickRenderShape(
					queryRay,
					item.pickShape,
					item.broadphaseBounds,
				);
				if (!precisePick) {
					continue;
				}
				const renderPoint = chunkLocalPointToRendererLocal(
					precisePick.point,
					transform.offset,
				);
				const renderDistance = distanceBetweenRenderVec3(
					ray.origin,
					renderPoint,
				);
				if (renderDistance <= MIN_PICK_DISTANCE) {
					continue;
				}
				if (!nearestPick || renderDistance < nearestPick.distance) {
					nearestPick = {
						item,
						distance: renderDistance,
						point: renderPoint,
					};
				}
			}
			return nearestPick;
		},
		queryFrustum(frustum, mask) {
			return [...itemsById.values()].filter((item) => {
				if (!mask.has(item.kind)) {
					return false;
				}
				const transform = resolveItemChunkTransform(item, chunkTransformsByKey);
				return renderBoundsIntersectsFrustum(
					translateRenderBounds(item.broadphaseBounds, transform.offset),
					frustum,
				);
			});
		},
	};
}

function resolveItemChunkTransform(
	item: RenderSpatialItem,
	chunkTransformsByKey: ReadonlyMap<RenderChunkKey, RenderChunkTransform>,
): RenderChunkTransform {
	const transform = chunkTransformsByKey.get(item.chunkKey);
	if (!transform) {
		throw new Error(
			`Render spatial item ${item.id} references missing chunk transform ${item.chunkKey}.`,
		);
	}
	return transform;
}

function rendererRayToChunkLocal(
	ray: RenderRay,
	offset: RenderVec3,
): RenderRay {
	return {
		origin: subtractRenderVec3(ray.origin, offset),
		direction: ray.direction,
	};
}

function chunkLocalPointToRendererLocal(
	point: RenderVec3,
	offset: RenderVec3,
): RenderVec3 {
	return addRenderVec3(point, offset);
}
