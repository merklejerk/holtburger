import type {
	PreparedPolygonSetBspNode,
	PreparedPolygonSetRenderGeometry,
	PreparedPolygonSetVertexArray,
} from "../assets/types";
import type { Vec3Dto } from "../host/contracts";
import {
	OUTDOOR_LANDBLOCK_WORLD_SIZE,
	getOutdoorLandblockCoords,
	makeOutdoorLandblockId,
	normalizeOutdoorLandblockId,
} from "../landblocks";
import {
	landblockRenderPointToCellAcLocalPoint,
	pointInsideCellBsp,
} from "./cell-bsp-residency";
import {
	buildAcPlacementMatrix,
	invertMat4,
	transformPointByMat4,
	type RenderMat4,
} from "./render-math";
import {
	distanceBetweenRenderVec3Squared,
	renderBoundsCenter,
	renderBoundsContainsPoint,
	renderBoundsFromPoints,
	renderBoundsSize,
	transformRenderBounds,
	unionRenderBounds,
	type RenderBounds,
	type RenderVec3,
} from "./render-spatial-math";
import type { BrowserCameraResidency } from "./renderer-contract";
import type { RenderChunkTransform } from "./render-anchor";
import type { WorldRenderSceneContext } from "./render-scene-context";
import type { StructuredInteriorCell } from "./structured-interior-scene";
import {
	getDetailedLandblockRenderArtifacts,
	type DetailedLandblockRenderArtifacts,
} from "./landblock-render-product";
import type { StaticLandblockRenderProductSet } from "./static-landblock-render-artifact-store";

export type CameraViewResidencyContext =
	| {
			kind: "outdoor-landblock";
			landblockId: number;
	  }
	| {
			kind: "env-cell";
			landblockId: number;
			envCellId: number;
	  }
	| {
			kind: "unknown";
			landblockId: number | null;
	  };

export interface WorldResidencyIndex {
	cellCount: number;
	landblockCount: number;
	query(position: Vec3Dto): CameraViewResidencyContext;
	queryDetailed(position: Vec3Dto): WorldResidencyQueryResult;
}

interface WorldResidencyQueryResult {
	context: CameraViewResidencyContext;
	diagnostics: WorldResidencyQueryDiagnostics;
}

export interface WorldResidencyQueryDiagnostics {
	landblockId: number | null;
	aabbCandidateCount: number;
	cellBspMatchCount: number;
	aabbFallbackCount: number;
	source: "cell-bsp" | "aabb-fallback" | "outdoor" | "unknown";
}

interface ResidencyLandblockIndex {
	landblockId: number;
	chunkOffset: RenderVec3;
	root: ResidencyBvhNode | null;
	items: ResidencyCellItem[];
}

interface ResidencyBvhNode {
	bounds: RenderBounds;
	left: ResidencyBvhNode | null;
	right: ResidencyBvhNode | null;
	items: ResidencyCellItem[];
}

interface ResidencyCellItem {
	envCellId: number;
	landblockId: number;
	bounds: RenderBounds;
	center: RenderVec3;
	inverseCellRenderMatrix: RenderMat4;
	cellBsp: PreparedPolygonSetBspNode | null;
}

interface RenderAnchorInference {
	landblockId: number;
}

interface ResidencyCellSource {
	envCellId: number;
	landblockId: number;
	localPlacement: StructuredInteriorCell["chunkLocalPlacement"];
	renderGeometry: PreparedPolygonSetRenderGeometry;
	cellBsp: PreparedPolygonSetBspNode | null;
	cellStructureVertexArray: PreparedPolygonSetVertexArray | null;
}

export function createEmptyWorldResidencyIndex(): WorldResidencyIndex {
	return {
		cellCount: 0,
		landblockCount: 0,
		query: () => ({ kind: "unknown", landblockId: null }),
		queryDetailed: () => ({
			context: { kind: "unknown", landblockId: null },
			diagnostics: createResidencyQueryDiagnostics({
				landblockId: null,
				source: "unknown",
			}),
		}),
	};
}

export function buildWorldResidencyIndex(options: {
	cells: readonly StructuredInteriorCell[];
	renderChunkTransforms: readonly RenderChunkTransform[];
	sceneContext?: WorldRenderSceneContext;
}): WorldResidencyIndex {
	return buildWorldResidencyIndexFromCellSources({
		sources: options.cells.map(structuredInteriorCellToResidencySource),
		renderChunkTransforms: options.renderChunkTransforms,
		sceneContext: options.sceneContext,
	});
}

