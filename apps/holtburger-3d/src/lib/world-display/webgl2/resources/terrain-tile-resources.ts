import { formatHex32 } from "../../../landblocks";
import type { TerrainBlendPlan } from "../../terrain-blend-plan";
import type { RenderMat4, RenderVec4 } from "../../render-math";
import type { RenderBvhItemKey } from "../../prepared-bvh-visibility";
import type { StagedWorldIndexedGeometry } from "../../staged-world-geometry";
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
}

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

export function destroyWebgl2TerrainTileResource(
	resource: Webgl2TerrainTileResource,
): void {
	resource.vertexArray.dispose();
	resource.vertexBuffer.dispose();
	resource.uvBuffer?.dispose();
	resource.indexBuffer.dispose();
	for (const draw of resource.compatibilityDraws) {
		destroyWebgl2TerrainTileCompatibilityDraw(draw);
	}
}

export function destroyWebgl2TerrainTileCompatibilityDraw(
	draw: Webgl2TerrainTileCompatibilityDrawResource,
): void {
	draw.vertexArray.dispose();
	draw.vertexBuffer.dispose();
	draw.uvBuffer?.dispose();
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
