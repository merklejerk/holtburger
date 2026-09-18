import type { ParticleMeshSource } from "../../assets/particle-mesh-source";
import { SHARED_FRONTEND_TUNING } from "../../frontend-tuning";
import { ParticleMeshCache } from "../behavior/particle-mesh-cache";
import { resolveSceneLightingByRole } from "../environment/scene-lighting";
import type { RuntimeLight } from "../environment/runtime-lights";
import {
	createPerspectiveMat4,
	createViewMat4,
	mat4ToFloat32Array,
	multiplyMat4,
	transformPoint3,
} from "../math/matrices";
import { Mat4, Vec3 } from "../math/types";
import type { ObjectPreviewFrame } from "../preview/object-preview-presentation";
import type { PreparedObjectPreviewAssets } from "../preview/object-preview-assets";
import type { PartRenderState } from "../systems/components";
import type { TexturePreparer } from "../textures/texture-preparer";
import {
	isAssetTextureKey,
	TexturePixelFormat,
	TextureWrapMode,
} from "../textures/types";
import { DynamicBatchedRanges } from "./dynamic-batched-ranges";
import {
	createDynamicLightScratch,
	bindWebGL2DynamicLights,
	bindWebGL2SceneLighting,
	bindWebGL2StaticLights,
} from "./webgl2-lighting";
import {
	OBJECT_PREVIEW_VERTICAL_FOV_DEGREES,
	resolveObjectPreviewViewTransform,
	type ObjectPreviewViewTransform,
} from "./object-preview-camera";
import { ParticleMeshResidency } from "./particle-mesh-residency";
import { dynamicObjectPhase } from "./object-rendering-policy";
import type { RenderExtent } from "./render-extent";
import { validateRenderExtent } from "./render-extent";
import type {
	GeometryResourceKey,
	Texture2DResourceKey,
} from "./resource-manager";
import { WebGL2DeviceStateApplicator } from "./webgl2-device-state-applicator";
import {
	WebGL2DynamicAppearances,
	type PreparedDynamicAppearance,
} from "./webgl2-dynamic-appearances";
import { WebGL2DynamicPosePages } from "./webgl2-dynamic-pose-pages";
import { WebGL2ObjectDrawCompiler } from "./webgl2-object-draw-compiler";
import {
	createWebGL2ObjectProgram,
	OBJECT_TEXTURE_UNITS,
	type WebGL2DynamicObjectProgram,
} from "./webgl2-object-program";
import { WebGL2ParticlePass } from "./webgl2-particle-pass";
import { WebGL2PreviewTextureResidency } from "./webgl2-preview-texture-residency";
import { WebGL2ResourceManager } from "./webgl2-resource-manager";
import { WebGL2TextureSamplerCatalog } from "./webgl2-texture-sampler-catalog";
import { probeWebGL2TextureFilteringSupport } from "./webgl2-texture-filtering-support";
import {
	TRANSPARENT_CANVAS_EMISSION_BLEND,
	TRANSPARENT_CANVAS_EMISSION_MODE,
	transparentCanvasEmissionMode,
} from "./transparent-canvas-emission";

const PREVIEW_POSE_KEY = "object-preview";
const PREVIEW_NODE_ID = "scene-node:0";

/** Neutral inspection lighting independent of regional environment and viewer-light policy. */
const PREVIEW_LIGHTING = resolveSceneLightingByRole({
	ambientLevel: 0.52,
	ambientColor: { red: 1, green: 1, blue: 1, alpha: 1 },
	sunVector: new Vec3(-0.8, 1.2, 1.4),
	sunColor: { red: 1, green: 0.96, blue: 0.9, alpha: 1 },
})["outdoor-object"];

const NO_LIGHTS: readonly RuntimeLight[] = [];

type PreviewDynamicRange = Extract<
	PreparedDynamicAppearance,
	{ kind: "drawable" }
>["plan"]["ranges"][number];

interface PreviewFallbackBinding {
	readonly texture: WebGLTexture;
	readonly sampler: WebGLSampler;
}

interface PreviewDynamicPart {
	readonly frameInstance: {
		readonly sourceToLandblock: Mat4;
		readonly color: { r: number; g: number; b: number; a: number };
	};
	renderState: PartRenderState;
}

