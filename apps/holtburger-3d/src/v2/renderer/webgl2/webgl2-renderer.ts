import type {
	FrameState,
	Renderer,
	RendererSnapshot,
	RendererSnapshotListener,
	StaticResidencyDelta,
	TerrainTextureBinding,
	TexturePlacementUpdate,
} from "../types";
import type {
	TerrainGeometryStaticDrawUnit,
	TerrainMaterialTextureRoleBinding,
} from "../../static/contracts";
import {
	type TextureFilteringMode,
	type TextureWrapMode,
} from "../../textures/sampling-policy";

const TERRAIN_LAYERED_MAX_LAYER_ENTRIES = 8;
const TERRAIN_LAYERED_MAX_OVERLAYS_PER_LAYER = 3;
const TERRAIN_LAYERED_MAX_ROADS_PER_LAYER = 2;
const TERRAIN_ATLAS_MIP_GRADIENT_SCALE = 0.5;

const defaultFrameState: FrameState = {
	camera: {
		position: [96, 120, 260],
		yawRadians: 0,
		pitchRadians: -0.45,
	},
	timeSeconds: 0,
};

const TERRAIN_VERTEX_SHADER = `#version 300 es
layout(location = 0) in vec3 position;
layout(location = 1) in vec2 texCoord;
layout(location = 2) in float layerSlot;

uniform mat4 uModelViewProjection;

out vec2 vTexCoord;
out vec3 vWorldPosition;
flat out int vLayerSlot;

void main() {
	vTexCoord = texCoord;
	vWorldPosition = position;
	vLayerSlot = int(layerSlot);
	gl_Position = uModelViewProjection * vec4(position, 1.0);
}
`;

const TERRAIN_FRAGMENT_SHADER = `#version 300 es
precision highp float;

uniform vec4 uColor;
uniform sampler2D uTexture;
uniform vec4 uTextureRect;
uniform vec2 uTextureSize;
uniform bool uUseTexture;
uniform int uMaterialMode;
uniform sampler2D uColorAtlasTexture;
uniform vec2 uColorAtlasSize;
uniform sampler2D uMaskAtlasTexture;
uniform vec2 uMaskAtlasSize;
uniform sampler2D uDetailAtlasTexture;
uniform vec2 uDetailAtlasSize;
uniform vec4 uDetailAtlasRect;
uniform float uDetailTiling;
uniform float uDetailFadeNear;
uniform float uDetailFadeFar;
uniform int uDetailEnabled;
uniform vec3 uCameraPosition;
uniform vec4 uLayerBaseColorRects[${TERRAIN_LAYERED_MAX_LAYER_ENTRIES}];
uniform float uLayerBaseTilings[${TERRAIN_LAYERED_MAX_LAYER_ENTRIES}];
uniform vec4 uLayerOverlayColorRects[${TERRAIN_LAYERED_MAX_LAYER_ENTRIES * TERRAIN_LAYERED_MAX_OVERLAYS_PER_LAYER}];
uniform vec4 uLayerOverlayMaskRects[${TERRAIN_LAYERED_MAX_LAYER_ENTRIES * TERRAIN_LAYERED_MAX_OVERLAYS_PER_LAYER}];
uniform float uLayerOverlayTilings[${TERRAIN_LAYERED_MAX_LAYER_ENTRIES * TERRAIN_LAYERED_MAX_OVERLAYS_PER_LAYER}];
uniform int uLayerOverlayRotations[${TERRAIN_LAYERED_MAX_LAYER_ENTRIES * TERRAIN_LAYERED_MAX_OVERLAYS_PER_LAYER}];
uniform int uLayerOverlayCounts[${TERRAIN_LAYERED_MAX_LAYER_ENTRIES}];
uniform vec4 uLayerRoadColorRects[${TERRAIN_LAYERED_MAX_LAYER_ENTRIES}];
uniform vec4 uLayerRoadMaskRects[${TERRAIN_LAYERED_MAX_LAYER_ENTRIES * TERRAIN_LAYERED_MAX_ROADS_PER_LAYER}];
uniform float uLayerRoadTilings[${TERRAIN_LAYERED_MAX_LAYER_ENTRIES}];
uniform int uLayerRoadRotations[${TERRAIN_LAYERED_MAX_LAYER_ENTRIES * TERRAIN_LAYERED_MAX_ROADS_PER_LAYER}];
uniform int uLayerRoadCounts[${TERRAIN_LAYERED_MAX_LAYER_ENTRIES}];

in vec2 vTexCoord;
in vec3 vWorldPosition;
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
	vec2 atlasGradX = gradX * rect.zw / atlasSize * ${TERRAIN_ATLAS_MIP_GRADIENT_SCALE.toFixed(8)};
	vec2 atlasGradY = gradY * rect.zw / atlasSize * ${TERRAIN_ATLAS_MIP_GRADIENT_SCALE.toFixed(8)};
	return textureGrad(atlasTexture, atlasUv, atlasGradX, atlasGradY);
}

vec4 sampleRepeatingColor(vec4 rect, float tiling) {
	vec2 tiledUv = vTexCoord * tiling;
	return sampleAtlasRect(
		uColorAtlasTexture,
		uColorAtlasSize,
		rect,
		fract(tiledUv),
		dFdx(tiledUv),
		dFdy(tiledUv)
	);
}

vec4 sampleRepeatingDetail() {
	vec2 tiledUv = vTexCoord * uDetailTiling;
	return sampleAtlasRect(
		uDetailAtlasTexture,
		uDetailAtlasSize,
		uDetailAtlasRect,
		fract(tiledUv),
		dFdx(tiledUv),
		dFdy(tiledUv)
	);
}

float terrainDetailFade() {
	float cameraDistance = length(vWorldPosition - uCameraPosition);
	return clamp(
		(uDetailFadeFar - cameraDistance) / max(uDetailFadeFar - uDetailFadeNear, 0.0001),
		0.0,
		1.0
	);
}

float sampleMask(vec4 rect, int rotation) {
	vec2 maskUv = rotateLegacyAlphaUv(legacyAlphaUv(vTexCoord), rotation);
	vec2 atlasUv = (rect.xy + maskUv * rect.zw) / uMaskAtlasSize;
	return texture(uMaskAtlasTexture, atlasUv).r;
}

vec4 sampleLayeredTerrain() {
	int layer = clamp(vLayerSlot, 0, ${TERRAIN_LAYERED_MAX_LAYER_ENTRIES - 1});
	vec4 color = sampleRepeatingColor(uLayerBaseColorRects[layer], uLayerBaseTilings[layer]);
	for (int overlayIndex = 0; overlayIndex < ${TERRAIN_LAYERED_MAX_OVERLAYS_PER_LAYER}; overlayIndex += 1) {
		if (overlayIndex >= uLayerOverlayCounts[layer]) {
			break;
		}
		int index = layer * ${TERRAIN_LAYERED_MAX_OVERLAYS_PER_LAYER} + overlayIndex;
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
		int roadBaseIndex = layer * ${TERRAIN_LAYERED_MAX_ROADS_PER_LAYER};
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
	if (uDetailEnabled == 1) {
		vec4 detailColor = sampleRepeatingDetail();
		float detailWeight = clamp(detailColor.a * terrainDetailFade(), 0.0, 1.0);
		color.rgb = mix(color.rgb, detailColor.rgb, detailWeight);
	}
	return vec4(color.rgb, 1.0);
}

void main() {
	if (uMaterialMode == 2) {
		fragColor = sampleLayeredTerrain();
		return;
	}
	vec2 localUv = fract(vTexCoord);
	vec2 atlasUv = (uTextureRect.xy + localUv * uTextureRect.zw) / uTextureSize;
	vec2 atlasGradX = dFdx(vTexCoord) * uTextureRect.zw / uTextureSize * ${TERRAIN_ATLAS_MIP_GRADIENT_SCALE.toFixed(8)};
	vec2 atlasGradY = dFdy(vTexCoord) * uTextureRect.zw / uTextureSize * ${TERRAIN_ATLAS_MIP_GRADIENT_SCALE.toFixed(8)};
	vec4 textureColor = textureGrad(uTexture, atlasUv, atlasGradX, atlasGradY);
	fragColor = uUseTexture ? textureColor : uColor;
}
`;

