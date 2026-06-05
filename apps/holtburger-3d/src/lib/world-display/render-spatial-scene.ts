import type { AssetChannelState } from "../assets/types";
import type { Vec3Dto } from "../host/contracts";
import { formatHex32 } from "../landblocks";
import type {
	PortalDebugOverlay,
	WorldDebugOverlayModel,
} from "./debug-overlays";
import type {
	RenderBounds,
	RenderSpatialItem,
	RenderVec3,
} from "./render-spatial-index";
import {
	debugCellSpatialItemId,
	portalSpatialItemId,
	staticRenderablePartSpatialItemId,
	structuredCellSpatialItemId,
	terrainSpatialItemId,
} from "./render-spatial-ids";
import {
	buildAcPlacementMatrix,
	transformPointByMat4,
	type RenderMat4,
} from "./render-math";
import {
	renderBoundsFromPoints,
	transformRenderBounds,
} from "./render-spatial-math";
import { buildStaticRenderablePartMatrix } from "./staged-world-assembly";
import {
	isPreparedGfxObjAsset,
	type StaticRenderablePart,
	type StaticRenderableSceneModel,
} from "./static-renderables";
import type {
	StructuredInteriorCell,
	StructuredInteriorSceneModel,
} from "./structured-interior-scene";
import type { TerrainSceneModel, TerrainSceneTile } from "./terrain-scene";
import {
	deriveLandblockRenderChunkPlacement,
	type RenderChunkKey,
} from "./render-chunks";
import {
	getDetailedLandblockRenderArtifacts,
	getStaticObjectBundleArtifacts,
	type DetailedLandblockRenderArtifacts,
} from "./landblock-render-product";
import {
	formatRenderDomainKey,
	WORLD_RENDER_DOMAIN,
} from "./render-domains";
import type { StaticLandblockRenderProductSet } from "./static-landblock-render-artifact-store";
import type {
	StaticBundleSpatialHint,
	StaticObjectBundleArtifact,
} from "./static-bundle-layer";

export const TERRAIN_SPATIAL_OWNER_KEY = "terrain-scene";
export const STRUCTURED_INTERIOR_SPATIAL_OWNER_KEY =
	"structured-interior-scene";
export const DEBUG_OVERLAY_SPATIAL_OWNER_KEY = "debug-overlay-scene";
export const STATIC_RENDERABLE_SPATIAL_OWNER_KEY = "static-renderable-scene";

const PORTAL_PICK_THICKNESS = 0.35;
const CELL_MARKER_PICK_RADIUS = 2.5;

export function deriveTerrainSpatialItems(
	terrainScene: TerrainSceneModel,
): RenderSpatialItem[] {
	return terrainScene.tiles.map(deriveTerrainSpatialItem);
}

export function deriveStructuredInteriorSpatialItems(
	structuredInteriorScene: StructuredInteriorSceneModel,
): RenderSpatialItem[] {
	return structuredInteriorScene.cells.map(deriveStructuredInteriorSpatialItem);
}

export function deriveStructuredInteriorSpatialItemsFromLandblockArtifacts(
	artifacts: StaticLandblockRenderProductSet,
): RenderSpatialItem[] | null {
	const detailedArtifacts = artifacts.artifacts
		.map(getDetailedLandblockRenderArtifacts)
		.filter((artifact): artifact is DetailedLandblockRenderArtifacts =>
			Boolean(artifact),
		);
	if (detailedArtifacts.length === 0) {
		return null;
	}
	const selectedEnvCellIds = new Set(
		detailedArtifacts.flatMap((artifact) => artifact.selectedEnvCellIds),
	);
	return detailedArtifacts
		.flatMap((artifact) => artifact.structuredInteriorCells)
		.filter((cell) => selectedEnvCellIds.has(cell.envCellId))
		.map((cell) =>
			deriveDetailedStructuredInteriorSpatialItem(cell, selectedEnvCellIds),
		)
		.sort((left, right) => left.id.localeCompare(right.id));
}

export function deriveStaticRenderableSpatialItems(
	assetState: AssetChannelState,
	staticRenderableScene: StaticRenderableSceneModel,
): RenderSpatialItem[] {
	return staticRenderableScene.parts.flatMap((part) =>
		deriveStaticRenderablePartSpatialItem(assetState, part),
	);
}

