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
	transformPoint3,
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
import type {
	GeometryResourceKey,
	InstanceStreamResourceKey,
} from "./resource-manager";
import { STATIC_INSTANCE_RECORD_BYTES } from "../systems/static-resources";
import type { TerrainProgramInput } from "./terrain-program-input";
import {
	WebGL2ResourceManager,
	type WebGL2GeometryBinding,
} from "./webgl2-resource-manager";
import {
	createWebGL2TerrainProgram,
	type WebGL2TerrainProgram,
} from "./webgl2-terrain-program";
import { FrameInstanceStreamArena } from "./frame-instance-stream-arena";
import {
	createWebGL2ObjectProgram,
	type WebGL2FogObjectProgram,
	type WebGL2FogInstancedObjectProgram,
	type WebGL2InstancedObjectProgram,
	type WebGL2ObjectProgram,
} from "./webgl2-object-program";
import { bindWebGL2ObjectInstanceRange } from "./webgl2-instance-buffer";
import { bindWebGL2DistanceFog } from "./webgl2-fog";
import {
	formAdjacentTransparentInstanceRuns,
	objectBlendPolicy,
	orderTransparentStaticRanges,
	type TransparentStaticRange,
} from "./object-rendering-policy";
import type { WebGL2InstanceBufferBinding } from "./webgl2-instance-buffer";

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
	readonly drawKind: "baked" | "instanced";
	readonly geometry: GeometryResourceKey;
	readonly indexCount: number;
	readonly indexStart: number;
	readonly instances:
		| null
		| {
				readonly kind: "persistent";
				readonly resource: InstanceStreamResourceKey;
		  }
		| {
				readonly cohortKey: string;
				readonly instance: import("../systems/static-resources").StaticInstanceData;
				readonly kind: "frame-template";
		  }
		| {
				readonly cohortKey: string;
				readonly firstInstance: number;
				readonly instanceCount: number;
				readonly kind: "frame-range";
		  };
	readonly landblockId: string;
	readonly localToLandblock: Mat4;
	readonly material: StaticObjectDrawUnit["material"];
	readonly ordering: StaticObjectDrawUnit["ordering"];
	readonly transparentSort: StaticObjectDrawUnit["transparentSort"];
}

type AnyObjectProgram =
	| WebGL2ObjectProgram
	| WebGL2FogObjectProgram
	| WebGL2InstancedObjectProgram
	| WebGL2FogInstancedObjectProgram;

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
	visibleStaticLayerCount: number;
	visibleStaticNodeCount: number;
	visibleDynamics: number;
	visibleEnvCellShells: number;
	submittedStaticObjectDrawCount: number;
	submittedStaticObjectTriangleCount: number;
	submittedBakedStaticObjectDrawCount: number;
	submittedBakedStaticObjectTriangleCount: number;
	submittedPersistentInstancedDrawCount: number;
	submittedPersistentInstanceCount: number;
	submittedInstancedSourceTriangleCount: number;
	transparentStaticCandidateCount: number;
	farTransparentStaticCandidateCount: number;
	nearTransparentStaticCandidateCount: number;
	transparentFrameRunCount: number;
	farTransparentFrameRunCount: number;
	nearTransparentFrameRunCount: number;
	transparentFrameUploadCount: number;
	transparentFrameUploadBytes: number;
	submittedTransparentStaticDrawCount: number;
	submittedTransparentInstanceCount: number;
	submittedAdditiveStaticDrawCount: number;
	frameInstanceCapacity: number;
	frameInstanceGrowthCount: number;
	frameInstanceViewHighWaterMark: number;
	objectProgramChanges: number;
	objectTexturePageBinds: number;
}

export class WebGL2Renderer implements Renderer {
	static readonly #identityMatrix = Mat4.identity();

