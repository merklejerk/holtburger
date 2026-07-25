import {
	createLandblockOffset,
	getLandblockCoordinates,
	type LandblockCoordinates,
	OUTDOOR_LANDBLOCK_WORLD_SIZE,
} from "../landblocks";
import {
	createPerspectiveMat4,
	createViewMat4,
	mat4ToFloat32Array,
} from "../math/matrices";
import { createFrustum, type Frustum } from "../math/frustum";
import { Mat4, Vec3 } from "../math/types";
import type { TerrainDrawUnit } from "../terrain/types";
import type { StaticObjectDrawUnit } from "../commit/artifacts";
import { TextureFilteringMode, TextureWrapMode } from "../textures/types";
import type {
	FrameInput,
	FrameSelectionMetrics,
	FrameViewInput,
	Renderer,
} from "./renderer";
import { RenderWorld } from "./render-world";
import type { GeometryResourceKey } from "./resource-manager";
import type { TerrainProgramInput } from "./terrain-program-input";
import {
	WebGL2ResourceManager,
	type WebGL2GeometryBinding,
} from "./webgl2-resource-manager";
import {
	createWebGL2TerrainProgram,
	type WebGL2TerrainProgram,
} from "./webgl2-terrain-program";
import {
	createWebGL2ObjectProgram,
	type WebGL2ObjectProgram,
} from "./webgl2-object-program";
import { bindWebGL2DistanceFog } from "./webgl2-fog";

const CLEAR_COLOR = {
	red: 0.15,
	green: 0.05,
	blue: 0.05,
	alpha: 1,
} as const;

const DETAIL_FADE_NEAR = 10;
const DETAIL_FADE_FAR = 50;

/** One visible landblock terrain source paired with selected renderer resources. */
interface TerrainFrameInput {
	/** Selected LOD, transition range, and logical texture identities. */
	readonly drawUnit: TerrainDrawUnit;
	/** Device resources resolved by this renderer for the terrain shader contract. */
	readonly program: TerrainProgramInput;
}

/** One opaque or alpha-test static-object range paired with its resolved node placement. */
interface ObjectFrameInput {
	readonly drawUnit: StaticObjectDrawUnit;
	readonly geometry: GeometryResourceKey;
	readonly landblockId: string;
	readonly localToLandblock: Mat4;
}

/** Anchor-relative matrices and content reused by all passes for one view. */
interface PreparedView {
	/** Decoded landblock grid coordinates of the view's render-world origin. */
	readonly anchorCoordinates: LandblockCoordinates;
	/** Camera position expressed in the view's anchor-relative render frame. */
	readonly cameraPosition: Vec3;
	/** Projection matrix derived from the current drawing-buffer aspect ratio. */
	readonly projection: Mat4;
	/** Terrain selected by this renderer from its RenderWorld. */
	readonly terrain: readonly TerrainFrameInput[];
	/** Opaque and alpha-test static-object ranges visible to this view. */
	readonly objects: readonly ObjectFrameInput[];
	/** Anchor-relative camera view transform. */
	readonly view: Mat4;
	/** Landblock defining the view's render-world origin. */
	readonly anchorLandblockId: FrameInput["anchorLandblockId"];
}

/** Mutable backing state copied only when Explorer samples renderer diagnostics. */
interface MutableFrameSelectionMetrics {
	viewCount: number;
	visibleSceneEntries: number;
	visiblePortalCrossings: number;
	terrainFrameInputs: number;
	visibleStaticObjects: number;
	visibleDynamics: number;
	visibleEnvCellShells: number;
	submittedBuildingRanges: number;
	submittedBuildingTriangles: number;
	objectProgramChanges: number;
	objectTexturePageBinds: number;
}

export class WebGL2Renderer implements Renderer {
	static readonly #identityMatrix = Mat4.identity();

