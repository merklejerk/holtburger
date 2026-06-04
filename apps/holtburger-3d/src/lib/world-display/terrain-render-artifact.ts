import {
	formatAtlasReadyPreparedTextureAssetId,
	type AssetChannelState,
	type PreparedLandblockOutdoorPayload,
	type PreparedTexturePayload,
	type PreparedTerrainBvh,
	type PreparedTerrainMesh,
} from "../assets/types";
import { formatLandblockOutdoorAssetId } from "../landblocks";
import {
	terrainBvhItemKey,
	type RenderBvhItemKey,
} from "./prepared-bvh-visibility";
import {
	buildTerrainBlendPlanSet,
	type TerrainBlendPlan,
} from "./terrain-blend-plan";
import {
	buildTerrainMaterialResourcePlan,
	type TerrainMaterialResourcePlan,
} from "./terrain-materials";
import {
	buildTerrainTileDrawSlicePlans,
	buildTerrainTileFallbackGeometry,
	buildTerrainTileLayerGeometry,
	type TerrainTileDrawSlicePlan,
	type TerrainTileLayerGeometry,
	type TerrainTileLayerPlan,
} from "./terrain-tile-plan";
import type { StagedWorldIndexedGeometry } from "./staged-world-geometry";

interface TerrainRenderArtifactBuildPolicy {
	buildPolicyRevision: string;
	cpuTexturePagePolicyRevision: string;
	maxLayerEntries: number;
}

export interface BuildTerrainRenderArtifactOptions {
	assetState: AssetChannelState;
	outdoor: PreparedLandblockOutdoorPayload;
	policy: TerrainRenderArtifactBuildPolicy;
	requestId: string;
}

export interface LandblockTerrainRenderArtifact {
	type: "landblock-terrain-render-artifact";
	key: string;
	requestId: string;
	landblockId: number;
	regionNumber: number;
	assetId: string;
	artifactRevision: string;
	buildPolicyRevision: string;
	cpuTexturePagePolicyRevision: string;
	diagnosticRootAssetIds: readonly string[];
	diagnosticPreparedAssetIds: readonly string[];
	mesh: PreparedTerrainMesh;
	materialResources: TerrainMaterialResourcePlan;
	blendPlanSignature: string | null;
	texturePageRefs: readonly TerrainRenderTexturePageRef[];
	layerPlan: TerrainTileLayerPlan | null;
	drawSlices: readonly TerrainRenderDrawSliceArtifact[];
	debugFallbackGeometry: StagedWorldIndexedGeometry;
	bvh: PreparedTerrainBvh;
	bvhItemKeys: readonly RenderBvhItemKey[];
	diagnostics: TerrainRenderArtifactDiagnostics;
}

export interface TerrainRenderDrawSliceArtifact {
	key: string;
	slicePlan: TerrainTileDrawSlicePlan;
	geometry: TerrainTileLayerGeometry;
}

export interface TerrainRenderTexturePageRef {
	key: string;
	sourceAssetId: string;
	renderSurfaceId: number;
	role: "color" | "mask" | "detail";
	width: number;
	height: number;
	formatRaw: number;
	format: string;
	wrapS: "clamp" | "repeat";
	wrapT: "clamp" | "repeat";
	tiling: number;
	bytes: Uint8Array;
}

interface TerrainRenderArtifactDiagnostics {
	status: "ready" | "debug-fallback";
	quadCount: number;
	triangleCount: number;
	texturePageRefCount: number;
	drawSliceCount: number;
	materialDiagnostics: readonly string[];
	blendDiagnostics: readonly string[];
	fallbackReasons: readonly string[];
}