export function deriveStaticRenderableSpatialItemsFromLandblockArtifacts(
	artifacts: StaticLandblockRenderProductSet,
): RenderSpatialItem[] | null {
	const bundleArtifacts = artifacts.artifacts.flatMap((result) =>
		getStaticObjectBundleArtifacts(result),
	);
	if (bundleArtifacts.length === 0) {
		return null;
	}
	const items = bundleArtifacts.flatMap((bundle) =>
		deriveStaticBundleSpatialItems(bundle),
	);
	return items.length > 0
		? items.sort((left, right) => left.id.localeCompare(right.id))
		: null;
}

export function deriveDebugOverlaySpatialItems(
	debugOverlayScene: WorldDebugOverlayModel,
): RenderSpatialItem[] {
	return [
		...(debugOverlayScene.showCellIndicators
			? debugOverlayScene.cells.flatMap(deriveCellDebugOverlaySpatialItem)
			: []),
		...(debugOverlayScene.showPortalPolygons
			? debugOverlayScene.portals.flatMap(derivePortalSpatialItem)
			: []),
	];
}

function deriveTerrainSpatialItem(tile: TerrainSceneTile): RenderSpatialItem {
	const bounds = deriveTerrainTileBounds(tile);
	const placement = deriveLandblockRenderChunkPlacement(tile.landblockId);
	return {
		id: terrainSpatialItemId(tile.assetId),
		kind: "terrain",
		ownerKey: TERRAIN_SPATIAL_OWNER_KEY,
		chunkKey: placement.chunkKey,
		broadphaseBounds: bounds,
		pickShape: { kind: "box", bounds },
		metadata: {
			kind: "terrain",
			landblockId: tile.landblockId,
			assetId: tile.assetId,
			terrainQuad: null,
		},
	};
}

function deriveStructuredInteriorSpatialItem(
	cell: StructuredInteriorCell,
): RenderSpatialItem {
	const transform = buildAcPlacementMatrix(
		cell.chunkLocalPlacement,
		{ x: 0, y: 0, z: 0 },
		{ x: 1, y: 1, z: 1 },
	);
	const center = transformPoint({ x: 0, y: 0, z: 0 }, transform);
	const bounds = cell.renderGeometry.bounds
		? transformBounds(cell.renderGeometry.bounds, transform)
		: expandPointBounds(center, CELL_MARKER_PICK_RADIUS);

	return {
		id: structuredCellSpatialItemId(cell.renderKey),
		kind: "structured-cell",
		ownerKey: STRUCTURED_INTERIOR_SPATIAL_OWNER_KEY,
		chunkKey: cell.renderChunk.chunkKey,
		broadphaseBounds: bounds,
		pickShape: cell.renderGeometry.bounds
			? { kind: "box", bounds }
			: { kind: "sphere", center, radius: CELL_MARKER_PICK_RADIUS },
		metadata: {
			kind: "structured-cell",
			envCellId: cell.envCellId,
			renderKey: cell.renderKey,
			isFocus: cell.isFocus,
		},
	};
}

function deriveDetailedStructuredInteriorSpatialItem(
	cell: DetailedLandblockRenderArtifacts["structuredInteriorCells"][number],
	selectedEnvCellIds: ReadonlySet<number>,
): RenderSpatialItem {
	const transform = buildAcPlacementMatrix(
		cell.localPlacement,
		{ x: 0, y: 0, z: 0 },
		{ x: 1, y: 1, z: 1 },
	);
	const center = transformPoint({ x: 0, y: 0, z: 0 }, transform);
	const bounds = cell.renderGeometry.bounds
		? transformBounds(cell.renderGeometry.bounds, transform)
		: expandPointBounds(center, CELL_MARKER_PICK_RADIUS);
	const renderKey = formatRenderDomainKey(
		WORLD_RENDER_DOMAIN.interiorCellShell,
		`env-cell/${formatHex32(cell.envCellId)}`,
	);
	return {
		id: structuredCellSpatialItemId(renderKey),
		kind: "structured-cell",
		ownerKey: STRUCTURED_INTERIOR_SPATIAL_OWNER_KEY,
		chunkKey: cell.renderChunk.chunkKey,
		broadphaseBounds: bounds,
		pickShape: cell.renderGeometry.bounds
			? { kind: "box", bounds }
			: { kind: "sphere", center, radius: CELL_MARKER_PICK_RADIUS },
		metadata: {
			kind: "structured-cell",
			envCellId: cell.envCellId,
			renderKey,
			isFocus: selectedEnvCellIds.has(cell.envCellId),
		},
	};
}

