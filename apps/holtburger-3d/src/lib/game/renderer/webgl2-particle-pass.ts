import type { DatAssetId } from "../game-types";
import type { ParticleDrawRange } from "./particle-render-routing";
import {
	createWebGL2ParticleProgram,
	PARTICLE_TEXTURE_UNITS,
	type WebGL2ParticleProgram,
} from "./webgl2-particle-program";
import type { WebGL2PortalDeferredVisibilityUniforms } from "./portal-deferred-visibility-glsl";
import { WebGL2ParticleRecordStore } from "./webgl2-particle-record-store";
import { PARTICLE_RECORDS_PER_ROW } from "./particle-record-layout";
import { objectBlendPolicy } from "./object-rendering-policy";
import { TextureWrapMode } from "../textures/types";
import type { TextureFilteringPolicy } from "./texture-filtering-policy";
import type { WebGL2TextureSamplerCatalog } from "./webgl2-texture-sampler-catalog";
import type { WebGL2DeviceStateApplicator } from "./webgl2-device-state-applicator";

/** One batch's drawable mesh, already resident on the GPU. */
/** Neutral colour for a textured mesh, which never reads the solid-colour uniform. */
const OPAQUE_WHITE = [1, 1, 1, 1] as const;

export interface ParticleDrawGeometry {
	readonly vertexArray: WebGLVertexArrayObject;
	readonly indexCount: number;
	readonly indexOffsetBytes: number;
	/** Accessible mip levels of the base texture for sampler creation. */
	readonly baseMipLevels: number;
	/** Base texture and its palette, bound to the program's fixed sampler units. */
	readonly baseTexture: WebGLTexture;
	/** Authored colour of an untextured surface, or null when the mesh samples a texture. */
	readonly materialColor: readonly [number, number, number, number] | null;
	readonly paletteTexture: WebGLTexture | null;
	/** How the fragment stage reads the base texture: direct, index8, or index16. */
	readonly materialKind: number;
	readonly palettedClipMap: boolean;
	readonly alphaTest: number;
	/** Authored surface flags, so blend selection reuses retail's mapping rather than guessing. */
	readonly rawSurfaceFlags: number;
	/** Orientation mode from the mesh's authored degrade band. */
	readonly orientation: number;
	readonly lockedAxis: readonly [number, number, number];
	readonly wrap: TextureWrapMode;
}

export interface ParticleDrawContext {
	readonly gl: WebGL2RenderingContext;
	/** Column-major matrices, matching every other pass's uniform contract. */
	readonly projection: Float32Array;
	readonly view: Float32Array;
	readonly cameraPosition: readonly [number, number, number];
	/** Scene origin of this frame's render anchor, which records are re-anchored against. */
	readonly anchorOrigin: readonly [number, number, number];
	readonly clockSeconds: number;
	readonly samplers: WebGL2TextureSamplerCatalog;
	/** Renderer-owned device-state mirror shared with object submission. */
	readonly state: WebGL2DeviceStateApplicator;
	readonly textureFiltering: TextureFilteringPolicy;
	/** Global opacity scale applied to all particles in this context, in [0, 1]. Defaults to 1. */
	readonly opacityScale?: number;
	/** Record mirror owned by the emitter runtime; the pass uploads it, never writes it. */
	readonly records: ParticleRecordFrame;
}

/** The emitter runtime's record storage and what changed in it since the last frame. */
export interface ParticleRecordFrame {
	readonly data: Float32Array;
	readonly dirtySlots: { readonly first: number; readonly last: number } | null;
}

export interface ParticleDrawDiagnostics {
	readonly drawnBatchCount: number;
	/**
	 * Texture rows uploaded this frame.
	 *
	 * Worth surfacing rather than assuming: the dirty span is a single min/max range, so scattered
	 * spawns across many emitters can widen it to cover most of the store. A row count near the
	 * store's height means the span has degenerated and the upload is no longer incremental.
	 */
	readonly uploadedRecordRowCount: number;
	readonly drawnParticleCount: number;
	/** Batches skipped because their mesh is not resident; never a silent zero. */
	readonly unresolvedBatchCount: number;
}

