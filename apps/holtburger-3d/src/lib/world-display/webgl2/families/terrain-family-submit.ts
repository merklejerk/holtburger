import { multiplyMat4, type RenderMat4 } from "../../render-math";
import { createWebgl2Program, type Webgl2ProgramResource } from "../../webgl2-gl";
import type { Webgl2StateCache } from "../../webgl2-state-cache";
import {
	describeTerrainBlendTextureAtlasEntryKey,
	type Webgl2TerrainTileResource,
	type Webgl2TerrainTileTexturePageBinding,
} from "../resources/terrain-tile-resources";
import type { Webgl2TextureAtlasGenerationResource } from "../resources/texture-atlas-generation";
import { applyOpaqueCompactedFamilyRenderState } from "./family-render-state";

const WEBGL2_TERRAIN_FAMILY_MAX_LAYER_ENTRIES = 8;
const TERRAIN_FAMILY_MAX_OVERLAYS_PER_LAYER = 3;
const TERRAIN_FAMILY_MAX_ROADS_PER_LAYER = 2;

export type Webgl2TerrainFamilyWorldProgram = Webgl2ProgramResource<
	"position" | "uv" | "terrainLayerSlot",
	| "uModelViewProjection"
	| "uColorAtlasTexture"
	| "uColorAtlasSize"
	| "uMaskAtlasTexture"
	| "uMaskAtlasSize"
	| "uLayerBaseColorRects"
	| "uLayerBaseTilings"
	| "uLayerOverlayColorRects"
	| "uLayerOverlayMaskRects"
	| "uLayerOverlayTilings"
	| "uLayerOverlayRotations"
	| "uLayerOverlayCounts"
	| "uLayerRoadColorRects"
	| "uLayerRoadMaskRects"
	| "uLayerRoadTilings"
	| "uLayerRoadRotations"
	| "uLayerRoadCounts"
>;

export interface Webgl2TerrainFamilySubmitMetrics {
	shaderDrawCallCount: number;
	submittedTileCount: number;
	submittedTriangleCount: number;
	fallbackSamples: readonly string[];
}

export function createWebgl2TerrainFamilyWorldProgram(
	gl: WebGL2RenderingContext,
): Webgl2TerrainFamilyWorldProgram {
	return createWebgl2Program(gl, {
		label: "webgl2 terrain family world",
		vertexSource: TERRAIN_FAMILY_WORLD_VERTEX_SHADER,
		fragmentSource: TERRAIN_FAMILY_WORLD_FRAGMENT_SHADER,
		attributes: ["position", "uv", "terrainLayerSlot"],
		uniforms: [
			"uModelViewProjection",
			"uColorAtlasTexture",
			"uColorAtlasSize",
			"uMaskAtlasTexture",
			"uMaskAtlasSize",
			"uLayerBaseColorRects",
			"uLayerBaseTilings",
			"uLayerOverlayColorRects",
			"uLayerOverlayMaskRects",
			"uLayerOverlayTilings",
			"uLayerOverlayRotations",
			"uLayerOverlayCounts",
			"uLayerRoadColorRects",
			"uLayerRoadMaskRects",
			"uLayerRoadTilings",
			"uLayerRoadRotations",
			"uLayerRoadCounts",
		],
	});
}

export function describeWebgl2TerrainFamilyFragmentShaderSource(): string {
	return TERRAIN_FAMILY_WORLD_FRAGMENT_SHADER;
}