export function buildWorldResidencyIndexFromLandblockArtifacts(options: {
	artifacts: StaticLandblockRenderProductSet;
	renderChunkTransforms: readonly RenderChunkTransform[];
	sceneContext?: WorldRenderSceneContext;
}): WorldResidencyIndex | null {
	const sources = collectArtifactResidencyCellSources(options.artifacts);
	if (sources.length === 0) {
		return null;
	}
	return buildWorldResidencyIndexFromCellSources({
		sources,
		renderChunkTransforms: options.renderChunkTransforms,
		sceneContext: options.sceneContext,
	});
}

function buildWorldResidencyIndexFromCellSources(options: {
	sources: readonly ResidencyCellSource[];
	renderChunkTransforms: readonly RenderChunkTransform[];
	sceneContext?: WorldRenderSceneContext;
}): WorldResidencyIndex {
	const anchor = inferRenderAnchor(options.renderChunkTransforms);
	if (!anchor) {
		return createEmptyWorldResidencyIndex();
	}

	const chunkOffsetByLandblockId = deriveChunkOffsetByLandblockId(
		options.renderChunkTransforms,
	);
	const itemsByLandblockId = new Map<number, ResidencyCellItem[]>();
	for (const source of options.sources) {
		const item = deriveResidencyCellItem(source);
		if (!item) {
			continue;
		}

		const items = itemsByLandblockId.get(item.landblockId) ?? [];
		items.push(item);
		itemsByLandblockId.set(item.landblockId, items);
	}

	const landblocks = new Map<number, ResidencyLandblockIndex>();
	let cellCount = 0;
	for (const [landblockId, items] of itemsByLandblockId.entries()) {
		cellCount += items.length;
		landblocks.set(landblockId, {
			landblockId,
			chunkOffset: chunkOffsetByLandblockId.get(landblockId) ?? {
				x: 0,
				y: 0,
				z: 0,
			},
			items,
			root: buildResidencyBvh(items),
		});
	}

	const sceneContext = options.sceneContext ?? {
		kind: "outdoor",
		anchorLandblockId: anchor.landblockId,
	};
	return {
		cellCount,
		landblockCount: landblocks.size,
		query: (position) =>
			queryWorldResidencyIndex(position, anchor, landblocks, sceneContext)
				.context,
		queryDetailed: (position) =>
			queryWorldResidencyIndex(position, anchor, landblocks, sceneContext),
	};
}

export function describeCameraViewResidencyContext(
	context: CameraViewResidencyContext,
): string {
	switch (context.kind) {
		case "outdoor-landblock":
			return `outdoor landblock ${formatResidencyHex(context.landblockId)}`;
		case "env-cell":
			return `env cell ${formatResidencyHex(context.envCellId)} in ${formatResidencyHex(context.landblockId)}`;
		case "unknown":
			return context.landblockId === null
				? "unknown"
				: `unknown in ${formatResidencyHex(context.landblockId)}`;
	}
}

export function deriveBrowserCameraResidency(
	context: CameraViewResidencyContext,
	diagnostics: WorldResidencyQueryDiagnostics,
): BrowserCameraResidency {
	if (context.kind === "env-cell") {
		return {
			kind: "env-cell",
			landblockId: normalizeOutdoorLandblockId(context.landblockId),
			envCellId: context.envCellId,
			source: diagnostics.source,
		};
	}

	if (context.kind === "outdoor-landblock") {
		return {
			kind: "outdoor-landblock",
			landblockId: normalizeOutdoorLandblockId(context.landblockId),
			envCellId: null,
			source: diagnostics.source,
		};
	}

	return {
		kind: "unknown",
		landblockId:
			context.landblockId === null
				? normalizeNullableOutdoorLandblockId(diagnostics.landblockId)
				: normalizeOutdoorLandblockId(context.landblockId),
		envCellId: null,
		source: diagnostics.source,
	};
}

function normalizeNullableOutdoorLandblockId(
	landblockId: number | null,
): number | null {
	return landblockId === null ? null : normalizeOutdoorLandblockId(landblockId);
}