export function createWebgl2Renderer(canvas: HTMLCanvasElement): Renderer {
	const gl = canvas.getContext("webgl2", {
		alpha: false,
		antialias: true,
		depth: true,
		stencil: false,
	});

	if (!gl) {
		throw new Error("WebGL2 is not available in this browser.");
	}

	return new Webgl2Renderer(canvas, gl);
}

class Webgl2Renderer implements Renderer {
	readonly #canvas: HTMLCanvasElement;
	readonly #gl: WebGL2RenderingContext;
	readonly #listeners = new Set<RendererSnapshotListener>();
	readonly #terrainResources = new Map<string, TerrainGeometryResource>();
	readonly #textures = new Map<string, WebGLTexture>();
	readonly #terrainTextureBindings = new Map<
		string,
		Map<string, TerrainTextureBinding>
	>();
	readonly #warnedLayeredFallbackDrawUnitIds = new Set<string>();
	readonly #terrainProgram: TerrainGeometryProgram;
	#animationFrameId: number | null = null;
	#disposed = false;
	#frameCount = 0;
	#frameState = defaultFrameState;
	#error: string | null = null;

	constructor(canvas: HTMLCanvasElement, gl: WebGL2RenderingContext) {
		this.#canvas = canvas;
		this.#gl = gl;
		this.#terrainProgram = createTerrainGeometryProgram(gl);
		this.#startFrameLoop();
	}

	applyStaticDelta(delta: StaticResidencyDelta): void {
		for (const drawUnitId of delta.removedDrawUnitIds) {
			const resource = this.#terrainResources.get(drawUnitId);
			if (!resource) {
				continue;
			}
			resource.dispose();
			this.#terrainResources.delete(drawUnitId);
			this.#terrainTextureBindings.delete(drawUnitId);
			this.#warnedLayeredFallbackDrawUnitIds.delete(drawUnitId);
		}

		for (const placement of delta.addedDrawUnitPlacements) {
			const { drawUnit } = placement;
			if (drawUnit.kind !== "terrain-geometry") {
				continue;
			}

			this.#terrainResources.get(drawUnit.drawUnitId)?.dispose();
			this.#terrainResources.set(
				drawUnit.drawUnitId,
				createTerrainGeometryResource(
					this.#gl,
					drawUnit,
					placement.translation,
				),
			);
		}