export function submitWebgl2TerrainFamilyTiles({
	gl,
	stateCache,
	program,
	viewProjectionMatrix,
	terrainTiles,
	generation,
	terrainBackfaceCulling,
}: {
	gl: WebGL2RenderingContext;
	stateCache: Webgl2StateCache;
	program: Webgl2TerrainFamilyWorldProgram;
	viewProjectionMatrix: RenderMat4;
	terrainTiles: readonly Webgl2TerrainTileResource[];
	generation: Webgl2TextureAtlasGenerationResource;
	terrainBackfaceCulling: boolean;
}): Webgl2TerrainFamilySubmitMetrics {
	const metrics: Webgl2TerrainFamilySubmitMetrics = {
		shaderDrawCallCount: 0,
		submittedTileCount: 0,
		submittedTriangleCount: 0,
		fallbackSamples: [],
	};
	if (terrainTiles.length === 0) {
		return metrics;
	}
	stateCache.useProgram(program.program);
	applyOpaqueCompactedFamilyRenderState({ gl, stateCache });
	stateCache.setCullState({
		enabled: terrainBackfaceCulling,
		mode: gl.BACK,
	});
	gl.uniform1i(program.uniforms.uColorAtlasTexture, 0);
	gl.uniform1i(program.uniforms.uMaskAtlasTexture, 1);
	for (const tile of terrainTiles) {
		const submitPlan = createTerrainTileFamilySubmitPlan(tile, generation);
		if (!submitPlan) {
			metrics.fallbackSamples = [
				...metrics.fallbackSamples,
				`terrain tile ${tile.id} was marked one-draw-ready but could not create a submit plan`,
			].slice(0, 8);
			continue;
		}
		if (stateCache.bindTexture2D(0, submitPlan.colorAtlasTexture.texture.texture)) {
			// Counted in aggregate state metrics by the world submitter.
		}
		if (stateCache.bindTexture2D(1, submitPlan.maskAtlasTexture.texture.texture)) {
			// Counted in aggregate state metrics by the world submitter.
		}
		gl.uniform2f(
			program.uniforms.uColorAtlasSize,
			submitPlan.colorAtlasTexture.width,
			submitPlan.colorAtlasTexture.height,
		);
		gl.uniform2f(
			program.uniforms.uMaskAtlasSize,
			submitPlan.maskAtlasTexture.width,
			submitPlan.maskAtlasTexture.height,
		);
		uploadTerrainLayerUniforms(gl, program, tile);
		if (stateCache.bindVertexArray(tile.vertexArray.vertexArray)) {
			// Counted in aggregate state metrics by the world submitter.
		}
		metrics.submittedTileCount += 1;
		metrics.submittedTriangleCount += tile.triangleCount;
		metrics.shaderDrawCallCount += 1;
		gl.uniformMatrix4fv(
			program.uniforms.uModelViewProjection,
			false,
			multiplyMat4(viewProjectionMatrix, tile.modelMatrix),
		);
		gl.drawElements(gl.TRIANGLES, tile.vertexCount, tile.indexType, 0);
	}
	return metrics;
}

function createTerrainTileFamilySubmitPlan(
	tile: Webgl2TerrainTileResource,
	generation: Webgl2TextureAtlasGenerationResource,
) {
	const colorTextureIndex = singleTerrainTextureIndex(
		tile.texturePageBindings,
		"terrain-color",
	);
	if (colorTextureIndex === null) {
		return null;
	}
	const maskTextureIndex =
		singleTerrainTextureIndex(tile.texturePageBindings, "terrain-mask") ??
		colorTextureIndex;
	const colorAtlasTexture =
		generation.textures.find(
			(texture) => texture.textureIndex === colorTextureIndex,
		) ?? null;
	const maskAtlasTexture =
		generation.textures.find(
			(texture) => texture.textureIndex === maskTextureIndex,
		) ?? null;
	if (!colorAtlasTexture || !maskAtlasTexture) {
		return null;
	}
	return {
		colorAtlasTexture,
		maskAtlasTexture,
	};
}

function singleTerrainTextureIndex(
	bindings: readonly Webgl2TerrainTileTexturePageBinding[],
	family: Webgl2TerrainTileTexturePageBinding["family"],
): number | null {
	const indices = [
		...new Set(
			bindings.flatMap((binding) =>
				binding.family === family && binding.textureIndex !== null
					? [binding.textureIndex]
					: [],
			),
		),
	];
	return indices.length === 1 ? (indices[0] ?? null) : null;
}

