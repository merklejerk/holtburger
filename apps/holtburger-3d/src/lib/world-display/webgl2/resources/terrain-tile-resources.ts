import { formatHex32 } from "../../../landblocks";
import type {
	TerrainBlendPlan,
	TerrainBlendTextureRef,
} from "../../terrain-blend-plan";
import type { TerrainTileLayerPlan } from "../../terrain-tile-plan";
import type { RenderMat4, RenderVec4 } from "../../render-math";
import type { RenderBvhItemKey } from "../../prepared-bvh-visibility";
import type { StagedWorldIndexedGeometry } from "../../staged-world-geometry";
import type { TexturePageFamily } from "../../texture-pages/texture-page-atlas-planner";
import type { TerrainSceneTile } from "../../terrain-scene";
import type { Webgl2SceneDomain } from "../../webgl2-scene-domain-targets";
import type {
	Webgl2BufferResource,
	Webgl2Texture2DResource,
	Webgl2VertexArrayResource,
} from "../../webgl2-gl";

export interface Webgl2TerrainTextureBinding {
	key: string;
	texture: Webgl2Texture2DResource;
	tiling: number;
	wrapS: "clamp" | "repeat";
	wrapT: "clamp" | "repeat";
}

export interface Webgl2TerrainBlendResources {
	plan: TerrainBlendPlan;
	base: Webgl2TerrainTextureBinding;
	overlays: readonly {
		terrain: Webgl2TerrainTextureBinding;
		alpha: Webgl2TerrainTextureBinding;
		rotation: number;
	}[];
	roads: readonly {
		road: Webgl2TerrainTextureBinding;
		alpha: Webgl2TerrainTextureBinding;
		rotation: number;
	}[];
}

export type Webgl2TerrainTileReadiness =
	| {
			status: "ready";
			terrainMaterialAssetId: string;
	  }
	| {
			status: "fallback-debug";
			reason: string;
	  };

export interface Webgl2TerrainTileCompatibilityDrawResource {
	id: string;
	pcode: number | null;
	geometrySignature: string;
	vertexArray: Webgl2VertexArrayResource;
	vertexBuffer: Webgl2BufferResource;
	uvBuffer: Webgl2BufferResource | null;
	layerSlotBuffer: Webgl2BufferResource | null;
	indexBuffer: Webgl2BufferResource;
	indexType: GLenum;
	vertexCount: number;
	triangleCount: number;
	blend: Webgl2TerrainBlendResources | null;
	debugColor: RenderVec4 | null;
	preparedAssetIds: readonly string[];
}

export interface Webgl2TerrainTileResource {
	id: string;
	assetId: string;
	landblockId: number;
	label: string;
	placementKey: string;
	geometrySignature: string;
	vertexArray: Webgl2VertexArrayResource;
	vertexBuffer: Webgl2BufferResource;
	uvBuffer: Webgl2BufferResource | null;
	layerSlotBuffer: Webgl2BufferResource | null;
	indexBuffer: Webgl2BufferResource;
	indexType: GLenum;
	vertexCount: number;
	triangleCount: number;
	modelMatrix: RenderMat4;
	readiness: Webgl2TerrainTileReadiness;
	dataSource: TerrainSceneTile["dataSource"];
	bvhItemKeys: RenderBvhItemKey[];
	bvhFallbackReason: string | null;
	compatibilityDraws: Webgl2TerrainTileCompatibilityDrawResource[];
	layerPlan: TerrainTileLayerPlan | null;
	layerPlanBlockers: readonly string[];
	texturePageBindings: Webgl2TerrainTileTexturePageBinding[];
	texturePageBlockers: readonly string[];
	oneDrawReadiness: Webgl2TerrainTileOneDrawReadiness;
	drawSlices: Webgl2TerrainTileDrawSliceResource[];
}

export interface Webgl2TerrainTileDrawSliceResource {
	id: string;
	parentTerrainTileId: string;
	reason: string;
	geometrySignature: string;
	vertexArray: Webgl2VertexArrayResource;
	vertexBuffer: Webgl2BufferResource;
	uvBuffer: Webgl2BufferResource;
	layerSlotBuffer: Webgl2BufferResource;
	indexBuffer: Webgl2BufferResource;
	indexType: GLenum;
	vertexCount: number;
	triangleCount: number;
	modelMatrix: RenderMat4;
	bvhItemKeys: RenderBvhItemKey[];
	layerPlan: TerrainTileLayerPlan;
	texturePageBindings: Webgl2TerrainTileTexturePageBinding[];
	texturePageBlockers: readonly string[];
	oneDrawReadiness: Webgl2TerrainTileOneDrawReadiness;
}