export function inferRenderAnchor(
	transforms: readonly RenderChunkTransform[],
): RenderAnchorInference | null {
	const first = transforms[0];
	if (!first) {
		return null;
	}

	const chunkCoords = getOutdoorLandblockCoords(first.chunkLandblockId);
	const anchorX = chunkCoords.x - first.offset.x / OUTDOOR_LANDBLOCK_WORLD_SIZE;
	const anchorY = chunkCoords.y + first.offset.z / OUTDOOR_LANDBLOCK_WORLD_SIZE;
	if (!Number.isFinite(anchorX) || !Number.isFinite(anchorY)) {
		return null;
	}

	const roundedX = Math.round(anchorX);
	const roundedY = Math.round(anchorY);
	if (
		Math.abs(anchorX - roundedX) > 0.001 ||
		Math.abs(anchorY - roundedY) > 0.001 ||
		roundedX < 0 ||
		roundedX > 0xfe ||
		roundedY < 0 ||
		roundedY > 0xfe
	) {
		return null;
	}

	return {
		landblockId: makeOutdoorLandblockId(roundedX, roundedY),
	};
}

export function computeRendererPositionLandblockResidency(
	position: Vec3Dto,
	anchor: RenderAnchorInference,
): { landblockId: number; landblockRelativePosition: RenderVec3 } | null {
	const anchorCoords = getOutdoorLandblockCoords(anchor.landblockId);
	const globalOutdoorX =
		anchorCoords.x * OUTDOOR_LANDBLOCK_WORLD_SIZE + position.x;
	const globalOutdoorY =
		anchorCoords.y * OUTDOOR_LANDBLOCK_WORLD_SIZE - position.z;
	const landblockX = Math.floor(globalOutdoorX / OUTDOOR_LANDBLOCK_WORLD_SIZE);
	const landblockY = Math.floor(globalOutdoorY / OUTDOOR_LANDBLOCK_WORLD_SIZE);
	if (
		landblockX < 0 ||
		landblockX > 0xfe ||
		landblockY < 0 ||
		landblockY > 0xfe
	) {
		return null;
	}

	const landblockOriginX = landblockX * OUTDOOR_LANDBLOCK_WORLD_SIZE;
	const landblockOriginY = landblockY * OUTDOOR_LANDBLOCK_WORLD_SIZE;
	return {
		landblockId: makeOutdoorLandblockId(landblockX, landblockY),
		landblockRelativePosition: {
			x: globalOutdoorX - landblockOriginX,
			y: position.y,
			z: -(globalOutdoorY - landblockOriginY),
		},
	};
}

export function deriveResidencyCellBounds(
	cell: Pick<StructuredInteriorCell, "chunkLocalPlacement" | "renderGeometry">,
): RenderBounds | null {
	return deriveResidencyCellBoundsFromPlacement(
		cell.renderGeometry,
		cell.chunkLocalPlacement,
	);
}

function deriveResidencyCellBoundsFromPlacement(
	renderGeometry: PreparedPolygonSetRenderGeometry,
	localPlacement: ResidencyCellSource["localPlacement"],
): RenderBounds | null {
	return transformRenderGeometryBounds(
		renderGeometry,
		buildAcPlacementMatrix(
			localPlacement,
			{ x: 0, y: 0, z: 0 },
			{ x: 1, y: 1, z: 1 },
		),
	);
}