	readonly #matrixScratch = new Float32Array(16);
	readonly #offsetScratch = new Vec3(0, 0, 0);
	/** Reused while deriving transparent range distances before sorting a view. */
	readonly #transparentCenterScratch = new Vec3(0, 0, 0);
	readonly #canvas: HTMLCanvasElement;
	readonly #gl: WebGL2RenderingContext;
	readonly #resources: WebGL2ResourceManager;
	readonly #frameInstances: FrameInstanceStreamArena;
	readonly #visibleStaticLayers = new Set<string>();
	/** Read-only runtime gateway used to collect this renderer's frame submissions. */
	readonly #world: RenderWorld;
	readonly #terrainProgram: WebGL2TerrainProgram;
	readonly #objectProgram: WebGL2FogObjectProgram;
	readonly #instancedObjectProgram: WebGL2FogInstancedObjectProgram;
	/** Transparent and additive materials deliberately use a shader with no fog uniforms. */
	readonly #blendedObjectProgram: WebGL2ObjectProgram;
	readonly #blendedInstancedObjectProgram: WebGL2InstancedObjectProgram;
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
		visibleStaticLayerCount: 0,
		visibleStaticNodeCount: 0,
		submittedStaticObjectDrawCount: 0,
		submittedStaticObjectTriangleCount: 0,
		submittedBakedStaticObjectDrawCount: 0,
		submittedBakedStaticObjectTriangleCount: 0,
		submittedPersistentInstancedDrawCount: 0,
		submittedPersistentInstanceCount: 0,
		submittedInstancedSourceTriangleCount: 0,
		transparentStaticCandidateCount: 0,
		farTransparentStaticCandidateCount: 0,
		nearTransparentStaticCandidateCount: 0,
		transparentFrameRunCount: 0,
		farTransparentFrameRunCount: 0,
		nearTransparentFrameRunCount: 0,
		transparentFrameUploadCount: 0,
		transparentFrameUploadBytes: 0,
		submittedTransparentStaticDrawCount: 0,
		submittedTransparentInstanceCount: 0,
		submittedAdditiveStaticDrawCount: 0,
		frameInstanceCapacity: 0,
		frameInstanceGrowthCount: 0,
		frameInstanceViewHighWaterMark: 0,
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
		this.#frameInstances = new FrameInstanceStreamArena(gl);
		this.#world = world;
		this.#terrainProgram = createWebGL2TerrainProgram(gl);
		this.#objectProgram = createWebGL2ObjectProgram(gl);
		this.#instancedObjectProgram = createWebGL2ObjectProgram(gl, {
			distanceFog: true,
			transformSource: "instanced",
		});
		this.#blendedObjectProgram = createWebGL2ObjectProgram(gl, {
			distanceFog: false,
		});
		this.#blendedInstancedObjectProgram = createWebGL2ObjectProgram(gl, {
			distanceFog: false,
			transformSource: "instanced",
		});
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
		const arena = this.#frameInstances.getDiagnostics();
		this.#frameSelectionMetrics.visibleStaticLayerCount =
			this.#visibleStaticLayers.size;
		this.#frameSelectionMetrics.frameInstanceCapacity = arena.capacity;
		this.#frameSelectionMetrics.frameInstanceGrowthCount = arena.growthCount;
		this.#frameSelectionMetrics.frameInstanceViewHighWaterMark =
			arena.viewHighWaterMark;
		void input.timeSeconds;
	}

	getFrameSelectionMetrics(): FrameSelectionMetrics {
		return { ...this.#frameSelectionMetrics };
	}

	async destroy(): Promise<void> {
		this.#gl.deleteProgram(this.#terrainProgram.program);
		this.#gl.deleteProgram(this.#objectProgram.program);
		this.#gl.deleteProgram(this.#instancedObjectProgram.program);
		this.#gl.deleteProgram(this.#blendedObjectProgram.program);
		this.#gl.deleteProgram(this.#blendedInstancedObjectProgram.program);
		this.#gl.deleteTexture(this.#objectFallbackTexture);
		this.#frameInstances.destroy();
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
	): {
		readonly terrain: readonly TerrainFrameInput[];
		readonly objects: readonly ObjectFrameInput[];
	} {
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
				this.#visibleStaticLayers.add(contribution.cullingGroup);
				this.#frameSelectionMetrics.visibleStaticNodeCount += 1;
				const node = this.#world.resolveStaticObjectNode(
					nodeId,
					contribution.renderable,
				);
				for (const resolved of node.drawUnits) {
					const { drawUnit } = resolved;
					if (
						drawUnit.kind === "instanced" &&
						drawUnit.ordering === "transparent"
					) {
						throw new Error(
							"Persistent transparent instance draw requires frame-streamed templates.",
						);
					}
					objects.push({
						drawKind: drawUnit.kind,
						geometry: resolved.geometry,
						indexCount: drawUnit.indexCount,
						indexStart: drawUnit.indexStart,
						instances:
							resolved.instances === null
								? null
								: { kind: "persistent", resource: resolved.instances },
						landblockId: node.placement.landblockId,
						localToLandblock: node.placement.localToLandblock,
						material: drawUnit.material,
						ordering: drawUnit.ordering,
						transparentSort: drawUnit.transparentSort,
					});
				}
				for (const resolved of node.frameStreamedInstances) {
					const { template } = resolved;
					objects.push({
						drawKind: "instanced",
						geometry: resolved.geometry,
						indexCount: template.indexCount,
						indexStart: template.indexStart,
						instances: {
							cohortKey: template.cohortKey,
							instance: template.instance,
							kind: "frame-template",
						},
						landblockId: node.placement.landblockId,
						localToLandblock: node.placement.localToLandblock,
						material: template.material,
						ordering: "transparent",
						transparentSort: template.transparentSort,
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
			if (left.ordering === "transparent" && right.ordering === "transparent") {
				return 0;
			}
			const ordering = left.ordering.localeCompare(right.ordering);
			if (ordering !== 0) return ordering;
			return objectMaterialSortKey(left).localeCompare(
				objectMaterialSortKey(right),
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
		this.#visibleStaticLayers.clear();
		metrics.visibleStaticLayerCount = 0;
		metrics.visibleStaticNodeCount = 0;
		metrics.submittedStaticObjectDrawCount = 0;
		metrics.submittedStaticObjectTriangleCount = 0;
		metrics.submittedBakedStaticObjectDrawCount = 0;
		metrics.submittedBakedStaticObjectTriangleCount = 0;
		metrics.submittedPersistentInstancedDrawCount = 0;
		metrics.submittedPersistentInstanceCount = 0;
		metrics.submittedInstancedSourceTriangleCount = 0;
		metrics.transparentStaticCandidateCount = 0;
		metrics.farTransparentStaticCandidateCount = 0;
		metrics.nearTransparentStaticCandidateCount = 0;
		metrics.transparentFrameRunCount = 0;
		metrics.farTransparentFrameRunCount = 0;
		metrics.nearTransparentFrameRunCount = 0;
		metrics.transparentFrameUploadCount = 0;
		metrics.transparentFrameUploadBytes = 0;
		metrics.submittedTransparentStaticDrawCount = 0;
		metrics.submittedTransparentInstanceCount = 0;
		metrics.submittedAdditiveStaticDrawCount = 0;
		metrics.frameInstanceCapacity = 0;
		metrics.frameInstanceGrowthCount = 0;
		metrics.frameInstanceViewHighWaterMark = 0;
		metrics.objectProgramChanges = 0;
		metrics.objectTexturePageBinds = 0;
	}

	#drawView(
		view: PreparedView,
		fog: FrameInput["environment"]["distanceFog"],
	): void {
		this.#drawTerrain(view, fog);
		this.#drawOpaqueObjects(view, fog);
		this.#drawBlendedObjects(view);
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
		const objects = view.objects.filter(
			({ ordering }) => ordering === "opaque" || ordering === "alpha-test",
		);
		if (objects.length === 0) return;
		const gl = this.#gl;
		gl.depthMask(true);
		gl.disable(gl.BLEND);
		let activeProgram:
			| WebGL2FogObjectProgram
			| WebGL2FogInstancedObjectProgram
			| null = null;
		for (const object of objects) {
			const program =
				object.drawKind === "instanced"
					? this.#instancedObjectProgram
					: this.#objectProgram;
			if (program !== activeProgram) {
				this.#activateObjectProgram(program, view, fog);
				activeProgram = program;
			}
			this.#drawObjectRange(program, object, view);
		}
	}

	#drawBlendedObjects(view: PreparedView): void {
		const transparent: TransparentStaticRange<ObjectFrameInput>[] = [];
		const additive: ObjectFrameInput[] = [];
		for (const object of view.objects) {
			if (object.ordering === "additive") {
				additive.push(object);
				continue;
			}
			if (object.ordering !== "transparent") continue;
			const facts = object.transparentSort;
			if (!facts)
				throw new Error(
					"Transparent static-object contribution lacks sort facts.",
				);
			if (object.instances?.kind === "frame-template") {
				transformPoint3(
					object.instances.instance.sourceToLandblock,
					facts.center,
					this.#transparentCenterScratch,
				);
			} else {
				transformPoint3(
					object.localToLandblock,
					facts.center,
					this.#transparentCenterScratch,
				);
			}
			const offset = createLandblockOffset(
				getLandblockCoordinates(object.landblockId),
				view.anchorCoordinates,
				this.#offsetScratch,
			);
			const x =
				this.#transparentCenterScratch.x + offset.x - view.cameraPosition.x;
			const y =
				this.#transparentCenterScratch.y + offset.y - view.cameraPosition.y;
			const z =
				this.#transparentCenterScratch.z + offset.z - view.cameraPosition.z;
			transparent.push({
				distanceSquared: x * x + y * y + z * z,
				range: object,
				stableId: facts.stableId,
			});
		}
		additive.sort((left, right) =>
			objectMaterialSortKey(left).localeCompare(objectMaterialSortKey(right)),
		);
		const orderedTransparent = orderTransparentStaticRanges(
			transparent,
			compareFarTransparentBatchOrder,
		);
		this.#frameSelectionMetrics.transparentStaticCandidateCount +=
			transparent.length;
		this.#frameSelectionMetrics.farTransparentStaticCandidateCount +=
			orderedTransparent.far.length;
		this.#frameSelectionMetrics.nearTransparentStaticCandidateCount +=
			orderedTransparent.near.length;
		const sortedTransparent = this.#prepareFrameTransparentRuns({
			far: orderedTransparent.far.map(({ range }) => range),
			near: orderedTransparent.near.map(({ range }) => range),
		});
		if (sortedTransparent.length === 0 && additive.length === 0) return;
		const gl = this.#gl;
		gl.depthMask(false);
		gl.enable(gl.BLEND);
		let activeProgram:
			| WebGL2ObjectProgram
			| WebGL2InstancedObjectProgram
			| null = null;
		for (const object of [...sortedTransparent, ...additive]) {
			const program =
				object.drawKind === "instanced"
					? this.#blendedInstancedObjectProgram
					: this.#blendedObjectProgram;
			if (program !== activeProgram) {
				this.#activateObjectProgram(program, view, null);
				activeProgram = program;
			}
			this.#configureObjectBlend(object.material);
			this.#drawObjectRange(program, object, view);
		}
	}

	/**
	 * Upload both transparent phases once while keeping their independent run boundaries.
	 */
	#prepareFrameTransparentRuns(ordered: {
		readonly far: readonly ObjectFrameInput[];
		readonly near: readonly ObjectFrameInput[];
	}): readonly ObjectFrameInput[] {
		const orderedInstances: import("../systems/static-resources").StaticInstanceData[] =
			[];
		const submissions: ObjectFrameInput[] = [];
		const schedulePhase = (phase: readonly ObjectFrameInput[]) =>
			formAdjacentTransparentInstanceRuns(
				phase,
				(object) => object.instances?.kind === "frame-template",
				(left, right) =>
					left.instances?.kind === "frame-template" &&
					right.instances?.kind === "frame-template" &&
					compareFrameTemplateBatchIdentity(left, right) === 0,
			);
		const farScheduled = schedulePhase(ordered.far);
		const nearScheduled = schedulePhase(ordered.near);
		const farRunCount = farScheduled.filter(
			(submission) => submission.kind === "frame-instance-run",
		).length;
		const nearRunCount = nearScheduled.filter(
			(submission) => submission.kind === "frame-instance-run",
		).length;
		this.#frameSelectionMetrics.transparentFrameRunCount +=
			farRunCount + nearRunCount;
		this.#frameSelectionMetrics.farTransparentFrameRunCount += farRunCount;
		this.#frameSelectionMetrics.nearTransparentFrameRunCount += nearRunCount;
		const scheduled = [...farScheduled, ...nearScheduled];
		for (const submission of scheduled) {
			if (submission.kind === "single") {
				submissions.push(submission.value);
				continue;
			}
			const [object, ...rest] = submission.values;
			if (!object || object.instances?.kind !== "frame-template") {
				throw new Error("Frame-instance run has no template.");
			}
			const firstInstance = orderedInstances.length;
			orderedInstances.push(object.instances.instance);
			for (const adjacent of rest) {
				if (adjacent.instances?.kind !== "frame-template") {
					throw new Error("Frame-instance run contains a non-template value.");
				}
				orderedInstances.push(adjacent.instances.instance);
			}
			submissions.push({
				...object,
				instances: {
					cohortKey: object.instances.cohortKey,
					firstInstance,
					instanceCount: submission.values.length,
					kind: "frame-range",
				},
			});
		}
		this.#frameInstances.prepareView(orderedInstances);
		if (orderedInstances.length > 0) {
			this.#frameSelectionMetrics.transparentFrameUploadCount += 1;
			this.#frameSelectionMetrics.transparentFrameUploadBytes +=
				orderedInstances.length * STATIC_INSTANCE_RECORD_BYTES;
		}
		return submissions;
	}

	#drawObjectRange(
		program: AnyObjectProgram,
		object: ObjectFrameInput,
		view: PreparedView,
	): void {
		if (
			(object.drawKind === "baked") !==
			(program.transformSource === "baked")
		) {
			throw new Error(
				`${object.drawKind} draw cannot use ${program.transformSource} object program.`,
			);
		}
		const { material } = object;
		const gl = this.#gl;
		this.#configureObjectCulling(material.polygon.cullMode);
		if (program.transformSource === "baked") {
			gl.uniformMatrix4fv(
				program.uniforms.localToLandblock,
				false,
				mat4ToFloat32Array(object.localToLandblock, this.#matrixScratch),
			);
		}
		const offset = createLandblockOffset(
			getLandblockCoordinates(object.landblockId),
			view.anchorCoordinates,
			this.#offsetScratch,
		);
		gl.uniform3f(
			program.uniforms.landblockOffset,
			offset.x,
			offset.y,
			offset.z,
		);
		gl.uniform1i(
			program.uniforms.wrapRepeat,
			material.sampler.wrap === TextureWrapMode.Repeat ? 1 : 0,
		);
		gl.uniform1i(
			program.uniforms.palettedClipMap,
			material.palettedClipMap ? 1 : 0,
		);
		gl.uniform1f(
			program.uniforms.alphaTest,
			object.ordering === "alpha-test" && material.source.kind === "texture"
				? 200 / 255
				: 0,
		);
		const opacity = sourceOpacity(material.source.translucency);
		const diffuse = Math.max(0, material.source.diffuseScale);
		if (material.source.kind === "solid-color") {
			const [red, green, blue, alpha] = material.source.color;
			gl.uniform1i(program.uniforms.materialKind, 0);
			gl.uniform4f(
				program.uniforms.materialColor,
				red * diffuse,
				green * diffuse,
				blue * diffuse,
				alpha * opacity,
			);
		} else {
			const base = material.textures.base;
			if (!base)
				throw new Error(
					`Textured material ${material.source.id} has no base texture.`,
				);
			const baseBinding = this.#world.resolveAtlasTexture(base);
			const baseResource = this.#resources.getTexture2D(baseBinding.resource);
			this.#bindObjectTexture(
				0,
				baseResource.texture,
				material.sampler.filtering,
			);
			this.#setAtlasRect(
				program.uniforms.baseRect,
				baseBinding.placement.bounds,
				baseResource.width,
				baseResource.height,
			);
			gl.uniform1i(program.uniforms.base, 0);
			gl.uniform1i(
				program.uniforms.materialKind,
				material.source.textureEncoding === "direct-color"
					? 1
					: material.source.textureEncoding === "index8"
						? 2
						: 3,
			);
			gl.uniform4f(
				program.uniforms.materialColor,
				diffuse,
				diffuse,
				diffuse,
				opacity,
			);
			if (material.source.textureEncoding !== "direct-color") {
				const palette = material.textures.palette;
				if (!palette)
					throw new Error(
						`Indexed material ${material.source.id} has no palette texture.`,
					);
				const paletteBinding = this.#world.resolveAtlasTexture(palette);
				const paletteResource = this.#resources.getTexture2D(
					paletteBinding.resource,
				);
				this.#bindObjectTexture(
					1,
					paletteResource.texture,
					TextureFilteringMode.Nearest,
				);
				this.#setAtlasRect(
					program.uniforms.paletteRect,
					paletteBinding.placement.bounds,
					paletteResource.width,
					paletteResource.height,
				);
				gl.uniform2f(
					program.uniforms.paletteSize,
					paletteBinding.placement.bounds.max.x -
						paletteBinding.placement.bounds.min.x,
					paletteBinding.placement.bounds.max.y -
						paletteBinding.placement.bounds.min.y,
				);
				gl.uniform1i(program.uniforms.palette, 1);
			}
		}
		const detail = this.#world.resolveActiveRegionObjectDetail();
		if (detail && (material.source.rawSurfaceFlags & 0x20000) !== 0) {
			const resource = this.#resources.getTexture2D(
				this.#world.resolveTexture2D(detail.key),
			);
			this.#bindObjectTexture(2, resource.texture, TextureFilteringMode.Linear);
			gl.uniform4f(program.uniforms.detailRect, 0, 0, 1, 1);
			gl.uniform1f(program.uniforms.detailTiling, detail.tiling);
			gl.uniform1i(program.uniforms.detail, 2);
			gl.uniform1i(program.uniforms.useDetail, 1);
		} else {
			gl.uniform1i(program.uniforms.useDetail, 0);
		}
		gl.uniform1f(program.uniforms.luminosity, material.source.luminosity);
		const geometry = this.#resources.getGeometry(object.geometry);
		validateDrawRange(geometry, object.indexStart, object.indexCount);
		gl.bindVertexArray(geometry.vertexArray);
		let submittedInstanceCount = 1;
		if (object.drawKind === "instanced") {
			if (!object.instances) {
				throw new Error("Instanced draw has no resolved instance stream.");
			}
			if (object.instances.kind === "frame-template") {
				throw new Error(
					"Unprepared frame instance template reached submission.",
				);
			}
			const range =
				object.instances.kind === "persistent"
					? persistentInstanceRange(
							this.#resources.getInstanceStream(object.instances.resource),
						)
					: this.#frameInstances.getRange(
							object.instances.firstInstance,
							object.instances.instanceCount,
						);
			const instances = range.binding;
			if (range.instanceCount === 0)
				throw new Error("Instanced draw has an empty instance range.");
			bindWebGL2ObjectInstanceRange(
				gl,
				instances,
				range.firstInstance,
				range.instanceCount,
			);
			submittedInstanceCount = range.instanceCount;
			gl.drawElementsInstanced(
				gl.TRIANGLES,
				object.indexCount,
				geometry.indexType,
				object.indexStart * geometry.indexElementBytes,
				submittedInstanceCount,
			);
		} else {
			if (object.instances !== null) {
				throw new Error("Baked draw unexpectedly resolved an instance stream.");
			}
			gl.drawElements(
				gl.TRIANGLES,
				object.indexCount,
				geometry.indexType,
				object.indexStart * geometry.indexElementBytes,
			);
		}
		const sourceTriangleCount = object.indexCount / 3;
		this.#frameSelectionMetrics.submittedStaticObjectDrawCount += 1;
		this.#frameSelectionMetrics.submittedStaticObjectTriangleCount +=
			sourceTriangleCount * submittedInstanceCount;
		if (object.drawKind === "baked") {
			this.#frameSelectionMetrics.submittedBakedStaticObjectDrawCount += 1;
			this.#frameSelectionMetrics.submittedBakedStaticObjectTriangleCount +=
				sourceTriangleCount;
		} else {
			this.#frameSelectionMetrics.submittedInstancedSourceTriangleCount +=
				sourceTriangleCount;
			if (object.instances?.kind === "persistent") {
				this.#frameSelectionMetrics.submittedPersistentInstancedDrawCount += 1;
				this.#frameSelectionMetrics.submittedPersistentInstanceCount +=
					submittedInstanceCount;
			}
		}
		if (object.ordering === "transparent") {
			this.#frameSelectionMetrics.submittedTransparentStaticDrawCount += 1;
			if (object.drawKind === "instanced") {
				this.#frameSelectionMetrics.submittedTransparentInstanceCount +=
					submittedInstanceCount;
			}
		}
		if (object.ordering === "additive") {
			this.#frameSelectionMetrics.submittedAdditiveStaticDrawCount += 1;
		}
	}

	#activateObjectProgram(
		program: AnyObjectProgram,
		view: PreparedView,
		fog: FrameInput["environment"]["distanceFog"],
	): void {
		const gl = this.#gl;
		gl.useProgram(program.program);
		this.#frameSelectionMetrics.objectProgramChanges += 1;
		for (const [unit, uniform] of [
			[0, program.uniforms.base],
			[1, program.uniforms.palette],
			[2, program.uniforms.detail],
		] as const) {
			this.#bindObjectTexture(
				unit,
				this.#objectFallbackTexture,
				TextureFilteringMode.Nearest,
			);
			gl.uniform1i(uniform, unit);
		}
		gl.uniformMatrix4fv(
			program.uniforms.projection,
			false,
			mat4ToFloat32Array(view.projection, this.#matrixScratch),
		);
		gl.uniformMatrix4fv(
			program.uniforms.view,
			false,
			mat4ToFloat32Array(view.view, this.#matrixScratch),
		);
		if ("fogUniforms" in program) {
			gl.uniform2f(
				program.fogUniforms.cameraHorizontalPosition,
				view.cameraPosition.x,
				view.cameraPosition.z,
			);
			bindWebGL2DistanceFog(gl, program.fogUniforms, fog);
		}
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
		gl.texParameteri(
			gl.TEXTURE_2D,
			gl.TEXTURE_MIN_FILTER,
			filtering === TextureFilteringMode.Nearest ? gl.NEAREST : gl.LINEAR,
		);
		gl.texParameteri(
			gl.TEXTURE_2D,
			gl.TEXTURE_MAG_FILTER,
			filtering === TextureFilteringMode.Nearest ? gl.NEAREST : gl.LINEAR,
		);
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

	#configureObjectCulling(
		mode: StaticObjectDrawUnit["material"]["polygon"]["cullMode"],
	): void {
		const gl = this.#gl;
		if (mode === "double") {
			gl.disable(gl.CULL_FACE);
			return;
		}
		gl.enable(gl.CULL_FACE);
		gl.cullFace(mode === "counter-clockwise" ? gl.FRONT : gl.BACK);
	}

	#configureObjectBlend(material: StaticObjectDrawUnit["material"]): void {
		const policy = objectBlendPolicy(material.source.rawSurfaceFlags);
		const gl = this.#gl;
		gl.blendFunc(
			policy.source === "one"
				? gl.ONE
				: policy.source === "src-alpha"
					? gl.SRC_ALPHA
					: gl.ONE_MINUS_SRC_ALPHA,
			policy.destination === "one"
				? gl.ONE
				: policy.destination === "src-alpha"
					? gl.SRC_ALPHA
					: gl.ONE_MINUS_SRC_ALPHA,
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

/** Retail sources encode translucency as either a unit float or a legacy byte-scale value. */
function sourceOpacity(translucency: number): number {
	const normalized =
		translucency > 1 ? 1 - Math.min(translucency, 255) / 255 : 1 - translucency;
	return Math.max(0, Math.min(1, normalized));
}

/** Cluster far transparency by the exact fields used to form frame-instance runs. */
function compareFarTransparentBatchOrder(
	left: ObjectFrameInput,
	right: ObjectFrameInput,
): number {
	const leftFrame = left.instances?.kind === "frame-template";
	const rightFrame = right.instances?.kind === "frame-template";
	if (leftFrame !== rightFrame) return leftFrame ? -1 : 1;
	if (leftFrame && rightFrame) {
		return compareFrameTemplateBatchIdentity(left, right);
	}
	return (
		objectMaterialSortKey(left).localeCompare(objectMaterialSortKey(right)) ||
		left.geometry.localeCompare(right.geometry) ||
		left.landblockId.localeCompare(right.landblockId) ||
		left.indexStart - right.indexStart ||
		left.indexCount - right.indexCount
	);
}

/** Compare the complete compatibility identity shared by sorting and adjacent run formation. */
function compareFrameTemplateBatchIdentity(
	left: ObjectFrameInput,
	right: ObjectFrameInput,
): number {
	const leftInstances = left.instances;
	const rightInstances = right.instances;
	if (
		leftInstances?.kind !== "frame-template" ||
		rightInstances?.kind !== "frame-template"
	) {
		throw new Error(
			"Transparent frame-template batch comparison requires two templates.",
		);
	}
	return (
		leftInstances.cohortKey.localeCompare(rightInstances.cohortKey) ||
		left.geometry.localeCompare(right.geometry) ||
		left.landblockId.localeCompare(right.landblockId) ||
		left.indexStart - right.indexStart ||
		left.indexCount - right.indexCount
	);
}

/** Keep opaque/alpha-test ordering classes intact while clustering equivalent atlas/program state. */
function objectMaterialSortKey(input: {
	readonly material: StaticObjectDrawUnit["material"];
}): string {
	const { material } = input;
	return [
		material.source.kind,
		material.textures.base ?? "solid",
		material.textures.palette ?? "none",
		material.polygon.cullMode,
		material.sampler.filtering,
		material.sampler.wrap,
	].join("|");
}

function persistentInstanceRange(binding: WebGL2InstanceBufferBinding): {
	readonly binding: WebGL2InstanceBufferBinding;
	readonly firstInstance: 0;
	readonly instanceCount: number;
} {
	return {
		binding,
		firstInstance: 0,
		instanceCount: binding.populatedInstanceCount,
	};
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
