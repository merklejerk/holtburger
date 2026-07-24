import {
	createLandblockOffset,
	createLandblockWorldOrigin,
} from "../landblocks";
import {
	createPerspectiveMat4,
	createViewMat4,
	mat4ToFloat32Array,
} from "../math/matrices";
import { Mat4, Vec3 } from "../math/types";
import type { TerrainDrawUnit } from "../terrain/types";
import type { FrameInput, FrameViewInput, Renderer } from "./renderer";
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

/** Anchor-relative matrices and content reused by all passes for one view. */
interface PreparedView {
	/** Projection matrix derived from the current drawing-buffer aspect ratio. */
	readonly projection: Mat4;
	/** Terrain selected by this renderer from its RenderWorld. */
	readonly terrain: readonly TerrainFrameInput[];
	/** Anchor-relative camera view transform. */
	readonly view: Mat4;
	/** Landblock defining the view's render-world origin. */
	readonly anchorLandblockId: FrameInput["anchorLandblockId"];
}

export class WebGL2Renderer implements Renderer {
	readonly #canvas: HTMLCanvasElement;
	readonly #gl: WebGL2RenderingContext;
	readonly #resources: WebGL2ResourceManager;
	/** Read-only runtime gateway used to collect this renderer's frame submissions. */
	readonly #world: RenderWorld;
	readonly #terrainProgram: WebGL2TerrainProgram;
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
		this.#beginFrame(input.environment);
		for (const view of input.views) {
			this.#drawView(
				this.#prepareView(input.anchorLandblockId, view),
				input.environment,
			);
		}
		void input.timeSeconds;
	}

	async destroy(): Promise<void> {
		this.#gl.deleteProgram(this.#terrainProgram.program);
	}

	#beginFrame(environment: FrameInput["environment"]): void {
		const gl = this.#gl;
		const clearColor =
			environment.distanceFog?.color ?? environment.backgroundColor;
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
		const anchorOrigin = createLandblockWorldOrigin(anchorLandblockId);
		const cameraPosition = new Vec3(
			camera.placement.position.x - anchorOrigin.x,
			camera.placement.position.y - anchorOrigin.y,
			camera.placement.position.z - anchorOrigin.z,
		);
		const aspectRatio = this.#frameWidth / Math.max(1, this.#frameHeight);
		return {
			anchorLandblockId,
			projection: createPerspectiveMat4(
				camera.fov,
				aspectRatio,
				camera.near,
				camera.far,
			),
			terrain: this.#collectTerrain(camera, anchorLandblockId),
			view: createViewMat4(cameraPosition, camera.placement.rotation),
		};
	}

	#collectTerrain(
		camera: FrameViewInput["camera"],
		anchorLandblockId: FrameInput["anchorLandblockId"],
	): readonly TerrainFrameInput[] {
		const terrain: TerrainFrameInput[] = [];
		const visible = this.#world.queryVisibleScene(camera);
		for (const { nodeId } of visible.entries) {
			const contribution = this.#world.getRenderContribution(
				nodeId,
				anchorLandblockId,
			);
			if (!contribution) continue;
			if (contribution.kind === "static-object") {
				void this.#world.resolveStaticObjectRenderable(contribution.renderable);
				continue;
			}
			if (contribution.kind === "dynamic") {
				void this.#world.resolveDynamicRenderable(contribution.renderable);
				continue;
			}
			if (contribution.kind === "env-cell") {
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
		}
		for (const crossing of visible.crossings) {
			const drawUnit = this.#world.getPortalDrawUnit(crossing.aperture.id);
			if (drawUnit) void this.#world.resolvePortalDrawUnit(drawUnit);
		}
		return terrain;
	}

	#drawView(view: PreparedView, environment: FrameInput["environment"]): void {
		this.#drawTerrain(view, environment);
		this.#gl.bindVertexArray(null);
	}

	#drawTerrain(
		view: PreparedView,
		environment: FrameInput["environment"],
	): void {
		const gl = this.#gl;
		gl.depthMask(true);
		gl.disable(gl.BLEND);
		gl.useProgram(this.#terrainProgram.program);
		gl.uniformMatrix4fv(
			this.#terrainProgram.uniforms.projection,
			false,
			mat4ToFloat32Array(view.projection),
		);
		gl.uniformMatrix4fv(
			this.#terrainProgram.uniforms.view,
			false,
			mat4ToFloat32Array(view.view),
		);
		gl.uniform1f(
			this.#terrainProgram.uniforms.detailFadeNear,
			DETAIL_FADE_NEAR,
		);
		gl.uniform1f(this.#terrainProgram.uniforms.detailFadeFar, DETAIL_FADE_FAR);
		const fog = environment.distanceFog;
		gl.uniform1i(this.#terrainProgram.uniforms.fogEnabled, fog ? 1 : 0);
		gl.uniform1f(this.#terrainProgram.uniforms.fogNear, fog?.near ?? 0);
		gl.uniform1f(this.#terrainProgram.uniforms.fogFar, fog?.far ?? 1);
		gl.uniform3f(
			this.#terrainProgram.uniforms.fogColor,
			fog?.color.red ?? 0,
			fog?.color.green ?? 0,
			fog?.color.blue ?? 0,
		);
		for (const terrain of view.terrain) {
			const landblockOffset = createLandblockOffset(
				terrain.drawUnit.landblockId,
				view.anchorLandblockId,
			);
			this.#bindTerrainResources(terrain);
			this.#drawTerrainGeometry(
				terrain.program.geometry,
				terrain.drawUnit.indexStart,
				terrain.drawUnit.indexCount,
				Mat4.identity(),
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