interface PreviewRendererDependencies {
	readonly particleMeshSource: ParticleMeshSource;
	/** Diagnostic harness only; production leaves the composited default buffer discardable. */
	readonly preserveDrawingBuffer?: boolean;
	readonly texturePreparer: TexturePreparer;
}

interface PreviewCameraCache {
	readonly height: number;
	readonly transform: ObjectPreviewViewTransform;
	readonly width: number;
	readonly yawRadians: number;
}

/** Device pixels and yaw supplied by the controller for one admitted preview frame. */
export interface ObjectPreviewRenderViewport {
	readonly extent: RenderExtent;
	readonly yawRadians: number;
}

/** Cold probe facts for lifecycle verification; ordinary UI never samples these per frame. */
export interface ObjectPreviewRendererDiagnostics {
	readonly appearanceRangeCount: number;
	readonly drawnObjectRangeCount: number;
	readonly frameCount: number;
	readonly minimumMaterialOpacity: number;
	readonly minimumPartOpacity: number;
	readonly particle: ReturnType<WebGL2ParticlePass["getDiagnostics"]>;
	readonly transparentRangeCount: number;
}

/** Dedicated transparent WebGL2 device for one mounted object preview. */
export class WebGL2PreviewRenderer {
	readonly #canvas: HTMLCanvasElement;
	readonly #gl: WebGL2RenderingContext;
	readonly #assets: PreparedObjectPreviewAssets;
	readonly #resources: WebGL2ResourceManager;
	readonly #textures: WebGL2PreviewTextureResidency;
	readonly #samplers: WebGL2TextureSamplerCatalog;
	readonly #state: WebGL2DeviceStateApplicator;
	readonly #appearances: WebGL2DynamicAppearances;
	readonly #poses: WebGL2DynamicPosePages<typeof PREVIEW_POSE_KEY>;
	readonly #particleResidency: ParticleMeshResidency;
	readonly #particleMeshes: ParticleMeshCache;
	readonly #particles: WebGL2ParticlePass;
	readonly #program: WebGL2DynamicObjectProgram;
	readonly #geometryResource: GeometryResourceKey;
	readonly #geometry: ReturnType<WebGL2ResourceManager["getGeometry"]>;
	readonly #appearance: Extract<
		PreparedDynamicAppearance,
		{ kind: "drawable" }
	>;
	readonly #releaseAppearance: () => void;
	readonly #fallbackResource: Texture2DResourceKey;
	readonly #fallback: PreviewFallbackBinding;
	readonly #parts: PreviewDynamicPart[];
	readonly #poseInput: ReadonlyMap<
		typeof PREVIEW_POSE_KEY,
		readonly PreviewDynamicPart[]
	>;
	readonly #opaqueRanges = new DynamicBatchedRanges("opaque");
	readonly #additiveRanges = new DynamicBatchedRanges("additive");
	readonly #dynamicLightScratch = createDynamicLightScratch();
	readonly #matrixScratch = new Float32Array(16);
	readonly #depthScratch = Vec3.zero();
	#destroyed = false;
	#contextLost = false;
	#drawnObjectRangeCount = 0;
	#frameCount = 0;
	#cameraCache: PreviewCameraCache | null = null;

