import { createLandblockOffset, getLandblockCoordinates } from "../landblocks";
import { mat4ToFloat32Array, transformPoint3 } from "../math/matrices";
import { Mat4 } from "../math/types";
import type { SceneTopologyView, SceneVisibilityIslandId } from "../scene";
import { TextureWrapMode } from "../textures/types";
import { SHARED_FRONTEND_TUNING } from "../../frontend-tuning";
import type { SceneVec3 } from "../../assets/ac-frame";
import {
	MAX_STATIC_LIGHTS,
	fitLightsToBudget,
} from "../environment/runtime-lights";
import { TERRAIN_LIGHT_MASK_ALL } from "../environment/terrain-light-mask";
import type { LandblockLights } from "../environment/outdoor-light-index";
import type { LandblockOwnerId } from "../game-types";
import { objectLightingRole } from "../environment/scene-lighting";
import { bindWebGL2DistanceFog } from "./webgl2-fog";
import {
	bindWebGL2DynamicLights,
	bindWebGL2SceneLighting,
	bindWebGL2StaticLights,
	createDynamicLightScratch,
} from "./webgl2-lighting";
import {
	areStaticObjectDrawsCompatible,
	createObjectSubmissionPhasesFromBuckets,
	formAdjacentObjectInstanceRuns,
	formGroupedObjectInstanceRuns,
	type ObjectFrameSubmission,
	type ObjectSubmissionPhases,
	type PreparedObjectTextureBinding,
	type TransparentObjectSortFacts,
} from "./object-rendering-policy";
import {
	OBJECT_INSTANCE_RECORD_BYTES,
	type ObjectInstanceData,
} from "../systems/static-resources";
import { FrameInstanceStreamArena } from "./frame-instance-stream-arena";
import {
	WebGL2OutdoorPssmPass,
	type ActiveOutdoorPssmFrame,
} from "./webgl2-outdoor-pssm-pass";
import {
	hasOutdoorShadowLight,
	resolveOutdoorShadowProjection,
} from "./outdoor-pssm";
import {
	bindWebGL2OutdoorPssmUniforms,
	createWebGL2OutdoorPssmUniformScratch,
	OUTDOOR_PSSM_TEXTURE_UNIT,
} from "./webgl2-pssm-receiver";
import { WebGL2OutdoorPssmReceiverPrograms } from "./webgl2-pssm-receiver-programs";
import { WebGL2EntityGroundingPrograms } from "./webgl2-entity-grounding-programs";
import {
	applyWebGL2EntityGroundingUniforms,
	entityGroundingUniformAttemptCount,
} from "./webgl2-entity-grounding";
import {
	createEntityGroundingSelectionScratch,
	createOutdoorDirectionalShadowSelectionScratch,
	indexIndoorVisibilityIslands,
	type EntityGroundingCaster,
	type IndoorGroundingCell,
	type OutdoorDirectionalShadowCaster,
} from "./entity-grounding";
import type { EntityShadowSettings } from "./entity-shadow-policy";
import {
	createWebGL2ObjectProgram,
	OBJECT_TEXTURE_UNITS,
	type WebGL2DynamicObjectProgram,
	type WebGL2FogDynamicObjectProgram,
	type WebGL2FogInstancedObjectProgram,
	type WebGL2FogObjectProgram,
	type WebGL2FogStaticTableObjectProgram,
	type WebGL2InstancedObjectProgram,
	type WebGL2ObjectProgram,
	type WebGL2StaticTableObjectProgram,
} from "./webgl2-object-program";
import { bindWebGL2ObjectInstanceRange } from "./webgl2-instance-buffer";
import type { WebGL2PortalScopeAtlasPipeline } from "./webgl2-portal-scope-atlas-pipeline";
import type { FrameInput } from "./renderer";
import type { RenderWorld } from "./render-world";
import type { WebGL2DeviceAndTargetPool } from "./webgl2-device-targets";
import type { RendererFrameDiagnosticsAndProfiler } from "./webgl2-frame-diagnostics";
import type { SceneContributionCompilerAndSelector } from "./webgl2-scene-compiler";
import {
	EMPTY_LANDBLOCK_LIGHTS,
	EMPTY_LIGHTS,
	type AnyObjectProgram,
	type FrameInstancePhasePolicy,
	type LitObjectProgram,
	type ObjectColorSubmission,
	type PreparedDynamicBlended,
	type PreparedDynamicColor,
	type PreparedObjectFrameInput,
	type PreparedOutdoorShadowView,
	type PreparedSceneContributions,
	type PreparedView,
	type PreparedViewGeometry,
	type SceneShading,
} from "./webgl2-renderer-types";

export class ObjectAndShadowPassExecutor {
	static readonly identityMatrix = Mat4.identity();

	readonly #deviceTargets: WebGL2DeviceAndTargetPool;
	readonly #diagnostics: RendererFrameDiagnosticsAndProfiler;
	readonly #sceneCompiler: SceneContributionCompilerAndSelector;

	readonly #objectProgram: WebGL2FogObjectProgram;
	readonly #instancedObjectProgram: WebGL2FogInstancedObjectProgram;
	/** Transparent and additive materials deliberately use a shader with no fog uniforms. */
	readonly #blendedObjectProgram: WebGL2ObjectProgram;
	readonly #blendedInstancedObjectProgram: WebGL2InstancedObjectProgram;
	/** Lazy scope-envelope variants; flat and legacy portal frames never compile them. */
	#portalBlendedObjectProgram: WebGL2ObjectProgram | null = null;
	#portalBlendedInstancedObjectProgram: WebGL2InstancedObjectProgram | null =
		null;
	/** Cold static-table shader variants keyed by fog, deferred portal visibility and PSSM. */
	readonly #staticTablePrograms = new Map<
		number,
		WebGL2StaticTableObjectProgram | WebGL2FogStaticTableObjectProgram
	>();
	/** Allocated only when a merged color root is first prepared. */
	#dynamicOpaqueProgram:
		WebGL2DynamicObjectProgram | WebGL2FogDynamicObjectProgram | null = null;
	/** One unfogged depth-tested program shared by every admitted ordered entity range. */
	#dynamicBlendedProgram:
		WebGL2DynamicObjectProgram | WebGL2FogDynamicObjectProgram | null = null;
	/** Complete float-compatible fallback for every statically active object sampler. */
	readonly objectFallbackBinding: PreparedObjectTextureBinding<
		WebGLTexture,
		WebGLSampler
	>;
	readonly #frameInstances: FrameInstanceStreamArena;
	/** Geometry VAOs whose instance pointers and invariant enable/divisor state were bound together. */
	readonly #configuredObjectInstanceVertexArrays =
		new WeakSet<WebGLVertexArrayObject>();
	readonly matrixScratch = new Float32Array(16);
	/** Reusable dynamic-light upload staging; renderer-owned to keep draw loops allocation-free. */
	readonly dynamicLightScratch = createDynamicLightScratch();
	/** Lazy-resource outdoor actor depth schedule reading the shared dynamic pose pages. */
	readonly #outdoorPssmPass: WebGL2OutdoorPssmPass;
	readonly outdoorPssmReceiverPrograms: WebGL2OutdoorPssmReceiverPrograms;
	readonly #entityGroundingPrograms: WebGL2EntityGroundingPrograms;
	readonly outdoorPssmUniformScratch = createWebGL2OutdoorPssmUniformScratch();
	/** Current sequential view's receiver state; null prevents every inactive sample path. */
	#activeOutdoorPssmFrame: ActiveOutdoorPssmFrame | null = null;
	/** Reused frame-hot storage for analytic candidate collection and receiver selection. */
	readonly entityGroundingCasters: EntityGroundingCaster[] = [];
	readonly outdoorDirectionalCasters: OutdoorDirectionalShadowCaster[] = [];
	readonly indoorGroundingCells = new Map<string, IndoorGroundingCell>();
	readonly entityGroundingSelectionScratch =
		createEntityGroundingSelectionScratch();
	readonly outdoorDirectionalSelectionScratch =
		createOutdoorDirectionalShadowSelectionScratch();
	readonly indoorVisibilityIslands = new Map<string, SceneVisibilityIslandId>();
	/** Last topology indexed into the retained indoor-island lookup. */
	#indoorVisibilityTopology: SceneTopologyView | null = null;