function deriveStaticRenderablePartSpatialItem(
	assetState: AssetChannelState,
	part: StaticRenderablePart,
): RenderSpatialItem[] {
	const asset = assetState.preparedByAssetId[part.gfxObjAssetId];
	if (!isPreparedGfxObjAsset(asset) || !asset.payload.renderGeometry.bounds) {
		return [];
	}
	const bounds = transformBoundsByRenderMat4(
		asset.payload.renderGeometry.bounds,
		buildStaticRenderablePartMatrix(part),
	);

	return [
		{
			id: staticRenderablePartSpatialItemId(part.renderKey),
			kind: staticRenderablePartSpatialKind(part),
			ownerKey: STATIC_RENDERABLE_SPATIAL_OWNER_KEY,
			chunkKey: part.renderChunk.chunkKey,
			broadphaseBounds: bounds,
			pickShape: { kind: "box", bounds },
			metadata: {
				kind: "static-renderable",
				renderKey: part.renderKey,
				instanceId: part.instanceId,
				staticKind: part.kind,
				renderDomain: part.renderDomain,
				owningLandblockId: part.owningLandblockId,
				owningEnvCellId: part.owningEnvCellId,
				sourceAssetId: part.sourceAssetId,
				gfxObjAssetId: part.gfxObjAssetId,
				gfxObjId: part.gfxObjId,
				partIndex: part.partIndex,
				materialSignature: part.materialSignature,
				materialSlotCount: part.materialSlots.length,
				detailRoleKind: part.detailRoleKind,
				detailSignature: part.detailSignature,
				textureVelocitySignature: part.textureVelocitySignature,
			},
		},
	];
}

function deriveStaticBundleSpatialItems(
	bundle: StaticObjectBundleArtifact,
): RenderSpatialItem[] {
	const objectRecordByVisibilityKey = new Map(
		bundle.objectRecords.flatMap((record) =>
			record.visibilityKeys.map((visibilityKey) => [visibilityKey, record] as const),
		),
	);
	const renderChunk = deriveLandblockRenderChunkPlacement(bundle.landblockId);
	return (bundle.spatialHints ?? []).flatMap((hint) => {
		const objectRecord = hint.visibilityKeys
			.map((visibilityKey) => objectRecordByVisibilityKey.get(visibilityKey))
			.find((record): record is NonNullable<typeof record> => Boolean(record));
		if (!objectRecord) {
			return [];
		}
		return [deriveStaticBundleSpatialItem(bundle, hint, objectRecord, renderChunk.chunkKey)];
	});
}

function deriveStaticBundleSpatialItem(
	bundle: StaticObjectBundleArtifact,
	hint: StaticBundleSpatialHint,
	objectRecord: StaticObjectBundleArtifact["objectRecords"][number],
	chunkKey: RenderChunkKey,
): RenderSpatialItem {
	const kind = staticBundleSpatialKind(objectRecord.kind);
	return {
		id: staticRenderablePartSpatialItemId(hint.key),
		kind,
		ownerKey: STATIC_RENDERABLE_SPATIAL_OWNER_KEY,
		chunkKey,
		broadphaseBounds: hint.bounds,
		pickShape: { kind: "box", bounds: hint.bounds },
		metadata: {
			kind: "static-renderable",
			renderKey: hint.key,
			instanceId: objectRecord.objectKey,
			staticKind: objectRecord.kind,
			renderDomain:
				objectRecord.owningEnvCellId === null
					? WORLD_RENDER_DOMAIN.exteriorStatic
					: WORLD_RENDER_DOMAIN.interiorStatic,
			owningLandblockId: objectRecord.owningLandblockId,
			owningEnvCellId: objectRecord.owningEnvCellId,
			sourceAssetId: objectRecord.sourceAssetId,
			gfxObjAssetId: objectRecord.sourceAssetId,
			gfxObjId: 0,
			partIndex: 0,
			materialSignature: `artifact-static:${bundle.key}:${objectRecord.objectKey}`,
			materialSlotCount: 0,
			detailRoleKind: "artifact-static",
			detailSignature: `artifact-static:${bundle.bundleKind}`,
			textureVelocitySignature: "artifact-static:none",
		},
	};
}

function staticBundleSpatialKind(
	kind: StaticObjectBundleArtifact["objectRecords"][number]["kind"],
): RenderSpatialItem["kind"] {
	if (kind === "indoor-static") {
		return "indoor-static";
	}
	if (kind === "building") {
		return "building";
	}
	return "outdoor-static";
}

function staticRenderablePartSpatialKind(
	part: StaticRenderablePart,
): RenderSpatialItem["kind"] {
	if (part.kind === "indoor-static") {
		return "indoor-static";
	}
	if (part.kind === "building") {
		return "building";
	}
	return "outdoor-static";
}