		this.#emit();
	}

	applyDynamicDelta(): void {
		// Dynamic renderer residency starts after static pipeline contracts are proven.
	}

	applyTexturePlacementUpdate(update: TexturePlacementUpdate): void {
		const gl = this.#gl;
		for (const textureRefId of update.removedTextureRefIds) {
			const texture = this.#textures.get(textureRefId);
			if (!texture) {
				continue;
			}
			gl.deleteTexture(texture);
			this.#textures.delete(textureRefId);
		}

		for (const placement of update.placements) {
			const texture = createDirectTexture(gl, placement);
			const previousTexture = this.#textures.get(placement.textureRefId);
			if (previousTexture) {
				gl.deleteTexture(previousTexture);
			}
			this.#textures.set(placement.textureRefId, texture);
		}

		for (const binding of update.drawUnitBindings) {
			const bindings =
				this.#terrainTextureBindings.get(binding.drawUnitId) ?? new Map();
			bindings.set(binding.textureUseId, binding);
			this.#terrainTextureBindings.set(binding.drawUnitId, bindings);
		}
	}

	applySamplerPolicyUpdate(): void {
		// Sampler policy changes are part of the renderer contract, not Phase 1 behavior.
	}

	updateFrameState(state: FrameState): void {
		this.#frameState = state;
	}

	subscribe(listener: RendererSnapshotListener): () => void {
		this.#listeners.add(listener);
		listener(this.#createSnapshot());

		return () => {
			this.#listeners.delete(listener);
		};
	}

	dispose(): void {
		this.#disposed = true;

		if (this.#animationFrameId !== null) {
			cancelAnimationFrame(this.#animationFrameId);
			this.#animationFrameId = null;
		}

		for (const resource of this.#terrainResources.values()) {
			resource.dispose();
		}
		for (const texture of this.#textures.values()) {
			this.#gl.deleteTexture(texture);
		}
		this.#terrainResources.clear();
		this.#textures.clear();
		this.#terrainTextureBindings.clear();
		this.#warnedLayeredFallbackDrawUnitIds.clear();
		this.#terrainProgram.dispose();
		this.#listeners.clear();
	}

	#startFrameLoop(): void {
		const renderFrame = (timestampMilliseconds: number): void => {
			if (this.#disposed) {
				return;
			}

			try {
				this.#render(timestampMilliseconds / 1000);
			} catch (error) {
				this.#error = error instanceof Error ? error.message : String(error);
				this.#emit();
				this.dispose();
				return;
			}

			this.#animationFrameId = requestAnimationFrame(renderFrame);
		};

		this.#animationFrameId = requestAnimationFrame(renderFrame);
	}

	#render(timeSeconds: number): void {
		this.#resizeToDisplaySize();

		const gl = this.#gl;
		const frameTime = this.#frameState.timeSeconds || timeSeconds;
		const pulse = 0.5 + Math.sin(frameTime * 0.7) * 0.5;

		gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
		gl.enable(gl.DEPTH_TEST);
		gl.clearColor(0.025 + pulse * 0.015, 0.045, 0.065 + pulse * 0.025, 1);
		gl.clearDepth(1);
		gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
		this.#drawTerrain();

		this.#frameCount += 1;
		this.#emit();
	}

	#drawTerrain(): void {
		if (this.#terrainResources.size === 0) {
			return;
		}

		const gl = this.#gl;
		const mvp = createModelViewProjectionMatrix(
			this.#frameState,
			gl.drawingBufferWidth / Math.max(1, gl.drawingBufferHeight),
		);

		gl.useProgram(this.#terrainProgram.program);
		gl.uniformMatrix4fv(
			this.#terrainProgram.uniforms.uModelViewProjection,
			false,
			mvp,
		);
		gl.uniform4f(this.#terrainProgram.uniforms.uColor, 0.22, 0.72, 0.42, 1);

		for (const resource of this.#terrainResources.values()) {
			const bindings =
				this.#terrainTextureBindings.get(resource.drawUnitId) ?? new Map();
			const binding = resource.primaryTextureUseId
				? bindings.get(resource.primaryTextureUseId)
				: undefined;
			const texture = binding
				? (this.#textures.get(binding.textureRefId) ?? null)
				: null;
			const useTexture =
				resource.materialFamily === "terrain-single-base-color" &&
				texture !== null;
			const useLayered =
				resource.materialFamily === "terrain-layered" &&
				uploadTerrainLayeredUniforms(
					gl,
					this.#terrainProgram,
					resource,
					bindings,
					this.#textures,
					this.#frameState,
				);
			if (resource.materialFamily === "terrain-layered" && !useLayered) {
				this.#warnTerrainLayeredFallback(resource);
			}
			gl.activeTexture(gl.TEXTURE0);
			gl.bindTexture(gl.TEXTURE_2D, useTexture ? texture : null);
			gl.uniform1i(this.#terrainProgram.uniforms.uTexture, 0);
			gl.uniform4f(
				this.#terrainProgram.uniforms.uTextureRect,
				binding?.rect[0] ?? 0,
				binding?.rect[1] ?? 0,
				binding?.rect[2] ?? 1,
				binding?.rect[3] ?? 1,
			);
			gl.uniform2f(
				this.#terrainProgram.uniforms.uTextureSize,
				binding?.textureWidth ?? 1,
				binding?.textureHeight ?? 1,
			);
			gl.uniform1i(
				this.#terrainProgram.uniforms.uUseTexture,
				useTexture ? 1 : 0,
			);
			gl.uniform1i(
				this.#terrainProgram.uniforms.uMaterialMode,
				useLayered ? 2 : useTexture ? 1 : 0,
			);
			gl.bindVertexArray(resource.vertexArray);
			gl.drawElements(gl.TRIANGLES, resource.indexCount, resource.indexType, 0);
		}

		gl.bindVertexArray(null);
		gl.bindTexture(gl.TEXTURE_2D, null);
	}

	#resizeToDisplaySize(): void {
		const devicePixelRatio = window.devicePixelRatio || 1;
		const width = Math.max(
			1,
			Math.floor(this.#canvas.clientWidth * devicePixelRatio),
		);
		const height = Math.max(
			1,
			Math.floor(this.#canvas.clientHeight * devicePixelRatio),
		);

		if (this.#canvas.width !== width || this.#canvas.height !== height) {
			this.#canvas.width = width;
			this.#canvas.height = height;
		}
	}

	#createSnapshot(): RendererSnapshot {
		return {
			backend: "webgl2",
			canvasWidth: this.#canvas.width,
			canvasHeight: this.#canvas.height,
			error: this.#error,
			frameCount: this.#frameCount,
			isRunning: !this.#disposed,
			renderedTriangles: Array.from(this.#terrainResources.values()).reduce(
				(total, resource) => total + resource.triangleCount,
				0,
			),
			staticDrawUnits: this.#terrainResources.size,
			terrainDrawUnits: this.#terrainResources.size,
		};
	}

	#emit(): void {
		const snapshot = this.#createSnapshot();

		for (const listener of this.#listeners) {
			listener(snapshot);
		}
	}

	#warnTerrainLayeredFallback(resource: TerrainGeometryResource): void {
		if (this.#warnedLayeredFallbackDrawUnitIds.has(resource.drawUnitId)) {
			return;
		}
		this.#warnedLayeredFallbackDrawUnitIds.add(resource.drawUnitId);
		console.warn(
			`V2 terrain draw unit ${resource.drawUnitId} rendered with terrain-debug-flat because its layered material could not be fully satisfied.`,
			{
				materialFamily: resource.materialFamily,
				reason:
					"Missing texture binding/residency or more than one packed page for a color or mask role.",
			},
		);
	}
}