export interface Webgl2TerrainTileTexturePageBinding {
	family: Extract<TexturePageFamily, "terrain-color" | "terrain-mask" | "terrain-detail">;
	atlasEntryKey: string;
	textureIndex: number | null;
	rect: readonly [number, number, number, number] | null;
}

export type Webgl2TerrainTileOneDrawReadiness =
	| {
			status: "ready";
			layerEntryCount: number;
			texturePageBindingCount: number;
			colorPageBindingCount: number;
			maskPageBindingCount: number;
	  }
	| {
			status: "blocked";
			blockers: readonly string[];
	  };

export interface Webgl2TerrainTileRenderCandidate {
	id: string;
	terrainTileId: string;
	landblockId: number;
	sceneDomain: Webgl2SceneDomain;
	bvhItemKeys: readonly RenderBvhItemKey[];
	bvhFallbackReason: string | null;
	compatibilityDrawCount: number;
}

export function terrainTileResourceId(
	tile: Pick<TerrainSceneTile, "assetId">,
): string {
	return `terrain-tile/${tile.assetId}`;
}

export function deriveTerrainTileRenderCandidate(
	resource: Webgl2TerrainTileResource,
): Webgl2TerrainTileRenderCandidate {
	return {
		id: resource.id,
		terrainTileId: resource.id,
		landblockId: resource.landblockId,
		sceneDomain: "exterior",
		bvhItemKeys: [...resource.bvhItemKeys],
		bvhFallbackReason: resource.bvhFallbackReason,
		compatibilityDrawCount: resource.compatibilityDraws.length,
	};
}

export function describeTerrainTileGeometrySignature(
	geometry: StagedWorldIndexedGeometry,
): string {
	return [
		`v:${geometry.vertexCount}`,
		`t:${geometry.triangleCount}`,
		`p:${geometry.positions.length}:${hashFloat32Array(geometry.positions)}`,
		`u:${geometry.uvs ? `${geometry.uvs.length}:${hashFloat32Array(geometry.uvs)}` : "none"}`,
		`i:${geometry.indices.length}:${hashIndexArray(geometry.indices)}`,
	].join("|");
}

export function describeTerrainTileGraphSignature(
	resource: Webgl2TerrainTileResource,
): string {
	return [
		resource.id,
		formatHex32(resource.landblockId),
		resource.placementKey,
		resource.geometrySignature,
		resource.readiness.status,
		resource.readiness.status === "ready"
			? resource.readiness.terrainMaterialAssetId
			: resource.readiness.reason,
		`compat:${resource.compatibilityDraws
			.map((draw) => `${draw.id}:${draw.geometrySignature}:${draw.blend ? "blend" : "debug"}`)
			.join(",")}`,
		`layer:${resource.layerPlan?.signature ?? "none"}`,
		`layer-blockers:${resource.layerPlanBlockers.join(",")}`,
		`pages:${resource.texturePageBindings
			.map((binding) => `${binding.family}:${binding.atlasEntryKey}`)
			.join(",")}`,
		`blockers:${resource.texturePageBlockers.join(",")}`,
		`one-draw:${describeTerrainTileOneDrawReadiness(resource.oneDrawReadiness)}`,
		`slices:${resource.drawSlices
			.map(
				(slice) =>
					`${slice.id}:${slice.geometrySignature}:${describeTerrainTileOneDrawReadiness(slice.oneDrawReadiness)}`,
			)
			.join(",")}`,
		`bvh:${resource.bvhItemKeys.join(",")}`,
	].join("|");
}

export function collectTerrainTileCompatibilityTextureKeys(
	resource: Webgl2TerrainTileResource,
): readonly string[] {
	return resource.compatibilityDraws.flatMap((draw) => {
		if (!draw.blend) {
			return [];
		}
		return [
			draw.blend.base.key,
			...draw.blend.overlays.flatMap((overlay) => [
				overlay.terrain.key,
				overlay.alpha.key,
			]),
			...draw.blend.roads.flatMap((road) => [road.road.key, road.alpha.key]),
		];
	});
}

export function describeTerrainBlendTextureAtlasEntryKey(
	ref: TerrainBlendTextureRef,
): string {
	return [
		"terrain-page",
		ref.role,
		formatHex32(ref.renderSurface.renderSurfaceId),
		ref.renderSurface.formatRaw,
		ref.renderSurface.width,
		ref.renderSurface.height,
	].join("/");
}

export function createBlockedTerrainTileOneDrawReadiness(
	blockers: readonly string[],
): Webgl2TerrainTileOneDrawReadiness {
	return {
		status: "blocked",
		blockers: [...new Set(blockers)].sort(),
	};
}