function uploadTerrainLayerUniforms(
	gl: WebGL2RenderingContext,
	program: Webgl2TerrainFamilyWorldProgram,
	tile: Webgl2TerrainTileResource,
): void {
	if (!tile.layerPlan) {
		throw new Error(`Terrain tile ${tile.id} has no terrain layer plan.`);
	}
	const baseColorRects = new Float32Array(
		WEBGL2_TERRAIN_FAMILY_MAX_LAYER_ENTRIES * 4,
	);
	const baseTilings = new Float32Array(WEBGL2_TERRAIN_FAMILY_MAX_LAYER_ENTRIES);
	const overlayColorRects = new Float32Array(
		WEBGL2_TERRAIN_FAMILY_MAX_LAYER_ENTRIES *
			TERRAIN_FAMILY_MAX_OVERLAYS_PER_LAYER *
			4,
	);
	const overlayMaskRects = new Float32Array(
		WEBGL2_TERRAIN_FAMILY_MAX_LAYER_ENTRIES *
			TERRAIN_FAMILY_MAX_OVERLAYS_PER_LAYER *
			4,
	);
	const overlayTilings = new Float32Array(
		WEBGL2_TERRAIN_FAMILY_MAX_LAYER_ENTRIES *
			TERRAIN_FAMILY_MAX_OVERLAYS_PER_LAYER,
	);
	const overlayRotations = new Int32Array(
		WEBGL2_TERRAIN_FAMILY_MAX_LAYER_ENTRIES *
			TERRAIN_FAMILY_MAX_OVERLAYS_PER_LAYER,
	);
	const overlayCounts = new Int32Array(WEBGL2_TERRAIN_FAMILY_MAX_LAYER_ENTRIES);
	const roadColorRects = new Float32Array(WEBGL2_TERRAIN_FAMILY_MAX_LAYER_ENTRIES * 4);
	const roadMaskRects = new Float32Array(
		WEBGL2_TERRAIN_FAMILY_MAX_LAYER_ENTRIES *
			TERRAIN_FAMILY_MAX_ROADS_PER_LAYER *
			4,
	);
	const roadTilings = new Float32Array(WEBGL2_TERRAIN_FAMILY_MAX_LAYER_ENTRIES);
	const roadRotations = new Int32Array(
		WEBGL2_TERRAIN_FAMILY_MAX_LAYER_ENTRIES *
			TERRAIN_FAMILY_MAX_ROADS_PER_LAYER,
	);
	const roadCounts = new Int32Array(WEBGL2_TERRAIN_FAMILY_MAX_LAYER_ENTRIES);

	for (const layer of tile.layerPlan.layerEntries) {
		baseColorRects.set(
			resolveTerrainBindingRect(tile, describeTerrainBlendTextureAtlasEntryKey(layer.plan.base)),
			layer.slot * 4,
		);
		baseTilings[layer.slot] = layer.plan.base.tiling;
		overlayCounts[layer.slot] = Math.min(
			layer.plan.overlays.length,
			TERRAIN_FAMILY_MAX_OVERLAYS_PER_LAYER,
		);
		for (const [overlayIndex, overlay] of layer.plan.overlays
			.slice(0, TERRAIN_FAMILY_MAX_OVERLAYS_PER_LAYER)
			.entries()) {
			const index = layer.slot * TERRAIN_FAMILY_MAX_OVERLAYS_PER_LAYER + overlayIndex;
			overlayColorRects.set(
				resolveTerrainBindingRect(
					tile,
					describeTerrainBlendTextureAtlasEntryKey(overlay.terrain),
				),
				index * 4,
			);
			overlayMaskRects.set(
				resolveTerrainBindingRect(
					tile,
					describeTerrainBlendTextureAtlasEntryKey(overlay.alpha),
				),
				index * 4,
			);
			overlayTilings[index] = overlay.terrain.tiling;
			overlayRotations[index] = overlay.rotation;
		}
		roadCounts[layer.slot] = Math.min(
			layer.plan.roads.length,
			TERRAIN_FAMILY_MAX_ROADS_PER_LAYER,
		);
		const roadTexture = layer.plan.roads[0]?.road ?? null;
		if (roadTexture) {
			roadColorRects.set(
				resolveTerrainBindingRect(
					tile,
					describeTerrainBlendTextureAtlasEntryKey(roadTexture),
				),
				layer.slot * 4,
			);
			roadTilings[layer.slot] = roadTexture.tiling;
		}
		for (const [roadIndex, road] of layer.plan.roads
			.slice(0, TERRAIN_FAMILY_MAX_ROADS_PER_LAYER)
			.entries()) {
			const index = layer.slot * TERRAIN_FAMILY_MAX_ROADS_PER_LAYER + roadIndex;
			roadMaskRects.set(
				resolveTerrainBindingRect(
					tile,
					describeTerrainBlendTextureAtlasEntryKey(road.alpha),
				),
				index * 4,
			);
			roadRotations[index] = road.rotation;
		}
	}

	gl.uniform4fv(program.uniforms.uLayerBaseColorRects, baseColorRects);
	gl.uniform1fv(program.uniforms.uLayerBaseTilings, baseTilings);
	gl.uniform4fv(program.uniforms.uLayerOverlayColorRects, overlayColorRects);
	gl.uniform4fv(program.uniforms.uLayerOverlayMaskRects, overlayMaskRects);
	gl.uniform1fv(program.uniforms.uLayerOverlayTilings, overlayTilings);
	gl.uniform1iv(program.uniforms.uLayerOverlayRotations, overlayRotations);
	gl.uniform1iv(program.uniforms.uLayerOverlayCounts, overlayCounts);
	gl.uniform4fv(program.uniforms.uLayerRoadColorRects, roadColorRects);
	gl.uniform4fv(program.uniforms.uLayerRoadMaskRects, roadMaskRects);
	gl.uniform1fv(program.uniforms.uLayerRoadTilings, roadTilings);
	gl.uniform1iv(program.uniforms.uLayerRoadRotations, roadRotations);
	gl.uniform1iv(program.uniforms.uLayerRoadCounts, roadCounts);
}