interface TerrainGeometryProgram {
	readonly program: WebGLProgram;
	readonly uniforms: {
		readonly uColor: WebGLUniformLocation;
		readonly uCameraPosition: WebGLUniformLocation;
		readonly uColorAtlasSize: WebGLUniformLocation;
		readonly uColorAtlasTexture: WebGLUniformLocation;
		readonly uDetailAtlasRect: WebGLUniformLocation;
		readonly uDetailAtlasSize: WebGLUniformLocation;
		readonly uDetailAtlasTexture: WebGLUniformLocation;
		readonly uDetailEnabled: WebGLUniformLocation;
		readonly uDetailFadeFar: WebGLUniformLocation;
		readonly uDetailFadeNear: WebGLUniformLocation;
		readonly uDetailTiling: WebGLUniformLocation;
		readonly uLayerBaseColorRects: WebGLUniformLocation;
		readonly uLayerBaseTilings: WebGLUniformLocation;
		readonly uLayerOverlayColorRects: WebGLUniformLocation;
		readonly uLayerOverlayCounts: WebGLUniformLocation;
		readonly uLayerOverlayMaskRects: WebGLUniformLocation;
		readonly uLayerOverlayRotations: WebGLUniformLocation;
		readonly uLayerOverlayTilings: WebGLUniformLocation;
		readonly uLayerRoadColorRects: WebGLUniformLocation;
		readonly uLayerRoadCounts: WebGLUniformLocation;
		readonly uLayerRoadMaskRects: WebGLUniformLocation;
		readonly uLayerRoadRotations: WebGLUniformLocation;
		readonly uLayerRoadTilings: WebGLUniformLocation;
		readonly uMaskAtlasSize: WebGLUniformLocation;
		readonly uMaskAtlasTexture: WebGLUniformLocation;
		readonly uMaterialMode: WebGLUniformLocation;
		readonly uModelViewProjection: WebGLUniformLocation;
		readonly uTexture: WebGLUniformLocation;
		readonly uTextureRect: WebGLUniformLocation;
		readonly uTextureSize: WebGLUniformLocation;
		readonly uUseTexture: WebGLUniformLocation;
	};
	dispose(): void;
}

interface TerrainGeometryResource {
	readonly vertexArray: WebGLVertexArrayObject;
	readonly positionBuffer: WebGLBuffer;
	readonly texCoordBuffer: WebGLBuffer;
	readonly layerSlotBuffer: WebGLBuffer;
	readonly indexBuffer: WebGLBuffer;
	readonly drawUnitId: string;
	readonly materialFamily: TerrainGeometryStaticDrawUnit["materialFamily"];
	readonly primaryTextureUseId: string | null;
	readonly terrainMaterialPlan: TerrainGeometryStaticDrawUnit["terrainMaterialPlan"];
	readonly indexCount: number;
	readonly indexType: GLenum;
	readonly triangleCount: number;
	dispose(): void;
}

function createTerrainGeometryProgram(
	gl: WebGL2RenderingContext,
): TerrainGeometryProgram {
	const vertexShader = compileShader(
		gl,
		gl.VERTEX_SHADER,
		TERRAIN_VERTEX_SHADER,
	);
	const fragmentShader = compileShader(
		gl,
		gl.FRAGMENT_SHADER,
		TERRAIN_FRAGMENT_SHADER,
	);
	const program = gl.createProgram();
	if (!program) {
		throw new Error("Failed to create V2 terrain geometry shader program.");
	}

	gl.attachShader(program, vertexShader);
	gl.attachShader(program, fragmentShader);
	gl.linkProgram(program);
	gl.deleteShader(vertexShader);
	gl.deleteShader(fragmentShader);

	if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
		const message = gl.getProgramInfoLog(program) ?? "unknown link error";
		gl.deleteProgram(program);
		throw new Error(`Failed to link V2 terrain geometry shader: ${message}`);
	}

	return {
		program,
		uniforms: {
			uCameraPosition: requireUniform(gl, program, "uCameraPosition"),
			uColor: requireUniform(gl, program, "uColor"),
			uColorAtlasSize: requireUniform(gl, program, "uColorAtlasSize"),
			uColorAtlasTexture: requireUniform(gl, program, "uColorAtlasTexture"),
			uDetailAtlasRect: requireUniform(gl, program, "uDetailAtlasRect"),
			uDetailAtlasSize: requireUniform(gl, program, "uDetailAtlasSize"),
			uDetailAtlasTexture: requireUniform(gl, program, "uDetailAtlasTexture"),
			uDetailEnabled: requireUniform(gl, program, "uDetailEnabled"),
			uDetailFadeFar: requireUniform(gl, program, "uDetailFadeFar"),
			uDetailFadeNear: requireUniform(gl, program, "uDetailFadeNear"),
			uDetailTiling: requireUniform(gl, program, "uDetailTiling"),
			uLayerBaseColorRects: requireUniform(gl, program, "uLayerBaseColorRects"),
			uLayerBaseTilings: requireUniform(gl, program, "uLayerBaseTilings"),
			uLayerOverlayColorRects: requireUniform(
				gl,
				program,
				"uLayerOverlayColorRects",
			),
			uLayerOverlayCounts: requireUniform(gl, program, "uLayerOverlayCounts"),
			uLayerOverlayMaskRects: requireUniform(
				gl,
				program,
				"uLayerOverlayMaskRects",
			),
			uLayerOverlayRotations: requireUniform(
				gl,
				program,
				"uLayerOverlayRotations",
			),
			uLayerOverlayTilings: requireUniform(gl, program, "uLayerOverlayTilings"),
			uLayerRoadColorRects: requireUniform(gl, program, "uLayerRoadColorRects"),
			uLayerRoadCounts: requireUniform(gl, program, "uLayerRoadCounts"),
			uLayerRoadMaskRects: requireUniform(gl, program, "uLayerRoadMaskRects"),
			uLayerRoadRotations: requireUniform(gl, program, "uLayerRoadRotations"),
			uLayerRoadTilings: requireUniform(gl, program, "uLayerRoadTilings"),
			uMaskAtlasSize: requireUniform(gl, program, "uMaskAtlasSize"),
			uMaskAtlasTexture: requireUniform(gl, program, "uMaskAtlasTexture"),
			uMaterialMode: requireUniform(gl, program, "uMaterialMode"),
			uModelViewProjection: requireUniform(gl, program, "uModelViewProjection"),
			uTexture: requireUniform(gl, program, "uTexture"),
			uTextureRect: requireUniform(gl, program, "uTextureRect"),
			uTextureSize: requireUniform(gl, program, "uTextureSize"),
			uUseTexture: requireUniform(gl, program, "uUseTexture"),
		},
		dispose() {
			gl.deleteProgram(program);
		},
	};
}

