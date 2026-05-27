import type {
	AssetChannelState,
	PreparedEnvCellPayload,
	PreparedLandblockOutdoorPayload,
} from "../assets/types";
import {
	formatEnvCellAssetId,
	formatLandblockOutdoorAssetId,
} from "../landblocks";
import type { RenderChunkTransform } from "./render-anchor";
import { deriveTerrainTileRenderChunk } from "./render-chunks";
import {
	queryEnvCellLocalBvhVisibility,
	queryOutdoorBvhVisibility,
	queryTerrainBvhVisibility,
	type RenderBvhItemKey,
} from "./prepared-bvh-visibility";
import { transformEnvCellLocalBounds } from "./prepared-bvh-bounds";
import {
	crossRenderVec3,
	dotRenderVec3,
	normalizeRenderVec3,
	type RenderFrustum,
	type RenderPlane,
	type RenderVec3,
} from "./render-spatial-math";
import type { StaticRenderableSceneModel } from "./static-renderables";
import type { StructuredInteriorSceneModel } from "./structured-interior-scene";
import type { TerrainSceneModel } from "./terrain-scene";

export interface PortalClippedBvhVisibilityInput {
	assetState: AssetChannelState;
	terrainScene: TerrainSceneModel;
	staticRenderableScene: StaticRenderableSceneModel;
	structuredInteriorScene: StructuredInteriorSceneModel;
	renderChunkTransforms: readonly RenderChunkTransform[];
	cameraFrustum: RenderFrustum;
	cameraPosition: RenderVec3;
	apertureWorldPoints: readonly RenderVec3[];
	compositeScene: "exterior" | "interior";
	requestedInteriorEnvCellIds: readonly number[];
}

export interface PortalClippedBvhVisibilityResult {
	visibleItemKeys: ReadonlySet<RenderBvhItemKey>;
	fallbackReasons: readonly string[];
}

export function derivePortalClippedBvhVisibility(
	options: PortalClippedBvhVisibilityInput,
): PortalClippedBvhVisibilityResult {
	const visibleItemKeys = new Set<RenderBvhItemKey>();
	const fallbackReasons: string[] = [];
	const frustum = buildPortalClippedRenderFrustum({
		cameraFrustum: options.cameraFrustum,
		cameraPosition: options.cameraPosition,
		apertureWorldPoints: options.apertureWorldPoints,
	});
	if (!frustum) {
		return {
			visibleItemKeys,
			fallbackReasons: ["portal clipped BVH query missing aperture volume"],
		};
	}

	const chunkTransformsByKey = new Map(
		options.renderChunkTransforms.map((transform) => [
			transform.chunkKey,
			transform,
		]),
	);

	if (options.compositeScene === "interior") {
		queryInteriorPortalVisibility({
			assetState: options.assetState,
			structuredInteriorScene: options.structuredInteriorScene,
			renderChunkTransformsByKey: chunkTransformsByKey,
			requestedInteriorEnvCellIds: options.requestedInteriorEnvCellIds,
			frustum,
			visibleItemKeys,
			fallbackReasons,
		});
		return { visibleItemKeys, fallbackReasons };
	}

	queryExteriorPortalVisibility({
		assetState: options.assetState,
		terrainScene: options.terrainScene,
		staticRenderableScene: options.staticRenderableScene,
		renderChunkTransformsByKey: chunkTransformsByKey,
		frustum,
		visibleItemKeys,
		fallbackReasons,
	});
	return { visibleItemKeys, fallbackReasons };
}

export function buildPortalClippedRenderFrustum(options: {
	cameraFrustum: RenderFrustum;
	cameraPosition: RenderVec3;
	apertureWorldPoints: readonly RenderVec3[];
}): RenderFrustum | null {
	const points = options.apertureWorldPoints;
	if (points.length < 3) {
		return null;
	}

	const centroid = averageRenderVec3(points);
	const planes = [...options.cameraFrustum.planes];
	const aperturePlane = buildApertureForwardPlane(
		points,
		centroid,
		options.cameraPosition,
	);
	if (aperturePlane) {
		planes.push(aperturePlane);
	}

	for (let index = 0; index < points.length; index += 1) {
		const current = points[index];
		const next = points[(index + 1) % points.length];
		if (!current || !next) {
			continue;
		}
		const plane = buildEdgePlane({
			cameraPosition: options.cameraPosition,
			edgeStart: current,
			edgeEnd: next,
			insidePoint: centroid,
		});
		if (plane) {
			planes.push(plane);
		}
	}

	return { planes };
}