function resolveTerrainBindingRect(
	tile: Webgl2TerrainTileResource,
	atlasEntryKey: string,
): readonly [number, number, number, number] {
	const binding = tile.texturePageBindings.find(
		(candidate) => candidate.atlasEntryKey === atlasEntryKey,
	);
	if (!binding?.rect) {
		throw new Error(
			`Terrain tile ${tile.id} missing terrain atlas binding ${atlasEntryKey}.`,
		);
	}
	return binding.rect;
}

const TERRAIN_FAMILY_WORLD_VERTEX_SHADER = `#version 300 es
layout(location = 0) in vec3 position;
layout(location = 1) in vec2 uv;
layout(location = 2) in float terrainLayerSlot;

uniform mat4 uModelViewProjection;

out vec2 vUv;
flat out int vLayerSlot;

void main() {
	vUv = uv;
	vLayerSlot = int(floor(terrainLayerSlot + 0.5));
	gl_Position = uModelViewProjection * vec4(position, 1.0);
}
`;

const TERRAIN_FAMILY_WORLD_FRAGMENT_SHADER = `#version 300 es
#define MAX_LAYER_ENTRIES ${WEBGL2_TERRAIN_FAMILY_MAX_LAYER_ENTRIES}
#define MAX_OVERLAYS_PER_LAYER ${TERRAIN_FAMILY_MAX_OVERLAYS_PER_LAYER}
#define MAX_ROADS_PER_LAYER ${TERRAIN_FAMILY_MAX_ROADS_PER_LAYER}

precision highp float;

uniform sampler2D uColorAtlasTexture;
uniform vec2 uColorAtlasSize;
uniform sampler2D uMaskAtlasTexture;
uniform vec2 uMaskAtlasSize;
uniform vec4 uLayerBaseColorRects[MAX_LAYER_ENTRIES];
uniform float uLayerBaseTilings[MAX_LAYER_ENTRIES];
uniform vec4 uLayerOverlayColorRects[MAX_LAYER_ENTRIES * MAX_OVERLAYS_PER_LAYER];
uniform vec4 uLayerOverlayMaskRects[MAX_LAYER_ENTRIES * MAX_OVERLAYS_PER_LAYER];
uniform float uLayerOverlayTilings[MAX_LAYER_ENTRIES * MAX_OVERLAYS_PER_LAYER];
uniform int uLayerOverlayRotations[MAX_LAYER_ENTRIES * MAX_OVERLAYS_PER_LAYER];
uniform int uLayerOverlayCounts[MAX_LAYER_ENTRIES];
uniform vec4 uLayerRoadColorRects[MAX_LAYER_ENTRIES];
uniform vec4 uLayerRoadMaskRects[MAX_LAYER_ENTRIES * MAX_ROADS_PER_LAYER];
uniform float uLayerRoadTilings[MAX_LAYER_ENTRIES];
uniform int uLayerRoadRotations[MAX_LAYER_ENTRIES * MAX_ROADS_PER_LAYER];
uniform int uLayerRoadCounts[MAX_LAYER_ENTRIES];

in vec2 vUv;
flat in int vLayerSlot;

out vec4 fragColor;

vec2 legacyAlphaUv(vec2 uv) {
	return vec2(uv.x, 1.0 - uv.y);
}

vec2 rotateLegacyAlphaUv(vec2 uv, int rotation) {
	if (rotation == 1) {
		return vec2(1.0 - uv.y, uv.x);
	}
	if (rotation == 2) {
		return vec2(1.0 - uv.x, 1.0 - uv.y);
	}
	if (rotation == 3) {
		return vec2(uv.y, 1.0 - uv.x);
	}
	return uv;
}

vec4 sampleAtlasRect(sampler2D atlasTexture, vec2 atlasSize, vec4 rect, vec2 localUv, vec2 gradX, vec2 gradY) {
	vec2 atlasUv = (rect.xy + localUv * rect.zw) / atlasSize;
	vec2 atlasGradX = gradX * rect.zw / atlasSize;
	vec2 atlasGradY = gradY * rect.zw / atlasSize;
	return textureGrad(atlasTexture, atlasUv, atlasGradX, atlasGradY);
}

vec4 sampleRepeatingColor(vec4 rect, float tiling) {
	vec2 tiledUv = vUv * tiling;
	return sampleAtlasRect(
		uColorAtlasTexture,
		uColorAtlasSize,
		rect,
		fract(tiledUv),
		dFdx(tiledUv),
		dFdy(tiledUv)
	);
}

float sampleMask(vec4 rect, int rotation) {
	vec2 maskUv = rotateLegacyAlphaUv(legacyAlphaUv(vUv), rotation);
	vec2 atlasUv = (rect.xy + maskUv * rect.zw) / uMaskAtlasSize;
	return texture(
		uMaskAtlasTexture,
		atlasUv
	).r;
}

void main() {
	int layer = clamp(vLayerSlot, 0, MAX_LAYER_ENTRIES - 1);
	vec4 color = sampleRepeatingColor(uLayerBaseColorRects[layer], uLayerBaseTilings[layer]);
	for (int overlayIndex = 0; overlayIndex < MAX_OVERLAYS_PER_LAYER; overlayIndex += 1) {
		if (overlayIndex >= uLayerOverlayCounts[layer]) {
			break;
		}
		int index = layer * MAX_OVERLAYS_PER_LAYER + overlayIndex;
		vec4 overlayColor = sampleRepeatingColor(
			uLayerOverlayColorRects[index],
			uLayerOverlayTilings[index]
		);
		float alpha = sampleMask(uLayerOverlayMaskRects[index], uLayerOverlayRotations[index]);
		color = mix(color, overlayColor, clamp(1.0 - alpha, 0.0, 1.0));
	}
	if (uLayerRoadCounts[layer] > 0) {
		vec4 roadColor = sampleRepeatingColor(
			uLayerRoadColorRects[layer],
			uLayerRoadTilings[layer]
		);
		int roadBaseIndex = layer * MAX_ROADS_PER_LAYER;
		float roadAlpha = 1.0 - sampleMask(
			uLayerRoadMaskRects[roadBaseIndex],
			uLayerRoadRotations[roadBaseIndex]
		);
		if (uLayerRoadCounts[layer] > 1) {
			roadAlpha = 1.0 - (
				sampleMask(uLayerRoadMaskRects[roadBaseIndex], uLayerRoadRotations[roadBaseIndex]) *
				sampleMask(uLayerRoadMaskRects[roadBaseIndex + 1], uLayerRoadRotations[roadBaseIndex + 1])
			);
		}
		color = mix(color, roadColor, clamp(roadAlpha, 0.0, 1.0));
	}
	fragColor = vec4(color.rgb, 1.0);
}
`;