function createTerrainGeometryResource(
	gl: WebGL2RenderingContext,
	drawUnit: TerrainGeometryStaticDrawUnit,
	translation: readonly [number, number, number],
): TerrainGeometryResource {
	const vertexArray = gl.createVertexArray();
	const positionBuffer = gl.createBuffer();
	const texCoordBuffer = gl.createBuffer();
	const layerSlotBuffer = gl.createBuffer();
	const indexBuffer = gl.createBuffer();
	if (
		!vertexArray ||
		!positionBuffer ||
		!texCoordBuffer ||
		!layerSlotBuffer ||
		!indexBuffer
	) {
		if (vertexArray) {
			gl.deleteVertexArray(vertexArray);
		}
		if (positionBuffer) {
			gl.deleteBuffer(positionBuffer);
		}
		if (texCoordBuffer) {
			gl.deleteBuffer(texCoordBuffer);
		}
		if (layerSlotBuffer) {
			gl.deleteBuffer(layerSlotBuffer);
		}
		if (indexBuffer) {
			gl.deleteBuffer(indexBuffer);
		}
		throw new Error(`Failed to create GPU buffers for ${drawUnit.drawUnitId}.`);
	}

	gl.bindVertexArray(vertexArray);
	gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
	gl.bufferData(
		gl.ARRAY_BUFFER,
		translateTerrainPositions(drawUnit.positions, translation),
		gl.STATIC_DRAW,
	);
	gl.enableVertexAttribArray(0);
	gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);

	gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
	gl.bufferData(gl.ARRAY_BUFFER, drawUnit.texCoords, gl.STATIC_DRAW);
	gl.enableVertexAttribArray(1);
	gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0);

	gl.bindBuffer(gl.ARRAY_BUFFER, layerSlotBuffer);
	gl.bufferData(gl.ARRAY_BUFFER, drawUnit.layerSlots, gl.STATIC_DRAW);
	gl.enableVertexAttribArray(2);
	gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 0, 0);

	gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
	gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, drawUnit.indices, gl.STATIC_DRAW);
	gl.bindVertexArray(null);
	gl.bindBuffer(gl.ARRAY_BUFFER, null);
	gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);

	return {
		drawUnitId: drawUnit.drawUnitId,
		indexBuffer,
		indexCount: drawUnit.indices.length,
		indexType:
			drawUnit.indexType === "uint16" ? gl.UNSIGNED_SHORT : gl.UNSIGNED_INT,
		materialFamily: drawUnit.materialFamily,
		primaryTextureUseId: drawUnit.primaryTextureUseId,
		terrainMaterialPlan: drawUnit.terrainMaterialPlan,
		layerSlotBuffer,
		positionBuffer,
		texCoordBuffer,
		triangleCount: drawUnit.triangleCount,
		vertexArray,
		dispose() {
			gl.deleteBuffer(positionBuffer);
			gl.deleteBuffer(texCoordBuffer);
			gl.deleteBuffer(layerSlotBuffer);
			gl.deleteBuffer(indexBuffer);
			gl.deleteVertexArray(vertexArray);
		},
	};
}

function translateTerrainPositions(
	positions: Float32Array,
	translation: readonly [number, number, number],
): Float32Array {
	if (translation[0] === 0 && translation[1] === 0 && translation[2] === 0) {
		return positions;
	}

	const translated = new Float32Array(positions);
	for (let index = 0; index < translated.length; index += 3) {
		translated[index] += translation[0];
		translated[index + 1] += translation[1];
		translated[index + 2] += translation[2];
	}

	return translated;
}

