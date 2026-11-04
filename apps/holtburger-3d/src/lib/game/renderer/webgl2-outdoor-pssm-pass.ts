import { createLandblockOffset, getLandblockCoordinates } from "../landblocks";
import { mat4ToFloat32Array } from "../math/matrices";
import type { Quat, Vec3 } from "../math/types";
import type { ObjectGeometryKey } from "../geometry/types";
import type { WebGL2DynamicPosePages } from "./webgl2-dynamic-pose-pages";
import type { LandblockOwnerId } from "../game-types";
import type {
	OutdoorPssmSettings,
	OutdoorShadowCasterBudget,
	OutdoorShadowProjectionSettings,
} from "./entity-shadow-policy";
import {
	buildOutdoorPssmCascades,
	hasOutdoorShadowLight,
	resolveOutdoorShadowProjection,
	type OutdoorPssmCascade,
} from "./outdoor-pssm";
import {
	planOutdoorShadowCastersForView,
	createOutdoorPssmCasterBatch,
	createOutdoorPssmCasterSelectionScratch,
	type OutdoorPssmCasterBatch,
	type OutdoorPssmCasterWorld,
} from "./outdoor-pssm-casters";
import type { EntityShadowCasterShape } from "./entity-grounding";
import type { Frustum } from "../math/frustum";
import type { SceneNodeId } from "../scene";
import {
	createWebGL2PssmCasterProgram,
	type WebGL2PssmCasterProgram,
} from "./webgl2-pssm-caster-program";
import {
	WebGL2PssmShadowTargets,
	type WebGL2PssmShadowTargetDiagnostics,
	type WebGL2PssmShadowTargetSet,
} from "./webgl2-pssm-shadow-targets";
import type { RendererOutdoorShadowMapFrameMetrics } from "./renderer";
import type { WebGL2GeometryBinding } from "./webgl2-resource-manager";

/** Caller-owned profiling sink; omitted entirely when renderer profiling is disabled. */
export type WebGL2OutdoorPssmPassProfileMetrics = {
	-readonly [Key in keyof RendererOutdoorShadowMapFrameMetrics]: number;
};

/** Per-view outdoor map state consumed immediately by eligible receiver programs. */
export interface ActiveOutdoorPssmFrame {
	readonly cascades: readonly OutdoorPssmCascade[];
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
	readonly cameraFrustum: Frustum;
	readonly casterBudget: OutdoorShadowCasterBudget;
	readonly frameHeight: number;
	readonly frameWidth: number;
	readonly selectedDynamicNodeIds: Set<SceneNodeId>;
	/** Whether degradation-hidden dynamic parts may cast into this frame's maps. */
	readonly showRetailHiddenGeometry: boolean;
	readonly settings: OutdoorPssmSettings;
	readonly projectionSettings: OutdoorShadowProjectionSettings;
	readonly sunVector: Vec3;
}

/** Lookup-only access to staged geometry and the renderer's completed pose upload. */
interface OutdoorPssmGeometryResources {
	/** Resolve the shared merged vertex allocation. */
	getGeometry(key: ObjectGeometryKey): WebGL2GeometryBinding;
	/** Every draw must have been admitted to the frame's pose upload population. */
	getPose: WebGL2DynamicPosePages<SceneNodeId>["get"];
}
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

/** Independent retained selection storage for one view; subsequent views cannot overwrite it. */
interface PssmViewStorage {
	/** Analytic tier from the same whole-root selection as the mapped batches. */
	readonly analyticCasters: EntityShadowCasterShape[];
	/** Active batch prefix paired with this view's cascades. */
	readonly batches: OutdoorPssmCasterBatch[];
	/** High-water reusable cascade batch storage. */
	readonly batchPool: OutdoorPssmCasterBatch[];
	/** Cascade frusta passed together to the complete-root selection. */
	readonly cascadeFrusta: Frustum[];
	/** View-owned mutable caster records; sharing these would overwrite earlier plans. */
	readonly casterSelectionScratch: ReturnType<
		typeof createOutdoorPssmCasterSelectionScratch
	>;
	/** Current light matrices and split intervals, retained for receiver execution. */
	readonly cascades: OutdoorPssmCascade[];
}