	constructor(
		world: RenderWorld,
		deviceTargets: WebGL2DeviceAndTargetPool,
		diagnostics: RendererFrameDiagnosticsAndProfiler,
		sceneCompiler: SceneContributionCompilerAndSelector,
	) {
		this.#deviceTargets = deviceTargets;
		this.#diagnostics = diagnostics;
		this.#sceneCompiler = sceneCompiler;

		const { gl, resources, textureSamplers } = deviceTargets;
		this.#frameInstances = new FrameInstanceStreamArena(gl);
		this.#outdoorPssmPass = new WebGL2OutdoorPssmPass(
			gl,
			{
				getGeometry: (key) => resources.getGeometry(world.resolveGeometry(key)),
				getPose: (nodeId) => sceneCompiler.dynamicPosePages.get(nodeId),
			},
			{
				getDynamicDepth: (nodeId, showRetailHiddenGeometry) =>
					sceneCompiler.dynamicDepths.prepare(nodeId, showRetailHiddenGeometry),
				hasOutdoorDynamicShadowGeometry: (nodeId, showRetailHiddenGeometry) =>
					sceneCompiler.dynamicDepths.hasOutdoorDynamicShadowGeometry(
						nodeId,
						showRetailHiddenGeometry,
					),
				readRenderContribution: (nodeId) =>
					world.readRenderContribution(nodeId),
				getEntityShadowDynamicFacts: (nodeId) =>
					world.getEntityShadowDynamicFacts(nodeId),
				queryOutdoorShadowCasterMasks: (...args) =>
					world.queryOutdoorShadowCasterMasks(...args),
			},
		);
		this.outdoorPssmReceiverPrograms = new WebGL2OutdoorPssmReceiverPrograms(
			gl,
		);
		this.#entityGroundingPrograms = new WebGL2EntityGroundingPrograms(gl);
		this.#objectProgram = createWebGL2ObjectProgram(gl);
		this.#instancedObjectProgram = createWebGL2ObjectProgram(gl, {
			distanceFog: true,
			transformSource: "attribute",
		});
		this.#blendedObjectProgram = createWebGL2ObjectProgram(gl, {
			distanceFog: false,
		});
		this.#blendedInstancedObjectProgram = createWebGL2ObjectProgram(gl, {
			distanceFog: false,
			transformSource: "attribute",
		});
		this.objectFallbackBinding = {
			sampler: textureSamplers.getSampler({
				mipLevels: 1,
				policy: SHARED_FRONTEND_TUNING.rendering.frameDefaults.textureFiltering,
				samplingClass: "exact",
				wrap: TextureWrapMode.Clamp,
			}),
			texture: createObjectFallbackTexture(gl),
		};
	}

	get activeOutdoorPssmFrame(): ActiveOutdoorPssmFrame | null {
		return this.#activeOutdoorPssmFrame;
	}

	get outdoorPssmPass(): WebGL2OutdoorPssmPass {
		return this.#outdoorPssmPass;
	}

	get frameInstances(): FrameInstanceStreamArena {
		return this.#frameInstances;
	}

	ensureIndoorVisibilityTopology(topology: SceneTopologyView): void {
		if (
			this.#indoorVisibilityTopology !== topology ||
			this.#indoorVisibilityTopology.revision !== topology.revision
		) {
			indexIndoorVisibilityIslands(topology, this.indoorVisibilityIslands);
			this.#indoorVisibilityTopology = topology;
		}
	}

	requireDynamicOpaqueProgram():
		WebGL2DynamicObjectProgram | WebGL2FogDynamicObjectProgram {
		return (this.#dynamicOpaqueProgram ??= createWebGL2ObjectProgram(
			this.#deviceTargets.gl,
			{
				distanceFog: true,
				outdoorPssm: false,
				portalVisibility: false,
				transformSource: "pose-table",
				materialSource: "table",
			},
		));
	}

	requireDynamicBlendedProgram():
		WebGL2DynamicObjectProgram | WebGL2FogDynamicObjectProgram {
		return (this.#dynamicBlendedProgram ??= createWebGL2ObjectProgram(
			this.#deviceTargets.gl,
			{
				distanceFog: false,
				outdoorPssm: false,
				portalVisibility: false,
				transformSource: "pose-table",
				materialSource: "table",
			},
		));
	}

	beginFrame(): void {
		this.#outdoorPssmPass.beginFrame();
	}

	disableOutdoorPssm(): void {
		this.#outdoorPssmPass.disable();
	}

	resetActiveOutdoorPssmFrame(): void {
		this.#activeOutdoorPssmFrame = null;
	}

	/** Select one view's shadow inputs without drawing or changing active receiver state. */
	prepareOutdoorShadows(
		prepared: PreparedViewGeometry,
		entityShadows: EntityShadowSettings,
		showRetailHiddenGeometry: boolean,
		shading: SceneShading,
	): PreparedOutdoorShadowView | null {
		if (entityShadows.mode === "none") return null;
		if (entityShadows.mode === "simple") {
			if (!hasOutdoorShadowLight(shading.lighting.terrain.sunVector))
				return null;
			const projection = resolveOutdoorShadowProjection(
				shading.lighting.terrain.sunVector,
				entityShadows.projection,
			);
			return {
				maps: null,
				projection,
				analyticCasters: [],
			};
		}

		const frameWidth = this.#deviceTargets.frameWidth;
		const frameHeight = this.#deviceTargets.frameHeight;
		const preparedShadows = this.#outdoorPssmPass.prepare({
			anchorCoordinates: prepared.anchorCoordinates,
			anchorLandblockId: prepared.anchorLandblockId,
			aspectRatio: frameWidth / Math.max(1, frameHeight),
			camera: {
				far: prepared.camera.far,
				near: prepared.camera.near,
				position: prepared.cameraPosition,
				rotation: prepared.camera.placement.rotation,
				verticalFovDegrees: prepared.camera.fov,
			},
			cameraFrustum: prepared.frustum,
			casterBudget: entityShadows.casterBudget,
			frameHeight,
			frameWidth,
			selectedDynamicNodeIds: this.#sceneCompiler.selectedDynamicNodeIds,
			showRetailHiddenGeometry,
			projectionSettings: entityShadows.projection,
			settings: entityShadows.pssm,
			sunVector: shading.lighting.terrain.sunVector,
		});
		if (preparedShadows !== null) {
			for (const batch of preparedShadows.storage.batches)
				for (const caster of batch.casters)
					this.#sceneCompiler.poseUploadParts.set(caster.nodeId, caster.parts);
		}
		return preparedShadows === null
			? null
			: {
					maps: preparedShadows,
					projection: preparedShadows.projection,
					analyticCasters: preparedShadows.storage.analyticCasters,
				};
	}

	/** Execute selected mapped casters only; selection has already completed. */
	executeOutdoorShadows(prepared: PreparedOutdoorShadowView | null): void {
		this.#activeOutdoorPssmFrame = null;
		if (prepared === null || prepared.maps === null) return;
		const { maps } = prepared;

		this.#diagnostics.profiler?.setGpuSystem("shadowMaps");
		this.#activeOutdoorPssmFrame = this.#outdoorPssmPass.render(maps);

		if (this.#activeOutdoorPssmFrame) {
			this.#deviceTargets.deviceState.invalidate();
		}
		this.#diagnostics.profiler?.setGpuSystem("other");
	}

	/** Partition one prepared physical object population for both opaque and deferred consumers. */
	createObjectSubmissionPhases(
		view: PreparedView,
	): ObjectSubmissionPhases<ObjectColorSubmission> {
		const phases = createObjectSubmissionPhasesFromBuckets(
			view.objectBuckets,
			(object) => this.transparentSortFacts(object, view),
			(object) =>
				object.drawKind === "merged"
					? object.transparentCohortKey
					: object.instances?.kind === "frame-template"
						? object.instances.transparentCohortKey
						: null,
			(object) => this.transparentCameraDepth(object, view),
		);
		this.#diagnostics.metrics.transparentObjectCandidateCount +=
			phases.transparent.far.length + phases.transparent.near.length;
		this.#diagnostics.metrics.farTransparentObjectCandidateCount +=
			phases.transparent.far.length;
		this.#diagnostics.metrics.nearTransparentObjectCandidateCount +=
			phases.transparent.near.length;
		return phases;
	}

	/**
	 * Classify one transparent range against the camera, without deriving its camera depth.
	 *
	 * Every producer publishes its sort center in landblock space, so placing it in the view's
	 * anchored frame is one offset add: no per-candidate matrix work survives here.
	 */
	transparentSortFacts(
		object: ObjectColorSubmission,
		view: PreparedViewGeometry,
	): TransparentObjectSortFacts {
		const facts = object.transparentSort;
		if (!facts) {
			throw new Error(
				"Transparent static-object contribution lacks sort facts.",
			);
		}
		const offset = createLandblockOffset(
			getLandblockCoordinates(object.landblockId),
			view.anchorCoordinates,
			this.#sceneCompiler.offsetScratch,
		);
		const x = facts.center.x + offset.x - view.cameraPosition.x;
		const y = facts.center.y + offset.y - view.cameraPosition.y;
		const z = facts.center.z + offset.z - view.cameraPosition.z;
		return {
			distanceSquared: x * x + y * y + z * z,
			stableId: facts.stableId,
		};
	}

	/** Project one near candidate's center onto the camera's forward axis for exact ordering. */
	transparentCameraDepth(
		object: ObjectColorSubmission,
		view: PreparedViewGeometry,
	): number {
		const facts = object.transparentSort;
		if (!facts) {
			throw new Error(
				"Transparent static-object contribution lacks sort facts.",
			);
		}
		const offset = createLandblockOffset(
			getLandblockCoordinates(object.landblockId),
			view.anchorCoordinates,
			this.#sceneCompiler.offsetScratch,
		);
		const centerScratch = this.#sceneCompiler.transparentCenterScratch;
		centerScratch.x = facts.center.x + offset.x;
		centerScratch.y = facts.center.y + offset.y;
		centerScratch.z = facts.center.z + offset.z;
		transformPoint3(view.view, centerScratch, centerScratch);
		// The renderer's right-handed view matrix maps forward to negative view-space Z.
		return -centerScratch.z;
	}

	/** Form every phase's runs and upload their combined instance stream once per view. */
	prepareViewObjectRuns(
		phases: ObjectSubmissionPhases<ObjectColorSubmission>,
	): {
		readonly opaque: readonly ObjectColorSubmission[];
		readonly blended: readonly ObjectColorSubmission[];
	} {
		const prepared = this.prepareFrameInstanceRuns(
			[
				phases.opaque,
				phases.transparent.far,
				phases.transparent.near,
				phases.additive,
			],
			[
				{
					cohort: "ignore",
					grouping: "grouped",
				},
				{
					cohort: "require",
					grouping: "adjacent",
				},
				{
					cohort: "require",
					grouping: "adjacent",
				},
				{
					cohort: "require",
					grouping: "grouped",
				},
			],
		);
		const farRunCount = prepared.runCounts[1] ?? 0;
		const nearRunCount = prepared.runCounts[2] ?? 0;
		this.#diagnostics.metrics.transparentFrameRunCount +=
			farRunCount + nearRunCount;
		this.#diagnostics.metrics.farTransparentFrameRunCount += farRunCount;
		this.#diagnostics.metrics.nearTransparentFrameRunCount += nearRunCount;
		const opaqueCount = prepared.phaseObjectCounts[0] ?? 0;
		return {
			opaque: prepared.objects.slice(0, opaqueCount),
			blended: prepared.objects.slice(opaqueCount),
		};
	}

	/** Form phase-local compatible runs and upload their complete sequential instance population. */
	prepareFrameInstanceRuns(
		phases: readonly (readonly ObjectColorSubmission[])[],
		policies: readonly FrameInstancePhasePolicy[],
	): {
		readonly objects: readonly ObjectColorSubmission[];
		readonly runCounts: readonly number[];
		readonly phaseObjectCounts: readonly number[];
	} {
		const orderedInstances: ObjectInstanceData[] = [];
		const objects: ObjectColorSubmission[] = [];
		const runCounts: number[] = [];
		const phaseObjectCounts: number[] = [];

		for (const [phaseIndex, phase] of phases.entries()) {
			const firstObject = objects.length;
			const policy = policies[phaseIndex];
			if (!policy) {
				throw new Error(
					`Object instance phase ${phaseIndex} has no grouping policy.`,
				);
			}
			const scheduled = scheduleFrameInstanceRuns(phase, policy);
			runCounts.push(
				scheduled.filter(
					(submission) => submission.kind === "frame-instance-run",
				).length,
			);
			for (const submission of scheduled) {
				if (submission.kind === "single") {
					objects.push(submission.value);
					continue;
				}
				const object = submission.values[0];
				if (object.drawKind === "merged")
					throw new Error("Merged geometry entered an instance run.");
				const firstInstance = orderedInstances.length;
				for (const adjacent of submission.values) {
					if (
						adjacent.drawKind === "merged" ||
						adjacent.instances?.kind !== "frame-template"
					) {
						throw new Error(
							"Object instance run contains prepared range state.",
						);
					}
					orderedInstances.push(adjacent.instances.instance);
				}
				const instanceCount = orderedInstances.length - firstInstance;
				if (instanceCount === 0) continue;
				objects.push({
					...object,
					instances: {
						firstInstance,
						instanceCount,
						kind: "frame-range",
					},
				});
			}
			phaseObjectCounts.push(objects.length - firstObject);
		}

		this.#frameInstances.prepareView(orderedInstances);

		if (orderedInstances.length > 0) {
			this.#diagnostics.metrics.frameInstanceUploadCount += 1;
			this.#diagnostics.metrics.frameInstanceUploadBytes +=
				orderedInstances.length * OBJECT_INSTANCE_RECORD_BYTES;
		}
		return { objects, runCounts, phaseObjectCounts };
	}

	/** Start one object-owned phase with complete bindings for every active sampler. */
	beginObjectPhase(): void {
		this.#deviceTargets.deviceState.invalidate();
		for (const unit of Object.values(OBJECT_TEXTURE_UNITS)) {
			this.bindPreparedObjectTexture(unit, this.objectFallbackBinding);
		}
	}

	drawOpaqueObjects(
		view: PreparedView,
		objects: readonly ObjectColorSubmission[],
		shading: SceneShading,
		portalPipeline: WebGL2PortalScopeAtlasPipeline | null,
	): void {
		if (objects.length === 0) return;
		this.#diagnostics.profiler?.setGpuSystem("opaqueGeometry");

		const gl = this.#deviceTargets.gl;
		const state = this.#deviceTargets.deviceState;

		this.beginObjectPhase();
		gl.depthMask(true);
		state.applyBlend(null);
		for (const object of objects) {
			if (object.drawKind === "merged")
				throw new Error("Ordered merged geometry entered the opaque phase.");
			const receivesIndoorGrounding =
				object.source === "env-cell-shell" &&
				view.entityAnalyticShadows?.indoorByScopeKey.has(
					object.renderScopeKey,
				) === true;
			const receivesOutdoorPssm =
				this.#activeOutdoorPssmFrame !== null && object.receivesOutdoorPssm;
			const program = object.compatibility.geometry.staticMaterials
				? this.requireStaticTableProgram(
						/* distanceFog */ true,
						/* portalVisibility */ false,
						receivesOutdoorPssm,
					)
				: receivesIndoorGrounding
					? this.#entityGroundingPrograms.fogged()
					: receivesOutdoorPssm
						? object.drawKind === "instanced"
							? this.outdoorPssmReceiverPrograms.foggedInstanced()
							: this.outdoorPssmReceiverPrograms.foggedBaked()
						: object.drawKind === "instanced"
							? this.#instancedObjectProgram
							: this.#objectProgram;
			const programChanged = state.applyProgram(program.program);
			const viewChanged = state.applyViewStamp(view);
			if (viewChanged) {
				this.activateObjectProgram(program, view, shading);
			}
			this.applyObjectLighting(program, object, shading);
			this.applyObjectGrounding(program, object, view);
			portalPipeline?.routeObjectSubmission(
				object.renderScopeKey,
				program.uniforms.clipTransform,
				programChanged || viewChanged,
			);
			this.drawObjectRange(program, object, view.landblockOffsets);
		}
		this.#diagnostics.profiler?.setGpuSystem("other");
	}

	/** Execute preselected physical color spans using the frame's already-uploaded pose pages. */
	drawDynamicOpaque(view: PreparedView, shading: SceneShading): void {
		if (view.dynamicOpaque.length === 0) return;
		const program = this.#dynamicOpaqueProgram;
		if (program === null)
			throw new Error("Merged opaque color was not prepared before execution.");

		this.#diagnostics.profiler?.setGpuSystem("opaqueGeometry");
		const gl = this.#deviceTargets.gl;
		const state = this.#deviceTargets.deviceState;

		this.beginObjectPhase();
		gl.enable(gl.DEPTH_TEST);
		gl.depthFunc(gl.LEQUAL);
		gl.depthMask(true);
		state.applyBlend(null);
		for (const object of view.dynamicOpaque) {
			state.applyProgram(program.program);
			if (state.applyViewStamp(view))
				this.activateObjectProgram(program, view, shading);
			this.applyObjectLighting(program, object, shading);
			this.bindDynamicColor(program, object, view);
			for (const span of object.ranges) {
				const range = object.appearance.plan.physicalRanges[span.rangeIndex];
				if (range === undefined)
					throw new Error("Merged opaque span lost its physical range.");
				this.drawDynamicColorSpan(range, span.indexCount);
			}
		}
		this.#diagnostics.profiler?.setGpuSystem("other");
	}

	drawBlendedObjects(
		view: PreparedView,
		sortedBlended: readonly ObjectColorSubmission[],
		shading: SceneShading,
		portalPipeline: WebGL2PortalScopeAtlasPipeline | null,
	): void {
		if (sortedBlended.length === 0) return;

		this.#diagnostics.profiler?.setGpuSystem("transparencyAndEffects");
		const gl = this.#deviceTargets.gl;
		const state = this.#deviceTargets.deviceState;

		// Primes every object sampler unit, not just the cache, exactly as the opaque pass does.
		// `invalidate()` alone was not enough: it makes issued binds re-apply, but a material
		// that *skips* a bind — direct colour skips the palette, solid colour skips both — keeps
		// whatever the frame last left on that unit. Terrain leaves integer `usampler2D`
		// textures on units 0 and 1, and the opaque pass returns before priming them when a view
		// has no opaque candidates, so a view of purely transparent objects reached this loop
		// with an integer texture bound under a float sampler and every draw failed validation.
		this.beginObjectPhase();
		gl.depthMask(false);
		let portalPrograms: {
			readonly baked: WebGL2ObjectProgram;
			readonly instanced: WebGL2InstancedObjectProgram;
		} | null = null;
		for (const object of sortedBlended) {
			if (object.drawKind === "merged") {
				this.drawDynamicBlended(object, view, shading);
				continue;
			}
			const receivesIndoorGrounding =
				object.source === "env-cell-shell" &&
				view.entityAnalyticShadows?.indoorByScopeKey.has(
					object.renderScopeKey,
				) === true;
			const receivesOutdoorPssm =
				this.#activeOutdoorPssmFrame !== null && object.receivesOutdoorPssm;
			let program: AnyObjectProgram;
			if (object.compatibility.geometry.staticMaterials) {
				program = this.requireStaticTableProgram(
					/* distanceFog */ false,
					portalPipeline !== null,
					receivesOutdoorPssm,
				);
			} else if (receivesIndoorGrounding) {
				program = this.#entityGroundingPrograms.blended(
					portalPipeline !== null,
				);
			} else if (receivesOutdoorPssm) {
				program =
					object.drawKind === "instanced"
						? this.outdoorPssmReceiverPrograms.blendedInstanced(
								portalPipeline !== null,
							)
						: this.outdoorPssmReceiverPrograms.blendedBaked(
								portalPipeline !== null,
							);
			} else {
				if (portalPipeline) {
					portalPrograms ??= this.requirePortalBlendedObjectPrograms();
				}
				program =
					object.drawKind === "instanced"
						? (portalPrograms?.instanced ?? this.#blendedInstancedObjectProgram)
						: (portalPrograms?.baked ?? this.#blendedObjectProgram);
			}
			state.applyProgram(program.program);
			if (state.applyViewStamp(view)) {
				this.activateObjectProgram(program, view, shading);
			}
			if (portalPipeline) {
				const uniforms = program.portalVisibilityUniforms;
				if (!uniforms) {
					throw new Error(
						"Portal deferred object draw selected a program without scope-envelope visibility.",
					);
				}
				portalPipeline.routeDeferredSubmission(object.renderScopeKey, uniforms);
			}
			this.applyObjectLighting(program, object, shading);
			this.applyObjectGrounding(program, object, view);
			state.applyBlend(object.blendPolicy);
			this.drawObjectRange(program, object, view.landblockOffsets);
		}
		this.#diagnostics.profiler?.setGpuSystem("other");
	}

	/** Draw one selected span exactly where the shared transparent/additive ordering placed it. */
	drawDynamicBlended(
		object: PreparedDynamicBlended,
		view: PreparedView,
		shading: SceneShading,
	): void {
		const { program, range } = object;
		const state = this.#deviceTargets.deviceState;
		state.applyProgram(program.program);
		if (state.applyViewStamp(view))
			this.activateObjectProgram(program, view, shading);
		this.applyObjectLighting(program, object, shading);
		state.applyBlend(range.batch.blendPolicy);
		this.bindDynamicColor(program, object, view);
		this.drawDynamicColorSpan(range, object.indexCount);
		if (object.ordering === "transparent")
			this.#diagnostics.metrics.submittedTransparentObjectDrawCount += 1;
		else this.#diagnostics.metrics.submittedAdditiveObjectDrawCount += 1;
	}

	/** Bind the entity's shared pose/appearance generation independently from its color phase. */
	bindDynamicColor(
		program: WebGL2DynamicObjectProgram | WebGL2FogDynamicObjectProgram,
		object: PreparedDynamicColor,
		view: PreparedView,
	): void {
		const state = this.#deviceTargets.deviceState;
		const offset = view.landblockOffsets.get(object.landblockId);
		if (offset === undefined)
			throw new Error(
				`Merged color landblock ${object.landblockId} has no frame offset.`,
			);
		this.#diagnostics.countUniformWrite(
			state.applyUniform3f(program.uniforms.landblockOffset, ...offset),
		);
		// Rigid part materials are produced with detailRole:null in object-material-ranges.
		this.#diagnostics.countUniformWrite(
			state.applyUniform1i(program.uniforms.useDetail, 0),
		);
		const pose = this.#sceneCompiler.dynamicPosePages.get(object.nodeId);
		state.applyTexture2D(OBJECT_TEXTURE_UNITS.poses, pose.texture, null);
		state.applyTexture2D(
			OBJECT_TEXTURE_UNITS.materials,
			object.appearance.table,
			null,
		);
		this.#diagnostics.countUniformWrite(
			state.applyUniform1i(program.uniforms.firstPoseRow, pose.firstRow),
		);
		state.applyVertexArray(object.geometry.vertexArray);
		state.applyElementArrayBuffer(object.appearance.indexBuffer);
	}

	/** Submit one compatible physical span after its entity and pass state have been bound. */
	drawDynamicColorSpan(
		range: PreparedDynamicColor["appearance"]["plan"]["ranges"][number],
		indexCount: number,
	): void {
		const gl = this.#deviceTargets.gl;
		const state = this.#deviceTargets.deviceState;
		state.applyCullFace(range.batch.cullFace);
		const { base, palette } = range.batch.textures;
		if (base) this.bindPreparedObjectTexture(OBJECT_TEXTURE_UNITS.base, base);
		if (palette)
			this.bindPreparedObjectTexture(OBJECT_TEXTURE_UNITS.palette, palette);
		gl.drawElements(
			gl.TRIANGLES,
			indexCount,
			gl.UNSIGNED_INT,
			range.indexStart * Uint32Array.BYTES_PER_ELEMENT,
		);
		this.#diagnostics.metrics.objectDrawCalls += 1;
		this.#diagnostics.metrics.submittedDynamicDrawCount += 1;
	}

	drawObjectRange(
		program: AnyObjectProgram,
		object: PreparedObjectFrameInput,
		landblockOffsets: PreparedSceneContributions["landblockOffsets"],
	): void {
		if (
			(object.drawKind === "single") !==
			(program.transformSource === "uniform")
		) {
			throw new Error(
				`${object.drawKind} draw cannot use ${program.transformSource} object program.`,
			);
		}
		const { compatibility } = object;
		const gl = this.#deviceTargets.gl;
		const state = this.#deviceTargets.deviceState;
		const diagnostics = this.#diagnostics;
		const metrics = diagnostics.metrics;
		state.applyCullFace(compatibility.cullFace);
		if (program.transformSource === "uniform") {
			diagnostics.countUniformWrite(
				state.applyUniformMatrix4fv(
					program.uniforms.localToLandblock,
					mat4ToFloat32Array(object.localToLandblock, this.matrixScratch),
				),
			);
		}
		const landblockOffset = landblockOffsets.get(object.landblockId);
		if (landblockOffset === undefined) {
			throw new Error(
				`Submitted object in landblock ${object.landblockId} has no frame offset.`,
			);
		}
		diagnostics.countUniformWrite(
			state.applyUniform3f(
				program.uniforms.landblockOffset,
				landblockOffset[0],
				landblockOffset[1],
				landblockOffset[2],
			),
		);
		const preparedMaterial = compatibility.material;
		if (preparedMaterial.kind !== "solid-color") {
			this.bindPreparedObjectTexture(
				OBJECT_TEXTURE_UNITS.base,
				preparedMaterial.base,
			);
			if (preparedMaterial.kind !== "direct-color")
				this.bindPreparedObjectTexture(
					OBJECT_TEXTURE_UNITS.palette,
					preparedMaterial.palette,
				);
		}
		if (program.materialSource === "table") {
			const table = compatibility.geometry.staticMaterials;
			if (!table)
				throw new Error(
					"Static table program received uniform-material geometry.",
				);
			state.applyTexture2D(OBJECT_TEXTURE_UNITS.materials, table.texture, null);
		} else {
			diagnostics.countUniformWrite(
				state.applyUniform1i(
					program.uniforms.wrapRepeat,
					compatibility.wrapRepeat ? 1 : 0,
				),
			);
			diagnostics.countUniformWrite(
				state.applyUniform1i(
					program.uniforms.palettedClipMap,
					compatibility.palettedClipMap ? 1 : 0,
				),
			);
			diagnostics.countUniformWrite(
				state.applyUniform1f(
					program.uniforms.alphaTest,
					compatibility.alphaTest,
				),
			);
			diagnostics.countUniformWrite(
				state.applyUniform4f(
					program.uniforms.materialColor,
					...preparedMaterial.color,
				),
			);
			if (preparedMaterial.kind === "solid-color") {
				diagnostics.countUniformWrite(
					state.applyUniform1i(program.uniforms.materialKind, 0),
				);
			} else {
				diagnostics.countUniformWrite(
					state.applyUniform4f(
						program.uniforms.baseRect,
						...preparedMaterial.base.rect,
					),
				);
				diagnostics.countUniformWrite(
					state.applyUniform1i(
						program.uniforms.materialKind,
						preparedMaterial.kind === "direct-color"
							? 1
							: preparedMaterial.kind === "index8"
								? 2
								: 3,
					),
				);
				if (preparedMaterial.kind !== "direct-color") {
					diagnostics.countUniformWrite(
						state.applyUniform4f(
							program.uniforms.paletteRect,
							...preparedMaterial.palette.rect,
						),
					);
				}
			}
			diagnostics.countUniformWrite(
				state.applyUniform1f(
					program.uniforms.luminosity,
					compatibility.luminosity,
				),
			);
		}
		const { detail } = compatibility;
		if (detail) {
			this.bindPreparedObjectTexture(OBJECT_TEXTURE_UNITS.detail, detail);
			diagnostics.countUniformWrite(
				state.applyUniform4f(program.uniforms.detailRect, ...detail.rect),
			);
			diagnostics.countUniformWrite(
				state.applyUniform1f(program.uniforms.detailTiling, detail.tiling),
			);
			diagnostics.countUniformWrite(
				state.applyUniform1i(program.uniforms.useDetail, 1),
			);
		} else {
			diagnostics.countUniformWrite(
				state.applyUniform1i(program.uniforms.useDetail, 0),
			);
		}
		metrics.objectDrawCalls += 1;
		const geometry = compatibility.geometry;
		state.applyVertexArray(geometry.vertexArray);
		let submittedInstanceCount = 1;
		if (object.drawKind === "instanced") {
			if (!object.instances) {
				throw new Error("Instanced draw has no resolved instance stream.");
			}
			if (object.instances.kind === "frame-template") {
				throw new Error("Unprepared object instance data reached submission.");
			}
			const range = this.#frameInstances.getRange(
				object.instances.firstInstance,
				object.instances.instanceCount,
			);
			const instances = range.binding;
			if (range.instanceCount === 0)
				throw new Error("Instanced draw has an empty instance range.");
			const configureInvariantAttributes =
				!this.#configuredObjectInstanceVertexArrays.has(geometry.vertexArray);
			bindWebGL2ObjectInstanceRange(
				gl,
				instances,
				range.firstInstance,
				range.instanceCount,
				configureInvariantAttributes,
			);
			if (configureInvariantAttributes) {
				this.#configuredObjectInstanceVertexArrays.add(geometry.vertexArray);
			}
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
		if (object.source === "portal-transition") {
			metrics.submittedPortalTransitionDrawCount += 1;
		} else {
			metrics.submittedStaticObjectDrawCount += 1;
			metrics.submittedStaticObjectTriangleCount +=
				sourceTriangleCount * submittedInstanceCount;
		}
		if (object.source === "env-cell-shell") {
			metrics.submittedEnvCellShellDrawCount += 1;
			metrics.submittedEnvCellShellTriangleCount += sourceTriangleCount;
			if (object.cullFaceOverride !== null) {
				metrics.envCellShellCullOverrideCount += 1;
			}
		} else if (object.source === "env-cell-resident") {
			metrics.submittedEnvCellResidentDrawCount += 1;
			metrics.submittedEnvCellResidentTriangleCount +=
				sourceTriangleCount * submittedInstanceCount;
		}
		if (object.drawKind === "single" && object.source !== "portal-transition") {
			metrics.submittedBakedStaticObjectDrawCount += 1;
			metrics.submittedBakedStaticObjectTriangleCount += sourceTriangleCount;
			diagnostics.mergeCensusCollector?.record(
				object.landblockId,
				object.localToLandblock,
				compatibility,
				program.materialSource,
			);
		} else if (
			object.drawKind === "instanced" &&
			object.source !== "portal-transition"
		) {
			metrics.submittedInstancedSourceTriangleCount += sourceTriangleCount;
		}
		if (object.ordering === "transparent") {
			metrics.submittedTransparentObjectDrawCount += 1;
			if (object.drawKind === "instanced") {
				metrics.submittedTransparentInstanceCount += submittedInstanceCount;
			}
		}
		if (object.ordering === "additive") {
			metrics.submittedAdditiveObjectDrawCount += 1;
		}
	}

	activateObjectProgram(
		program: LitObjectProgram,
		view: PreparedView,
		shading: SceneShading,
	): void {
		const gl = this.#deviceTargets.gl;
		this.#diagnostics.metrics.objectProgramChanges += 1;
		gl.uniform4f(program.uniforms.clipTransform, 1, 1, 0, 0);
		gl.uniformMatrix4fv(
			program.uniforms.projection,
			false,
			mat4ToFloat32Array(view.projection, this.matrixScratch),
		);
		gl.uniformMatrix4fv(
			program.uniforms.view,
			false,
			mat4ToFloat32Array(view.view, this.matrixScratch),
		);
		bindWebGL2DynamicLights(
			gl,
			program.uniforms,
			shading.dynamicLights,
			shading.anchorOrigin,
			this.dynamicLightScratch,
		);
		const pssmUniforms = program.outdoorPssmUniforms;
		if (pssmUniforms) {
			const active = this.#activeOutdoorPssmFrame;
			if (!active) {
				throw new Error("Outdoor PSSM receiver program has no active frame.");
			}
			bindWebGL2OutdoorPssmUniforms(
				gl,
				pssmUniforms,
				active,
				this.outdoorPssmUniformScratch,
			);
			this.#deviceTargets.deviceState.applyTextureArrayUnit(
				OUTDOOR_PSSM_TEXTURE_UNIT,
				active.targets.depth,
			);
		}
		if ("fogUniforms" in program) {
			gl.uniform3f(
				program.fogUniforms.cameraPosition,
				view.cameraPosition.x,
				view.cameraPosition.y,
				view.cameraPosition.z,
			);
			bindWebGL2DistanceFog(gl, program.fogUniforms, shading.fog);
		}
	}

	/**
	 * Bind the lighting this contribution's retail role requires.
	 *
	 * Interior and outdoor contributions interleave within one pass, so lighting is per draw
	 * rather than per program activation; the state applicator suppresses redundant binds.
	 */
	applyObjectLighting(
		program: LitObjectProgram,
		object: Pick<
			ObjectColorSubmission | PreparedDynamicColor,
			"source" | "landblockId"
		>,
		shading: SceneShading,
	): void {
		const gl = this.#deviceTargets.gl;
		const state = this.#deviceTargets.deviceState;
		const role = objectLightingRole(object.source);
		if (state.applyLightingRole(role)) {
			bindWebGL2SceneLighting(gl, program.uniforms, shading.lighting[role]);
			this.#diagnostics.metrics.objectLightingBinds += 1;
		}
		// Interior geometry already carries its static lighting in baked vertex colours, and
		// daylight or lamp-free outdoor landblocks contribute zero static lights; share the empty
		// `null` scope across all of them so landblock transitions do not re-upload `uStaticLightCount = 0`.
		const lights =
			role === "interior-object" ||
			object.source === "portal-transition" ||
			shading.authoredLightResponse <= 0
				? EMPTY_LIGHTS
				: shading.staticLights(object.landblockId).lights;
		const scope = lights.length > 0 ? object.landblockId : null;
		if (!state.applyStaticLightScope(scope)) return;
		bindWebGL2StaticLights(
			gl,
			program.uniforms,
			lights,
			shading.anchorOrigin,
			shading.authoredLightResponse,
			this.dynamicLightScratch,
		);
		this.#diagnostics.metrics.staticLightBinds += 1;
	}

	/** Bind one shell scope's fixed analytic-grounding set through the object uniform cache. */
	applyObjectGrounding(
		program: AnyObjectProgram,
		object: PreparedObjectFrameInput,
		view: PreparedView,
	): void {
		const uniforms = program.entityGroundingUniforms;
		const active = view.entityAnalyticShadows;
		const selection = active?.indoorByScopeKey.get(object.renderScopeKey);
		if (!uniforms) {
			if (object.source === "env-cell-shell" && selection !== undefined) {
				throw new Error(
					"Active EnvCell grounding draw selected an ordinary object program.",
				);
			}
			return;
		}
		if (
			object.source !== "env-cell-shell" ||
			active === null ||
			selection === undefined
		) {
			throw new Error(
				"Indoor grounding program selected without an active EnvCell record set.",
			);
		}
		const attempted = entityGroundingUniformAttemptCount(selection);
		const issued = applyWebGL2EntityGroundingUniforms(
			this.#deviceTargets.deviceState,
			uniforms,
			selection,
			active.indoorSettings,
		);
		this.#diagnostics.metrics.objectUniformUploads += issued;
		this.#diagnostics.metrics.objectSuppressedUniformUploads +=
			attempted - issued;
	}

	/**
	 * Resolve and budget one landblock's authored lights.
	 *
	 * The index memoizes the gather across frames, so the per-frame cost is a map read plus a
	 * budget fit that is a pass-through whenever the set fits, which it almost always does.
	 */
	resolveStaticLights(
		input: FrameInput,
		landblockId: LandblockOwnerId,
		sceneCameraPosition: SceneVec3,
	): LandblockLights {
		if (!input.frameSettings.staticLightsEnabled) {
			return EMPTY_LANDBLOCK_LIGHTS;
		}
		if (input.outdoorLights.isEmpty) return EMPTY_LANDBLOCK_LIGHTS;
		const reaching = input.outdoorLights.resolve(landblockId);
		if (reaching.lights.length <= MAX_STATIC_LIGHTS) return reaching;
		const fitted = fitLightsToBudget(
			reaching.lights,
			sceneCameraPosition,
			MAX_STATIC_LIGHTS,
		);
		this.#diagnostics.metrics.droppedLights += fitted.dropped;
		// The fit reorders by distance from the camera, so the memoized masks no longer name these
		// slots. Fall back to admitting every light rather than binding a stale table; the shader
		// still bounds iteration by the live count, so the result is identical and only the tiling
		// saving is lost. Unreachable on retail content, whose worst landblock carries 51 lights
		// against a cap of 64.
		return { lights: fitted.lights, cellMasks: TERRAIN_LIGHT_MASK_ALL };
	}

	/** Compile the two portal-only material variants on the first replacement-compositor frame. */
	requirePortalBlendedObjectPrograms(): {
		readonly baked: WebGL2ObjectProgram;
		readonly instanced: WebGL2InstancedObjectProgram;
	} {
		const gl = this.#deviceTargets.gl;
		this.#portalBlendedObjectProgram ??= createWebGL2ObjectProgram(gl, {
			distanceFog: false,
			portalVisibility: true,
		});
		this.#portalBlendedInstancedObjectProgram ??= createWebGL2ObjectProgram(
			gl,
			{
				distanceFog: false,
				portalVisibility: true,
				transformSource: "attribute",
			},
		);
		return {
			baked: this.#portalBlendedObjectProgram,
			instanced: this.#portalBlendedInstancedObjectProgram,
		};
	}

	/** Shader variants are renderer-owned; material textures remain geometry-owned. */
	requireStaticTableProgram(
		distanceFog: boolean,
		portalVisibility: boolean,
		outdoorPssm: boolean,
	): WebGL2StaticTableObjectProgram | WebGL2FogStaticTableObjectProgram {
		const key =
			Number(distanceFog) |
			(Number(portalVisibility) << 1) |
			(Number(outdoorPssm) << 2);
		let program = this.#staticTablePrograms.get(key);
		if (!program) {
			program = createWebGL2ObjectProgram(this.#deviceTargets.gl, {
				distanceFog,
				portalVisibility,
				outdoorPssm,
				transformSource: "uniform",
				materialSource: "table",
			});
			this.#staticTablePrograms.set(key, program);
		}
		return program;
	}

	bindPreparedObjectTexture(
		unit: number,
		binding: PreparedObjectTextureBinding<WebGLTexture, WebGLSampler>,
	): void {
		if (this.#deviceTargets.deviceState.applyTextureUnit(unit, binding)) {
			this.#diagnostics.metrics.objectTextureBinds += 1;
		}
	}

	destroyDynamicPrograms(): void {
		const gl = this.#deviceTargets.gl;
		if (this.#dynamicOpaqueProgram !== null)
			gl.deleteProgram(this.#dynamicOpaqueProgram.program);
		this.#dynamicOpaqueProgram = null;
		if (this.#dynamicBlendedProgram !== null)
			gl.deleteProgram(this.#dynamicBlendedProgram.program);
		this.#dynamicBlendedProgram = null;
	}

	destroy(): void {
		const gl = this.#deviceTargets.gl;
		gl.deleteProgram(this.#objectProgram.program);
		gl.deleteProgram(this.#instancedObjectProgram.program);
		gl.deleteProgram(this.#blendedObjectProgram.program);
		gl.deleteProgram(this.#blendedInstancedObjectProgram.program);
		if (this.#portalBlendedObjectProgram) {
			gl.deleteProgram(this.#portalBlendedObjectProgram.program);
		}
		this.#portalBlendedObjectProgram = null;
		if (this.#portalBlendedInstancedObjectProgram) {
			gl.deleteProgram(this.#portalBlendedInstancedObjectProgram.program);
		}
		this.#portalBlendedInstancedObjectProgram = null;
		gl.deleteTexture(this.objectFallbackBinding.texture);
		this.outdoorPssmReceiverPrograms.destroy();
		for (const program of this.#staticTablePrograms.values())
			gl.deleteProgram(program.program);
		this.#staticTablePrograms.clear();
		this.#entityGroundingPrograms.destroy();
		this.#outdoorPssmPass.destroy();
		this.#frameInstances.destroy();
	}
}

/** Schedule one phase under its explicit ordering and cohort semantics. */
function scheduleFrameInstanceRuns(
	ordered: readonly ObjectColorSubmission[],
	policy: FrameInstancePhasePolicy,
): readonly ObjectFrameSubmission<ObjectColorSubmission>[] {
	const isFrameInstance = (object: ObjectColorSubmission): boolean =>
		object.drawKind !== "merged" && object.instances?.kind === "frame-template";
	const isCompatible = (
		left: ObjectColorSubmission,
		right: ObjectColorSubmission,
	): boolean =>
		left.drawKind !== "merged" &&
		right.drawKind !== "merged" &&
		frameTemplateDrawIdentityEquals(left, right) &&
		(policy.cohort === "ignore" || frameTemplateCohortEquals(left, right));
	return policy.grouping === "grouped"
		? formGroupedObjectInstanceRuns(
				ordered,
				isFrameInstance,
				(object) => {
					if (object.drawKind === "merged")
						throw new Error(
							"Merged geometry requested an instance grouping key.",
						);
					return objectInstanceBatchKey(object, policy.cohort);
				},
				isCompatible,
			)
		: formAdjacentObjectInstanceRuns(ordered, isFrameInstance, isCompatible);
}

/** Check every non-cohort identity required in addition to prepared draw compatibility. */
function frameTemplateDrawIdentityEquals(
	left: PreparedObjectFrameInput,
	right: PreparedObjectFrameInput,
): boolean {
	const leftInstances = left.instances;
	const rightInstances = right.instances;
	if (
		leftInstances?.kind !== "frame-template" ||
		rightInstances?.kind !== "frame-template"
	) {
		throw new Error(
			"Frame-template batch identity requires two frame templates.",
		);
	}
	return (
		// One offset per landblock this frame, so equal landblocks mean equal offsets. This replaces
		// the component comparison the compatibility value used to carry.
		left.landblockId === right.landblockId &&
		areStaticObjectDrawsCompatible(left.compatibility, right.compatibility) &&
		left.source === right.source &&
		left.receivesOutdoorPssm === right.receivesOutdoorPssm &&
		left.renderScopeKey === right.renderScopeKey &&
		left.geometry === right.geometry &&
		left.indexStart === right.indexStart &&
		left.indexCount === right.indexCount
	);
}

/** Preserve order-sensitive template identity only for phases that explicitly require it. */
function frameTemplateCohortEquals(
	left: PreparedObjectFrameInput,
	right: PreparedObjectFrameInput,
): boolean {
	const leftInstances = left.instances;
	const rightInstances = right.instances;
	if (
		leftInstances?.kind !== "frame-template" ||
		rightInstances?.kind !== "frame-template"
	) {
		throw new Error(
			"Frame-template cohort identity requires two frame templates.",
		);
	}
	return (
		leftInstances.transparentCohortKey === rightInstances.transparentCohortKey
	);
}

/** Stable semantic partition used to narrow exact instance compatibility checks. */
function objectInstanceBatchKey(
	object: PreparedObjectFrameInput,
	cohort: FrameInstancePhasePolicy["cohort"],
): string {
	const instances = object.instances;
	if (instances?.kind !== "frame-template") {
		throw new Error(
			"Object instance grouping received a non-frame instance input.",
		);
	}
	if (cohort === "ignore") return object.batchKey;
	return `${object.ordering}\0${object.source}\0${object.receivesOutdoorPssm ? "pssm" : "plain"}\0${object.renderScopeKey}\0${object.landblockId}\0${object.geometry}\0${object.indexStart}\0${object.indexCount}\0${instances.transparentCohortKey}`;
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