function queryInteriorPortalVisibility(options: {
	assetState: AssetChannelState;
	structuredInteriorScene: StructuredInteriorSceneModel;
	renderChunkTransformsByKey: ReadonlyMap<string, RenderChunkTransform>;
	requestedInteriorEnvCellIds: readonly number[];
	frustum: RenderFrustum;
	visibleItemKeys: Set<RenderBvhItemKey>;
	fallbackReasons: string[];
}): void {
	const requestedIds = new Set(options.requestedInteriorEnvCellIds);
	if (requestedIds.size === 0) {
		options.fallbackReasons.push("portal interior composite has no requested env cells");
		return;
	}
	let queriedCellCount = 0;
	for (const cell of options.structuredInteriorScene.cells) {
		if (!requestedIds.has(cell.envCellId)) {
			continue;
		}
		queriedCellCount += 1;
		const payload = findPreparedEnvCellPayload(
			options.assetState,
			cell.envCellId,
		);
		if (!payload) {
			options.fallbackReasons.push(
				`missing portal env-cell payload ${formatEnvCellAssetId(cell.envCellId)}`,
			);
			continue;
		}
		const transform = options.renderChunkTransformsByKey.get(
			cell.renderChunk.chunkKey,
		);
		if (!transform) {
			options.fallbackReasons.push(
				`missing portal render chunk transform ${cell.renderChunk.chunkKey}`,
			);
			continue;
		}
		const result = queryEnvCellLocalBvhVisibility({
			payload,
			frustum: options.frustum,
			boundsToRendererBounds: (bounds) =>
				transformEnvCellLocalBounds(bounds, payload, transform),
		});
		mergePortalVisibilityResult(result, options);
	}
	if (queriedCellCount === 0) {
		options.fallbackReasons.push(
			"portal interior composite had no loaded structured cells to query",
		);
	}
}

function queryExteriorPortalVisibility(options: {
	assetState: AssetChannelState;
	terrainScene: TerrainSceneModel;
	staticRenderableScene: StaticRenderableSceneModel;
	renderChunkTransformsByKey: ReadonlyMap<string, RenderChunkTransform>;
	frustum: RenderFrustum;
	visibleItemKeys: Set<RenderBvhItemKey>;
	fallbackReasons: string[];
}): void {
	let queriedExteriorSourceCount = 0;
	for (const tile of options.terrainScene.tiles) {
		queriedExteriorSourceCount += 1;
		const payload = findPreparedOutdoorPayload(
			options.assetState,
			tile.landblockId,
		);
		if (!payload) {
			options.fallbackReasons.push(
				`missing portal terrain payload ${formatLandblockOutdoorAssetId(tile.landblockId)}`,
			);
			continue;
		}
		const transform = options.renderChunkTransformsByKey.get(
			tile.renderChunk.chunkKey,
		);
		if (!transform) {
			options.fallbackReasons.push(
				`missing portal render chunk transform ${tile.renderChunk.chunkKey}`,
			);
			continue;
		}
		mergePortalVisibilityResult(
			queryTerrainBvhVisibility({
				terrainBvh: payload.terrain.terrainBvh,
				landblockId: payload.landblockId,
				frustum: options.frustum,
				chunkOffset: transform.offset,
			}),
			options,
		);
	}

	for (const payload of findActiveOutdoorPayloads(
		options.assetState,
		options.staticRenderableScene,
	)) {
		queriedExteriorSourceCount += 1;
		const transform = options.renderChunkTransformsByKey.get(
			deriveTerrainTileRenderChunk(payload.landblockId).chunkKey,
		);
		if (!transform) {
			options.fallbackReasons.push(
				`missing portal render chunk transform ${deriveTerrainTileRenderChunk(payload.landblockId).chunkKey}`,
			);
			continue;
		}
		mergePortalVisibilityResult(
			queryOutdoorBvhVisibility({
				payload,
				frustum: options.frustum,
				chunkOffset: transform.offset,
			}),
			options,
		);
	}
	if (queriedExteriorSourceCount === 0) {
		options.fallbackReasons.push(
			"portal exterior composite had no loaded outdoor sources to query",
		);
	}
}

function mergePortalVisibilityResult(
	result: PortalClippedBvhVisibilityResult,
	options: {
		visibleItemKeys: Set<RenderBvhItemKey>;
		fallbackReasons: string[];
	},
): void {
	for (const itemKey of result.visibleItemKeys) {
		options.visibleItemKeys.add(itemKey);
	}
	options.fallbackReasons.push(...result.fallbackReasons);
}