/** Injected scope-atlas routing without coupling the reusable particle pass to its owner. */
export interface ParticlePortalScopeRouting {
	routeDeferredSubmission(
		renderScopeKey: string,
		uniforms: WebGL2PortalDeferredVisibilityUniforms,
	): void;
}

/**
 * Draws every visible particle batch as one instanced call per batch.
 *
 * Retail draws each live particle as its own `CPhysicsPart` through the general per-part path. That
 * pins the *semantics* — surface flags drive blend state, particles are GfxObj meshes — but it is a
 * 2002 draw-call ceiling this deliberately does not inherit. The parity bar is visual output, never
 * draw-call topology.
 *
 * Geometry resolution is injected rather than owned: the pass should not know how meshes become
 * resident, and that keeps it testable without a resource manager.
 */
export class WebGL2ParticlePass {
	readonly #resolveGeometry: (
		hwGfxObjId: DatAssetId,
	) => ParticleDrawGeometry | null;
	#gl: WebGL2RenderingContext | null = null;
	#program: WebGL2ParticleProgram | null = null;
	#portalProgram: WebGL2ParticleProgram | null = null;
	#records: WebGL2ParticleRecordStore | null = null;
	/** Reused flattening scratch keeps all scoped batches in one contiguous frame upload. */
	readonly #scopedBatches: ParticleDrawRange[] = [];
	readonly #scopedRenderScopeKeys: string[] = [];
	#diagnostics: ParticleDrawDiagnostics = {
		drawnBatchCount: 0,
		uploadedRecordRowCount: 0,
		drawnParticleCount: 0,
		unresolvedBatchCount: 0,
	};

	constructor(
		resolveGeometry: (hwGfxObjId: DatAssetId) => ParticleDrawGeometry | null,
	) {
		this.#resolveGeometry = resolveGeometry;
	}

	draw(
		context: ParticleDrawContext,
		batches: readonly ParticleDrawRange[],
	): void {
		this.#draw(context, batches, null, null);
	}

	/** Draw scope-grouped particles with one upload and one scalar scope route per physical draw. */
	drawScoped(
		context: ParticleDrawContext,
		batchesByScope: ReadonlyMap<string, readonly ParticleDrawRange[]>,
		routing: ParticlePortalScopeRouting,
	): void {
		this.#scopedBatches.length = 0;
		this.#scopedRenderScopeKeys.length = 0;
		for (const [renderScopeKey, batches] of batchesByScope) {
			if (renderScopeKey === "sky") continue;
			for (const batch of batches) {
				this.#scopedBatches.push(batch);
				this.#scopedRenderScopeKeys.push(renderScopeKey);
			}
		}
		this.#draw(
			context,
			this.#scopedBatches,
			this.#scopedRenderScopeKeys,
			routing,
		);
	}

	#draw(
		context: ParticleDrawContext,
		batches: readonly ParticleDrawRange[],
		renderScopeKeys: readonly string[] | null,
		routing: ParticlePortalScopeRouting | null,
	): void {
		const { gl } = context;
		let drawnBatchCount = 0;
		let drawnParticleCount = 0;
		let unresolvedBatchCount = 0;
		let preparedInstanceCount = 0;
		for (const batch of batches) preparedInstanceCount += batch.count;
		const opacityScale = context.opacityScale ?? 1.0;
		if (opacityScale <= 0 || preparedInstanceCount === 0) {
			this.#diagnostics = {
				drawnBatchCount: 0,
				drawnParticleCount: 0,
				unresolvedBatchCount: 0,
				uploadedRecordRowCount: 0,
			};
			return;
		}
		if ((renderScopeKeys === null) !== (routing === null)) {
			throw new Error(
				"Particle portal scope keys and routing must be supplied together.",
			);
		}
		if (renderScopeKeys && renderScopeKeys.length !== batches.length) {
			throw new Error(
				`Particle scope routing has ${renderScopeKeys.length} keys for ${batches.length} batches.`,
			);
		}
		if (this.#gl !== null && this.#gl !== gl) {
			throw new Error("Particle pass cannot move between WebGL devices.");
		}
		this.#gl = gl;
		const records = (this.#records ??= new WebGL2ParticleRecordStore(
			gl,
			PARTICLE_RECORDS_PER_ROW,
		));
		records.sync(context.records.data, context.records.dirtySlots);
		const program = routing
			? (this.#portalProgram ??= createWebGL2ParticleProgram(gl, true))
			: (this.#program ??= createWebGL2ParticleProgram(gl));
		const portalVisibilityUniforms = program.portalVisibilityUniforms;
		if (routing && !portalVisibilityUniforms) {
			throw new Error(
				"Portal particle draw selected a program without scope-envelope visibility.",
			);
		}

		// Record synchronization mutates texture state directly. Begin the particle-owned phase only
		// after it completes, then let the renderer's one device-state mirror own every draw bind.
		const state = context.state;
		state.invalidate();
		state.applyProgram(program.program);
		// The record texture is RGBA32F and read with texelFetch, so it requires exact sampling.
		// Own the sampler explicitly: outdoor object passes also use this texture unit and may leave
		// a sampler requiring unsupported float filtering or absent mip levels behind, which makes
		// the particle vertex texture incomplete.
		const recordSampler = context.samplers.getSampler({
			mipLevels: 1,
			policy: context.textureFiltering,
			samplingClass: "exact",
			wrap: TextureWrapMode.Clamp,
		});
		state.applyTexture2D(
			PARTICLE_TEXTURE_UNITS.records,
			records.texture,
			recordSampler,
		);
		gl.uniformMatrix4fv(program.uniforms.projection, false, context.projection);
		gl.uniformMatrix4fv(program.uniforms.view, false, context.view);
		gl.uniform1f(program.uniforms.clockSeconds, context.clockSeconds);
		gl.uniform1f(program.uniforms.opacityScale, opacityScale);
		gl.uniform3f(
			program.uniforms.cameraPosition,
			context.cameraPosition[0],
			context.cameraPosition[1],
			context.cameraPosition[2],
		);
		// One value for the whole frame, so it binds once here rather than per drawn range.
		gl.uniform3f(
			program.uniforms.anchorOrigin,
			context.anchorOrigin[0],
			context.anchorOrigin[1],
			context.anchorOrigin[2],
		);
		// Particles are additive-friendly unlit sprites: depth-tested against the scene but never
		// occluding it, which is what retail's transparent staging produces for them.
		gl.enable(gl.DEPTH_TEST);
		gl.depthMask(false);
		// Blend enablement and policy are selected per batch through the shared device-state owner.
		// Unit 1 always uses exact single-level clamp sampling for palette lookups.
		const paletteSampler = context.samplers.getSampler({
			mipLevels: 1,
			policy: context.textureFiltering,
			samplingClass: "exact",
			wrap: TextureWrapMode.Clamp,
		});

		// Ranges each address their own slots, so this is an accounting total rather than a cursor:
		// every prepared instance must be either drawn or counted unresolved.
		let accountedInstanceCount = 0;
		for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
			const batch = batches[batchIndex];
			if (!batch)
				throw new Error(`Particle batch ${batchIndex} is unavailable.`);
			const instanceCount = batch.count;
			if (instanceCount === 0) continue;
			const geometry = this.#resolveGeometry(batch.hwGfxObjId);
			// A batch whose mesh has not landed is counted, not silently dropped: the emitter is
			// live and the viewer is missing it.
			if (geometry === null) {
				unresolvedBatchCount += 1;
				accountedInstanceCount += instanceCount;
				continue;
			}
			// Retail's own flag-to-blend mapping, shared with the object and sky paths: additive
			// surfaces keep their destination so a particle's black backing adds nothing.
			const blend = objectBlendPolicy(geometry.rawSurfaceFlags);
			state.applyBlend(blend);
			state.applyVertexArray(geometry.vertexArray);
			// One uniform selects this range's records, where binding seven attribute pointers to the
			// same range would cost about twenty GL calls.
			gl.uniform1i(program.uniforms.instanceBase, batch.baseSlot);
			if (routing) {
				if (portalVisibilityUniforms === null) {
					throw new Error(
						"Portal particle program lost its scope-envelope uniforms.",
					);
				}
				const renderScopeKey = renderScopeKeys?.[batchIndex];
				if (renderScopeKey === undefined) {
					throw new Error(`Particle batch ${batchIndex} has no render scope.`);
				}
				routing.routeDeferredSubmission(
					renderScopeKey,
					portalVisibilityUniforms,
				);
			}

			// Motion type and orientation are per-batch constants, never per-instance attributes.
			state.applyUniform1i(program.uniforms.motionType, batch.motionType);
			state.applyUniform1i(
				program.uniforms.usesRangeFrame,
				batch.frame.kind === "range" ? 1 : 0,
			);
			if (batch.frame.kind === "range") {
				state.applyUniform3f(
					program.uniforms.rangeLandblockOrigin,
					batch.frame.landblockOrigin[0],
					batch.frame.landblockOrigin[1],
					batch.frame.landblockOrigin[2],
				);
				state.applyUniform3f(
					program.uniforms.rangeLocalOrigin,
					batch.frame.localOrigin[0],
					batch.frame.localOrigin[1],
					batch.frame.localOrigin[2],
				);
				state.applyUniform4f(
					program.uniforms.rangeRotation,
					batch.frame.rotation.w,
					batch.frame.rotation.x,
					batch.frame.rotation.y,
					batch.frame.rotation.z,
				);
			}
			state.applyUniform1i(program.uniforms.orientation, geometry.orientation);
			state.applyUniform3f(
				program.uniforms.lockedAxis,
				geometry.lockedAxis[0],
				geometry.lockedAxis[1],
				geometry.lockedAxis[2],
			);
			state.applyUniform1i(
				program.uniforms.materialKind,
				geometry.materialKind,
			);
			// Only the solid-colour kind reads this, but it is written unconditionally: a stale
			// colour left by a previous batch would otherwise tint the next untextured draw.
			const color = geometry.materialColor ?? OPAQUE_WHITE;
			state.applyUniform4f(program.uniforms.materialColor, ...color);
			state.applyUniform1i(
				program.uniforms.palettedClipMap,
				geometry.palettedClipMap ? 1 : 0,
			);
			state.applyUniform1f(program.uniforms.alphaTest, geometry.alphaTest);
			const baseSampler = context.samplers.getSampler({
				mipLevels: geometry.baseMipLevels,
				policy: context.textureFiltering,
				samplingClass: "filterable",
				wrap: geometry.wrap,
			});
			state.applyTexture2D(
				PARTICLE_TEXTURE_UNITS.base,
				geometry.baseTexture,
				baseSampler,
			);
			// Unit 1 is bound unconditionally, falling back to the base texture for an unpaletted
			// mesh. WebGL validates every *active* sampler against its bound texture at draw time,
			// even when the shader branches away from it, so leaving unit 1 to whatever a previous
			// pass left there fails the draw with a format/sampler mismatch.
			state.applyTexture2D(
				PARTICLE_TEXTURE_UNITS.palette,
				geometry.paletteTexture ?? geometry.baseTexture,
				paletteSampler,
			);
			gl.drawElementsInstanced(
				gl.TRIANGLES,
				geometry.indexCount,
				gl.UNSIGNED_INT,
				geometry.indexOffsetBytes,
				instanceCount,
			);
			drawnBatchCount += 1;
			drawnParticleCount += instanceCount;
			accountedInstanceCount += instanceCount;
		}
		if (accountedInstanceCount !== preparedInstanceCount) {
			throw new Error(
				`Particle submission accounted for ${accountedInstanceCount} of ${preparedInstanceCount} prepared instances.`,
			);
		}

		gl.bindVertexArray(null);
		gl.depthMask(true);
		state.applyBlend(null);
		// The explicit null VAO bind is outside the applicator contract; forget the phase before any
		// later owner begins so no cached binding can survive it.
		state.invalidate();
		this.#diagnostics = {
			drawnBatchCount,
			uploadedRecordRowCount: records.uploadedRowCount,
			drawnParticleCount,
			unresolvedBatchCount,
		};
	}

	getDiagnostics(): ParticleDrawDiagnostics {
		return this.#diagnostics;
	}

	destroy(): void {
		this.#records?.destroy();
		this.#records = null;
		if (this.#program) this.#gl?.deleteProgram(this.#program.program);
		this.#program = null;
		if (this.#portalProgram) {
			this.#gl?.deleteProgram(this.#portalProgram.program);
		}
		this.#portalProgram = null;
		this.#gl = null;
		this.#scopedBatches.length = 0;
		this.#scopedRenderScopeKeys.length = 0;
	}
}
