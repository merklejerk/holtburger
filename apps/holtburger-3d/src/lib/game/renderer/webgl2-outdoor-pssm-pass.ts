import { createLandblockOffset, getLandblockCoordinates } from "../landblocks";
import { mat4ToFloat32Array } from "../math/matrices";
import type { Quat, Vec3 } from "../math/types";
import type { FrameInstanceStreamArena } from "./frame-instance-stream-arena";
import type { LandblockOwnerId } from "../game-types";
import type { OutdoorPssmSettings } from "./entity-shadow-policy";
import {
	buildOutdoorPssmCascades,
	type OutdoorPssmCascade,
} from "./outdoor-pssm";
import {
	collectOutdoorPssmCasters,
	createOutdoorPssmCasterBatch,
	type OutdoorPssmCasterWorld,
} from "./outdoor-pssm-casters";
import type { SceneNodeId } from "../scene";
import { OBJECT_INSTANCE_RECORD_BYTES } from "../systems/static-resources";
import { bindWebGL2ObjectInstanceRange } from "./webgl2-instance-buffer";
import {
	createWebGL2PssmCasterProgram,
	type WebGL2PssmCasterProgram,
} from "./webgl2-pssm-caster-program";
import {
	WebGL2PssmShadowTargets,
	type WebGL2PssmShadowTargetDiagnostics,
	type WebGL2PssmShadowTargetSet,
} from "./webgl2-pssm-shadow-targets";
import type {
	WebGL2GeometryBinding,
	WebGL2ResourceManager,
} from "./webgl2-resource-manager";

/** Per-view outdoor map state consumed immediately by eligible receiver programs. */
export interface ActiveOutdoorPssmFrame {
	readonly cascades: readonly OutdoorPssmCascade[];
	/** Shared instance-arena uploads performed while building this view's cascades. */
	readonly instanceUploads: {
		readonly bytes: number;
		readonly count: number;
	};
	readonly settings: OutdoorPssmSettings;
	readonly targets: WebGL2PssmShadowTargetSet;
}

/** Complete camera and schedule facts for one sequential outdoor shadow-map build. */
export interface WebGL2OutdoorPssmPassInput {
	readonly anchorCoordinates: { readonly x: number; readonly y: number };
	readonly anchorLandblockId: LandblockOwnerId;
	readonly aspectRatio: number;
	readonly camera: {
		readonly far: number;
		readonly near: number;
		readonly position: Vec3;
		readonly rotation: Quat;
		readonly verticalFovDegrees: number;
	};
	readonly frameHeight: number;
	readonly frameWidth: number;
	readonly selectedDynamicNodeIds: Set<SceneNodeId>;
	readonly settings: OutdoorPssmSettings;
	readonly sunVector: Vec3;
}

type OutdoorPssmGeometryResources = Pick<WebGL2ResourceManager, "getGeometry">;
type OutdoorPssmInstanceArena = Pick<
	FrameInstanceStreamArena,
	"getRange" | "prepareView"
>;
type OutdoorPssmTargetOwner = Pick<
	WebGL2PssmShadowTargets,
	"attachLayer" | "destroy" | "disable" | "getDiagnostics" | "resize"
>;

/** Cold construction overrides used by deterministic pass fixtures. */
export interface WebGL2OutdoorPssmPassDependencies {
	readonly createProgram?: (
		gl: WebGL2RenderingContext,
	) => WebGL2PssmCasterProgram;
	readonly targets?: OutdoorPssmTargetOwner;
}

/**
 * Owns the material-free outdoor actor depth schedule and all of its renderer-lifetime resources.
 *
 * Construction allocates no shadow target or shader program. Disabled and zero-sun sessions
 * therefore preserve the pre-shadow GPU path exactly.
 */