	readonly #onContextLost = (event: Event): void => {
		event.preventDefault();
		this.#contextLost = true;
	};

	private constructor(
		canvas: HTMLCanvasElement,
		gl: WebGL2RenderingContext,
		assets: PreparedObjectPreviewAssets,
		resources: WebGL2ResourceManager,
		textures: WebGL2PreviewTextureResidency,
		samplers: WebGL2TextureSamplerCatalog,
		state: WebGL2DeviceStateApplicator,
		appearances: WebGL2DynamicAppearances,
		poses: WebGL2DynamicPosePages<typeof PREVIEW_POSE_KEY>,
		particleResidency: ParticleMeshResidency,
		particleMeshes: ParticleMeshCache,
		particles: WebGL2ParticlePass,
		program: WebGL2DynamicObjectProgram,
		geometryResource: GeometryResourceKey,
		appearance: Extract<PreparedDynamicAppearance, { kind: "drawable" }>,
		releaseAppearance: () => void,
		fallbackResource: Texture2DResourceKey,
		fallback: PreviewFallbackBinding,
	) {
		this.#canvas = canvas;
		this.#gl = gl;
		this.#assets = assets;
		this.#resources = resources;
		this.#textures = textures;
		this.#samplers = samplers;
		this.#state = state;
		this.#appearances = appearances;
		this.#poses = poses;
		this.#particleResidency = particleResidency;
		this.#particleMeshes = particleMeshes;
		this.#particles = particles;
		this.#program = program;
		this.#geometryResource = geometryResource;
		this.#geometry = resources.getGeometry(geometryResource);
		this.#appearance = appearance;
		this.#releaseAppearance = releaseAppearance;
		this.#fallbackResource = fallbackResource;
		this.#fallback = fallback;
		this.#parts = assets.template.layout.parts.map(() => ({
			frameInstance: {
				color: { r: 1, g: 1, b: 1, a: 1 },
				sourceToLandblock: Mat4.identity(),
			},
			renderState: { textureVelocity: [0, 0], translucency: 0 },
		}));
		this.#poseInput = new Map([[PREVIEW_POSE_KEY, this.#parts]]);
		canvas.addEventListener("webglcontextlost", this.#onContextLost);
	}

	static async build(
		canvas: HTMLCanvasElement,
		assets: PreparedObjectPreviewAssets,
		dependencies: PreviewRendererDependencies,
	): Promise<WebGL2PreviewRenderer> {
		const gl = canvas.getContext("webgl2", {
			alpha: true,
			antialias: true,
			depth: true,
			// Object and particle RGB is accumulated in premultiplied form; coverage-alpha blending
			// below gives the DOM compositor the matching transparent-canvas contract.
			premultipliedAlpha: true,
			preserveDrawingBuffer: dependencies.preserveDrawingBuffer ?? false,
			stencil: false,
		});
		if (!gl) throw new Error("WebGL2 is not available for object previews.");
		const resources = new WebGL2ResourceManager(gl);
		const textures = new WebGL2PreviewTextureResidency(resources);
		const samplers = new WebGL2TextureSamplerCatalog(
			gl,
			probeWebGL2TextureFilteringSupport(gl),
		);
		const state = new WebGL2DeviceStateApplicator(gl, "coverage");
		const compiler = new WebGL2ObjectDrawCompiler({
			resolveAtlasTexture: (key) => textures.resolveAtlasTexture(key),
			resolveStaticDetail: () => null,
			resolveTexture2D: (key) => {
				if (!isAssetTextureKey(key))
					throw new Error(
						`Preview renderer cannot resolve generated texture ${key}.`,
					);
				return textures.resolveTexture2D(key);
			},
			resources,
			samplers,
			textureFiltering: () =>
				SHARED_FRONTEND_TUNING.rendering.frameDefaults.textureFiltering,
		});
		const appearances = new WebGL2DynamicAppearances(gl, (material, ordering) =>
			compiler.prepareSurface(material, ordering),
		);
		const poses = new WebGL2DynamicPosePages<typeof PREVIEW_POSE_KEY>(gl);
		const particleResidency = new ParticleMeshResidency(resources);
		const particleMeshes = new ParticleMeshCache(
			dependencies.particleMeshSource,
			(batch) => particleResidency.install(batch, dependencies.texturePreparer),
		);
		const particles = new WebGL2ParticlePass((id) =>
			particleResidency.resolve(id),
		);
		let geometryResource: GeometryResourceKey | null = null;
		let releaseAppearance: (() => void) | null = null;
		let fallbackResource: Texture2DResourceKey | null = null;
		let program: WebGL2DynamicObjectProgram | null = null;
		try {
			await textures.install(
				assets.template.textureRequirements,
				dependencies.texturePreparer,
			);
			geometryResource = resources.createGeometry(
				assets.template.layout.geometry,
			);
			releaseAppearance = appearances.retain(
				assets.template.layout,
				assets.template.appearance,
			);
			const appearance = appearances.get(assets.template.appearance);
			if (appearance.kind === "empty")
				throw new Error("Object preview visual has no drawable ranges.");
			await particleMeshes.prepare(assets.particleMeshIds);
			program = createWebGL2ObjectProgram(gl, {
				distanceFog: false,
				materialSource: "table",
				outdoorPssm: false,
				portalVisibility: false,
				transformSource: "pose-table",
			});
			fallbackResource = resources.createTexture2D({
				data: Uint8Array.of(255, 255, 255, 255),
				format: TexturePixelFormat.RGBA8,
				height: 1,
				mipLevels: 1,
				width: 1,
			});
			const fallbackBinding = resources.getTexture2D(fallbackResource);
			return new WebGL2PreviewRenderer(
				canvas,
				gl,
				assets,
				resources,
				textures,
				samplers,
				state,
				appearances,
				poses,
				particleResidency,
				particleMeshes,
				particles,
				program,
				geometryResource,
				appearance,
				releaseAppearance,
				fallbackResource,
				{
					sampler: samplers.getSampler({
						mipLevels: 1,
						policy:
							SHARED_FRONTEND_TUNING.rendering.frameDefaults.textureFiltering,
						samplingClass: "exact",
						wrap: TextureWrapMode.Clamp,
					}),
					texture: fallbackBinding.texture,
				},
			);
		} catch (cause) {
			if (program) gl.deleteProgram(program.program);
			if (fallbackResource) resources.releaseResource(fallbackResource);
			releaseAppearance?.();
			particles.destroy();
			particleMeshes.destroy();
			particleResidency.destroy();
			poses.destroy();
			appearances.destroy();
			samplers.destroy();
			textures.destroy();
			if (geometryResource) resources.releaseResource(geometryResource);
			await resources.destroy();
			throw cause;
		}
	}

	draw(frame: ObjectPreviewFrame, viewport: ObjectPreviewRenderViewport): void {
		this.#assertUsable();
		validateRenderExtent(viewport.extent, "Object preview canvas");
		if (!Number.isFinite(viewport.yawRadians))
			throw new Error("Object preview yaw must be finite.");
		this.#resize(viewport.extent);
		const camera = this.#resolveCamera(viewport);
		const projection = createPerspectiveMat4(
			OBJECT_PREVIEW_VERTICAL_FOV_DEGREES,
			viewport.extent.width / viewport.extent.height,
			camera.nearPlane,
			camera.farPlane,
		);
		const view = createViewMat4(camera.cameraPosition, camera.cameraRotation);
		this.#updateParts(frame, camera.objectRoot);
		this.#drawnObjectRangeCount = 0;
		this.#poses.upload(this.#poseInput, frame.clockSeconds);

		const gl = this.#gl;
		gl.clearColor(0, 0, 0, 0);
		gl.colorMask(true, true, true, true);
		gl.depthMask(true);
		gl.enable(gl.DEPTH_TEST);
		gl.disable(gl.BLEND);
		gl.disable(gl.CULL_FACE);
		gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
		this.#drawObject(projection, view);
		this.#particles.beginFrame(frame.particleRecords);
		this.#particles.draw(
			{
				// Particle records remain in presentation coordinates. Re-anchoring by the
				// fit center applies the same translation as objectRoot without rewriting them.
				anchorOrigin: [
					-camera.objectRoot.m41,
					-camera.objectRoot.m42,
					-camera.objectRoot.m43,
				],
				cameraPosition: [
					camera.cameraPosition.x,
					camera.cameraPosition.y,
					camera.cameraPosition.z,
				],
				clockSeconds: frame.clockSeconds,
				gl,
				projection: mat4ToFloat32Array(projection),
				samplers: this.#samplers,
				state: this.#state,
				textureFiltering:
					SHARED_FRONTEND_TUNING.rendering.frameDefaults.textureFiltering,
				transparentCanvasComposition: true,
				view: mat4ToFloat32Array(view),
			},
			frame.particleRanges,
		);
		this.#frameCount += 1;
	}

	getDiagnostics(): ObjectPreviewRendererDiagnostics {
		let minimumMaterialOpacity = 1;
		let transparentRangeCount = 0;
		for (const range of this.#appearance.plan.ranges) {
			minimumMaterialOpacity = Math.min(
				minimumMaterialOpacity,
				range.batch.material.color[3],
			);
			if (range.source.ordering === "transparent") {
				transparentRangeCount += 1;
			}
		}
		return {
			appearanceRangeCount: this.#appearance.plan.ranges.length,
			drawnObjectRangeCount: this.#drawnObjectRangeCount,
			frameCount: this.#frameCount,
			minimumMaterialOpacity,
			minimumPartOpacity: this.#parts.reduce(
				(minimum, part) => Math.min(minimum, part.frameInstance.color.a),
				1,
			),
			particle: this.#particles.getDiagnostics(),
			transparentRangeCount,
		};
	}

	async destroy(): Promise<void> {
		if (this.#destroyed) return;
		this.#destroyed = true;
		this.#canvas.removeEventListener("webglcontextlost", this.#onContextLost);
		this.#particles.destroy();
		this.#particleMeshes.destroy();
		this.#particleResidency.destroy();
		this.#releaseAppearance();
		this.#appearances.destroy();
		this.#poses.destroy();
		this.#samplers.destroy();
		this.#textures.destroy();
		this.#resources.releaseResource(this.#fallbackResource);
		this.#resources.releaseResource(this.#geometryResource);
		this.#gl.deleteProgram(this.#program.program);
		await this.#resources.destroy();
	}

	#updateParts(frame: ObjectPreviewFrame, objectRoot: Mat4): void {
		for (const [
			selector,
			layoutPart,
		] of this.#assets.template.layout.parts.entries()) {
			const part = this.#parts[selector];
			const source = frame.partToPreview[layoutPart.partIndex];
			const renderState = frame.partRenderStates[layoutPart.partIndex];
			if (!part || !source || !renderState)
				throw new Error(
					`Object preview frame is missing authored part ${layoutPart.partIndex}.`,
				);
			multiplyMat4(objectRoot, source, part.frameInstance.sourceToLandblock);
			part.frameInstance.color.a = Math.max(
				0,
				Math.min(1, 1 - renderState.translucency),
			);
			part.renderState = renderState;
		}
	}

	#drawObject(projection: Mat4, view: Mat4): void {
		const gl = this.#gl;
		const state = this.#state;
		state.invalidate();
		for (const unit of Object.values(OBJECT_TEXTURE_UNITS))
			state.applyTextureUnit(unit, this.#fallback);
		state.applyProgram(this.#program.program);
		state.applyUniform1i(
			this.#program.uniforms.canvasEmissionMode,
			TRANSPARENT_CANVAS_EMISSION_MODE.none,
		);
		gl.uniform4f(this.#program.uniforms.clipTransform, 1, 1, 0, 0);
		gl.uniformMatrix4fv(
			this.#program.uniforms.projection,
			false,
			mat4ToFloat32Array(projection, this.#matrixScratch),
		);
		gl.uniformMatrix4fv(
			this.#program.uniforms.view,
			false,
			mat4ToFloat32Array(view, this.#matrixScratch),
		);
		gl.uniform3f(this.#program.uniforms.landblockOffset, 0, 0, 0);
		gl.uniform1i(this.#program.uniforms.useDetail, 0);
		bindWebGL2SceneLighting(gl, this.#program.uniforms, PREVIEW_LIGHTING);
		bindWebGL2DynamicLights(
			gl,
			this.#program.uniforms,
			NO_LIGHTS,
			{ x: 0, z: 0 },
			this.#dynamicLightScratch,
		);
		bindWebGL2StaticLights(
			gl,
			this.#program.uniforms,
			NO_LIGHTS,
			{ x: 0, z: 0 },
			0,
			this.#dynamicLightScratch,
		);
		const pose = this.#poses.get(PREVIEW_POSE_KEY);
		state.applyTexture2D(OBJECT_TEXTURE_UNITS.poses, pose.texture, null);
		state.applyTexture2D(
			OBJECT_TEXTURE_UNITS.materials,
			this.#appearance.table,
			null,
		);
		state.applyUniform1i(this.#program.uniforms.firstPoseRow, pose.firstRow);
		state.applyVertexArray(this.#geometry.vertexArray);
		gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.#appearance.indexBuffer);

		this.#opaqueRanges.beginFrame();
		for (const span of this.#opaqueRanges.prepare(
			PREVIEW_NODE_ID,
			this.#appearance.plan,
			this.#parts,
			false,
		)) {
			const range = this.#appearance.plan.physicalRanges[span.rangeIndex];
			if (!range) throw new Error("Object preview opaque span lost its range.");
			state.applyBlend(null);
			gl.depthMask(true);
			this.#drawSpan(range, span.indexCount);
		}

		gl.depthMask(false);
		const transparent = this.#appearance.plan.ranges.filter((range) => {
			const part = this.#parts[range.source.partSelector];
			if (!part)
				throw new Error("Object preview range references a missing part.");
			return (
				dynamicObjectPhase(
					range.source.ordering,
					part.frameInstance.color.a,
					range.source.retailVisibility,
					false,
				) === "transparent"
			);
		});
		transparent.sort(
			(left, right) =>
				this.#rangeDepth(right, view) - this.#rangeDepth(left, view),
		);
		for (const range of transparent) {
			state.applyBlend(range.batch.blendPolicy);
			this.#drawSpan(range, range.source.indexCount);
		}

		this.#additiveRanges.beginFrame();
		for (const span of this.#additiveRanges.prepare(
			PREVIEW_NODE_ID,
			this.#appearance.plan,
			this.#parts,
			false,
		)) {
			const range = this.#appearance.plan.physicalRanges[span.rangeIndex];
			if (!range)
				throw new Error("Object preview additive span lost its range.");
			const emissionMode = transparentCanvasEmissionMode(
				range.batch.blendPolicy,
			);
			if (emissionMode === TRANSPARENT_CANVAS_EMISSION_MODE.none)
				throw new Error("Object preview additive range lost its blend policy.");
			state.applyUniform1i(
				this.#program.uniforms.canvasEmissionMode,
				emissionMode,
			);
			state.applyBlend(TRANSPARENT_CANVAS_EMISSION_BLEND);
			this.#drawSpan(range, span.indexCount);
		}
		gl.depthMask(true);
		state.applyBlend(null);
	}

	#rangeDepth(range: PreviewDynamicRange, view: Mat4): number {
		const part = this.#parts[range.source.partSelector];
		if (!part)
			throw new Error(
				`Object preview range references missing part ${range.source.partSelector}.`,
			);
		transformPoint3(
			part.frameInstance.sourceToLandblock,
			range.source.transparentSort.center,
			this.#depthScratch,
		);
		transformPoint3(view, this.#depthScratch, this.#depthScratch);
		return -this.#depthScratch.z;
	}

	#drawSpan(range: PreviewDynamicRange, indexCount: number): void {
		this.#state.applyCullFace(range.batch.cullFace);
		const material = range.batch.material;
		if (material.kind !== "solid-color") {
			this.#state.applyTextureUnit(OBJECT_TEXTURE_UNITS.base, material.base);
			if (material.kind !== "direct-color")
				this.#state.applyTextureUnit(
					OBJECT_TEXTURE_UNITS.palette,
					material.palette,
				);
		}
		this.#gl.drawElements(
			this.#gl.TRIANGLES,
			indexCount,
			this.#gl.UNSIGNED_INT,
			range.indexStart * Uint32Array.BYTES_PER_ELEMENT,
		);
		this.#drawnObjectRangeCount += 1;
	}

	#resize(extent: RenderExtent): void {
		if (
			this.#canvas.width === extent.width &&
			this.#canvas.height === extent.height
		)
			return;
		this.#canvas.width = extent.width;
		this.#canvas.height = extent.height;
		this.#gl.viewport(0, 0, extent.width, extent.height);
	}

	#resolveCamera(
		viewport: ObjectPreviewRenderViewport,
	): ObjectPreviewViewTransform {
		const cached = this.#cameraCache;
		if (
			cached !== null &&
			cached.width === viewport.extent.width &&
			cached.height === viewport.extent.height &&
			cached.yawRadians === viewport.yawRadians
		)
			return cached.transform;
		const transform = resolveObjectPreviewViewTransform(
			this.#assets.fit,
			viewport.yawRadians,
			viewport.extent,
		);
		this.#cameraCache = {
			height: viewport.extent.height,
			transform,
			width: viewport.extent.width,
			yawRadians: viewport.yawRadians,
		};
		return transform;
	}

	#assertUsable(): void {
		if (this.#destroyed)
			throw new Error("Cannot draw with a destroyed object preview renderer.");
		if (this.#contextLost)
			throw new Error(
				"Object preview WebGL2 context was lost; remount is required.",
			);
	}
}