function queryWorldResidencyIndex(
	position: Vec3Dto,
	anchor: RenderAnchorInference,
	landblocks: ReadonlyMap<number, ResidencyLandblockIndex>,
	sceneContext: WorldRenderSceneContext,
): WorldResidencyQueryResult {
	if (sceneContext.kind === "dungeon") {
		return queryDungeonResidencyIndex(position, landblocks, sceneContext);
	}

	const landblockResidency = computeRendererPositionLandblockResidency(
		position,
		anchor,
	);
	if (!landblockResidency) {
		return {
			context: { kind: "unknown", landblockId: null },
			diagnostics: createResidencyQueryDiagnostics({
				landblockId: null,
				source: "unknown",
			}),
		};
	}

	const landblock = landblocks.get(landblockResidency.landblockId);
	if (!landblock) {
		return {
			context: {
				kind: "outdoor-landblock",
				landblockId: landblockResidency.landblockId,
			},
			diagnostics: createResidencyQueryDiagnostics({
				landblockId: landblockResidency.landblockId,
				source: "outdoor",
			}),
		};
	}

	const aabbCandidates = queryResidencyBvh(
		landblock.root,
		landblockResidency.landblockRelativePosition,
	);
	const cellBspMatches = filterCellBspMatches(
		aabbCandidates,
		landblockResidency.landblockRelativePosition,
	);
	const aabbFallbacks = filterAabbFallbackCandidates(aabbCandidates);
	const nearest = selectNearestResidencyCell(
		cellBspMatches,
		landblockResidency.landblockRelativePosition,
	);
	if (nearest) {
		return {
			context: {
				kind: "env-cell",
				landblockId: nearest.landblockId,
				envCellId: nearest.envCellId,
			},
			diagnostics: createResidencyQueryDiagnostics({
				landblockId: nearest.landblockId,
				aabbCandidateCount: aabbCandidates.length,
				cellBspMatchCount: cellBspMatches.length,
				aabbFallbackCount: aabbFallbacks.length,
				source: "cell-bsp",
			}),
		};
	}

	const nearestFallback = selectNearestResidencyCell(
		aabbFallbacks,
		landblockResidency.landblockRelativePosition,
	);
	if (nearestFallback) {
		return {
			context: {
				kind: "env-cell",
				landblockId: nearestFallback.landblockId,
				envCellId: nearestFallback.envCellId,
			},
			diagnostics: createResidencyQueryDiagnostics({
				landblockId: nearestFallback.landblockId,
				aabbCandidateCount: aabbCandidates.length,
				cellBspMatchCount: cellBspMatches.length,
				aabbFallbackCount: aabbFallbacks.length,
				source: "aabb-fallback",
			}),
		};
	}

	return {
		context: {
			kind: "outdoor-landblock",
			landblockId: landblock.landblockId,
		},
		diagnostics: createResidencyQueryDiagnostics({
			landblockId: landblock.landblockId,
			aabbCandidateCount: aabbCandidates.length,
			cellBspMatchCount: cellBspMatches.length,
			aabbFallbackCount: aabbFallbacks.length,
			source: "outdoor",
		}),
	};
}

function queryDungeonResidencyIndex(
	position: Vec3Dto,
	landblocks: ReadonlyMap<number, ResidencyLandblockIndex>,
	sceneContext: WorldRenderSceneContext,
): WorldResidencyQueryResult {
	const targetLandblockId =
		sceneContext.anchorLandblockId ?? firstLandblockId(landblocks);
	if (targetLandblockId === null) {
		return {
			context: { kind: "unknown", landblockId: null },
			diagnostics: createResidencyQueryDiagnostics({
				landblockId: null,
				source: "unknown",
			}),
		};
	}

	const landblock = landblocks.get(targetLandblockId);
	if (!landblock) {
		return {
			context: { kind: "unknown", landblockId: targetLandblockId },
			diagnostics: createResidencyQueryDiagnostics({
				landblockId: targetLandblockId,
				source: "unknown",
			}),
		};
	}

	const landblockRelativePosition = {
		x: position.x - landblock.chunkOffset.x,
		y: position.y - landblock.chunkOffset.y,
		z: position.z - landblock.chunkOffset.z,
	};
	const aabbCandidates = queryResidencyBvh(
		landblock.root,
		landblockRelativePosition,
	);
	const cellBspMatches = filterCellBspMatches(
		aabbCandidates,
		landblockRelativePosition,
	);
	const aabbFallbacks = filterAabbFallbackCandidates(aabbCandidates);
	const nearest = selectNearestResidencyCell(
		cellBspMatches,
		landblockRelativePosition,
	);
	if (nearest) {
		return {
			context: {
				kind: "env-cell",
				landblockId: nearest.landblockId,
				envCellId: nearest.envCellId,
			},
			diagnostics: createResidencyQueryDiagnostics({
				landblockId: nearest.landblockId,
				aabbCandidateCount: aabbCandidates.length,
				cellBspMatchCount: cellBspMatches.length,
				aabbFallbackCount: aabbFallbacks.length,
				source: "cell-bsp",
			}),
		};
	}

	const nearestFallback = selectNearestResidencyCell(
		aabbFallbacks,
		landblockRelativePosition,
	);
	if (nearestFallback) {
		return {
			context: {
				kind: "env-cell",
				landblockId: nearestFallback.landblockId,
				envCellId: nearestFallback.envCellId,
			},
			diagnostics: createResidencyQueryDiagnostics({
				landblockId: nearestFallback.landblockId,
				aabbCandidateCount: aabbCandidates.length,
				cellBspMatchCount: cellBspMatches.length,
				aabbFallbackCount: aabbFallbacks.length,
				source: "aabb-fallback",
			}),
		};
	}

	return {
		context: { kind: "unknown", landblockId: landblock.landblockId },
		diagnostics: createResidencyQueryDiagnostics({
			landblockId: landblock.landblockId,
			aabbCandidateCount: aabbCandidates.length,
			cellBspMatchCount: cellBspMatches.length,
			aabbFallbackCount: aabbFallbacks.length,
			source: "unknown",
		}),
	};
}