export function buildLandblockTerrainRenderArtifact({
	assetState,
	outdoor,
	policy,
	requestId,
}: BuildTerrainRenderArtifactOptions): LandblockTerrainRenderArtifact {
	const mesh = createPreparedTerrainMeshFromOutdoorPayload(outdoor);
	const materialResources = buildTerrainMaterialResourcePlan({
		assetState,
		regionNumber: outdoor.regionNumber,
		quads: mesh.quads,
	});
	const pcodes = [...new Set(mesh.quads.map((quad) => quad.pcode))].sort(
		(left, right) => left - right,
	);
	const blendPlanSet = buildTerrainBlendPlanSet({
		assetState,
		regionNumber: outdoor.regionNumber,
		pcodes,
	});
	const drawSlicePlans = buildTerrainTileDrawSlicePlans({
		planSet: blendPlanSet,
		maxLayerEntries: policy.maxLayerEntries,
	});
	const drawSlices = drawSlicePlans.map(
		(slicePlan): TerrainRenderDrawSliceArtifact => ({
			key: formatTerrainDrawSliceArtifactKey(outdoor.landblockId, slicePlan.id),
			slicePlan,
			geometry: buildTerrainTileLayerGeometry({
				mesh,
				plan: slicePlan.layerPlan,
				sourceSignature: `terrain:${outdoor.landblockId}:artifact:${slicePlan.id}`,
			}),
		}),
	);
	const texturePageRefs = blendPlanSet
		? collectTerrainRenderTexturePageRefs({
				assetState,
				plans: blendPlanSet.plans,
			})
		: [];
	const fallbackReasons = collectTerrainFallbackReasons({
		materialResources,
		hasBlendPlanSet: blendPlanSet !== null,
		drawSliceCount: drawSlices.length,
	});

	return {
		type: "landblock-terrain-render-artifact",
		key: [
			"terrain-artifact",
			outdoor.landblockId,
			policy.buildPolicyRevision,
			policy.cpuTexturePagePolicyRevision,
		].join(":"),
		requestId,
		landblockId: outdoor.landblockId,
		regionNumber: outdoor.regionNumber,
		assetId: formatLandblockOutdoorAssetId(outdoor.landblockId),
		artifactRevision: [
			formatLandblockOutdoorAssetId(outdoor.landblockId),
			`region:${outdoor.regionNumber}`,
			`grid:${mesh.gridSize}`,
			`quads:${mesh.quads.length}`,
			`pcodes:${pcodes.join(",")}`,
			`blend:${blendPlanSet?.signature ?? "none"}`,
			`material:${materialResources.signature}`,
			`build:${policy.buildPolicyRevision}`,
			`textures:${policy.cpuTexturePagePolicyRevision}`,
		].join("|"),
		buildPolicyRevision: policy.buildPolicyRevision,
		cpuTexturePagePolicyRevision: policy.cpuTexturePagePolicyRevision,
		diagnosticRootAssetIds: [
			formatLandblockOutdoorAssetId(outdoor.landblockId),
		],
		diagnosticPreparedAssetIds: collectTerrainPreparedAssetIds({
			outdoor,
			materialResources,
			texturePageRefs,
		}),
		mesh,
		materialResources,
		blendPlanSignature: blendPlanSet?.signature ?? null,
		texturePageRefs,
		layerPlan: drawSlices[0]?.slicePlan.layerPlan ?? null,
		drawSlices,
		debugFallbackGeometry: buildTerrainTileFallbackGeometry(
			mesh,
			`terrain:${outdoor.landblockId}:artifact:fallback`,
		),
		bvh: outdoor.terrain.terrainBvh,
		bvhItemKeys: outdoor.terrain.terrainBvh.items.map((item) =>
			terrainBvhItemKey(outdoor.landblockId, item.quadIndex),
		),
		diagnostics: {
			status: fallbackReasons.length === 0 ? "ready" : "debug-fallback",
			quadCount: mesh.quads.length,
			triangleCount: mesh.triangles.length,
			texturePageRefCount: texturePageRefs.length,
			drawSliceCount: drawSlices.length,
			materialDiagnostics: materialResources.diagnostics,
			blendDiagnostics: blendPlanSet?.diagnostics ?? [],
			fallbackReasons,
		},
	};
}

