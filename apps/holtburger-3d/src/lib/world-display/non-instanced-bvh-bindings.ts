import { formatHex32 } from "../landblocks";
import type { PortalDebugOverlay, CellDebugOverlay } from "./debug-overlays";
import {
	envPortalBvhItemKey,
	envRenderGeometryBvhItemKey,
	terrainBvhItemKey,
	type RenderBvhItemKey,
} from "./prepared-bvh-visibility";
import type { StructuredInteriorCell } from "./structured-interior-scene";
import type { TerrainSceneTile } from "./terrain-scene";
import type { TransitionPortalCandidate } from "./transition-portal-work-items";

export interface NonInstancedBatchBvhBinding {
	batchId: string;
	itemKeys: readonly RenderBvhItemKey[];
	fallbackReason: string | null;
}

export function terrainTileBatchId(assetId: string): string {
	return `terrain:${assetId}`;
}

export function structuredInteriorCellBatchId(renderKey: string): string {
	return `structured-interior:${renderKey}`;
}

export function debugCellOverlayBatchId(renderKey: string): string {
	return `debug-cell:${renderKey}`;
}

export function debugPortalOverlayBatchId(
	sourceEnvCellId: number,
	portalId: string,
): string {
	return `debug-portal:${formatHex32(sourceEnvCellId)}:${portalId}`;
}

export function transitionPortalMaskBatchId(candidateId: string): string {
	return `transition-portal-mask:${candidateId}`;
}

export function deriveTerrainTileBatchBvhBinding(
	tile: TerrainSceneTile,
): NonInstancedBatchBvhBinding {
	const itemKeys = new Set(
		tile.mesh.quads.map((quad) =>
			terrainBvhItemKey(tile.landblockId, quad.quadIndex),
		),
	);
	return {
		batchId: terrainTileBatchId(tile.assetId),
		itemKeys: [...itemKeys],
		fallbackReason:
			itemKeys.size === 0
				? `terrain batch ${tile.assetId} contains no terrain quad keys`
				: null,
	};
}

export function deriveStructuredInteriorCellBatchBvhBinding(
	cell: StructuredInteriorCell,
): NonInstancedBatchBvhBinding {
	return {
		batchId: structuredInteriorCellBatchId(cell.renderKey),
		itemKeys: [envRenderGeometryBvhItemKey(cell.envCellId)],
		fallbackReason: null,
	};
}

export function deriveDebugCellOverlayBatchBvhBinding(
	cell: CellDebugOverlay,
): NonInstancedBatchBvhBinding {
	return {
		batchId: debugCellOverlayBatchId(cell.renderKey),
		itemKeys: [envRenderGeometryBvhItemKey(cell.envCellId)],
		fallbackReason: null,
	};
}

export function deriveDebugPortalOverlayBatchBvhBinding(
	portal: PortalDebugOverlay,
): NonInstancedBatchBvhBinding {
	return {
		batchId: debugPortalOverlayBatchId(portal.sourceEnvCellId, portal.portalId),
		itemKeys: [envPortalBvhItemKey(portal.sourceEnvCellId, portal.portalId)],
		fallbackReason: null,
	};
}

export function deriveTransitionPortalMaskBatchBvhBinding(
	candidate: TransitionPortalCandidate,
): NonInstancedBatchBvhBinding {
	return {
		batchId: transitionPortalMaskBatchId(candidate.id),
		itemKeys: [
			envPortalBvhItemKey(
				candidate.aperture.source.envCellId,
				candidate.aperture.id,
			),
		],
		fallbackReason: null,
	};
}