function deriveResidencyCellItem(
	cell: ResidencyCellSource,
): ResidencyCellItem | null {
	const cellRenderMatrix = buildAcPlacementMatrix(
		cell.localPlacement,
		{ x: 0, y: 0, z: 0 },
		{ x: 1, y: 1, z: 1 },
	);
	const bounds =
		(cell.cellStructureVertexArray
			? deriveConservativeResidencyCellBounds(
					cell.cellStructureVertexArray,
					cellRenderMatrix,
				)
			: null) ??
		deriveResidencyCellBoundsFromPlacement(
			cell.renderGeometry,
			cell.localPlacement,
		);
	if (!bounds) {
		return null;
	}

	return {
		envCellId: cell.envCellId,
		landblockId: normalizeOutdoorLandblockId(cell.landblockId),
		bounds,
		center: renderBoundsCenter(bounds),
		inverseCellRenderMatrix: invertMat4(cellRenderMatrix),
		cellBsp: cell.cellBsp,
	};
}

function structuredInteriorCellToResidencySource(
	cell: StructuredInteriorCell,
): ResidencyCellSource {
	return {
		envCellId: cell.envCellId,
		landblockId: cell.renderChunk.chunkLandblockId,
		localPlacement: cell.chunkLocalPlacement,
		renderGeometry: cell.renderGeometry,
		cellBsp: cell.cellBsp,
		cellStructureVertexArray: cell.cellStructure?.vertexArray ?? null,
	};
}

function collectArtifactResidencyCellSources(
	artifacts: StaticLandblockRenderProductSet,
): ResidencyCellSource[] {
	const sources: ResidencyCellSource[] = [];
	for (const result of artifacts.artifacts) {
		const detailed = getDetailedLandblockRenderArtifacts(result);
		if (!detailed) {
			continue;
		}
		sources.push(...detailed.structuredInteriorCells.map(artifactCellToResidencySource));
	}
	return sources;
}

function artifactCellToResidencySource(
	cell: DetailedLandblockRenderArtifacts["structuredInteriorCells"][number],
): ResidencyCellSource {
	return {
		envCellId: cell.envCellId,
		landblockId: cell.landblockId,
		localPlacement: cell.localPlacement,
		renderGeometry: cell.renderGeometry,
		cellBsp: cell.cellBsp,
		cellStructureVertexArray: null,
	};
}

export function deriveConservativeResidencyCellBounds(
	vertexArray: PreparedPolygonSetVertexArray,
	matrix: RenderMat4,
): RenderBounds | null {
	if (vertexArray.vertices.length === 0) {
		return null;
	}

	const points = vertexArray.vertices.map((vertex) =>
		transformPointByMat4(
			{
				x: vertex.origin.x,
				y: vertex.origin.z,
				z: -vertex.origin.y,
			},
			matrix,
		),
	);
	return renderBoundsFromPoints(points);
}

function filterCellBspMatches(
	items: readonly ResidencyCellItem[],
	landblockRelativePosition: RenderVec3,
): ResidencyCellItem[] {
	return items.filter((item) => {
		if (!item.cellBsp) {
			return false;
		}
		const cellLocalPoint = landblockRenderPointToCellAcLocalPoint(
			landblockRelativePosition,
			item.inverseCellRenderMatrix,
		);
		return pointInsideCellBsp(item.cellBsp, cellLocalPoint);
	});
}