function deriveCellDebugOverlaySpatialItem(
	cell: WorldDebugOverlayModel["cells"][number],
): RenderSpatialItem[] {
	if (!cell.bounds) {
		return [];
	}
	const transform = buildAcPlacementMatrix(
		cell.chunkLocalPlacement,
		{ x: 0, y: 0, z: 0 },
		{ x: 1, y: 1, z: 1 },
	);
	const bounds = transformBounds(cell.bounds, transform);

	return [
		{
			id: debugCellSpatialItemId(cell.renderKey),
			kind: "structured-cell",
			ownerKey: DEBUG_OVERLAY_SPATIAL_OWNER_KEY,
			chunkKey: cell.renderChunk.chunkKey,
			broadphaseBounds: bounds,
			pickShape: { kind: "box", bounds },
			metadata: {
				kind: "structured-cell",
				envCellId: cell.envCellId,
				renderKey: cell.renderKey,
				isFocus: cell.isFocus,
			},
		},
	];
}

function derivePortalSpatialItem(
	portal: PortalDebugOverlay,
): RenderSpatialItem[] {
	if (portal.points.length < 3) {
		return [];
	}
	const transform = buildAcPlacementMatrix(
		portal.chunkLocalPlacement,
		{ x: 0, y: 0, z: 0 },
		{ x: 1, y: 1, z: 1 },
	);
	const points = portal.points.map((point) => transformPoint(point, transform));
	const bounds = expandBounds(pointsToBounds(points), PORTAL_PICK_THICKNESS);
	return [
		{
			id: portalSpatialItemId(portal.portalId),
			kind: "portal",
			ownerKey: DEBUG_OVERLAY_SPATIAL_OWNER_KEY,
			chunkKey: portal.renderChunk.chunkKey,
			broadphaseBounds: bounds,
			pickShape: { kind: "polygon", points, thickness: PORTAL_PICK_THICKNESS },
			metadata: {
				kind: "portal",
				portalId: portal.portalId,
				sourceEnvCellId: portal.sourceEnvCellId,
				targetEnvCellId: portal.targetEnvCellId,
				targetStatus: portal.targetStatus,
				polygonId: portal.polygonId,
				otherPortalId: portal.otherPortalId,
				flags: portal.flags,
			},
		},
	];
}

function deriveTerrainTileBounds(tile: TerrainSceneTile): RenderBounds {
	const localBounds = pointsToBounds(
		tile.mesh.vertices.map((vertex) => ({
			x: vertex.x,
			y: vertex.z,
			z: -vertex.y,
		})),
	);
	return {
		min: {
			x: localBounds.min.x + tile.chunkLocalOffset.x,
			y: localBounds.min.y,
			z: localBounds.min.z + tile.chunkLocalOffset.z,
		},
		max: {
			x: localBounds.max.x + tile.chunkLocalOffset.x,
			y: localBounds.max.y,
			z: localBounds.max.z + tile.chunkLocalOffset.z,
		},
	};
}

function transformBounds(
	bounds: { min: Vec3Dto; max: Vec3Dto },
	matrix: RenderMat4,
): RenderBounds {
	return transformRenderBounds(bounds, (point) =>
		transformPointByMat4(point, matrix),
	);
}

function transformBoundsByRenderMat4(
	bounds: { min: Vec3Dto; max: Vec3Dto },
	matrix: RenderMat4,
): RenderBounds {
	return transformRenderBounds(bounds, (point) =>
		transformPointByMat4(point, matrix),
	);
}

function transformPoint(point: Vec3Dto, matrix: RenderMat4): RenderVec3 {
	return transformPointByMat4(point, matrix);
}

function pointsToBounds(points: RenderVec3[]): RenderBounds {
	return renderBoundsFromPoints(points);
}

function expandPointBounds(point: RenderVec3, radius: number): RenderBounds {
	return {
		min: { x: point.x - radius, y: point.y - radius, z: point.z - radius },
		max: { x: point.x + radius, y: point.y + radius, z: point.z + radius },
	};
}

function expandBounds(bounds: RenderBounds, amount: number): RenderBounds {
	return {
		min: {
			x: bounds.min.x - amount,
			y: bounds.min.y - amount,
			z: bounds.min.z - amount,
		},
		max: {
			x: bounds.max.x + amount,
			y: bounds.max.y + amount,
			z: bounds.max.z + amount,
		},
	};
}
