import type { ParticleDrawCohort } from "../systems/particle-system";
import type { DatAssetId } from "../game-types";
import {
	createWebGL2ParticleProgram,
	type WebGL2ParticleProgram,
} from "./webgl2-particle-program";
import { WebGL2ParticleInstanceBuffer } from "./webgl2-particle-instance-buffer";
import { objectBlendPolicy } from "./object-rendering-policy";

/** One cohort's drawable mesh, already resident on the GPU. */
export interface ParticleDrawGeometry {
	readonly vertexArray: WebGLVertexArrayObject;
	readonly indexCount: number;
	readonly indexOffsetBytes: number;
	/** Base texture and its palette, bound to the program's fixed sampler units. */
	readonly baseTexture: WebGLTexture;
	readonly paletteTexture: WebGLTexture | null;
	/** How the fragment stage reads the base texture: direct, index8, or index16. */
	readonly materialKind: number;
	readonly alphaTest: number;
	/** Authored surface flags, so blend selection reuses retail's mapping rather than guessing. */
	readonly rawSurfaceFlags: number;
	/** Orientation mode from the mesh's authored degrade band. */
	readonly orientation: number;
	readonly lockedAxis: readonly [number, number, number];
}

export interface ParticleDrawContext {
	readonly gl: WebGL2RenderingContext;
	/** Column-major matrices, matching every other pass's uniform contract. */
	readonly projection: Float32Array;
	readonly view: Float32Array;
	readonly cameraPosition: readonly [number, number, number];
	readonly clockSeconds: number;
}

export interface ParticleDrawDiagnostics {
	readonly drawnCohortCount: number;
	readonly drawnParticleCount: number;
	/** Cohorts skipped because their mesh is not resident; never a silent zero. */
	readonly unresolvedCohortCount: number;
}

/**
 * Draws every visible particle cohort as one instanced call per cohort.
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
	#program: WebGL2ParticleProgram | null = null;
	#instances: WebGL2ParticleInstanceBuffer | null = null;
	#diagnostics: ParticleDrawDiagnostics = {
		drawnCohortCount: 0,
		drawnParticleCount: 0,
		unresolvedCohortCount: 0,
	};

	constructor(
		resolveGeometry: (hwGfxObjId: DatAssetId) => ParticleDrawGeometry | null,
	) {
		this.#resolveGeometry = resolveGeometry;
	}

	draw(
		context: ParticleDrawContext,
		cohorts: readonly ParticleDrawCohort[],
	): void {
		const { gl } = context;
		let drawnCohortCount = 0;
		let drawnParticleCount = 0;
		let unresolvedCohortCount = 0;
		const drawable = cohorts.filter((cohort) => cohort.particles.length > 0);
		if (drawable.length === 0) {
			this.#diagnostics = {
				drawnCohortCount: 0,
				drawnParticleCount: 0,
				unresolvedCohortCount: 0,
			};
			return;
		}
		const program = (this.#program ??= createWebGL2ParticleProgram(gl));
		const instances = (this.#instances ??= new WebGL2ParticleInstanceBuffer(gl));

		gl.useProgram(program.program);
		gl.uniformMatrix4fv(program.uniforms.projection, false, context.projection);
		gl.uniformMatrix4fv(program.uniforms.view, false, context.view);
		gl.uniform1f(program.uniforms.clockSeconds, context.clockSeconds);
		gl.uniform3f(
			program.uniforms.cameraPosition,
			context.cameraPosition[0],
			context.cameraPosition[1],
			context.cameraPosition[2],
		);
		// Particles are additive-friendly unlit sprites: depth-tested against the scene but never
		// occluding it, which is what retail's transparent staging produces for them.
		gl.enable(gl.DEPTH_TEST);
		gl.depthMask(false);
		gl.enable(gl.BLEND);
		// Blend mode is selected per cohort below. Enabling BLEND without a func inherits whatever
		// the previous pass left bound, which renders particles opaque over their own backing.

		for (const cohort of drawable) {
			const geometry = this.#resolveGeometry(cohort.hwGfxObjId);
			// A cohort whose mesh has not landed is counted, not silently dropped: the emitter is
			// live and the viewer is missing it.
			if (geometry === null) {
				unresolvedCohortCount += 1;
				continue;
			}
			// Retail's own flag-to-blend mapping, shared with the object and sky paths: additive
			// surfaces keep their destination so a particle's black backing adds nothing.
			const blend = objectBlendPolicy(geometry.rawSurfaceFlags);
			gl.blendFunc(
				blend.source === "one"
					? gl.ONE
					: blend.source === "one-minus-src-alpha"
						? gl.ONE_MINUS_SRC_ALPHA
						: gl.SRC_ALPHA,
				blend.destination === "one"
					? gl.ONE
					: blend.destination === "src-alpha"
						? gl.SRC_ALPHA
						: gl.ONE_MINUS_SRC_ALPHA,
			);
			gl.bindVertexArray(geometry.vertexArray);
			instances.bindAttributes();
			const instanceCount = instances.upload(cohort.particles);
			if (instanceCount === 0) continue;

			// Motion type and orientation are per-cohort constants, never per-instance attributes.
			gl.uniform1i(program.uniforms.motionType, cohort.motionType);
			gl.uniform1i(program.uniforms.orientation, geometry.orientation);
			gl.uniform3f(
				program.uniforms.lockedAxis,
				geometry.lockedAxis[0],
				geometry.lockedAxis[1],
				geometry.lockedAxis[2],
			);
			gl.uniform1i(program.uniforms.materialKind, geometry.materialKind);
			gl.uniform1f(program.uniforms.alphaTest, geometry.alphaTest);
			gl.activeTexture(gl.TEXTURE0);
			gl.bindTexture(gl.TEXTURE_2D, geometry.baseTexture);
			// Unit 1 is bound unconditionally, falling back to the base texture for an unpaletted
			// mesh. WebGL validates every *active* sampler against its bound texture at draw time,
			// even when the shader branches away from it, so leaving unit 1 to whatever a previous
			// pass left there fails the draw with a format/sampler mismatch.
			gl.activeTexture(gl.TEXTURE1);
			gl.bindTexture(
				gl.TEXTURE_2D,
				geometry.paletteTexture ?? geometry.baseTexture,
			);
			gl.drawElementsInstanced(
				gl.TRIANGLES,
				geometry.indexCount,
				gl.UNSIGNED_INT,
				geometry.indexOffsetBytes,
				instanceCount,
			);
			drawnCohortCount += 1;
			drawnParticleCount += instanceCount;
		}

		gl.bindVertexArray(null);
		gl.depthMask(true);
		gl.disable(gl.BLEND);
		this.#diagnostics = {
			drawnCohortCount,
			drawnParticleCount,
			unresolvedCohortCount,
		};
	}

	getDiagnostics(): ParticleDrawDiagnostics {
		return this.#diagnostics;
	}

	destroy(): void {
		this.#instances?.destroy();
		this.#instances = null;
		this.#program = null;
	}
}