function uploadTerrainLayeredUniforms(
	gl: WebGL2RenderingContext,
	program: TerrainGeometryProgram,
	resource: TerrainGeometryResource,
	bindings: ReadonlyMap<string, TerrainTextureBinding>,
	textures: ReadonlyMap<string, WebGLTexture>,
	frameState: FrameState,
): boolean {
	const plan = resource.terrainMaterialPlan;
	if (!plan) {
		return false;
	}

	const colorBindings = new Map<string, TerrainTextureBinding>();
	const maskBindings = new Map<string, TerrainTextureBinding>();
	let detailBinding: TerrainTextureBinding | null = null;

	for (const entry of plan.layerEntries) {
		if (!collectPageBinding(entry.base, bindings, colorBindings)) {
			return false;
		}
		for (const overlay of entry.overlays) {
			if (
				!collectPageBinding(overlay.terrain, bindings, colorBindings) ||
				!collectPageBinding(overlay.alpha, bindings, maskBindings)
			) {
				return false;
			}
		}
		for (const road of entry.roads) {
			if (
				!collectPageBinding(road.road, bindings, colorBindings) ||
				!collectPageBinding(road.alpha, bindings, maskBindings)
			) {
				return false;
			}
		}
	}

	for (const detailRole of plan.detailRoles) {
		const binding = detailRole.texture.textureUseId
			? bindings.get(detailRole.texture.textureUseId)
			: undefined;
		if (!binding) {
			return false;
		}
		if (detailBinding && detailBinding.textureRefId !== binding.textureRefId) {
			return false;
		}
		detailBinding = binding;
	}

	if (colorBindings.size !== 1 || maskBindings.size > 1) {
		return false;
	}

	const colorBinding = firstMapValue(colorBindings);
	const maskBinding = firstMapValue(maskBindings);
	const colorTexture = colorBinding
		? (textures.get(colorBinding.textureRefId) ?? null)
		: null;
	const maskTexture = maskBinding
		? (textures.get(maskBinding.textureRefId) ?? null)
		: null;
	const detailTexture = detailBinding
		? (textures.get(detailBinding.textureRefId) ?? null)
		: null;
	if (
		!colorBinding ||
		!colorTexture ||
		(maskBindings.size > 0 && !maskTexture)
	) {
		return false;
	}
	if (detailBinding && !detailTexture) {
		return false;
	}

	gl.activeTexture(gl.TEXTURE1);
	gl.bindTexture(gl.TEXTURE_2D, colorTexture);
	gl.uniform1i(program.uniforms.uColorAtlasTexture, 1);
	gl.uniform2f(
		program.uniforms.uColorAtlasSize,
		colorBinding.textureWidth,
		colorBinding.textureHeight,
	);
	gl.activeTexture(gl.TEXTURE2);
	gl.bindTexture(gl.TEXTURE_2D, maskTexture);
	gl.uniform1i(program.uniforms.uMaskAtlasTexture, 2);
	gl.uniform2f(
		program.uniforms.uMaskAtlasSize,
		maskBinding?.textureWidth ?? 1,
		maskBinding?.textureHeight ?? 1,
	);
	gl.activeTexture(gl.TEXTURE3);
	gl.bindTexture(gl.TEXTURE_2D, detailTexture);
	gl.uniform1i(program.uniforms.uDetailAtlasTexture, 3);
	gl.uniform2f(
		program.uniforms.uDetailAtlasSize,
		detailBinding?.textureWidth ?? 1,
		detailBinding?.textureHeight ?? 1,
	);

	uploadTerrainLayerRectUniforms(gl, program, plan, bindings);
	uploadTerrainDetailUniforms(gl, program, plan, bindings, detailBinding);
	gl.uniform3f(
		program.uniforms.uCameraPosition,
		frameState.camera.position[0],
		frameState.camera.position[1],
		frameState.camera.position[2],
	);

	return true;
}

function collectPageBinding(
	role: TerrainMaterialTextureRoleBinding,
	bindings: ReadonlyMap<string, TerrainTextureBinding>,
	pageBindings: Map<string, TerrainTextureBinding>,
): boolean {
	if (!role.textureUseId) {
		return false;
	}
	const binding = bindings.get(role.textureUseId);
	if (!binding) {
		return false;
	}
	pageBindings.set(binding.textureRefId, binding);
	return true;
}