function buildApertureForwardPlane(
	points: readonly RenderVec3[],
	centroid: RenderVec3,
	cameraPosition: RenderVec3,
): RenderPlane | null {
	const first = points[0];
	const second = points[1];
	const third = points[2];
	if (!first || !second || !third) {
		return null;
	}
	let normal = normalizeRenderVec3(
		crossRenderVec3(
			{
				x: second.x - first.x,
				y: second.y - first.y,
				z: second.z - first.z,
			},
			{
				x: third.x - first.x,
				y: third.y - first.y,
				z: third.z - first.z,
			},
		),
	);
	if (isZeroVector(normal)) {
		return null;
	}
	if (dotRenderVec3(normal, vectorBetween(centroid, cameraPosition)) > 0) {
		normal = scaleRenderVec3(normal, -1);
	}
	return planeFromPointAndNormal(centroid, normal);
}

function buildEdgePlane(options: {
	cameraPosition: RenderVec3;
	edgeStart: RenderVec3;
	edgeEnd: RenderVec3;
	insidePoint: RenderVec3;
}): RenderPlane | null {
	const edge = vectorBetween(options.edgeStart, options.edgeEnd);
	const toCamera = vectorBetween(options.edgeStart, options.cameraPosition);
	let normal = normalizeRenderVec3(crossRenderVec3(edge, toCamera));
	if (isZeroVector(normal)) {
		return null;
	}
	let plane = planeFromPointAndNormal(options.edgeStart, normal);
	if (signedPlaneDistance(plane, options.insidePoint) < 0) {
		normal = scaleRenderVec3(normal, -1);
		plane = planeFromPointAndNormal(options.edgeStart, normal);
	}
	return plane;
}

function findActiveOutdoorPayloads(
	assetState: AssetChannelState,
	staticRenderableScene: StaticRenderableSceneModel,
): PreparedLandblockOutdoorPayload[] {
	const landblockIds = new Set(
		staticRenderableScene.sourceInstances
			.filter((instance) => instance.owningEnvCellId === null)
			.map((instance) => instance.owningLandblockId),
	);
	return [...landblockIds]
		.map((landblockId) => findPreparedOutdoorPayload(assetState, landblockId))
		.filter(
			(payload): payload is PreparedLandblockOutdoorPayload => payload !== null,
		)
		.sort((left, right) => left.landblockId - right.landblockId);
}

function findPreparedOutdoorPayload(
	assetState: AssetChannelState,
	landblockId: number,
): PreparedLandblockOutdoorPayload | null {
	const asset =
		assetState.preparedByAssetId[formatLandblockOutdoorAssetId(landblockId)];
	return asset?.payload.kind === "landblock-outdoor" ? asset.payload : null;
}

function findPreparedEnvCellPayload(
	assetState: AssetChannelState,
	envCellId: number,
): PreparedEnvCellPayload | null {
	const asset = assetState.preparedByAssetId[formatEnvCellAssetId(envCellId)];
	return asset?.payload.kind === "env-cell" &&
		asset.payload.envCellId === envCellId
		? asset.payload
		: null;
}

function averageRenderVec3(points: readonly RenderVec3[]): RenderVec3 {
	const sum = points.reduce(
		(total, point) => ({
			x: total.x + point.x,
			y: total.y + point.y,
			z: total.z + point.z,
		}),
		{ x: 0, y: 0, z: 0 },
	);
	return {
		x: sum.x / points.length,
		y: sum.y / points.length,
		z: sum.z / points.length,
	};
}

function vectorBetween(from: RenderVec3, to: RenderVec3): RenderVec3 {
	return {
		x: to.x - from.x,
		y: to.y - from.y,
		z: to.z - from.z,
	};
}

function scaleRenderVec3(vector: RenderVec3, scale: number): RenderVec3 {
	return {
		x: vector.x * scale,
		y: vector.y * scale,
		z: vector.z * scale,
	};
}

function planeFromPointAndNormal(
	point: RenderVec3,
	normal: RenderVec3,
): RenderPlane {
	return {
		normal,
		constant: -dotRenderVec3(normal, point),
	};
}

function signedPlaneDistance(plane: RenderPlane, point: RenderVec3): number {
	return dotRenderVec3(plane.normal, point) + plane.constant;
}

function isZeroVector(vector: RenderVec3): boolean {
	return (
		Math.abs(vector.x) < 1e-8 &&
		Math.abs(vector.y) < 1e-8 &&
		Math.abs(vector.z) < 1e-8
	);
}