export class WebGL2OutdoorPssmPass {
	readonly #batch = createOutdoorPssmCasterBatch();
	readonly #cascades: OutdoorPssmCascade[] = [];
	readonly #frameInstances: OutdoorPssmInstanceArena;
	readonly #gl: WebGL2RenderingContext;
	readonly #matrixScratch = new Float32Array(16);
	readonly #createProgram: (
		gl: WebGL2RenderingContext,
	) => WebGL2PssmCasterProgram;
	#program: WebGL2PssmCasterProgram | null = null;
	#destroyed = false;
	readonly #resources: OutdoorPssmGeometryResources;
	readonly #targets: OutdoorPssmTargetOwner;
	readonly #world: OutdoorPssmCasterWorld;

	constructor(
		gl: WebGL2RenderingContext,
		resources: OutdoorPssmGeometryResources,
		world: OutdoorPssmCasterWorld,
		frameInstances: OutdoorPssmInstanceArena,
		dependencies: WebGL2OutdoorPssmPassDependencies = {},
	) {
		this.#gl = gl;
		this.#resources = resources;
		this.#world = world;
		this.#frameInstances = frameInstances;
		this.#createProgram =
			dependencies.createProgram ?? createWebGL2PssmCasterProgram;
		this.#targets = dependencies.targets ?? new WebGL2PssmShadowTargets(gl);
	}

	/** Build and submit every cascade, returning the state receivers may sample for this view. */
	render(input: WebGL2OutdoorPssmPassInput): ActiveOutdoorPssmFrame | null {
		if (!hasOutdoorPssmLightAndInterval(input)) return null;
		buildOutdoorPssmCascades(
			{
				camera: {
					aspectRatio: input.aspectRatio,
					far: input.camera.far,
					near: input.camera.near,
					position: input.camera.position,
					rotation: input.camera.rotation,
					verticalFovDegrees: input.camera.verticalFovDegrees,
				},
				settings: input.settings,
				sunVector: input.sunVector,
			},
			this.#cascades,
		);
		const targets = this.#targets.resize(
			input.settings.mapResolution,
			input.settings.cascadeCount,
		);
		let instanceUploadCount = 0;
		let instanceUploadBytes = 0;
		try {
			for (const cascade of this.#cascades) {
				this.#beginCascade(cascade.index, targets.resolution, input.settings);
				collectOutdoorPssmCasters(
					this.#world,
					cascade.lightFrustum,
					input.anchorLandblockId,
					input.selectedDynamicNodeIds,
					this.#batch,
				);
				if (this.#drawCascade(cascade, input.anchorCoordinates)) {
					instanceUploadCount += 1;
					instanceUploadBytes +=
						this.#batch.instances.length * OBJECT_INSTANCE_RECORD_BYTES;
				}
			}
		} finally {
			this.#restoreFrameState(input.frameWidth, input.frameHeight);
		}
		return {
			cascades: this.#cascades,
			instanceUploads: {
				bytes: instanceUploadBytes,
				count: instanceUploadCount,
			},
			settings: input.settings,
			targets,
		};
	}

	/** Release active target storage when the composite master setting turns off. */
	disable(): void {
		this.#targets.disable();
	}

	getDiagnostics(): WebGL2PssmShadowTargetDiagnostics {
		return this.#targets.getDiagnostics();
	}

	destroy(): void {
		if (this.#destroyed) return;
		this.#destroyed = true;
		this.#targets.destroy();
		if (this.#program) this.#gl.deleteProgram(this.#program.program);
		this.#program = null;
	}

	#beginCascade(
		cascadeIndex: number,
		resolution: number,
		settings: OutdoorPssmSettings,
	): void {
		const gl = this.#gl;
		this.#targets.attachLayer(cascadeIndex);
		gl.viewport(0, 0, resolution, resolution);
		gl.colorMask(false, false, false, false);
		gl.depthMask(true);
		gl.enable(gl.DEPTH_TEST);
		gl.depthFunc(gl.LEQUAL);
		gl.disable(gl.BLEND);
		gl.disable(gl.SCISSOR_TEST);
		gl.disable(gl.STENCIL_TEST);
		gl.enable(gl.POLYGON_OFFSET_FILL);
		gl.polygonOffset(
			settings.casterPolygonOffsetFactor,
			settings.casterPolygonOffsetUnits,
		);
		gl.clearDepth(1);
		gl.clear(gl.DEPTH_BUFFER_BIT);
	}

	#drawCascade(
		cascade: OutdoorPssmCascade,
		anchorCoordinates: WebGL2OutdoorPssmPassInput["anchorCoordinates"],
	): boolean {
		if (this.#batch.instances.length === 0) return false;
		const gl = this.#gl;
		const program = (this.#program ??= this.#createProgram(gl));
		gl.useProgram(program.program);
		gl.uniformMatrix4fv(
			program.uniforms.lightClip,
			false,
			mat4ToFloat32Array(cascade.lightClip, this.#matrixScratch),
		);
		this.#frameInstances.prepareView(this.#batch.instances);
		for (const run of this.#batch.runs) {
			const geometry = this.#resources.getGeometry(run.geometry);
			validateCasterDrawRange(geometry, run.indexStart, run.indexCount);
			const landblockOffset = createLandblockOffset(
				getLandblockCoordinates(run.landblockId),
				anchorCoordinates,
			);
			gl.uniform3f(
				program.uniforms.landblockOffset,
				landblockOffset.x,
				landblockOffset.y,
				landblockOffset.z,
			);
			gl.enable(gl.CULL_FACE);
			gl.cullFace(run.cullFace === "front" ? gl.FRONT : gl.BACK);
			gl.bindVertexArray(geometry.vertexArray);
			const range = this.#frameInstances.getRange(
				run.firstInstance,
				run.instanceCount,
			);
			bindWebGL2ObjectInstanceRange(
				gl,
				range.binding,
				range.firstInstance,
				range.instanceCount,
			);
			gl.drawElementsInstanced(
				gl.TRIANGLES,
				run.indexCount,
				geometry.indexType,
				run.indexStart * geometry.indexElementBytes,
				run.instanceCount,
			);
		}
		return true;
	}

	#restoreFrameState(frameWidth: number, frameHeight: number): void {
		const gl = this.#gl;
		gl.bindVertexArray(null);
		gl.bindBuffer(gl.ARRAY_BUFFER, null);
		gl.bindFramebuffer(gl.FRAMEBUFFER, null);
		gl.viewport(0, 0, frameWidth, frameHeight);
		gl.colorMask(true, true, true, true);
		gl.disable(gl.POLYGON_OFFSET_FILL);
		gl.disable(gl.CULL_FACE);
	}
}

/** Resolve the two non-configurable no-work cases before any GPU allocation or scene query. */
export function hasOutdoorPssmLightAndInterval(
	input: Pick<WebGL2OutdoorPssmPassInput, "camera" | "settings" | "sunVector">,
): boolean {
	return (
		Math.hypot(input.sunVector.x, input.sunVector.y, input.sunVector.z) >
			Number.EPSILON &&
		Math.min(input.camera.far, input.settings.maximumDistance) >
			input.camera.near
	);
}

function validateCasterDrawRange(
	binding: WebGL2GeometryBinding,
	indexStart: number,
	indexCount: number,
): void {
	if (
		!Number.isInteger(indexStart) ||
		!Number.isInteger(indexCount) ||
		indexStart < 0 ||
		indexCount <= 0 ||
		indexStart + indexCount > binding.indexCount
	) {
		throw new Error(
			`Invalid outdoor caster draw range ${indexStart}+${indexCount}/${binding.indexCount}.`,
		);
	}
}