function uploadTerrainLayerRectUniforms(
	gl: WebGL2RenderingContext,
	program: TerrainGeometryProgram,
	plan: NonNullable<TerrainGeometryResource["terrainMaterialPlan"]>,
	bindings: ReadonlyMap<string, TerrainTextureBinding>,
): void {
	const baseColorRects = new Float32Array(
		TERRAIN_LAYERED_MAX_LAYER_ENTRIES * 4,
	);
	const baseTilings = new Float32Array(TERRAIN_LAYERED_MAX_LAYER_ENTRIES);
	const overlayColorRects = new Float32Array(
		TERRAIN_LAYERED_MAX_LAYER_ENTRIES *
			TERRAIN_LAYERED_MAX_OVERLAYS_PER_LAYER *
			4,
	);
	const overlayMaskRects = new Float32Array(
		TERRAIN_LAYERED_MAX_LAYER_ENTRIES *
			TERRAIN_LAYERED_MAX_OVERLAYS_PER_LAYER *
			4,
	);
	const overlayTilings = new Float32Array(
		TERRAIN_LAYERED_MAX_LAYER_ENTRIES * TERRAIN_LAYERED_MAX_OVERLAYS_PER_LAYER,
	);
	const overlayRotations = new Int32Array(
		TERRAIN_LAYERED_MAX_LAYER_ENTRIES * TERRAIN_LAYERED_MAX_OVERLAYS_PER_LAYER,
	);
	const overlayCounts = new Int32Array(TERRAIN_LAYERED_MAX_LAYER_ENTRIES);
	const roadColorRects = new Float32Array(
		TERRAIN_LAYERED_MAX_LAYER_ENTRIES * 4,
	);
	const roadMaskRects = new Float32Array(
		TERRAIN_LAYERED_MAX_LAYER_ENTRIES * TERRAIN_LAYERED_MAX_ROADS_PER_LAYER * 4,
	);
	const roadTilings = new Float32Array(TERRAIN_LAYERED_MAX_LAYER_ENTRIES);
	const roadRotations = new Int32Array(
		TERRAIN_LAYERED_MAX_LAYER_ENTRIES * TERRAIN_LAYERED_MAX_ROADS_PER_LAYER,
	);
	const roadCounts = new Int32Array(TERRAIN_LAYERED_MAX_LAYER_ENTRIES);

	for (const layer of plan.layerEntries) {
		baseColorRects.set(
			resolveBindingRect(bindings, layer.base),
			layer.slot * 4,
		);
		baseTilings[layer.slot] = layer.base.tiling;
		overlayCounts[layer.slot] = Math.min(
			layer.overlays.length,
			TERRAIN_LAYERED_MAX_OVERLAYS_PER_LAYER,
		);
		for (const [overlayIndex, overlay] of layer.overlays
			.slice(0, TERRAIN_LAYERED_MAX_OVERLAYS_PER_LAYER)
			.entries()) {
			const index =
				layer.slot * TERRAIN_LAYERED_MAX_OVERLAYS_PER_LAYER + overlayIndex;
			overlayColorRects.set(
				resolveBindingRect(bindings, overlay.terrain),
				index * 4,
			);
			overlayMaskRects.set(
				resolveBindingRect(bindings, overlay.alpha),
				index * 4,
			);
			overlayTilings[index] = overlay.terrain.tiling;
			overlayRotations[index] = overlay.rotation;
		}
		roadCounts[layer.slot] = Math.min(
			layer.roads.length,
			TERRAIN_LAYERED_MAX_ROADS_PER_LAYER,
		);
		const roadTexture = layer.roads[0]?.road ?? null;
		if (roadTexture) {
			roadColorRects.set(
				resolveBindingRect(bindings, roadTexture),
				layer.slot * 4,
			);
			roadTilings[layer.slot] = roadTexture.tiling;
		}
		for (const [roadIndex, road] of layer.roads
			.slice(0, TERRAIN_LAYERED_MAX_ROADS_PER_LAYER)
			.entries()) {
			const index =
				layer.slot * TERRAIN_LAYERED_MAX_ROADS_PER_LAYER + roadIndex;
			roadMaskRects.set(resolveBindingRect(bindings, road.alpha), index * 4);
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

function uploadTerrainDetailUniforms(
	gl: WebGL2RenderingContext,
	program: TerrainGeometryProgram,
	plan: NonNullable<TerrainGeometryResource["terrainMaterialPlan"]>,
	bindings: ReadonlyMap<string, TerrainTextureBinding>,
	detailBinding: TerrainTextureBinding | null,
): void {
	const detailRole = plan.detailRoles[0] ?? null;
	const detailRect = detailRole
		? resolveBindingRect(bindings, detailRole.texture)
		: ([0, 0, 1, 1] as const);
	gl.uniform1i(
		program.uniforms.uDetailEnabled,
		detailRole && detailBinding ? 1 : 0,
	);
	gl.uniform4fv(program.uniforms.uDetailAtlasRect, detailRect);
	gl.uniform1f(program.uniforms.uDetailTiling, detailRole?.texture.tiling ?? 1);
	gl.uniform1f(program.uniforms.uDetailFadeNear, detailRole?.fadeNear ?? 0);
	gl.uniform1f(program.uniforms.uDetailFadeFar, detailRole?.fadeFar ?? 1);
}

function resolveBindingRect(
	bindings: ReadonlyMap<string, TerrainTextureBinding>,
	role: TerrainMaterialTextureRoleBinding,
): readonly [number, number, number, number] {
	if (!role.textureUseId) {
		return [0, 0, 1, 1];
	}

	return bindings.get(role.textureUseId)?.rect ?? [0, 0, 1, 1];
}

function firstMapValue<K, V>(map: ReadonlyMap<K, V>): V | null {
	for (const value of map.values()) {
		return value;
	}
	return null;
}

function createDirectTexture(
	gl: WebGL2RenderingContext,
	placement: TexturePlacementUpdate["placements"][number],
): WebGLTexture {
	if (placement.format !== "rgba8") {
		throw new Error(
			`V2 WebGL2 renderer only supports rgba8 direct textures. Received ${placement.format}.`,
		);
	}

	const texture = gl.createTexture();
	if (!texture) {
		throw new Error(`Failed to create texture ${placement.textureRefId}.`);
	}

	gl.bindTexture(gl.TEXTURE_2D, texture);
	gl.texParameteri(
		gl.TEXTURE_2D,
		gl.TEXTURE_MIN_FILTER,
		getMinFilter(gl, placement.filteringMode, placement.mipmapsGenerated),
	);
	gl.texParameteri(
		gl.TEXTURE_2D,
		gl.TEXTURE_MAG_FILTER,
		getMagFilter(gl, placement.filteringMode),
	);
	gl.texParameteri(
		gl.TEXTURE_2D,
		gl.TEXTURE_WRAP_S,
		getWrapMode(gl, placement.wrapS),
	);
	gl.texParameteri(
		gl.TEXTURE_2D,
		gl.TEXTURE_WRAP_T,
		getWrapMode(gl, placement.wrapT),
	);
	gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
	gl.texImage2D(
		gl.TEXTURE_2D,
		0,
		gl.RGBA,
		placement.width,
		placement.height,
		0,
		gl.RGBA,
		gl.UNSIGNED_BYTE,
		placement.pixels,
	);
	if (placement.mipmapsGenerated) {
		gl.generateMipmap(gl.TEXTURE_2D);
	}
	applyAnisotropy(gl, placement.anisotropy);
	gl.bindTexture(gl.TEXTURE_2D, null);

	return texture;
}

function getMinFilter(
	gl: WebGL2RenderingContext,
	filteringMode: TextureFilteringMode,
	generateMipmaps: boolean,
): GLenum {
	if (filteringMode === "nearest") {
		return gl.NEAREST;
	}

	return generateMipmaps ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR;
}

function getMagFilter(
	gl: WebGL2RenderingContext,
	filteringMode: TextureFilteringMode,
): GLenum {
	return filteringMode === "nearest" ? gl.NEAREST : gl.LINEAR;
}

function getWrapMode(
	gl: WebGL2RenderingContext,
	wrapMode: TextureWrapMode,
): GLenum {
	return wrapMode === "repeat" ? gl.REPEAT : gl.CLAMP_TO_EDGE;
}

function applyAnisotropy(gl: WebGL2RenderingContext, anisotropy: number): void {
	if (anisotropy <= 1) {
		return;
	}

	const extension =
		gl.getExtension("EXT_texture_filter_anisotropic") ??
		gl.getExtension("WEBKIT_EXT_texture_filter_anisotropic") ??
		gl.getExtension("MOZ_EXT_texture_filter_anisotropic");
	if (!extension) {
		return;
	}

	const maxAnisotropy = gl.getParameter(
		extension.MAX_TEXTURE_MAX_ANISOTROPY_EXT,
	) as number;
	gl.texParameterf(
		gl.TEXTURE_2D,
		extension.TEXTURE_MAX_ANISOTROPY_EXT,
		Math.min(anisotropy, maxAnisotropy),
	);
}

function compileShader(
	gl: WebGL2RenderingContext,
	shaderType: GLenum,
	source: string,
): WebGLShader {
	const shader = gl.createShader(shaderType);
	if (!shader) {
		throw new Error("Failed to create V2 terrain geometry shader.");
	}
	gl.shaderSource(shader, source);
	gl.compileShader(shader);
	if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
		const message = gl.getShaderInfoLog(shader) ?? "unknown compile error";
		gl.deleteShader(shader);
		throw new Error(`Failed to compile V2 terrain geometry shader: ${message}`);
	}

	return shader;
}

function requireUniform(
	gl: WebGL2RenderingContext,
	program: WebGLProgram,
	name: string,
): WebGLUniformLocation {
	const uniform =
		gl.getUniformLocation(program, name) ??
		gl.getUniformLocation(program, `${name}[0]`);
	if (!uniform) {
		throw new Error(`V2 terrain geometry shader is missing uniform ${name}.`);
	}

	return uniform;
}

function createModelViewProjectionMatrix(
	frameState: FrameState,
	aspectRatio: number,
): Float32Array {
	const projection = createPerspectiveMatrix(Math.PI / 3, aspectRatio, 1, 5000);
	const view = createViewMatrix(frameState);
	return multiplyMat4(projection, view);
}

function createPerspectiveMatrix(
	fovyRadians: number,
	aspectRatio: number,
	near: number,
	far: number,
): Float32Array {
	const f = 1 / Math.tan(fovyRadians / 2);
	const rangeInv = 1 / (near - far);

	return new Float32Array([
		f / aspectRatio,
		0,
		0,
		0,
		0,
		f,
		0,
		0,
		0,
		0,
		(near + far) * rangeInv,
		-1,
		0,
		0,
		near * far * rangeInv * 2,
		0,
	]);
}

function createViewMatrix(frameState: FrameState): Float32Array {
	const [cameraX, cameraY, cameraZ] = frameState.camera.position;
	const pitch = frameState.camera.pitchRadians;
	const yaw = frameState.camera.yawRadians;
	const cosPitch = Math.cos(pitch);
	const forward = normalizeVec3([
		Math.sin(yaw) * cosPitch,
		Math.sin(pitch),
		-Math.cos(yaw) * cosPitch,
	]);
	const target = [
		cameraX + forward[0],
		cameraY + forward[1],
		cameraZ + forward[2],
	] as const;

	return createLookAtMatrix([cameraX, cameraY, cameraZ], target, [0, 1, 0]);
}

function createLookAtMatrix(
	eye: readonly [number, number, number],
	target: readonly [number, number, number],
	up: readonly [number, number, number],
): Float32Array {
	const zAxis = normalizeVec3([
		eye[0] - target[0],
		eye[1] - target[1],
		eye[2] - target[2],
	]);
	const xAxis = normalizeVec3(crossVec3(up, zAxis));
	const yAxis = crossVec3(zAxis, xAxis);

	return new Float32Array([
		xAxis[0],
		yAxis[0],
		zAxis[0],
		0,
		xAxis[1],
		yAxis[1],
		zAxis[1],
		0,
		xAxis[2],
		yAxis[2],
		zAxis[2],
		0,
		-dotVec3(xAxis, eye),
		-dotVec3(yAxis, eye),
		-dotVec3(zAxis, eye),
		1,
	]);
}

function multiplyMat4(left: Float32Array, right: Float32Array): Float32Array {
	const result = new Float32Array(16);

	for (let column = 0; column < 4; column += 1) {
		for (let row = 0; row < 4; row += 1) {
			result[column * 4 + row] =
				left[0 * 4 + row] * right[column * 4 + 0] +
				left[1 * 4 + row] * right[column * 4 + 1] +
				left[2 * 4 + row] * right[column * 4 + 2] +
				left[3 * 4 + row] * right[column * 4 + 3];
		}
	}

	return result;
}

function normalizeVec3(
	value: readonly [number, number, number],
): readonly [number, number, number] {
	const length = Math.hypot(value[0], value[1], value[2]);
	if (length === 0) {
		return [0, 0, 0];
	}

	return [value[0] / length, value[1] / length, value[2] / length];
}

function crossVec3(
	left: readonly [number, number, number],
	right: readonly [number, number, number],
): readonly [number, number, number] {
	return [
		left[1] * right[2] - left[2] * right[1],
		left[2] * right[0] - left[0] * right[2],
		left[0] * right[1] - left[1] * right[0],
	];
}

function dotVec3(
	left: readonly [number, number, number],
	right: readonly [number, number, number],
): number {
	return left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
}