export function createPreparedTerrainMeshFromOutdoorPayload(
	payload: PreparedLandblockOutdoorPayload,
): PreparedTerrainMesh {
	return {
		landblockId: payload.landblockId,
		gridSize: payload.terrain.gridSize,
		tileSize: payload.terrain.tileSize,
		vertices: payload.terrain.vertices,
		triangles: payload.terrain.triangles.map((triangle) => ({
			a: triangle.vertexIndices[0],
			b: triangle.vertexIndices[1],
			c: triangle.vertexIndices[2],
			quadIndex: triangle.quadIndex,
			triangleInQuad: triangle.triangleInQuad,
			debugTerrainPcode:
				payload.terrain.quads.find(
					(quad) => quad.quadIndex === triangle.quadIndex,
				)?.pcode ?? 0,
			averageHeight: triangle.averageHeight,
		})),
		quads: payload.terrain.quads,
		minHeight: payload.terrain.minHeight,
		maxHeight: payload.terrain.maxHeight,
	};
}

function collectTerrainRenderTexturePageRefs({
	assetState,
	plans,
}: {
	assetState: AssetChannelState;
	plans: readonly TerrainBlendPlan[];
}): TerrainRenderTexturePageRef[] {
	const refsByKey = new Map<string, TerrainRenderTexturePageRef>();
	for (const plan of plans) {
		for (const ref of [
			plan.base,
			...plan.overlays.flatMap((overlay) => [overlay.terrain, overlay.alpha]),
			...plan.roads.flatMap((road) => [road.road, road.alpha]),
		]) {
			const key = [
				"terrain-page",
				ref.role,
				ref.textureAssetId,
				ref.renderSurface.renderSurfaceId,
				ref.renderSurface.formatRaw,
			].join(":");
			const preparedTexture = resolveTerrainAtlasPreparedTexture({
				assetState,
				renderSurfaceId: ref.renderSurface.renderSurfaceId,
			});
			const level = preparedTexture?.levels[0] ?? null;
			if (!preparedTexture || !level) {
				continue;
			}
			refsByKey.set(key, {
				key,
				sourceAssetId: formatAtlasReadyPreparedTextureAssetId({
					renderSurfaceId: ref.renderSurface.renderSurfaceId,
					usage: "raw",
				}),
				renderSurfaceId: ref.renderSurface.renderSurfaceId,
				role: ref.role,
				width: level.width,
				height: level.height,
				formatRaw: level.formatRaw,
				format: level.format,
				wrapS: ref.wrap,
				wrapT: ref.wrap,
				tiling: ref.tiling,
				bytes: new Uint8Array(level.bytes),
			});
		}
	}
	return [...refsByKey.values()].sort((left, right) =>
		left.key.localeCompare(right.key),
	);
}

function resolveTerrainAtlasPreparedTexture({
	assetState,
	renderSurfaceId,
}: {
	assetState: AssetChannelState;
	renderSurfaceId: number;
}): PreparedTexturePayload | null {
	const assetId = formatAtlasReadyPreparedTextureAssetId({
		renderSurfaceId,
		usage: "raw",
	});
	const asset = assetState.preparedByAssetId[assetId];
	return asset?.payload.kind === "prepared-texture" ? asset.payload : null;
}

function collectTerrainPreparedAssetIds(options: {
	outdoor: PreparedLandblockOutdoorPayload;
	materialResources: TerrainMaterialResourcePlan;
	texturePageRefs: readonly TerrainRenderTexturePageRef[];
}): string[] {
	return [
		formatLandblockOutdoorAssetId(options.outdoor.landblockId),
		options.materialResources.terrainMaterialAssetId,
		...options.texturePageRefs.flatMap((ref) => [
			ref.sourceAssetId,
			`render-surface/${ref.renderSurfaceId.toString(16).padStart(8, "0")}`,
		]),
	].sort();
}

function collectTerrainFallbackReasons(options: {
	materialResources: TerrainMaterialResourcePlan;
	hasBlendPlanSet: boolean;
	drawSliceCount: number;
}): string[] {
	return [
		options.materialResources.status === "ready"
			? null
			: `terrain material resources ${options.materialResources.status}`,
		options.hasBlendPlanSet ? null : "missing terrain blend plan set",
		options.drawSliceCount > 0 ? null : "no terrain draw slices",
	].filter((reason): reason is string => reason !== null);
}

function formatTerrainDrawSliceArtifactKey(
	landblockId: number,
	sliceId: string,
): string {
	return `terrain-artifact:${landblockId}:draw:${sliceId}`;
}