function filterAabbFallbackCandidates(
	items: readonly ResidencyCellItem[],
): ResidencyCellItem[] {
	return items.filter((item) => !item.cellBsp);
}

function transformRenderGeometryBounds(
	renderGeometry: PreparedPolygonSetRenderGeometry,
	matrix: RenderMat4,
): RenderBounds | null {
	if (!renderGeometry.bounds) {
		return null;
	}

	return transformRenderBounds(renderGeometry.bounds, (point) =>
		transformPointByMat4(point, matrix),
	);
}

function buildResidencyBvh(
	items: readonly ResidencyCellItem[],
): ResidencyBvhNode | null {
	if (items.length === 0) {
		return null;
	}

	const bounds = unionItemBounds(items);
	if (items.length <= 4) {
		return {
			bounds,
			left: null,
			right: null,
			items: [...items],
		};
	}

	const axis = longestBoxAxis(bounds);
	const sorted = [...items].sort(
		(left, right) =>
			renderVec3AxisComponent(left.center, axis) -
			renderVec3AxisComponent(right.center, axis),
	);
	const midpoint = Math.floor(sorted.length / 2);
	return {
		bounds,
		left: buildResidencyBvh(sorted.slice(0, midpoint)),
		right: buildResidencyBvh(sorted.slice(midpoint)),
		items: [],
	};
}

function queryResidencyBvh(
	node: ResidencyBvhNode | null,
	position: RenderVec3,
): ResidencyCellItem[] {
	if (!node || !renderBoundsContainsPoint(node.bounds, position)) {
		return [];
	}
	if (!node.left && !node.right) {
		return node.items.filter((item) =>
			renderBoundsContainsPoint(item.bounds, position),
		);
	}

	return [
		...queryResidencyBvh(node.left, position),
		...queryResidencyBvh(node.right, position),
	];
}

function selectNearestResidencyCell(
	items: readonly ResidencyCellItem[],
	position: RenderVec3,
): ResidencyCellItem | null {
	let nearest: ResidencyCellItem | null = null;
	let nearestDistanceSq = Number.POSITIVE_INFINITY;
	for (const item of items) {
		const distanceSq = distanceBetweenRenderVec3Squared(item.center, position);
		if (
			distanceSq < nearestDistanceSq ||
			(distanceSq === nearestDistanceSq &&
				nearest !== null &&
				item.envCellId < nearest.envCellId)
		) {
			nearest = item;
			nearestDistanceSq = distanceSq;
		}
	}
	return nearest;
}

function unionItemBounds(items: readonly ResidencyCellItem[]): RenderBounds {
	return unionRenderBounds(items.map((item) => item.bounds));
}

function longestBoxAxis(bounds: RenderBounds): 0 | 1 | 2 {
	const size = renderBoundsSize(bounds);
	if (size.x >= size.y && size.x >= size.z) {
		return 0;
	}
	return size.y >= size.z ? 1 : 2;
}

function renderVec3AxisComponent(vector: RenderVec3, axis: 0 | 1 | 2): number {
	return axis === 0 ? vector.x : axis === 1 ? vector.y : vector.z;
}

function formatResidencyHex(value: number): string {
	return `0x${(value >>> 0).toString(16).padStart(8, "0")}`;
}

function deriveChunkOffsetByLandblockId(
	transforms: readonly RenderChunkTransform[],
): Map<number, RenderVec3> {
	return new Map(
		transforms.map((transform) => [
			transform.chunkLandblockId,
			{ x: transform.offset.x, y: transform.offset.y, z: transform.offset.z },
		]),
	);
}

function firstLandblockId(
	landblocks: ReadonlyMap<number, ResidencyLandblockIndex>,
): number | null {
	const first = landblocks.keys().next();
	return first.done ? null : first.value;
}

function createResidencyQueryDiagnostics(options: {
	landblockId: number | null;
	aabbCandidateCount?: number;
	cellBspMatchCount?: number;
	aabbFallbackCount?: number;
	source: WorldResidencyQueryDiagnostics["source"];
}): WorldResidencyQueryDiagnostics {
	return {
		landblockId: options.landblockId,
		aabbCandidateCount: options.aabbCandidateCount ?? 0,
		cellBspMatchCount: options.cellBspMatchCount ?? 0,
		aabbFallbackCount: options.aabbFallbackCount ?? 0,
		source: options.source,
	};
}