export function deriveTerrainTileOneDrawReadiness(
	resource: Webgl2TerrainTileResource,
): Webgl2TerrainTileOneDrawReadiness {
	const blockers = collectTerrainTileOneDrawBlockers(resource);
	if (blockers.length > 0) {
		return createBlockedTerrainTileOneDrawReadiness(blockers);
	}
	const colorPageBindingCount = resource.texturePageBindings.filter(
		(binding) => binding.family === "terrain-color",
	).length;
	const maskPageBindingCount = resource.texturePageBindings.filter(
		(binding) => binding.family === "terrain-mask",
	).length;
	return {
		status: "ready",
		layerEntryCount: resource.layerPlan?.layerEntries.length ?? 0,
		texturePageBindingCount: resource.texturePageBindings.length,
		colorPageBindingCount,
		maskPageBindingCount,
	};
}

export function deriveTerrainDrawSliceOneDrawReadiness(
	slice: Webgl2TerrainTileDrawSliceResource,
): Webgl2TerrainTileOneDrawReadiness {
	const blockers = collectTerrainLayerRenderableBlockers({
		layerPlan: slice.layerPlan,
		layerPlanBlockers: [],
		texturePageBindings: slice.texturePageBindings,
		texturePageBlockers: slice.texturePageBlockers,
		hasUvBuffer: true,
		hasLayerSlotBuffer: true,
		resourceLabel: "terrain draw slice",
	});
	if (blockers.length > 0) {
		return createBlockedTerrainTileOneDrawReadiness(blockers);
	}
	const colorPageBindingCount = slice.texturePageBindings.filter(
		(binding) => binding.family === "terrain-color",
	).length;
	const maskPageBindingCount = slice.texturePageBindings.filter(
		(binding) => binding.family === "terrain-mask",
	).length;
	return {
		status: "ready",
		layerEntryCount: slice.layerPlan.layerEntries.length,
		texturePageBindingCount: slice.texturePageBindings.length,
		colorPageBindingCount,
		maskPageBindingCount,
	};
}

function collectTerrainTileOneDrawBlockers(
	resource: Webgl2TerrainTileResource,
): string[] {
	return collectTerrainLayerRenderableBlockers({
		layerPlan: resource.layerPlan,
		layerPlanBlockers: resource.layerPlanBlockers,
		texturePageBindings: resource.texturePageBindings,
		texturePageBlockers: resource.texturePageBlockers,
		hasUvBuffer: resource.uvBuffer !== null,
		hasLayerSlotBuffer: resource.layerSlotBuffer !== null,
		resourceLabel: "terrain tile",
	});
}

function collectTerrainLayerRenderableBlockers({
	layerPlan,
	layerPlanBlockers,
	texturePageBindings,
	texturePageBlockers,
	hasUvBuffer,
	hasLayerSlotBuffer,
	resourceLabel,
}: {
	layerPlan: TerrainTileLayerPlan | null;
	layerPlanBlockers: readonly string[];
	texturePageBindings: readonly Webgl2TerrainTileTexturePageBinding[];
	texturePageBlockers: readonly string[];
	hasUvBuffer: boolean;
	hasLayerSlotBuffer: boolean;
	resourceLabel: string;
}): string[] {
	const blockers = [...layerPlanBlockers, ...texturePageBlockers];
	if (!layerPlan) {
		blockers.push(`${resourceLabel} has no layer plan`);
	} else if (layerPlan.layerEntries.length === 0) {
		blockers.push(`${resourceLabel} layer plan has no entries`);
	}
	if (!hasUvBuffer) {
		blockers.push(`${resourceLabel} one-draw geometry has no uv buffer`);
	}
	if (!hasLayerSlotBuffer) {
		blockers.push(`${resourceLabel} one-draw geometry has no layer-slot buffer`);
	}
	const requiresColorPages =
		layerPlan?.layerEntries.some((entry) => entry.colorRefCount > 0) ??
		false;
	const colorTextureIndices = collectTerrainPageTextureIndices(
		texturePageBindings.filter(
			(binding) => binding.family === "terrain-color",
		),
	);
	if (
		requiresColorPages &&
		colorTextureIndices.length === 0
	) {
		blockers.push(`${resourceLabel} one-draw path has no terrain color page bindings`);
	}
	if (colorTextureIndices.length > 1) {
		blockers.push(
			`${resourceLabel} one-draw path requires ${colorTextureIndices.length} terrain color atlas textures`,
		);
	}
	const requiresMaskPages =
		layerPlan?.layerEntries.some((entry) => entry.maskRefCount > 0) ??
		false;
	const maskTextureIndices = collectTerrainPageTextureIndices(
		texturePageBindings.filter(
			(binding) => binding.family === "terrain-mask",
		),
	);
	if (
		requiresMaskPages &&
		maskTextureIndices.length === 0
	) {
		blockers.push(`${resourceLabel} one-draw path has no terrain mask page bindings`);
	}
	if (maskTextureIndices.length > 1) {
		blockers.push(
			`${resourceLabel} one-draw path requires ${maskTextureIndices.length} terrain mask atlas textures`,
		);
	}
	for (const ref of collectTerrainLayerTextureRefs(layerPlan)) {
		const atlasEntryKey = describeTerrainBlendTextureAtlasEntryKey(ref);
		const expectedFamily = ref.role === "mask" ? "terrain-mask" : "terrain-color";
		if (
			!texturePageBindings.some(
				(binding) =>
					binding.family === expectedFamily &&
					binding.atlasEntryKey === atlasEntryKey &&
					binding.textureIndex !== null &&
					binding.rect !== null,
			)
		) {
			blockers.push(
				`${resourceLabel} one-draw path is missing ${expectedFamily} binding ${atlasEntryKey}`,
			);
		}
	}
	return [...new Set(blockers)].sort();
}