	readonly #matrixScratch = new Float32Array(16);
	readonly #offsetScratch = new Vec3(0, 0, 0);
	readonly #canvas: HTMLCanvasElement;
	readonly #gl: WebGL2RenderingContext;
	readonly #resources: WebGL2ResourceManager;
	/** Read-only runtime gateway used to collect this renderer's frame submissions. */
	readonly #world: RenderWorld;
	readonly #terrainProgram: WebGL2TerrainProgram;
	readonly #objectProgram: WebGL2ObjectProgram;
	/** Float-compatible fallback keeps inactive object samplers independent from terrain bindings. */
	readonly #objectFallbackTexture: WebGLTexture;
	/** Reused per-frame diagnostics; cold reads return a copied snapshot. */
	readonly #frameSelectionMetrics: MutableFrameSelectionMetrics = {
		terrainFrameInputs: 0,
		viewCount: 0,
		visibleDynamics: 0,
		visibleEnvCellShells: 0,
		visiblePortalCrossings: 0,
		visibleSceneEntries: 0,
		visibleStaticObjects: 0,
		submittedBuildingRanges: 0,
		submittedBuildingTriangles: 0,
		objectProgramChanges: 0,
		objectTexturePageBinds: 0,
	};
	#frameWidth = 0;
	#frameHeight = 0;

	public static async build(
		canvas: HTMLCanvasElement,
		gl: WebGL2RenderingContext,
		resources: WebGL2ResourceManager,
		world: RenderWorld,
	): Promise<WebGL2Renderer> {
		return new WebGL2Renderer(canvas, gl, resources, world);
	}

	protected constructor(
		canvas: HTMLCanvasElement,
		gl: WebGL2RenderingContext,
		resources: WebGL2ResourceManager,
		world: RenderWorld,
	) {
		this.#canvas = canvas;
		this.#gl = gl;
		this.#resources = resources;
		this.#world = world;
		this.#terrainProgram = createWebGL2TerrainProgram(gl);
		this.#objectProgram = createWebGL2ObjectProgram(gl);
		this.#objectFallbackTexture = createObjectFallbackTexture(gl);
		gl.clearColor(
			CLEAR_COLOR.red,
			CLEAR_COLOR.green,
			CLEAR_COLOR.blue,
			CLEAR_COLOR.alpha,
		);
		gl.enable(gl.DEPTH_TEST);
	}

	drawFrame(input: FrameInput): void {
		this.#resizeCanvasForDpr();
		this.#resetFrameSelectionMetrics(input.views.length);
		const fog = input.frameSettings.distanceFogEnabled
			? input.environment.distanceFog
			: null;
		this.#beginFrame(input.environment, fog);
		for (const view of input.views) {
			this.#drawView(this.#prepareView(input.anchorLandblockId, view), fog);
		}
		void input.timeSeconds;
	}

	getFrameSelectionMetrics(): FrameSelectionMetrics {
		return { ...this.#frameSelectionMetrics };
	}

	async destroy(): Promise<void> {
		this.#gl.deleteProgram(this.#terrainProgram.program);
		this.#gl.deleteProgram(this.#objectProgram.program);
		this.#gl.deleteTexture(this.#objectFallbackTexture);
	}

	#beginFrame(
		environment: FrameInput["environment"],
		fog: FrameInput["environment"]["distanceFog"],
	): void {
		const gl = this.#gl;
		const clearColor = fog?.color ?? environment.backgroundColor;
		gl.clearColor(
			clearColor.red,
			clearColor.green,
			clearColor.blue,
			clearColor.alpha,
		);
		gl.colorMask(true, true, true, true);
		gl.depthMask(true);
		gl.disable(gl.BLEND);
		gl.disable(gl.CULL_FACE);
		gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
	}

	#prepareView(
		anchorLandblockId: FrameInput["anchorLandblockId"],
		input: FrameViewInput,
	): PreparedView {
		const camera = input.camera;
		const anchorCoordinates = getLandblockCoordinates(anchorLandblockId);
		const anchorOriginX = anchorCoordinates.x * OUTDOOR_LANDBLOCK_WORLD_SIZE;
		const anchorOriginZ = -anchorCoordinates.y * OUTDOOR_LANDBLOCK_WORLD_SIZE;
		const cameraPosition = new Vec3(
			camera.placement.position.x - anchorOriginX,
			camera.placement.position.y,
			camera.placement.position.z - anchorOriginZ,
		);
		const aspectRatio = this.#frameWidth / Math.max(1, this.#frameHeight);
		const projection = createPerspectiveMat4(
			camera.fov,
			aspectRatio,
			camera.near,
			camera.far,
		);
		const view = createViewMat4(cameraPosition, camera.placement.rotation);
		const collected = this.#collectScene(
			camera,
			anchorLandblockId,
			createFrustum(projection, view, cameraPosition),
		);
		return {
			anchorCoordinates,
			anchorLandblockId,
			cameraPosition,
			projection,
			objects: collected.objects,
			terrain: collected.terrain,
			view,
		};
	}

	#collectScene(
		camera: FrameViewInput["camera"],
		anchorLandblockId: FrameInput["anchorLandblockId"],
		frustum: Frustum,
	): { readonly terrain: readonly TerrainFrameInput[]; readonly objects: readonly ObjectFrameInput[] } {
		const terrain: TerrainFrameInput[] = [];
		const objects: ObjectFrameInput[] = [];
		const visible = this.#world.queryVisibleScene(
			camera,
			frustum,
			anchorLandblockId,
		);
		this.#frameSelectionMetrics.visibleSceneEntries += visible.entries.length;
		this.#frameSelectionMetrics.visiblePortalCrossings +=
			visible.crossings.length;
		for (const nodeId of visible.entries) {
			const contribution = this.#world.getRenderContribution(
				nodeId,
				anchorLandblockId,
			);
			if (!contribution) continue;
			if (contribution.kind === "static-object") {
				this.#frameSelectionMetrics.visibleStaticObjects += 1;
				const node = this.#world.resolveStaticObjectNode(
					nodeId,
					contribution.renderable,
				);
				for (const resolved of node.drawUnits) {
					if (
						resolved.drawUnit.kind !== "baked" ||
						(resolved.drawUnit.ordering !== "opaque" &&
							resolved.drawUnit.ordering !== "alpha-test")
					)
						continue;
					objects.push({
						drawUnit: resolved.drawUnit,
						geometry: resolved.geometry,
						landblockId: node.placement.landblockId,
						localToLandblock: node.placement.localToLandblock,
					});
				}
				continue;
			}
			if (contribution.kind === "dynamic") {
				this.#frameSelectionMetrics.visibleDynamics += 1;
				void this.#world.resolveDynamicRenderable(contribution.renderable);
				continue;
			}
			if (contribution.kind === "env-cell") {
				this.#frameSelectionMetrics.visibleEnvCellShells += 1;
				void this.#world.resolveEnvCellRenderable(contribution.renderable);
				continue;
			}
			const { drawUnit } = contribution;
			terrain.push({
				drawUnit,
				program: {
					geometry: this.#world.resolveGeometry(drawUnit.geometry),
					composition: this.#world.resolveTexture2D(drawUnit.composition),
					surfaceField: this.#world.resolveTexture2D(drawUnit.surfaceField),
					textures: {
						blendMasks: this.#world.resolveTextureArray(
							drawUnit.textures.blendMasks,
						),
						colors: this.#world.resolveTextureArray(drawUnit.textures.colors),
						detail: this.#world.resolveTexture2D(drawUnit.textures.detail),
						roadMasks: this.#world.resolveTextureArray(
							drawUnit.textures.roadMasks,
						),
					},
				},
			});
			this.#frameSelectionMetrics.terrainFrameInputs += 1;
		}
		for (const crossing of visible.crossings) {
			const drawUnit = this.#world.getPortalDrawUnit(crossing.apertureId);
			if (drawUnit) void this.#world.resolvePortalDrawUnit(drawUnit);
		}
		objects.sort((left, right) => {
			const ordering = left.drawUnit.ordering.localeCompare(right.drawUnit.ordering);
			if (ordering !== 0) return ordering;
			return objectMaterialSortKey(left.drawUnit).localeCompare(
				objectMaterialSortKey(right.drawUnit),
			);
		});
		return { objects, terrain };
	}

	#resetFrameSelectionMetrics(viewCount: number): void {
		const metrics = this.#frameSelectionMetrics;
		metrics.terrainFrameInputs = 0;
		metrics.viewCount = viewCount;
		metrics.visibleDynamics = 0;
		metrics.visibleEnvCellShells = 0;
		metrics.visiblePortalCrossings = 0;
		metrics.visibleSceneEntries = 0;
		metrics.visibleStaticObjects = 0;
		metrics.submittedBuildingRanges = 0;
		metrics.submittedBuildingTriangles = 0;
		metrics.objectProgramChanges = 0;
		metrics.objectTexturePageBinds = 0;
	}

	#drawView(
		view: PreparedView,
		fog: FrameInput["environment"]["distanceFog"],
	): void {
		this.#drawTerrain(view, fog);
		this.#drawOpaqueObjects(view, fog);
		this.#gl.bindVertexArray(null);
	}

	#drawTerrain(
		view: PreparedView,
		fog: FrameInput["environment"]["distanceFog"],
	): void {
		const gl = this.#gl;
		gl.depthMask(true);
		gl.disable(gl.BLEND);
		gl.useProgram(this.#terrainProgram.program);
		gl.uniformMatrix4fv(
			this.#terrainProgram.uniforms.projection,
			false,
			mat4ToFloat32Array(view.projection, this.#matrixScratch),
		);
		gl.uniform2f(
			this.#terrainProgram.uniforms.cameraHorizontalPosition,
			view.cameraPosition.x,
			view.cameraPosition.z,
		);
		gl.uniformMatrix4fv(
			this.#terrainProgram.uniforms.view,
			false,
			mat4ToFloat32Array(view.view, this.#matrixScratch),
		);
		gl.uniform1f(
			this.#terrainProgram.uniforms.detailFadeNear,
			DETAIL_FADE_NEAR,
		);
		gl.uniform1f(this.#terrainProgram.uniforms.detailFadeFar, DETAIL_FADE_FAR);
		bindWebGL2DistanceFog(gl, this.#terrainProgram.uniforms, fog);
		for (const terrain of view.terrain) {
			const landblockOffset = createLandblockOffset(
				terrain.drawUnit.coordinates,
				view.anchorCoordinates,
				this.#offsetScratch,
			);
			this.#bindTerrainResources(terrain);
			this.#drawTerrainGeometry(
				terrain.program.geometry,
				terrain.drawUnit.indexStart,
				terrain.drawUnit.indexCount,
				WebGL2Renderer.#identityMatrix,
				landblockOffset,
			);
		}
	}

	#bindTerrainResources(input: TerrainFrameInput): void {
		const { textures } = input.program;
		const surfaceField = this.#resources.getTexture2D(
			input.program.surfaceField,
		);
		const composition = this.#resources.getTexture2D(input.program.composition);
		const colors = this.#resources.getTextureArray(textures.colors.resource);
		const blendMasks = this.#resources.getTextureArray(
			textures.blendMasks.resource,
		);
		const roadMasks = this.#resources.getTextureArray(
			textures.roadMasks.resource,
		);
		const detail = this.#resources.getTexture2D(textures.detail);
		const gl = this.#gl;
		this.#bindTexture2D(
			0,
			surfaceField.texture,
			this.#terrainProgram.uniforms.surfaceField,
		);
		this.#bindTexture2D(
			1,
			composition.texture,
			this.#terrainProgram.uniforms.composition,
		);
		this.#bindTextureArray(
			2,
			colors.texture,
			this.#terrainProgram.uniforms.colors,
		);
		this.#bindTextureArray(
			3,
			blendMasks.texture,
			this.#terrainProgram.uniforms.blendMasks,
		);
		this.#bindTextureArray(
			4,
			roadMasks.texture,
			this.#terrainProgram.uniforms.roadMasks,
		);
		this.#bindTexture2D(
			5,
			detail.texture,
			this.#terrainProgram.uniforms.detail,
		);
		gl.activeTexture(gl.TEXTURE0);
	}

	#bindTexture2D(
		unit: number,
		texture: WebGLTexture,
		uniform: WebGLUniformLocation,
	): void {
		const gl = this.#gl;
		gl.activeTexture(gl.TEXTURE0 + unit);
		gl.bindTexture(gl.TEXTURE_2D, texture);
		gl.uniform1i(uniform, unit);
	}

	#bindTextureArray(
		unit: number,
		texture: WebGLTexture,
		uniform: WebGLUniformLocation,
	): void {
		const gl = this.#gl;
		gl.activeTexture(gl.TEXTURE0 + unit);
		gl.bindTexture(gl.TEXTURE_2D_ARRAY, texture);
		gl.uniform1i(uniform, unit);
	}

	#drawTerrainGeometry(
		geometryKey: GeometryResourceKey,
		indexStart: number,
		indexCount: number,
		localToLandblock: Mat4,
		landblockOffset: Vec3,
	): void {
		const binding = this.#resources.getGeometry(geometryKey);
		validateDrawRange(binding, indexStart, indexCount);
		const gl = this.#gl;
		gl.uniformMatrix4fv(
			this.#terrainProgram.uniforms.localToLandblock,
			false,
			mat4ToFloat32Array(localToLandblock),
		);
		gl.uniform3f(
			this.#terrainProgram.uniforms.landblockOffset,
			landblockOffset.x,
			landblockOffset.y,
			landblockOffset.z,
		);
		gl.bindVertexArray(binding.vertexArray);
		gl.drawElements(
			gl.TRIANGLES,
			indexCount,
			binding.indexType,
			indexStart * binding.indexElementBytes,
		);
	}

	#drawOpaqueObjects(
		view: PreparedView,
		fog: FrameInput["environment"]["distanceFog"],
	): void {
		if (view.objects.length === 0) return;
		const gl = this.#gl;
		gl.depthMask(true);
		gl.disable(gl.BLEND);
		gl.useProgram(this.#objectProgram.program);
		this.#frameSelectionMetrics.objectProgramChanges += 1;
		for (const [unit, uniform] of [
			[0, this.#objectProgram.uniforms.base],
			[1, this.#objectProgram.uniforms.palette],
			[2, this.#objectProgram.uniforms.detail],
		] as const) {
			this.#bindObjectTexture(unit, this.#objectFallbackTexture, TextureFilteringMode.Nearest);
			gl.uniform1i(uniform, unit);
		}
		gl.uniformMatrix4fv(
			this.#objectProgram.uniforms.projection,
			false,
			mat4ToFloat32Array(view.projection, this.#matrixScratch),
		);
		gl.uniformMatrix4fv(
			this.#objectProgram.uniforms.view,
			false,
			mat4ToFloat32Array(view.view, this.#matrixScratch),
		);
		gl.uniform2f(
			this.#objectProgram.uniforms.cameraHorizontalPosition,
			view.cameraPosition.x,
			view.cameraPosition.z,
		);
		bindWebGL2DistanceFog(gl, this.#objectProgram.uniforms, fog);
		for (const object of view.objects) this.#drawObjectRange(object, view);
	}

	#drawObjectRange(object: ObjectFrameInput, view: PreparedView): void {
		const { drawUnit } = object;
		const { material } = drawUnit;
		const gl = this.#gl;
		this.#configureObjectCulling(material.polygon.cullMode);
		gl.uniformMatrix4fv(
			this.#objectProgram.uniforms.localToLandblock,
			false,
			mat4ToFloat32Array(object.localToLandblock, this.#matrixScratch),
		);
		const offset = createLandblockOffset(
			getLandblockCoordinates(object.landblockId),
			view.anchorCoordinates,
			this.#offsetScratch,
		);
		gl.uniform3f(
			this.#objectProgram.uniforms.landblockOffset,
			offset.x,
			offset.y,
			offset.z,
		);
		gl.uniform1i(
			this.#objectProgram.uniforms.wrapRepeat,
			material.sampler.wrap === TextureWrapMode.Repeat ? 1 : 0,
		);
		gl.uniform1i(
			this.#objectProgram.uniforms.palettedClipMap,
			material.palettedClipMap ? 1 : 0,
		);
		gl.uniform1f(
			this.#objectProgram.uniforms.alphaTest,
			drawUnit.ordering === "alpha-test" && material.source.kind === "texture"
				? 200 / 255
				: 0,
		);
		const opacity = sourceOpacity(material.source.translucency);
		const diffuse = Math.max(0, material.source.diffuseScale);
		if (material.source.kind === "solid-color") {
			const [red, green, blue, alpha] = material.source.color;
			gl.uniform1i(this.#objectProgram.uniforms.materialKind, 0);
			gl.uniform4f(
				this.#objectProgram.uniforms.materialColor,
				red * diffuse,
				green * diffuse,
				blue * diffuse,
				alpha * opacity,
			);
		} else {
			const base = material.textures.base;
			if (!base) throw new Error(`Textured material ${material.source.id} has no base texture.`);
			const baseBinding = this.#world.resolveAtlasTexture(base);
			const baseResource = this.#resources.getTexture2D(baseBinding.resource);
			this.#bindObjectTexture(0, baseResource.texture, material.sampler.filtering);
			this.#setAtlasRect(this.#objectProgram.uniforms.baseRect, baseBinding.placement.bounds, baseResource.width, baseResource.height);
			gl.uniform1i(this.#objectProgram.uniforms.base, 0);
			gl.uniform1i(
				this.#objectProgram.uniforms.materialKind,
				material.source.textureEncoding === "direct-color"
					? 1
					: material.source.textureEncoding === "index8"
						? 2
						: 3,
			);
			gl.uniform4f(this.#objectProgram.uniforms.materialColor, diffuse, diffuse, diffuse, opacity);
			if (material.source.textureEncoding !== "direct-color") {
				const palette = material.textures.palette;
				if (!palette) throw new Error(`Indexed material ${material.source.id} has no palette texture.`);
				const paletteBinding = this.#world.resolveAtlasTexture(palette);
				const paletteResource = this.#resources.getTexture2D(paletteBinding.resource);
				this.#bindObjectTexture(1, paletteResource.texture, TextureFilteringMode.Nearest);
				this.#setAtlasRect(this.#objectProgram.uniforms.paletteRect, paletteBinding.placement.bounds, paletteResource.width, paletteResource.height);
				gl.uniform1f(this.#objectProgram.uniforms.paletteWidth, paletteBinding.placement.bounds.max.x - paletteBinding.placement.bounds.min.x);
				gl.uniform1i(this.#objectProgram.uniforms.palette, 1);
			}
		}
		const detail = this.#world.resolveActiveRegionObjectDetail();
		if (detail && (material.source.rawSurfaceFlags & 0x20000) !== 0) {
			const resource = this.#resources.getTexture2D(this.#world.resolveTexture2D(detail.key));
			this.#bindObjectTexture(2, resource.texture, TextureFilteringMode.Linear);
			gl.uniform4f(this.#objectProgram.uniforms.detailRect, 0, 0, 1, 1);
			gl.uniform1f(this.#objectProgram.uniforms.detailTiling, detail.tiling);
			gl.uniform1i(this.#objectProgram.uniforms.detail, 2);
			gl.uniform1i(this.#objectProgram.uniforms.useDetail, 1);
		} else {
			gl.uniform1i(this.#objectProgram.uniforms.useDetail, 0);
		}
		gl.uniform1f(this.#objectProgram.uniforms.luminosity, material.source.luminosity);
		const geometry = this.#resources.getGeometry(object.geometry);
		validateDrawRange(geometry, drawUnit.indexStart, drawUnit.indexCount);
		gl.bindVertexArray(geometry.vertexArray);
		gl.drawElements(
			gl.TRIANGLES,
			drawUnit.indexCount,
			geometry.indexType,
			drawUnit.indexStart * geometry.indexElementBytes,
		);
		this.#frameSelectionMetrics.submittedBuildingRanges += 1;
		this.#frameSelectionMetrics.submittedBuildingTriangles +=
			drawUnit.indexCount / 3;
	}

	#bindObjectTexture(
		unit: number,
		texture: WebGLTexture,
		filtering: TextureFilteringMode,
	): void {
		const gl = this.#gl;
		gl.activeTexture(gl.TEXTURE0 + unit);
		gl.bindTexture(gl.TEXTURE_2D, texture);
		this.#frameSelectionMetrics.objectTexturePageBinds += 1;
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filtering === TextureFilteringMode.Nearest ? gl.NEAREST : gl.LINEAR);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filtering === TextureFilteringMode.Nearest ? gl.NEAREST : gl.LINEAR);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
	}

	#setAtlasRect(
		uniform: WebGLUniformLocation,
		bounds: import("../math/types").AABB2,
		width: number,
		height: number,
	): void {
		this.#gl.uniform4f(
			uniform,
			bounds.min.x / width,
			bounds.min.y / height,
			bounds.max.x / width,
			bounds.max.y / height,
		);
	}

	#configureObjectCulling(mode: StaticObjectDrawUnit["material"]["polygon"]["cullMode"]): void {
		const gl = this.#gl;
		if (mode === "double") {
			gl.disable(gl.CULL_FACE);
			return;
		}
		gl.enable(gl.CULL_FACE);
		gl.cullFace(mode === "counter-clockwise" ? gl.FRONT : gl.BACK);
	}

	#resizeCanvasForDpr(): void {
		const dpr = window.devicePixelRatio ?? 1;
		const width = Math.max(1, Math.floor(this.#canvas.clientWidth * dpr));
		const height = Math.max(1, Math.floor(this.#canvas.clientHeight * dpr));
		if (width === this.#frameWidth && height === this.#frameHeight) return;

		this.#frameWidth = width;
		this.#frameHeight = height;
		this.#canvas.width = width;
		this.#canvas.height = height;
		this.#gl.viewport(0, 0, width, height);
	}
}

function validateDrawRange(
	binding: WebGL2GeometryBinding,
	indexStart: number,
	indexCount: number,
): void {
	if (
		!Number.isInteger(indexStart) ||
		!Number.isInteger(indexCount) ||
		indexStart < 0 ||
		indexCount < 0 ||
		indexStart + indexCount > binding.indexCount
	) {
		throw new Error(
			`Invalid geometry draw range ${indexStart}+${indexCount}/${binding.indexCount}.`,
		);
	}
}

/** Retail sources encode translucency as either a unit float or a legacy byte-scale value. */
function sourceOpacity(translucency: number): number {
	const normalized =
		translucency > 1
			? 1 - Math.min(translucency, 255) / 255
			: 1 - translucency;
	return Math.max(0, Math.min(1, normalized));
}

/** Keep opaque/alpha-test ordering classes intact while clustering equivalent atlas/program state. */
function objectMaterialSortKey(drawUnit: StaticObjectDrawUnit): string {
	const { material } = drawUnit;
	return [
		material.source.kind,
		material.textures.base ?? "solid",
		material.textures.palette ?? "none",
		material.polygon.cullMode,
		material.sampler.filtering,
		material.sampler.wrap,
	].join("|");
}

function createObjectFallbackTexture(gl: WebGL2RenderingContext): WebGLTexture {
	const texture = gl.createTexture();
	if (!texture) throw new Error("Failed to allocate object fallback texture.");
	try {
		gl.bindTexture(gl.TEXTURE_2D, texture);
		gl.texImage2D(
			gl.TEXTURE_2D,
			0,
			gl.RGBA8,
			1,
			1,
			0,
			gl.RGBA,
			gl.UNSIGNED_BYTE,
			Uint8Array.of(255, 255, 255, 255),
		);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
		return texture;
	} catch (error) {
		gl.deleteTexture(texture);
		throw error;
	} finally {
		gl.bindTexture(gl.TEXTURE_2D, null);
	}
}