function createViewStorage(): PssmViewStorage {
	return {
		analyticCasters: [],
		batches: [],
		batchPool: [],
		cascadeFrusta: [],
		casterSelectionScratch: createOutdoorPssmCasterSelectionScratch(),
		cascades: [],
	};
}

/** CPU-only selection for a view, valid until the next explicit frame reset. */
interface PreparedOutdoorPssmView {
	/** Original camera, anchor, target settings, and destination size used during execution. */
	readonly input: WebGL2OutdoorPssmPassInput;
	/** Per-view matrices, selected ranges, and analytic fallback tier. */
	readonly storage: PssmViewStorage;
	/** Shared mapped/analytic projection decision computed once during preparation. */
	readonly projection: ReturnType<typeof resolveOutdoorShadowProjection>;
}

/**
 * Owns the material-free outdoor actor depth schedule and all of its renderer-lifetime resources.
 *
 * Construction allocates no shadow target or shader program. Disabled and zero-sun sessions
 * therefore preserve the pre-shadow GPU path exactly.
 */
export class WebGL2OutdoorPssmPass {
	/** Storage is reused by view ordinal each frame, independently from sequential target reuse. */
	readonly #viewPool: PssmViewStorage[] = [];
	/** Next unused view slot in the current frame. */
	#nextView = 0;
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
		dependencies: WebGL2OutdoorPssmPassDependencies = {},
	) {
		this.#gl = gl;
		this.#resources = resources;
		this.#world = world;
		this.#createProgram =
			dependencies.createProgram ?? createWebGL2PssmCasterProgram;
		this.#targets = dependencies.targets ?? new WebGL2PssmShadowTargets(gl);
	}

	/** Release prior frame's scene references before preparing any of the next frame's views. */
	beginFrame(): void {
		this.#nextView = 0;
		this.#releaseCasterStorage();
	}

	/** Select casters and build cascades without issuing GPU commands or instance uploads. */
	prepare(
		input: WebGL2OutdoorPssmPassInput,
		profileMetrics: WebGL2OutdoorPssmPassProfileMetrics | null,
	): PreparedOutdoorPssmView | null {
		if (!hasOutdoorPssmLightAndInterval(input)) {
			return null;
		}
		let storage = this.#viewPool[this.#nextView];
		if (storage === undefined) {
			storage = createViewStorage();
			this.#viewPool.push(storage);
		}
		this.#nextView += 1;
		const projection = resolveOutdoorShadowProjection(
			input.sunVector,
			input.projectionSettings,
		);
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
				projection,
				settings: input.settings,
			},
			storage.cascades,
		);
		this.#prepareCascadeStorage(storage);
		planOutdoorShadowCastersForView(
			this.#world,
			storage.cascadeFrusta,
			input.cameraFrustum,
			input.anchorLandblockId,
			input.casterBudget,
			input.selectedDynamicNodeIds,
			storage.analyticCasters,
			input.showRetailHiddenGeometry,
			storage.batches,
			storage.casterSelectionScratch,
			profileMetrics,
		);
		return { input, storage, projection };
	}

	/** Execute an already-selected view; this method performs no scene selection. */
	render(
		prepared: PreparedOutdoorPssmView | null,
		profileMetrics: WebGL2OutdoorPssmPassProfileMetrics | null,
	): ActiveOutdoorPssmFrame | null {
		if (prepared === null) return null;
		const { input, storage } = prepared;
		if (storage.batches.every((batch) => batch.casters.length === 0)) {
			if (profileMetrics) profileMetrics.emptyMappedViewCount += 1;
			return null;
		}
		const targets = this.#targets.resize(
			input.settings.mapResolution,
			input.settings.cascadeCount,
		);
		try {
			for (
				let cascadeIndex = 0;
				cascadeIndex < storage.cascades.length;
				cascadeIndex += 1
			) {
				const cascade = storage.cascades[cascadeIndex];
				const batch = storage.batches[cascadeIndex];
				if (cascade === undefined || batch === undefined) {
					throw new Error(
						`Outdoor PSSM cascade ${cascadeIndex} is incomplete.`,
					);
				}
				this.#beginCascade(cascade.index, targets.resolution, input.settings);
				this.#drawCascade(cascade, batch, input.anchorCoordinates);
			}
		} finally {
			this.#restoreFrameState(input.frameWidth, input.frameHeight);
		}
		return {
			cascades: storage.cascades,
			settings: input.settings,
			targets,
		};
	}

	/** Release active target storage when the composite master setting turns off. */
	disable(): void {
		this.#targets.disable();
		this.#releaseCasterStorage();
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
		this.#releaseCasterStorage();
	}

	/** Drop scene-owned payload references while retaining only cheap reusable container capacity. */
	#releaseCasterStorage(): void {
		for (const storage of this.#viewPool) {
			storage.analyticCasters.length = 0;
			for (const batch of storage.batchPool) {
				batch.casters.length = 0;
			}
			storage.casterSelectionScratch.rootCascadeMasks.clear();
		}
	}

	/** Retain one reusable batch per high-water cascade and publish current frusta by reference. */
	#prepareCascadeStorage(storage: PssmViewStorage): void {
		while (storage.batchPool.length < storage.cascades.length) {
			storage.batchPool.push(createOutdoorPssmCasterBatch());
		}
		storage.batches.length = storage.cascades.length;
		storage.cascadeFrusta.length = storage.cascades.length;
		for (let index = 0; index < storage.cascades.length; index += 1) {
			const cascade = storage.cascades[index];
			const batch = storage.batchPool[index];
			if (cascade === undefined || batch === undefined) {
				throw new Error(`Outdoor PSSM cascade ${index} is missing.`);
			}
			storage.batches[index] = batch;
			storage.cascadeFrusta[index] = cascade.lightFrustum;
		}
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
		batch: OutdoorPssmCasterBatch,
		anchorCoordinates: WebGL2OutdoorPssmPassInput["anchorCoordinates"],
	): void {
		if (batch.casters.length === 0) return;
		const gl = this.#gl;
		const program = (this.#program ??= this.#createProgram(gl));
		gl.useProgram(program.program);
		gl.uniformMatrix4fv(
			program.uniforms.lightClip,
			false,
			mat4ToFloat32Array(cascade.lightClip, this.#matrixScratch),
		);
		gl.activeTexture(gl.TEXTURE0);
		gl.bindSampler(0, null);
		gl.uniform1i(program.uniforms.poses, 0);
		for (const caster of batch.casters) {
			const geometry = this.#resources.getGeometry(caster.geometry);
			const pose = this.#resources.getPose(caster.nodeId);
			gl.bindTexture(gl.TEXTURE_2D, pose.texture);
			gl.uniform1i(program.uniforms.firstPoseRow, pose.firstRow);
			const offset = createLandblockOffset(
				getLandblockCoordinates(caster.landblockId),
				anchorCoordinates,
			);
			gl.uniform3f(
				program.uniforms.landblockOffset,
				offset.x,
				offset.y,
				offset.z,
			);
			gl.bindVertexArray(geometry.vertexArray);
			gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, caster.appearance.indexBuffer);
			gl.enable(gl.CULL_FACE);
			for (const range of caster.ranges) {
				gl.cullFace(range.cullFace === "front" ? gl.FRONT : gl.BACK);
				gl.drawElements(
					gl.TRIANGLES,
					range.indexCount,
					gl.UNSIGNED_INT,
					range.indexStart * Uint32Array.BYTES_PER_ELEMENT,
				);
			}
		}
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
		hasOutdoorShadowLight(input.sunVector) &&
		Math.min(input.camera.far, input.settings.maximumDistance) >
			input.camera.near
	);
}