function collectTerrainPageTextureIndices(
	bindings: readonly Webgl2TerrainTileTexturePageBinding[],
): number[] {
	return [
		...new Set(
			bindings.flatMap((binding) =>
				binding.textureIndex === null ? [] : [binding.textureIndex],
			),
		),
	].sort((left, right) => left - right);
}

function collectTerrainLayerTextureRefs(
	layerPlan: TerrainTileLayerPlan | null,
): TerrainBlendTextureRef[] {
	const refs =
		layerPlan?.layerEntries.flatMap((entry) => [
			entry.plan.base,
			...entry.plan.overlays.flatMap((overlay) => [
				overlay.terrain,
				overlay.alpha,
			]),
			...entry.plan.roads.flatMap((road) => [road.road, road.alpha]),
		]) ?? [];
	const refsByKey = new Map(
		refs.map((ref) => [
			`${ref.role}/${describeTerrainBlendTextureAtlasEntryKey(ref)}`,
			ref,
		] as const),
	);
	return [...refsByKey.values()];
}

function describeTerrainTileOneDrawReadiness(
	readiness: Webgl2TerrainTileOneDrawReadiness,
): string {
	return readiness.status === "ready"
		? `ready:${readiness.layerEntryCount}:${readiness.texturePageBindingCount}:${readiness.colorPageBindingCount}:${readiness.maskPageBindingCount}`
		: `blocked:${readiness.blockers.join(",")}`;
}

export function destroyWebgl2TerrainTileResource(
	resource: Webgl2TerrainTileResource,
): void {
	resource.vertexArray.dispose();
	resource.vertexBuffer.dispose();
	resource.uvBuffer?.dispose();
	resource.layerSlotBuffer?.dispose();
	resource.indexBuffer.dispose();
	for (const slice of resource.drawSlices) {
		destroyWebgl2TerrainTileDrawSlice(slice);
	}
	for (const draw of resource.compatibilityDraws) {
		destroyWebgl2TerrainTileCompatibilityDraw(draw);
	}
}

export function destroyWebgl2TerrainTileDrawSlice(
	slice: Webgl2TerrainTileDrawSliceResource,
): void {
	slice.vertexArray.dispose();
	slice.vertexBuffer.dispose();
	slice.uvBuffer.dispose();
	slice.layerSlotBuffer.dispose();
	slice.indexBuffer.dispose();
}

export function destroyWebgl2TerrainTileCompatibilityDraw(
	draw: Webgl2TerrainTileCompatibilityDrawResource,
): void {
	draw.vertexArray.dispose();
	draw.vertexBuffer.dispose();
	draw.uvBuffer?.dispose();
	draw.layerSlotBuffer?.dispose();
	draw.indexBuffer.dispose();
}

function hashFloat32Array(values: Float32Array): string {
	let hash = 0x811c9dc5;
	const view = new DataView(
		values.buffer,
		values.byteOffset,
		values.byteLength,
	);
	for (let byteOffset = 0; byteOffset < view.byteLength; byteOffset += 1) {
		hash ^= view.getUint8(byteOffset);
		hash = Math.imul(hash, 0x01000193);
	}
	return (hash >>> 0).toString(16).padStart(8, "0");
}

function hashIndexArray(values: Uint16Array | Uint32Array): string {
	let hash = 0x811c9dc5;
	const view = new DataView(
		values.buffer,
		values.byteOffset,
		values.byteLength,
	);
	for (let byteOffset = 0; byteOffset < view.byteLength; byteOffset += 1) {
		hash ^= view.getUint8(byteOffset);
		hash = Math.imul(hash, 0x01000193);
	}
	return (hash >>> 0).toString(16).padStart(8, "0");
}
