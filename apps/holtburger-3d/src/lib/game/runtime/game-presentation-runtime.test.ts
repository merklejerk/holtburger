import { acVector3, sceneVec3 } from "../../assets/ac-frame";
import { describe, expect, it, vi } from "vitest";
import type { TexturePixelSource } from "../../assets/texture-pixel-source";
import type { AnimationAssetSource } from "../../assets/animation-asset-source";
import type {
	CommitPipeline,
	LandblockLayerCommit,
	StaticLandblockLayerCommitTerrain,
} from "../commit/types";
import { createLandblockWorldOrigin } from "../landblocks";
import { AABB3, Mat4, Quat, Vec3 } from "../math/types";
import type {
	AuthoredDynamicSource,
	ResolvedObjectResident,
} from "../resolution/landblock-layer";
import {
	type FrameInput,
	type FrameSelectionMetrics,
	type Renderer,
} from "../renderer/renderer";
import { SHARED_FRAME_SETTINGS } from "../../frontend-frame-settings";
import type { ParticleEmitterSource } from "../../assets/particle-emitter-source";
import type { DecodedParticleEmitterInfo } from "../../assets/decode-particle-emitter-record";
import type { SoundTableSource } from "../../assets/sound-table-source";
import type { ParticleMeshSource } from "../../assets/particle-mesh-source";
import type { PhysicsScriptSource } from "../../assets/physics-script-source";
import type { PhysicsScriptTableSource } from "../../assets/physics-script-table-source";
import type { RendererResourceManager } from "../renderer/resource-manager";
import { LandblockLayerKind, type LandblockIdLayer } from "./scene-interest";
import {
	GamePresentationRuntime,
	type GamePresentationRuntimeDependencies,
	type GamePresentationRuntimeRenderDevice,
} from "./game-presentation-runtime";
import type { SceneAvailabilityEvent } from "./scene-availability";
import { cellId, type DynamicEntityView } from "./dynamic-entity-feed";
import type { Camera } from "./types";
import type { DatAssetId, LandblockOwnerId } from "../game-types";
import type { SetupVisualSource } from "../../assets/setup-visual-source";
import type { DecodedStaticPresentation } from "../../assets/decode-static-source-record";
import type {
	ClosedWorkerPort,
	ClosedWorkerRequest,
	ClosedWorkerResponse,
} from "../workers/closed-worker";
import { generateTerrain } from "../terrain/terrain-generator";
import { validateTerrainGenerationValues } from "../terrain/terrain-generation-validation";
import { compileTerrainCompositionTable } from "../terrain/composition-table";
import { resolveTerrainMaterialTable } from "../terrain/terrain-materials";
import { resolveTerrainTextureFacts } from "../terrain/types";
import {
	texturePixelFormatByteLength,
	texturePurposePolicy,
	TexturePurpose,
} from "../textures/types";
import type {
	TexturePreparationServiceRequest,
	TexturePreparationServiceResponse,
} from "../textures/texture-preparer";
import {
	terrainWorkerResultTransferables,
	type TerrainWorkerJob,
	type TerrainWorkerResult,
} from "../terrain/terrain-worker-contract";

/** No runtime test stages a particle mesh, so any load here is a defect worth surfacing. */
const PARTICLE_MESH_SOURCE: ParticleMeshSource = {
	destroy: () => {},
	async loadParticleMeshes(hwGfxObjIds) {
		throw new Error(`Unexpected particle mesh load for ${hwGfxObjIds.join()}.`);
	},
};

/** No runtime test stages a sound table, so any load here is a defect worth surfacing. */
const SOUND_TABLE_SOURCE: SoundTableSource = {
	destroy: () => {},
	async loadSoundTable(soundTableId) {
		throw new Error(`Unexpected sound table load for ${soundTableId}.`);
	},
};

/** No runtime test stages an authored emitter, so any load here is a defect worth surfacing. */
const PARTICLE_EMITTER_SOURCE: ParticleEmitterSource = {
	destroy: () => {},
	async loadParticleEmitter(emitterInfoId) {
		throw new Error(`Unexpected particle emitter load for ${emitterInfoId}.`);
	},
};

/** No runtime test installs an authored script, so any load here is a defect worth surfacing. */
const PHYSICS_SCRIPT_SOURCE: PhysicsScriptSource = {
	destroy: () => {},
	async loadPhysicsScript(scriptId) {
		throw new Error(`Unexpected physics script load for ${scriptId}.`);
	},
};

/** No runtime test resolves a live cue unless it injects an explicit table source. */
const PHYSICS_SCRIPT_TABLE_SOURCE: PhysicsScriptTableSource = {
	destroy: () => {},
	async loadPhysicsScriptTable(tableId) {
		throw new Error(`Unexpected PhysicsScriptTable load for ${tableId}.`);
	},
};

/** One immediate scale root used to prove which composition owns its scalar. */
function scalePhysicsScriptSource(
	scriptId: DatAssetId,
	end: number,
): PhysicsScriptSource {
	return {
		destroy() {},
		async loadPhysicsScript(requestedId) {
			if (requestedId !== scriptId)
				throw new Error(`Unexpected physics script ${requestedId}.`);
			return {
				id: scriptId,
				lengthSeconds: 0,
				records: [
					{
						authoredOrder: 0,
						durationSeconds: 0,
						end,
						kind: "scale",
						startTime: 0,
					},
				],
			};
		},
	};
}

const ANIMATION_SOURCE: AnimationAssetSource = {
	/** No runtime test spawns a motion-driven entity, so a closure request is a defect. */
	async loadMotionTableClosure(motionTableId) {
		throw new Error(`Unexpected motion closure load for ${motionTableId}.`);
	},
	async loadAnimation(animationId) {
		return {
			frameCount: 1,
			hooks: [],
			id: animationId,
			partCount: 1,
			partFrames: [Mat4.identity()],
			positionFrames: [],
		};
	},
	destroy() {},
};

const TEST_RESOURCES = {
	createGeometry: () => "geometry-resource:1",
	createTexture2D: () => "texture-2d-resource:1",
	createTextureArray: () => "texture-array-resource:1",
	async destroy() {},
	generateTextureArrayMipmaps() {},
	releaseResource: () => true,
	replaceGeometry() {},
	replaceTexture2D() {},
	updateTexture2DRegions() {},
	uploadTextureArrayLayer() {},
} as RendererResourceManager;

const EMPTY_RENDERER_FRAME_FEEDBACK = {
	portalTransitionReceipt: null,
	selectedDynamicNodeIds: [],
} as const;

function testRenderer(overrides: Partial<Renderer> = {}): Renderer {
	return {
		clearPresentation() {},
		retainDynamicAppearance: () => () => {},
		async destroy() {},
		drawFrame: () => EMPTY_RENDERER_FRAME_FEEDBACK,
		drawPortalTransitionFrame: () => null,
		...overrides,
	};
}

describe("GamePresentationRuntime view and interest control", () => {
	it("keeps frontend scene interest independent from the primary camera", async () => {
		const requestedLayers: LandblockIdLayer[] = [];
		const frames: Parameters<Renderer["drawFrame"]>[0][] = [];
		const frameSelectionMetrics: FrameSelectionMetrics = {
			ambientOcclusion: {
				activeBytes: 0,
				allocatedGenerationCount: 0,
				pixelCount: 0,
				tileCount: 0,
				disposedGenerationCount: 0,
				effectiveDistanceFade: null,
			},
			entitySelection: {
				activeMaskBytes: 0,
				allocatedTargetGenerationCount: 0,
				compositeDrawCount: 0,
				disposedTargetGenerationCount: 0,
				maskDrawCount: 0,
				selectedSphereProxyCount: 0,
				selectedPartCount: 0,
				selectedTriangleCount: 0,
				skippedReason: "no-target",
			},
			envCellRenderMode: "portal",
			envCellShellCullOverrideCount: 0,
			portalSelectedScopeCount: 0,
			portalSelectedCrossingCount: 0,
			portalCompletedCullDepth: 0,
			portalPropagationDrawCount: 0,
			portalProjectionPrimitiveCount: 0,
			portalAtlasTilePixelCount: 0,
			portalFrontierRetreatCount: 0,
			portalTruncatedViewCount: 0,
			portalFramebufferCount: 0,
			portalTargetBytes: 0,
			portalTransitionSnapshotBytes: 0,
			portalTransitionOriginCaptured: false,
			portalTransitionSnapshotAllocatedGenerationCount: 0,
			portalTransitionSnapshotDisposedGenerationCount: 0,
			portalTransitionFramebufferCount: 0,
			portalTransitionTargetBytes: 0,
			submittedPortalTransitionDrawCount: 0,
			portalTransitionVisualInstalled: false,
			portalTransitionGeneration: null,
			portalTransitionKind: null,
			portalTransitionOnlyFramePresented: false,
			flatSceneFramebufferCount: 0,
			flatSceneTargetBytes: 0,
			flatSceneAllocatedGenerationCount: 0,
			flatSceneDisposedGenerationCount: 0,
			submittedEnvCellResidentDrawCount: 0,
			submittedEnvCellResidentTriangleCount: 0,
			submittedEnvCellShellDrawCount: 0,
			submittedEnvCellShellTriangleCount: 0,
			terrainFrameInputs: 2,
			viewCount: 1,
			visibleDynamicEntityCount: 3,
			visibleDynamicSourceRangeCount: 0,
			testedObjectPresentationCount: 0,
			retainedObjectPresentationCount: 0,
			rejectedObjectPresentationCount: 0,
			visibleEnvCellResidentNodes: 0,
			visibleEnvCellScopeCount: 0,
			visibleEnvCellShells: 5,
			visibleSceneEntries: 11,
			visibleStaticLayerCount: 3,
			visibleStaticNodeCount: 13,
			submittedStaticObjectDrawCount: 0,
			submittedStaticObjectTriangleCount: 0,
			submittedBakedStaticObjectDrawCount: 0,
			submittedBakedStaticObjectTriangleCount: 0,
			submittedInstancedSourceTriangleCount: 0,
			transparentObjectCandidateCount: 0,
			farTransparentObjectCandidateCount: 0,
			nearTransparentObjectCandidateCount: 0,
			transparentFrameRunCount: 0,
			farTransparentFrameRunCount: 0,
			nearTransparentFrameRunCount: 0,
			frameInstanceUploadCount: 0,
			frameInstanceUploadBytes: 0,
			submittedTransparentObjectDrawCount: 0,
			submittedTransparentInstanceCount: 0,
			submittedAdditiveObjectDrawCount: 0,
			submittedDynamicDrawCount: 0,
			submittedParticleBatchCount: 0,
			submittedParticleInstanceCount: 0,
			unresolvedParticleBatchCount: 0,
			frameInstanceCapacity: 0,
			frameInstanceGrowthCount: 0,
			frameInstanceViewHighWaterMark: 0,
			objectProgramChanges: 0,
			droppedLights: 0,
			staticLightBinds: 0,
			terrainLightMaskUploads: 0,
			farTerrainDraws: 0,
			farTerrainPaletteUploads: 0,
			farTerrainCutoffLandblocks: null,
			objectLightingBinds: 0,
			objectTextureBinds: 0,
			objectDrawCalls: 0,
			objectUniformUploads: 0,
			objectSuppressedUniformUploads: 0,
		};
		const setFrameProfilingEnabled = vi.fn();
		const renderer = testRenderer({
			drawFrame(input) {
				frames.push(input);
				return EMPTY_RENDERER_FRAME_FEEDBACK;
			},
			frameDiagnostics: {
				captureBakedDrawMergeCensus: vi.fn(),
				setProfilingEnabled: setFrameProfilingEnabled,
				resetProfile: vi.fn(),
				snapshot: () => ({
					dynamicResources: {
						appearances: { indexBytes: 0, materialBytes: 0 },
						poses: { allocatedBytes: 0, uploadedBytes: 0 },
					},
					compiledObjectDraws: null,
					entityShadows: {
						outdoorTargets: {
							activeBytes: 0,
							activeFramebufferCount: 0,
							activeTextureCount: 0,
							allocatedGenerationCount: 0,
							cascadeCount: null,
							disposedGenerationCount: 0,
							resolution: null,
						},
					},
					nameplates: {
						budgetRejectedCandidateCount: 0,
						cache: {
							byteCount: 0,
							hitCount: 0,
							liveEntryCount: 0,
							missCount: 0,
							rasterizationCount: 0,
							rejectedRasterCount: 0,
							releaseCount: 0,
						},
						eligibleCandidateCount: 0,
						submittedDrawCount: 0,
						submittedInstanceCount: 0,
					},
					profile: null,
					profilingEnabled: false,
					selectionMetrics: frameSelectionMetrics,
				}),
			},
		});
		const pipeline: CommitPipeline = {
			async prepareLandblockLayers(
				layers,
			): Promise<readonly LandblockLayerCommit[]> {
				requestedLayers.push(...layers);
				return [];
			},
		};
		const device: GamePresentationRuntimeRenderDevice = {
			buildRenderer: async () => renderer,
			resources: TEST_RESOURCES,
		};
		const runtime = await buildGamePresentationRuntimeForTest(
			device,
			pipeline,
			{} as TexturePixelSource,
			ANIMATION_SOURCE,
			PHYSICS_SCRIPT_SOURCE,
			// No runtime test triggers authored audio; a refusing device keeps that visible.
			{ playOneShot: () => null, prepare: async () => {} },
			PARTICLE_EMITTER_SOURCE,
			SOUND_TABLE_SOURCE,
			PARTICLE_MESH_SOURCE,
			null,
		);

		runtime.updateSceneInterest({
			ambientOutdoorEnvCellOwners: new Set(),
			target: {
				kind: "outdoor",
				requested: { kind: "outdoor", landblockId: "0x1010ffff" },
			},
			radii: {
				buildingRadius: null,
				envCellRadius: null,
				explicitObjectRadius: null,
				generatedObjectRadius: null,
				terrainRadius: 0,
			},
		});
		setTestCamera(runtime, {
			far: 800,
			fov: 90,
			near: 0.5,
			placement: {
				envCellId: null,
				landblockId: "0x2020ffff",
				position: sceneVec3(
					createLandblockWorldOrigin("0x2020ffff").add(new Vec3(10, 40, -20)),
				),
				rotation: Quat.identity(),
			},
		});
		runtime.frame(1);
		await Promise.resolve();

		expect(requestedLayers).toEqual([{ id: "0x1010ffff", layer: "terrain" }]);
		expect(frames[0]?.anchorLandblockId).toBe("0x2020ffff");
		expect(frames[0]?.extent).toEqual({ height: 480, width: 640 });
		expect(frames[0]?.frameSettings).toEqual(SHARED_FRAME_SETTINGS);
		runtime.setFrameSettings({
			layerVisibility: SHARED_FRAME_SETTINGS.layerVisibility,
			showRetailHiddenGeometry: false,
			nameplates: SHARED_FRAME_SETTINGS.nameplates,
			ambientOcclusion: {
				...SHARED_FRAME_SETTINGS.ambientOcclusion,
				enabled: true,
				parameters: {
					...SHARED_FRAME_SETTINGS.ambientOcclusion.parameters,
					intensity: 2,
				},
			},
			colorGrade: SHARED_FRAME_SETTINGS.colorGrade,
			entityShadows: SHARED_FRAME_SETTINGS.entityShadows,
			entitySelectionOutline: SHARED_FRAME_SETTINGS.entitySelectionOutline,
			distanceFogEnabled: false,
			viewerLightEnabled: false,
			weatherEnabled: true,
			staticLightsEnabled: true,
			envCellRenderMode: "flat",
			quality: {
				minimumObjectFootprintCssPixelArea: 8,
				minimumPortalFootprintCssPixelArea: 4,
				renderScale: SHARED_FRAME_SETTINGS.quality.renderScale,
				textureFiltering: "nearest",
			},
		});
		runtime.render(2);
		expect(frames[1]?.frameSettings).toEqual({
			layerVisibility: SHARED_FRAME_SETTINGS.layerVisibility,
			showRetailHiddenGeometry: false,
			nameplates: SHARED_FRAME_SETTINGS.nameplates,
			ambientOcclusion: {
				...SHARED_FRAME_SETTINGS.ambientOcclusion,
				enabled: true,
				parameters: {
					...SHARED_FRAME_SETTINGS.ambientOcclusion.parameters,
					intensity: 2,
				},
			},
			colorGrade: SHARED_FRAME_SETTINGS.colorGrade,
			entityShadows: SHARED_FRAME_SETTINGS.entityShadows,
			entitySelectionOutline: SHARED_FRAME_SETTINGS.entitySelectionOutline,
			distanceFogEnabled: false,
			viewerLightEnabled: false,
			weatherEnabled: true,
			staticLightsEnabled: true,
			envCellRenderMode: "flat",
			quality: {
				minimumObjectFootprintCssPixelArea: 8,
				minimumPortalFootprintCssPixelArea: 4,
				renderScale: SHARED_FRAME_SETTINGS.quality.renderScale,
				textureFiltering: "nearest",
			},
		});
		expect(runtime.getRendererFrameDiagnostics()).toEqual({
			dynamicResources: {
				appearances: { indexBytes: 0, materialBytes: 0 },
				poses: { allocatedBytes: 0, uploadedBytes: 0 },
			},
			compiledObjectDraws: null,
			entityShadows: {
				outdoorTargets: {
					activeBytes: 0,
					activeFramebufferCount: 0,
					activeTextureCount: 0,
					allocatedGenerationCount: 0,
					cascadeCount: null,
					disposedGenerationCount: 0,
					resolution: null,
				},
			},
			nameplates: {
				budgetRejectedCandidateCount: 0,
				cache: {
					byteCount: 0,
					hitCount: 0,
					liveEntryCount: 0,
					missCount: 0,
					rasterizationCount: 0,
					rejectedRasterCount: 0,
					releaseCount: 0,
				},
				eligibleCandidateCount: 0,
				submittedDrawCount: 0,
				submittedInstanceCount: 0,
			},
			profile: null,
			profilingEnabled: false,
			selectionMetrics: frameSelectionMetrics,
		});
		runtime.setRendererFrameProfilingEnabled(true);
		expect(setFrameProfilingEnabled).toHaveBeenCalledWith(true);
		const queriedPoint = createLandblockWorldOrigin("0x0102ffff").add(
			new Vec3(1, 10, -1),
		);
		expect(runtime.queryWorldPointResidencyCandidates(queriedPoint)).toEqual({
			envCells: [],
			outdoor: {
				envCellId: null,
				landblockId: "0x0102ffff",
			},
		});
		expect(() =>
			setTestCamera(runtime, {
				far: 800,
				fov: 90,
				near: 0.5,
				placement: {
					envCellId: null,
					landblockId: "0x2020ffff",
					position: sceneVec3(new Vec3(Number.NaN, 0, 0)),
					rotation: Quat.identity(),
				},
			}),
		).toThrow("must be finite");

		await runtime.destroy();
	});

	it("discards a terrain commit whose scene interest was withdrawn while loading", async () => {
		const pipeline = new DeferredCommitPipeline();
		const device: GamePresentationRuntimeRenderDevice = {
			buildRenderer: async () => testRenderer(),
			resources: TEST_RESOURCES,
		};
		const runtime = await buildGamePresentationRuntimeForTest(
			device,
			pipeline,
			{} as TexturePixelSource,
			ANIMATION_SOURCE,
			PHYSICS_SCRIPT_SOURCE,
			// No runtime test triggers authored audio; a refusing device keeps that visible.
			{ playOneShot: () => null, prepare: async () => {} },
			PARTICLE_EMITTER_SOURCE,
			SOUND_TABLE_SOURCE,
			PARTICLE_MESH_SOURCE,
			null,
		);

		runtime.updateSceneInterest(sceneInterest("0x1010ffff"));
		runtime.updateSceneInterest(sceneInterest("0x2020ffff"));
		pipeline.resolveNext([staleTerrainArtifact("0x1010ffff")]);
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(() => runtime.tick()).not.toThrow();

		await runtime.destroy();
	});

	it("keeps an in-flight layer current across an unchanged interest refresh", async () => {
		const pipeline = new DeferredCommitPipeline();
		const device: GamePresentationRuntimeRenderDevice = {
			buildRenderer: async () => testRenderer(),
			resources: TEST_RESOURCES,
		};
		const runtime = await buildGamePresentationRuntimeForTest(
			device,
			pipeline,
			{} as TexturePixelSource,
			ANIMATION_SOURCE,
			PHYSICS_SCRIPT_SOURCE,
			// No runtime test triggers authored audio; a refusing device keeps that visible.
			{ playOneShot: () => null, prepare: async () => {} },
			PARTICLE_EMITTER_SOURCE,
			SOUND_TABLE_SOURCE,
			PARTICLE_MESH_SOURCE,
			null,
		);
		const events: SceneAvailabilityEvent[] = [];
		const unsubscribe = runtime.subscribeSceneAvailability((event) =>
			events.push(event),
		);

		const first = runtime.updateSceneInterest(sceneInterest("0x1010ffff"));
		runtime.updateSceneInterest(sceneInterest("0x1010ffff"));
		pipeline.resolveNext([]);
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(events).toEqual([
			{
				kind: "scene-content-unavailable",
				layer: LandblockLayerKind.Terrain,
				residency: { envCellId: null, landblockId: "0x1010ffff" },
				revision: first.revision,
			},
		]);

		unsubscribe();
		await runtime.destroy();
	});

	it("rejects an old completion after withdrawal and same-layer re-request", async () => {
		const pipeline = new DeferredCommitPipeline();
		const device: GamePresentationRuntimeRenderDevice = {
			buildRenderer: async () => testRenderer(),
			resources: TEST_RESOURCES,
		};
		const runtime = await buildGamePresentationRuntimeForTest(
			device,
			pipeline,
			{} as TexturePixelSource,
			ANIMATION_SOURCE,
			PHYSICS_SCRIPT_SOURCE,
			// No runtime test triggers authored audio; a refusing device keeps that visible.
			{ playOneShot: () => null, prepare: async () => {} },
			PARTICLE_EMITTER_SOURCE,
			SOUND_TABLE_SOURCE,
			PARTICLE_MESH_SOURCE,
			null,
		);
		const events: SceneAvailabilityEvent[] = [];
		const unsubscribe = runtime.subscribeSceneAvailability((event) =>
			events.push(event),
		);

		runtime.updateSceneInterest(sceneInterest("0x1010ffff"));
		runtime.clearSceneInterest();
		const current = runtime.updateSceneInterest(sceneInterest("0x1010ffff"));
		pipeline.resolveNext([]);
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(events).toEqual([]);
		pipeline.resolveNext([]);
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(events).toHaveLength(1);
		expect(events[0]?.revision).toBe(current.revision);

		unsubscribe();
		await runtime.destroy();
	});

	it("rejects a queued completion after withdrawal and same-layer re-request", async () => {
		const pipeline = new DeferredCommitPipeline();
		const device: GamePresentationRuntimeRenderDevice = {
			buildRenderer: async () => testRenderer(),
			resources: TEST_RESOURCES,
		};
		const runtime = await buildGamePresentationRuntimeForTest(
			device,
			pipeline,
			{} as TexturePixelSource,
			ANIMATION_SOURCE,
			PHYSICS_SCRIPT_SOURCE,
			// No runtime test triggers authored audio; a refusing device keeps that visible.
			{ playOneShot: () => null, prepare: async () => {} },
			PARTICLE_EMITTER_SOURCE,
			SOUND_TABLE_SOURCE,
			PARTICLE_MESH_SOURCE,
			null,
		);

		runtime.updateSceneInterest(sceneInterest("0x1010ffff"));
		pipeline.resolveNext([staleTerrainArtifact("0x1010ffff")]);
		await new Promise((resolve) => setTimeout(resolve, 0));
		runtime.clearSceneInterest();
		runtime.updateSceneInterest(sceneInterest("0x1010ffff"));

		expect(() => runtime.tick()).not.toThrow();

		await runtime.destroy();
	});

	it("activates a promoted building owner set with shared playback", async () => {
		const pipeline = new DeferredCommitPipeline();
		const device: GamePresentationRuntimeRenderDevice = {
			buildRenderer: async () => testRenderer(),
			resources: TEST_RESOURCES,
		};
		const runtime = await buildGamePresentationRuntimeForTest(
			device,
			pipeline,
			{} as TexturePixelSource,
			ANIMATION_SOURCE,
			PHYSICS_SCRIPT_SOURCE,
			// No runtime test triggers authored audio; a refusing device keeps that visible.
			{ playOneShot: () => null, prepare: async () => {} },
			PARTICLE_EMITTER_SOURCE,
			SOUND_TABLE_SOURCE,
			PARTICLE_MESH_SOURCE,
			null,
		);

		runtime.updateSceneInterest(buildingSceneInterest("0xda55ffff"));
		pipeline.resolveNext([promotedBuildingArtifact("0xda55ffff")]);
		await new Promise((resolve) => setTimeout(resolve, 0));
		runtime.tick();
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(runtime.getAuthoredDynamicResidentDiagnostics()).toEqual([
			{
				defaultAnimationId: "0x03000001",
				landblockId: "0xda55ffff",
				layer: LandblockLayerKind.Buildings,
				blockingHooks: [],
				presentationMode: "animated",
				residentId: "resident:promoted",
				setupSourceId: "0x02000001",
			},
		]);
		expect(runtime.getStaticObjectRuntimeDiagnostics().layers).toEqual([
			expect.objectContaining({
				cullingGroup: LandblockLayerKind.Buildings,
				expectedResidentCount: 1,
				landblockId: "0xda55ffff",
				promotedDynamicResidentCount: 1,
				runtimeDynamicResidentCount: 1,
				staticArtifactInstalled: false,
			}),
		]);

		await runtime.destroy();
	});

	it("keeps promoted authored script scale in the browser effect domain", async () => {
		const scriptId = "0x33000002" as DatAssetId;
		const pipeline = new DeferredCommitPipeline();
		const runtime = await buildGamePresentationRuntimeForTest(
			{
				buildRenderer: async () => testRenderer(),
				resources: TEST_RESOURCES,
			},
			pipeline,
			{} as TexturePixelSource,
			ANIMATION_SOURCE,
			scalePhysicsScriptSource(scriptId, 2),
			{ playOneShot: () => null, prepare: async () => {} },
			PARTICLE_EMITTER_SOURCE,
			SOUND_TABLE_SOURCE,
			PARTICLE_MESH_SOURCE,
			null,
		);
		runtime.updateSceneInterest(buildingSceneInterest("0xda55ffff"));
		pipeline.resolveNext([promotedBuildingArtifact("0xda55ffff", scriptId)]);
		await new Promise((resolve) => setTimeout(resolve, 0));
		runtime.tick();
		await new Promise((resolve) => setTimeout(resolve, 0));
		setTestCamera(runtime, SPAWN_TEST_CAMERA);

		runtime.render(0);

		const diagnostics = runtime.getAuthoredDynamicRuntimeDiagnostics();
		expect(diagnostics.behavior.outcomeCounts).toEqual({ executed: 1 });
		expect(diagnostics.worldScaleBehavior.outcomeCounts).toEqual({});
		expect(diagnostics.effects.appliedCommandCount).toBe(1);
		expect(diagnostics.physicsScripts.activeOwnerCount).toBe(1);
		expect(diagnostics.worldScalePhysicsScripts.activeOwnerCount).toBe(0);
		await runtime.destroy();
	});

	it("routes a synthetic explicit-object source through static realization", async () => {
		const pipeline = new DeferredCommitPipeline();
		const device: GamePresentationRuntimeRenderDevice = {
			buildRenderer: async () => testRenderer(),
			resources: TEST_RESOURCES,
		};
		const runtime = await buildGamePresentationRuntimeForTest(
			device,
			pipeline,
			{} as TexturePixelSource,
			ANIMATION_SOURCE,
			PHYSICS_SCRIPT_SOURCE,
			// No runtime test triggers authored audio; a refusing device keeps that visible.
			{ playOneShot: () => null, prepare: async () => {} },
			PARTICLE_EMITTER_SOURCE,
			SOUND_TABLE_SOURCE,
			PARTICLE_MESH_SOURCE,
			null,
		);
		const availability: SceneAvailabilityEvent[] = [];
		runtime.subscribeSceneAvailability((event) => availability.push(event));

		runtime.updateSceneInterest(objectSceneInterest("0xda55ffff"));
		pipeline.resolveNext([promotedObjectArtifact("0xda55ffff")]);
		await new Promise((resolve) => setTimeout(resolve, 0));
		runtime.tick();
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(runtime.getAuthoredDynamicResidentDiagnostics()).toEqual([
			expect.objectContaining({
				landblockId: "0xda55ffff",
				layer: LandblockLayerKind.Objects,
				residentId: "resident:promoted",
			}),
		]);
		expect(runtime.getStaticObjectRuntimeDiagnostics().layers).toEqual([
			expect.objectContaining({
				cullingGroup: LandblockLayerKind.Objects,
				sceneNodeCount: 1,
			}),
		]);
		expect(availability).not.toContainEqual(
			expect.objectContaining({ kind: "scene-content-failed" }),
		);

		await runtime.destroy();
	});

	it("routes generated source through independent static realization", async () => {
		const pipeline = new DeferredCommitPipeline();
		const device: GamePresentationRuntimeRenderDevice = {
			buildRenderer: async () => testRenderer(),
			resources: TEST_RESOURCES,
		};
		const runtime = await buildGamePresentationRuntimeForTest(
			device,
			pipeline,
			{} as TexturePixelSource,
			ANIMATION_SOURCE,
			PHYSICS_SCRIPT_SOURCE,
			// No runtime test triggers authored audio; a refusing device keeps that visible.
			{ playOneShot: () => null, prepare: async () => {} },
			PARTICLE_EMITTER_SOURCE,
			SOUND_TABLE_SOURCE,
			PARTICLE_MESH_SOURCE,
			null,
		);
		const availability: SceneAvailabilityEvent[] = [];
		runtime.subscribeSceneAvailability((event) => availability.push(event));

		runtime.updateSceneInterest(generatedSceneInterest("0xda55ffff"));
		pipeline.resolveNext([promotedGeneratedArtifact("0xda55ffff")]);
		await new Promise((resolve) => setTimeout(resolve, 0));
		runtime.tick();
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(runtime.getAuthoredDynamicResidentDiagnostics()).toEqual([
			expect.objectContaining({
				landblockId: "0xda55ffff",
				layer: LandblockLayerKind.Generated,
				residentId: "resident:promoted",
			}),
		]);
		expect(runtime.getStaticObjectRuntimeDiagnostics().layers).toEqual([
			expect.objectContaining({
				cullingGroup: LandblockLayerKind.Generated,
				layer: LandblockLayerKind.Generated,
				sceneNodeCount: 1,
			}),
		]);
		expect(availability).not.toContainEqual(
			expect.objectContaining({ kind: "scene-content-failed" }),
		);

		await runtime.destroy();
	});
});

describe("GamePresentationRuntime dynamic-entity presentation", () => {
	it("resolves and executes a live script cue for the installed generation", async () => {
		const tableId = "0x34000001" as DatAssetId;
		const scriptId = "0x33000001" as DatAssetId;
		const runtime = await buildSpawnRuntime(
			{ load: async () => spawnedVisual() },
			ANIMATION_SOURCE,
			undefined,
			scalePhysicsScriptSource(scriptId, 2),
			{
				destroy() {},
				async loadPhysicsScriptTable(requestedId) {
					if (requestedId !== tableId)
						throw new Error(`Unexpected PhysicsScriptTable ${requestedId}.`);
					return {
						id: tableId,
						cues: new Map([[7, [{ maximumIntensity: 1, scriptId }]]]),
					};
				},
			},
		);
		const baseEntity = spawnedEntity(7, 3);
		runtime.playDynamicEntityScriptCue({
			guid: 7,
			generation: 3,
			cue: 7,
			intensity: 0.5,
		});
		await runtime.replaceDynamicEntitySnapshot([
			{
				...baseEntity,
				presentation: {
					...baseEntity.presentation,
					content: {
						...baseEntity.presentation.content,
						physicsEffectTableDid: Number.parseInt(tableId.slice(2), 16),
					},
				},
			},
		]);
		await vi.waitFor(() =>
			expect(
				runtime.getAuthoredDynamicRuntimeDiagnostics().worldScalePhysicsScripts
					.activeOwnerCount,
			).toBe(1),
		);
		setTestCamera(runtime, SPAWN_TEST_CAMERA);

		runtime.render(0);

		expect(
			runtime.getAuthoredDynamicRuntimeDiagnostics().worldScaleBehavior
				.outcomeCounts,
		).toEqual({ "owned-by-world": 1 });
		await runtime.destroy();
	});

	it("prepares live cues in server order for one entity", async () => {
		const tableId = "0x34000001" as DatAssetId;
		const firstScriptId = "0x33000001" as DatAssetId;
		const secondScriptId = "0x33000002" as DatAssetId;
		const firstScript =
			controlledPromise<
				Awaited<ReturnType<PhysicsScriptSource["loadPhysicsScript"]>>
			>();
		const requestedScripts: DatAssetId[] = [];
		const runtime = await buildSpawnRuntime(
			{ load: async () => spawnedVisual() },
			ANIMATION_SOURCE,
			undefined,
			{
				destroy() {},
				async loadPhysicsScript(scriptId) {
					requestedScripts.push(scriptId);
					if (scriptId === firstScriptId) return firstScript.promise;
					if (scriptId !== secondScriptId)
						throw new Error(`Unexpected physics script ${scriptId}.`);
					return { id: scriptId, lengthSeconds: 0, records: [] };
				},
			},
			{
				destroy() {},
				async loadPhysicsScriptTable() {
					return {
						id: tableId,
						cues: new Map([
							[7, [{ maximumIntensity: 1, scriptId: firstScriptId }]],
							[8, [{ maximumIntensity: 1, scriptId: secondScriptId }]],
						]),
					};
				},
			},
		);
		const baseEntity = spawnedEntity(7, 3);
		await runtime.replaceDynamicEntitySnapshot([
			{
				...baseEntity,
				presentation: {
					...baseEntity.presentation,
					content: {
						...baseEntity.presentation.content,
						physicsEffectTableDid: Number.parseInt(tableId.slice(2), 16),
					},
				},
			},
		]);

		runtime.playDynamicEntityScriptCue({
			guid: 7,
			generation: 3,
			cue: 7,
			intensity: 0.5,
		});
		runtime.playDynamicEntityScriptCue({
			guid: 7,
			generation: 3,
			cue: 8,
			intensity: 0.5,
		});
		await vi.waitFor(() => expect(requestedScripts).toEqual([firstScriptId]));
		firstScript.resolve({
			id: firstScriptId,
			lengthSeconds: 0,
			records: [],
		});
		await vi.waitFor(() =>
			expect(requestedScripts).toEqual([firstScriptId, secondScriptId]),
		);

		await runtime.destroy();
	});

	it("releases a live-cue closure that finishes after generation replacement", async () => {
		const tableId = "0x34000001" as DatAssetId;
		const scriptId = "0x33000001" as DatAssetId;
		const delayedScript =
			controlledPromise<
				Awaited<ReturnType<PhysicsScriptSource["loadPhysicsScript"]>>
			>();
		let scriptRequested = false;
		const runtime = await buildSpawnRuntime(
			{ load: async () => spawnedVisual() },
			ANIMATION_SOURCE,
			undefined,
			{
				destroy() {},
				loadPhysicsScript: () => {
					scriptRequested = true;
					return delayedScript.promise;
				},
			},
			{
				destroy() {},
				async loadPhysicsScriptTable() {
					return {
						id: tableId,
						cues: new Map([[7, [{ maximumIntensity: 1, scriptId }]]]),
					};
				},
			},
		);
		const withTable = (generation: number): DynamicEntityView => {
			const entity = spawnedEntity(7, generation);
			return {
				...entity,
				presentation: {
					...entity.presentation,
					content: {
						...entity.presentation.content,
						physicsEffectTableDid: Number.parseInt(tableId.slice(2), 16),
					},
				},
			};
		};
		await runtime.replaceDynamicEntitySnapshot([withTable(3)]);
		runtime.playDynamicEntityScriptCue({
			guid: 7,
			generation: 3,
			cue: 7,
			intensity: 0.5,
		});
		await vi.waitFor(() => expect(scriptRequested).toBe(true));
		await runtime.replaceDynamicEntitySnapshot([withTable(4)]);
		delayedScript.resolve({ id: scriptId, lengthSeconds: 0, records: [] });
		await Promise.resolve();
		expect(
			runtime.getAuthoredDynamicRuntimeDiagnostics().worldScalePhysicsScripts
				.activeOwnerCount,
		).toBe(0);

		// Repository teardown rejects referenced closures, so this also proves the stale handle left.
		await runtime.destroy();
	});

	it.each([-1, 0])(
		"preserves a cue emitter on frame %s across part geometry replacement and retires it on setup replacement",
		async (partIndex) => {
			const tableId = "0x34000001" as DatAssetId;
			const scriptId = "0x33000001" as DatAssetId;
			const emitterId = "0x32000001" as DatAssetId;
			const meshId = "0x01000001" as DatAssetId;
			const delayedEmitter = controlledPromise<DecodedParticleEmitterInfo>();
			let emitterRequested = false;
			const runtime = await buildSpawnRuntime(
				{
					load: async (setup, appearance) => {
						const visual = appearanceVisual(
							appearance.paletteDid === 2 ? 2 : 1,
						);
						return {
							...visual,
							setupId: setup === 0x02000002 ? "0x02000002" : "0x02000001",
							presentation: {
								...visual.presentation,
								appearanceKey: `particle-appearance:${appearance.paletteDid}`,
							},
						};
					},
				},
				ANIMATION_SOURCE,
				undefined,
				{
					destroy() {},
					async loadPhysicsScript() {
						return {
							id: scriptId,
							lengthSeconds: 0,
							records: [
								{
									authoredOrder: 0,
									emitterId: 0,
									emitterInfoId: emitterId,
									kind: "create-particle" as const,
									offsetOrigin: acVector3([0, 0, 0]),
									partIndex,
									startTime: 0,
								},
							],
						};
					},
				},
				{
					destroy() {},
					async loadPhysicsScriptTable() {
						return {
							id: tableId,
							cues: new Map([[7, [{ maximumIntensity: 1, scriptId }]]]),
						};
					},
				},
				{
					destroy() {},
					loadParticleEmitter: () => {
						emitterRequested = true;
						return delayedEmitter.promise;
					},
				},
				{
					destroy() {},
					async loadParticleMeshes() {
						return {
							presentations: new Map([
								[
									meshId,
									{
										orientation: "authored" as const,
										presentation: spawnedVisual(),
									},
								],
							]),
							textureDependencies: [],
						};
					},
				},
			);
			const baseEntity = spawnedEntity(7, 3);
			await runtime.replaceDynamicEntitySnapshot([
				{
					...baseEntity,
					presentation: {
						...baseEntity.presentation,
						content: {
							...baseEntity.presentation.content,
							physicsEffectTableDid: Number.parseInt(tableId.slice(2), 16),
						},
					},
				},
			]);
			runtime.playDynamicEntityScriptCue({
				guid: 7,
				generation: 3,
				cue: 7,
				intensity: 0.5,
			});
			await vi.waitFor(() => expect(emitterRequested).toBe(true));
			expect(
				runtime.getAuthoredDynamicRuntimeDiagnostics().worldScalePhysicsScripts
					.activeOwnerCount,
			).toBe(0);
			delayedEmitter.resolve(particleEmitterInfo(emitterId, meshId));
			await vi.waitFor(() =>
				expect(
					runtime.getAuthoredDynamicRuntimeDiagnostics()
						.worldScalePhysicsScripts.activeOwnerCount,
				).toBe(1),
			);
			setTestCamera(runtime, SPAWN_TEST_CAMERA);

			runtime.render(0);

			expect(
				runtime.getAuthoredDynamicRuntimeDiagnostics().particles.emitterCount,
			).toBe(1);
			const current = [...runtime.listPresentedSpawnedEntities()][0]?.view;
			if (current === undefined)
				throw new Error("Emitter owner was not installed.");
			const changed = {
				...current,
				presentation: {
					...current.presentation,
					appearance: { ...current.presentation.appearance, paletteDid: 2 },
				},
			};
			await runtime.upsertDynamicEntity(changed);
			runtime.render(0.01);
			const replacedOwner = runtime.selectedEntityPresentationState(
				current.identity.guid,
			);
			if (replacedOwner.kind !== "realized")
				throw new Error(
					"Emitter owner disappeared during geometry replacement.",
				);
			expect(
				replacedOwner.frame.localBounds.max.x -
					replacedOwner.frame.localBounds.min.x,
			).toBeCloseTo(4);
			expect(
				runtime.getAuthoredDynamicRuntimeDiagnostics().particles.emitterCount,
			).toBe(1);
			changed.presentation.content = {
				...changed.presentation.content,
				setupDid: 0x02000002,
			};
			expect(await runtime.upsertDynamicEntity(changed)).toBe("installed");
			runtime.render(0.02);
			expect(
				runtime.getAuthoredDynamicRuntimeDiagnostics().particles.emitterCount,
			).toBe(0);
			await runtime.destroy();
		},
	);

	it("keeps spawned-entity script scale world-owned at the composition seam", async () => {
		const scriptId = "0x33000001" as DatAssetId;
		const visual = spawnedVisual();
		const scriptedVisual: DecodedStaticPresentation = {
			...visual,
			behavior: {
				animationId: "0x03000001" as DatAssetId,
				kind: "animation-and-script",
				motionTableId: null,
				physicsScriptId: scriptId,
				physicsScriptTableId: null,
				soundTableId: null,
			},
		};
		const runtime = await buildSpawnRuntime(
			{ load: async () => scriptedVisual },
			ANIMATION_SOURCE,
			undefined,
			scalePhysicsScriptSource(scriptId, 8),
		);
		const baseEntity = spawnedEntity(7, 1);
		const entity: DynamicEntityView = {
			...baseEntity,
			presentation: { ...baseEntity.presentation, objectScale: 3 },
		};
		await runtime.replaceDynamicEntitySnapshot([entity]);
		setTestCamera(runtime, SPAWN_TEST_CAMERA);

		runtime.render(0);

		const diagnostics = runtime.getAuthoredDynamicRuntimeDiagnostics();
		expect(diagnostics.worldScaleBehavior.outcomeCounts).toEqual({
			"owned-by-world": 1,
		});
		expect(diagnostics.behavior.outcomeCounts).toEqual({});
		expect(diagnostics.effects.appliedCommandCount).toBe(0);
		expect(diagnostics.worldScalePhysicsScripts.activeOwnerCount).toBe(1);
		expect(diagnostics.physicsScripts.activeOwnerCount).toBe(0);
		await runtime.destroy();
	});

	it("publishes the installed generation identity of the viewer-driven entity", async () => {
		const frames: FrameInput[] = [];
		const runtime = await buildSpawnRuntime(
			{ load: async () => spawnedVisual() },
			ANIMATION_SOURCE,
			testRenderer({
				drawFrame(input) {
					frames.push(input);
					return EMPTY_RENDERER_FRAME_FEEDBACK;
				},
			}),
		);
		await runtime.replaceDynamicEntitySnapshot([spawnedEntity(7, 3)]);
		runtime.setViewerEntity(7);
		setTestCamera(runtime, {
			far: 800,
			fov: 90,
			near: 0.5,
			placement: {
				envCellId: null,
				landblockId: "0x0001ffff",
				position: sceneVec3(createLandblockWorldOrigin("0x0001ffff")),
				rotation: Quat.identity(),
			},
		});

		runtime.render(1);
		expect(frames.at(-1)?.viewerEntityIdentity).toBe(
			"dynamic-entity:0x00000007/3",
		);

		runtime.setViewerEntity(null);
		runtime.render(2);
		expect(frames.at(-1)?.viewerEntityIdentity).toBeNull();
		await runtime.destroy();
	});

	it("resolves the selected GUID to its current installed node at draw time", async () => {
		const frames: FrameInput[] = [];
		const runtime = await buildSpawnRuntime(
			{ load: async () => spawnedVisual() },
			ANIMATION_SOURCE,
			testRenderer({
				drawFrame(input) {
					frames.push(input);
					return EMPTY_RENDERER_FRAME_FEEDBACK;
				},
			}),
		);
		const portalBase = spawnedEntity(8, 3);
		const portal = {
			...portalBase,
			presentation: {
				...portalBase.presentation,
				entityClass: "portal" as const,
			},
		};
		await runtime.replaceDynamicEntitySnapshot([spawnedEntity(7, 3)]);
		setTestCamera(runtime, SPAWN_TEST_CAMERA);
		runtime.setSelectedEntityGuid(7);
		expect(runtime.selectedEntityPresentationState(7).kind).toBe("realized");

		runtime.render(1);
		expect(frames.at(-1)?.selectionTarget?.shape).toEqual({ kind: "rigid" });
		await runtime.replaceDynamicEntitySnapshot([portal]);
		runtime.setSelectedEntityGuid(8);
		expect(runtime.selectedEntityPresentationState(8).kind).toBe("realized");
		runtime.render(2);
		expect(frames.at(-1)?.selectionTarget?.shape).toEqual({ kind: "rigid" });

		runtime.setSelectedEntityGuid(null);
		runtime.render(3);
		expect(frames.at(-1)?.selectionTarget).toBeNull();
		await runtime.destroy();
	});

	it("applies path-stable tick updates without mutating scene placement", async () => {
		const runtime = await buildSpawnRuntime({
			load: async () => spawnedVisual(),
		});
		const initial = spawnedEntity(7, 1);
		await runtime.replaceDynamicEntitySnapshot([initial]);
		const placementRevision = runtime.dynamicEntityPlacementRevision;
		const updated = spawnedEntity(7, 1);
		if (updated.placement.kind !== "world")
			throw new Error("Update fixture lost world placement.");
		updated.placement.contact = "grounded";

		runtime.applyDynamicEntityTick(
			{
				hostTime: { seconds: 2 },
				durationMs: 30,
				advances: [],
				updates: [updated],
			},
			1_000,
		);
		expect(runtime.dynamicEntityPlacementRevision).toBe(placementRevision);

		const invalid = spawnedEntity(7, 1);
		if (invalid.placement.kind !== "world")
			throw new Error("Invalid update fixture lost world placement.");
		invalid.placement.pose.coords.x += 1;
		expect(() =>
			runtime.applyDynamicEntityTick(
				{
					hostTime: { seconds: 3 },
					durationMs: 30,
					advances: [],
					updates: [invalid],
				},
				1_030,
			),
		).toThrow("path-changing tick update");
		await runtime.destroy();
	});

	it("installs an outdoor player that also reaches an unloaded EnvCell", async () => {
		const landblockId = "0x0001ffff";
		const runtime = await buildGamePresentationRuntimeForTest(
			{
				buildRenderer: async () => testRenderer(),
				resources: TEST_RESOURCES,
			},
			{
				async prepareLandblockLayers(layers) {
					return [...layers].map(({ id: requested, layer }) => {
						if (layer !== LandblockLayerKind.Terrain)
							throw new Error(`Unexpected activation layer ${layer}.`);
						return terrainArtifact(requested);
					});
				},
			},
			new EchoTexturePixelSource(),
			ANIMATION_SOURCE,
			PHYSICS_SCRIPT_SOURCE,
			{ playOneShot: () => null, prepare: async () => {} },
			PARTICLE_EMITTER_SOURCE,
			SOUND_TABLE_SOURCE,
			PARTICLE_MESH_SOURCE,
			{ load: async () => spawnedVisual() },
		);
		const receipt = await runtime.activateScene({
			generation: 7,
			target: sceneInterest(landblockId),
		});
		await vi.waitFor(() => {
			runtime.tick();
			const status = runtime.sceneActivationStatus(receipt);
			if (status.kind === "failed") throw new Error(status.diagnostic);
			expect(status.kind).toBe("ready");
		});

		const player = spawnedEntity(7, 1);
		if (player.placement.kind !== "world")
			throw new Error("Player fixture lost world placement.");
		player.placement.spatialMembership = {
			reachesOutdoors: true,
			reachedEnvCellIds: [cellId(0x0001_0100)],
		};
		await runtime.replaceDynamicEntitySnapshot([player]);
		expect(runtime.dynamicEntityOrigin(player.identity.guid)?.landblockId).toBe(
			landblockId,
		);

		runtime.completeSceneActivation(receipt.generation);
		await runtime.replaceDynamicEntitySnapshot([player]);
		expect(runtime.dynamicEntityOrigin(player.identity.guid)?.landblockId).toBe(
			landblockId,
		);
		await runtime.destroy();
	});

	it("defers scope-blocked authority without treating it as deletion", async () => {
		let visualLoads = 0;
		const runtime = await buildSpawnRuntime({
			async load() {
				visualLoads += 1;
				return spawnedVisual();
			},
		});
		const player = spawnedEntity(7, 1);

		const initiallyInstalled = await runtime.replaceDynamicEntitySnapshot([
			player,
		]);
		expect(initiallyInstalled.get(player.identity.guid)).toBe("installed");
		expect(runtime.dynamicEntityOrigin(player.identity.guid)).not.toBeNull();
		runtime.setSelectedEntityGuid(player.identity.guid);
		expect(
			runtime.selectedEntityPresentationState(player.identity.guid).kind,
		).toBe("realized");

		await activateSpawnScene(runtime, "0x0002ffff", 2);
		const deferred = await runtime.replaceDynamicEntitySnapshot([player]);
		expect(deferred.get(player.identity.guid)).toBe("deferred");
		expect(runtime.dynamicEntityOrigin(player.identity.guid)).toBeNull();
		expect(
			runtime.selectedEntityPresentationState(player.identity.guid).kind,
		).toBe("frontend-evicted");

		await activateSpawnScene(runtime, "0x0001ffff", 3);
		const reinstalled = await runtime.replaceDynamicEntitySnapshot([player]);
		expect(reinstalled.get(player.identity.guid)).toBe("installed");
		expect(runtime.dynamicEntityOrigin(player.identity.guid)).not.toBeNull();
		expect(
			runtime.selectedEntityPresentationState(player.identity.guid).kind,
		).toBe("realized");
		expect(visualLoads).toBe(1);

		await runtime.replaceDynamicEntitySnapshot([]);
		expect(runtime.dynamicEntityOrigin(player.identity.guid)).toBeNull();
		await runtime.destroy();
	});

	/// The clip is a level on the view, not an edge on a tick. An entity realized asynchronously
	/// misses every transition that happened while its visual was decoding, so realization has to
	/// be able to ask what it is playing rather than wait to be told that it changed.
	it("plays the clip its view states when the entity is realized", async () => {
		const runtime = await buildSpawnRuntime(
			{ load: async () => spawnedVisual() },
			MOTION_TABLE_ANIMATION_SOURCE,
		);

		await runtime.replaceDynamicEntitySnapshot([
			motionDrivenEntity(1, {
				kind: "playing",
				animationId: Number(IDLE_ANIMATION_ID),
				completion: "loop",
				framerate: 4,
				highFrame: 0,
				lowFrame: 0,
			}),
		]);
		setTestCamera(runtime, SPAWN_TEST_CAMERA);
		runtime.render(0);

		expect(
			runtime.getAuthoredDynamicRuntimeDiagnostics().animation
				.activePlaybackCount,
		).toBe(1);
		await runtime.destroy();
	});

	/// The control for the test above: playback comes from the stated level and nothing else, so an
	/// entity stating none is realized silent rather than incidentally animated.
	it("realizes an entity stating no clip without any playback", async () => {
		const runtime = await buildSpawnRuntime(
			{ load: async () => spawnedVisual() },
			MOTION_TABLE_ANIMATION_SOURCE,
		);

		await runtime.replaceDynamicEntitySnapshot([motionDrivenEntity(1, null)]);
		setTestCamera(runtime, SPAWN_TEST_CAMERA);
		runtime.render(0);

		expect(
			runtime.getAuthoredDynamicRuntimeDiagnostics().animation
				.activePlaybackCount,
		).toBe(0);
		await runtime.destroy();
	});

	it.each(["palette", "texture", "part"] as const)(
		"replaces same-generation %s appearance without restarting placement or animation",
		async (kind) => {
			let loads = 0;
			const load = vi.fn(async () => appearanceVisual(loads++));
			const runtime = await buildSpawnRuntime({ load });
			const initial = spawnedEntity(7, 1);
			await runtime.upsertDynamicEntity(initial);
			const placementRevision = runtime.dynamicEntityPlacementRevision;
			const animationBefore =
				runtime.getAuthoredDynamicRuntimeDiagnostics().animation;
			const changed = spawnedEntity(7, 1);
			if (kind === "palette")
				changed.presentation.appearance.paletteDid = 0x04000002;
			if (kind === "texture")
				changed.presentation.appearance.textureChanges = [
					{
						partIndex: 0,
						oldTextureDid: 0x05000001,
						newTextureDid: 0x05000002,
					},
				];
			if (kind === "part")
				changed.presentation.appearance.partChanges = [
					{ partIndex: 0, gfxObjDid: 0x01000002 },
				];
			expect(await runtime.upsertDynamicEntity(changed)).toBe("installed");
			expect(load).toHaveBeenLastCalledWith(
				changed.presentation.content.setupDid,
				changed.presentation.appearance,
			);
			expect(runtime.dynamicEntityPlacementRevision).toBe(placementRevision);
			expect(runtime.getAuthoredDynamicRuntimeDiagnostics().animation).toEqual(
				animationBefore,
			);
			const selected = runtime.selectedEntityPresentationState(7);
			if (selected.kind !== "realized")
				throw new Error("Replacement lost its selected entity.");
			expect(selected.frame.localBounds.max.x).toBe(1);
			await runtime.destroy();
		},
	);

	it("keeps advancing animation in phase with an unchanged entity through appearance replacement", async () => {
		const runtime = await buildSpawnRuntime(
			{
				load: async (_setup, appearance) => {
					const visual = appearanceVisual(1);
					return {
						...visual,
						presentation: {
							...visual.presentation,
							appearanceKey: `animated:${appearance.paletteDid}`,
						},
					};
				},
			},
			{
				...ANIMATION_SOURCE,
				async loadAnimation(id) {
					const partFrames = Array.from({ length: 120 }, (_, index) => {
						const frame = Mat4.identity();
						frame.m41 = index;
						return frame;
					});
					return {
						id,
						frameCount: partFrames.length,
						partCount: 1,
						partFrames,
						positionFrames: [],
						hooks: [],
					};
				},
			},
		);
		await runtime.replaceDynamicEntitySnapshot([
			spawnedEntity(7, 1),
			spawnedEntity(8, 1),
		]);
		setTestCamera(runtime, SPAWN_TEST_CAMERA);
		const partX = (guid: number) => {
			const selected = runtime.selectedEntityPresentationState(guid);
			if (selected.kind !== "realized")
				throw new Error("Animated continuity fixture lost its entity.");
			return selected.frame.localBounds.min.x;
		};
		runtime.render(0);
		const initial = partX(7);
		const initialControl = partX(8);
		runtime.render(0.2);
		const before = partX(7);
		expect(before).toBeGreaterThan(initial);
		// Owners have deterministic, identity-derived start phases; compare their advancement.
		expect(before - initial).toBeCloseTo(partX(8) - initialControl);
		const changed = spawnedEntity(7, 1);
		changed.presentation.appearance.paletteDid = 2;
		expect(await runtime.upsertDynamicEntity(changed)).toBe("installed");
		expect(partX(7)).toBeCloseTo(before);
		runtime.render(0.4);
		expect(partX(7)).toBeGreaterThan(before);
		expect(partX(7) - initial).toBeCloseTo(partX(8) - initialControl);
		await runtime.destroy();
	});

	it("keeps A installed when an obsolete B request completes after A is requested again", async () => {
		const delayed = controlledPromise<DecodedStaticPresentation>();
		const load = vi.fn((_setup, appearance) =>
			appearance.paletteDid === 2
				? delayed.promise
				: Promise.resolve(appearanceVisual(0)),
		);
		const runtime = await buildSpawnRuntime({ load });
		const a = spawnedEntity(7, 1);
		await runtime.upsertDynamicEntity(a);
		const b = spawnedEntity(7, 1);
		b.presentation.appearance.paletteDid = 2;
		const stale = runtime.upsertDynamicEntity(b);
		expect(runtime.dynamicEntityOrigin(7)).not.toBeNull();
		expect(await runtime.upsertDynamicEntity(a)).toBe("installed");
		delayed.resolve(appearanceVisual(2));
		expect(await stale).toBe("deferred");
		expect(load).toHaveBeenCalledTimes(2);
		const selected = runtime.selectedEntityPresentationState(7);
		if (selected.kind !== "realized")
			throw new Error("A was lost during supersession.");
		expect(selected.frame.localBounds.max.x).toBe(0);
		await runtime.destroy();
	});

	it("retains the newest committed appearance when replacement loads finish in reverse order", async () => {
		const b = controlledPromise<DecodedStaticPresentation>();
		const c = controlledPromise<DecodedStaticPresentation>();
		const runtime = await buildSpawnRuntime({
			load: (_setup, appearance) => {
				if (appearance.paletteDid === 2) return b.promise;
				if (appearance.paletteDid === 3) return c.promise;
				return Promise.resolve(appearanceVisual(0));
			},
		});
		await runtime.upsertDynamicEntity(spawnedEntity(7, 1));
		const second = spawnedEntity(7, 1);
		second.presentation.appearance.paletteDid = 2;
		const third = spawnedEntity(7, 1);
		third.presentation.appearance.paletteDid = 3;
		const stale = runtime.upsertDynamicEntity(second);
		const current = runtime.upsertDynamicEntity(third);
		c.resolve(appearanceVisual(3));
		expect(await current).toBe("installed");
		b.resolve(appearanceVisual(2));
		expect(await stale).toBe("deferred");
		const selected = runtime.selectedEntityPresentationState(7);
		if (selected.kind !== "realized")
			throw new Error("Reversed completion removed the current appearance.");
		expect(selected.frame.localBounds.max.x).toBe(3);
		await runtime.destroy();
	});

	it("does not resurrect an entity deleted while its appearance is loading", async () => {
		const delayed = controlledPromise<DecodedStaticPresentation>();
		const runtime = await buildSpawnRuntime({
			load: (_setup, appearance) =>
				appearance.paletteDid === 2
					? delayed.promise
					: Promise.resolve(appearanceVisual(0)),
		});
		await runtime.upsertDynamicEntity(spawnedEntity(7, 1));
		const changed = spawnedEntity(7, 1);
		changed.presentation.appearance.paletteDid = 2;
		const pending = runtime.upsertDynamicEntity(changed);
		await runtime.replaceDynamicEntitySnapshot([]);
		delayed.resolve(appearanceVisual(2));
		expect(await pending).toBe("deferred");
		expect(runtime.dynamicEntityOrigin(7)).toBeNull();
		expect(
			runtime.getAuthoredDynamicRuntimeDiagnostics().dynamics.entityCount,
		).toBe(0);
		await runtime.destroy();
	});

	it("keeps an appearance request deferred if its residency is withdrawn while loading", async () => {
		const delayed = controlledPromise<DecodedStaticPresentation>();
		const runtime = await buildSpawnRuntime({
			load: (_setup, appearance) =>
				appearance.paletteDid === 2
					? delayed.promise
					: Promise.resolve(appearanceVisual(0)),
		});
		await runtime.upsertDynamicEntity(spawnedEntity(7, 1));
		const changed = spawnedEntity(7, 1);
		changed.presentation.appearance.paletteDid = 2;
		const pending = runtime.upsertDynamicEntity(changed);
		await activateSpawnScene(runtime, "0x0002ffff", 2);
		delayed.resolve(appearanceVisual(2));
		expect(await pending).toBe("deferred");
		expect(runtime.dynamicEntityOrigin(7)).toBeNull();
		await activateSpawnScene(runtime, "0x0001ffff", 3);
		await vi.waitFor(() => {
			runtime.tick();
			const selected = runtime.selectedEntityPresentationState(7);
			if (selected.kind !== "realized")
				throw new Error(
					"Returned residency has not realized its desired appearance.",
				);
			expect(selected.frame.localBounds.max.x).toBe(2);
		});
		await runtime.destroy();
	});

	it("does not report a failed requested appearance as installed merely because the old incarnation remains", async () => {
		const runtime = await buildSpawnRuntime({
			load: async (_setup, appearance) => {
				if (appearance.paletteDid === 2)
					throw new Error("replacement content unavailable");
				return appearanceVisual(0);
			},
		});
		await runtime.upsertDynamicEntity(spawnedEntity(7, 1));
		const changed = spawnedEntity(7, 1);
		changed.presentation.appearance.paletteDid = 2;
		await expect(runtime.upsertDynamicEntity(changed)).rejects.toThrow();
		expect(runtime.dynamicEntityOrigin(7)).not.toBeNull();
		await expect(
			runtime.reevaluateDynamicEntityEligibility(),
		).rejects.toThrow();
		const selected = runtime.selectedEntityPresentationState(7);
		if (selected.kind !== "realized")
			throw new Error("Failed replacement removed the previous visual.");
		expect(selected.frame.localBounds.max.x).toBe(0);
		await runtime.destroy();
	});

	it("accepts appearance changes delivered through tick updates", async () => {
		const runtime = await buildSpawnRuntime({
			load: async (_setup, appearance) =>
				appearanceVisual(appearance.paletteDid === 2 ? 2 : 0),
		});
		await runtime.upsertDynamicEntity(spawnedEntity(7, 1));
		const changed = spawnedEntity(7, 1);
		changed.presentation.appearance.paletteDid = 2;
		runtime.applyDynamicEntityTick(
			{
				hostTime: { seconds: 2 },
				durationMs: 30,
				advances: [],
				updates: [changed],
			},
			1000,
		);
		await vi.waitFor(() => {
			const selected = runtime.selectedEntityPresentationState(7);
			if (selected.kind !== "realized")
				throw new Error("Tick replacement lost its visual.");
			expect(selected.frame.localBounds.max.x).toBe(2);
		});
		await runtime.destroy();
	});

	it("shares one immutable visual load while retaining independent live owners", async () => {
		const visual = spawnedVisual();
		const load = vi.fn(async () => visual);
		const runtime = await buildSpawnRuntime({ load });

		await runtime.replaceDynamicEntitySnapshot([
			spawnedEntity(1, 1),
			spawnedEntity(2, 1),
		]);
		expect(load).toHaveBeenCalledTimes(1);
		expect(
			runtime.getAuthoredDynamicRuntimeDiagnostics().dynamics.entityCount,
		).toBe(2);
		expect(
			runtime.getAuthoredDynamicRuntimeDiagnostics().dynamics.templates
				.templateCount,
		).toBe(1);

		await runtime.replaceDynamicEntitySnapshot([spawnedEntity(2, 1)]);
		expect(
			runtime.getAuthoredDynamicRuntimeDiagnostics().dynamics.entityCount,
		).toBe(1);
		expect(
			runtime.getAuthoredDynamicRuntimeDiagnostics().dynamics.templates
				.templateCount,
		).toBe(1);
		await runtime.replaceDynamicEntitySnapshot([]);
		expect(
			runtime.getAuthoredDynamicRuntimeDiagnostics().dynamics.entityCount,
		).toBe(0);
		expect(
			runtime.getAuthoredDynamicRuntimeDiagnostics().dynamics.templates
				.templateCount,
		).toBe(0);
		await runtime.destroy();
	});

	it("replaces one GUID generation and updates same-generation state without reloading", async () => {
		const load = vi.fn(async () => spawnedVisual());
		const runtime = await buildSpawnRuntime({ load });
		await runtime.replaceDynamicEntitySnapshot([
			spawnedEntity(7, 1, { translucency: 0.5 }),
		]);
		await runtime.replaceDynamicEntitySnapshot([
			spawnedEntity(7, 1, { noDraw: true, translucency: 0.25 }),
		]);
		const renamed = spawnedEntity(7, 1, {
			noDraw: true,
			translucency: 0.25,
		});
		renamed.display = { level: 13, name: "Renamed entity" };
		await runtime.replaceDynamicEntitySnapshot([renamed]);
		await runtime.replaceDynamicEntitySnapshot([spawnedEntity(7, 2)]);

		expect(load).toHaveBeenCalledTimes(1);
		expect(
			runtime.getAuthoredDynamicRuntimeDiagnostics().dynamics.entityCount,
		).toBe(1);
		expect(
			[...runtime.listPresentedSpawnedEntities()][0]?.view.physics.translucency,
		).toBe(0);
		await runtime.destroy();
	});

	it("does not mutate placement for a state-only upsert and moves one changed root once", async () => {
		const runtime = await buildSpawnRuntime({
			load: async () => spawnedVisual(),
		});
		const entity = spawnedEntity(7, 1, { translucency: 0.5 });
		await runtime.upsertDynamicEntity(entity);
		const installedRevision = runtime.dynamicEntityPlacementRevision;

		await runtime.upsertDynamicEntity(spawnedEntity(7, 1, { noDraw: true }));
		expect(runtime.dynamicEntityPlacementRevision).toBe(installedRevision);
		const contacted = spawnedEntity(7, 1, { noDraw: true });
		if (contacted.placement.kind !== "world")
			throw new Error("Contact fixture lost world placement.");
		contacted.placement.contact = "sliding";
		await runtime.upsertDynamicEntity(contacted);
		expect(runtime.dynamicEntityPlacementRevision).toBe(installedRevision);

		const moved = spawnedEntity(7, 1, { noDraw: true });
		if (moved.placement.kind !== "world")
			throw new Error("Moved fixture lost world placement.");
		moved.placement.pose.coords.x += 1;
		await runtime.upsertDynamicEntity(moved);
		expect(runtime.dynamicEntityPlacementRevision).toBe(installedRevision + 1);
		await runtime.destroy();
	});

	it("retains a newer generation when an exact stale removal arrives", async () => {
		const runtime = await buildSpawnRuntime({
			load: async () => spawnedVisual(),
		});
		await runtime.upsertDynamicEntity(spawnedEntity(7, 2));

		runtime.removeDynamicEntity(7, 1);

		expect(runtime.dynamicEntityOrigin(7)).not.toBeNull();
		expect(
			runtime.getAuthoredDynamicRuntimeDiagnostics().dynamics.entityCount,
		).toBe(1);
		await runtime.destroy();
	});

	it("keeps hydration desired-only until its exact terrain residency publishes", async () => {
		let visualLoads = 0;
		const runtime = await buildUnscopedSpawnRuntime({
			async load() {
				visualLoads += 1;
				return spawnedVisual();
			},
		});
		const entity = spawnedEntity(7, 1);

		const hydration = await runtime.replaceDynamicEntitySnapshot([entity]);
		expect(hydration.get(7)).toBe("deferred");
		expect(visualLoads).toBe(0);
		expect(runtime.dynamicEntityOrigin(7)).toBeNull();
		await runtime.upsertDynamicEntity(
			spawnedEntity(7, 1, { translucency: 0.25 }),
		);

		runtime.updateSceneInterest(sceneInterest("0x0001ffff"));
		await vi.waitFor(() => {
			runtime.tick();
			expect(runtime.dynamicEntityOrigin(7)).not.toBeNull();
		});
		expect(visualLoads).toBe(1);
		expect(
			[...runtime.listPresentedSpawnedEntities()][0]?.view.physics.translucency,
		).toBe(0.25);
		await runtime.destroy();
	});

	it("withdraws only out-of-scope roots and wakes them on exact residency return", async () => {
		const runtime = await buildSpawnRuntime({
			load: async () => spawnedVisual(),
		});
		await runtime.upsertDynamicEntity(spawnedEntity(7, 1));
		expect(runtime.dynamicEntityOrigin(7)).not.toBeNull();
		expect(runtime.selectedEntityPresentationState(7).kind).toBe("realized");

		await activateSpawnScene(runtime, "0x0002ffff", 2);
		expect(runtime.dynamicEntityOrigin(7)).toBeNull();
		expect(runtime.selectedEntityPresentationState(7)).toEqual({
			kind: "frontend-evicted",
		});

		await activateSpawnScene(runtime, "0x0001ffff", 3);
		await vi.waitFor(() => {
			runtime.tick();
			expect(runtime.dynamicEntityOrigin(7)).not.toBeNull();
		});
		expect(runtime.selectedEntityPresentationState(7).kind).toBe("realized");
		await runtime.destroy();
	});

	it("cannot publish a visual load that completes after exact removal", async () => {
		const visualLoad = controlledPromise<DecodedStaticPresentation>();
		const source: SetupVisualSource = {
			load: () => visualLoad.promise,
		};
		const runtime = await buildSpawnRuntime(source);
		try {
			const stale = runtime.replaceDynamicEntitySnapshot([spawnedEntity(9, 1)]);
			await runtime.replaceDynamicEntitySnapshot([]);
			visualLoad.resolve(spawnedVisual());
			await stale;

			expect(
				runtime.getAuthoredDynamicRuntimeDiagnostics().dynamics.entityCount,
			).toBe(0);
		} finally {
			visualLoad.resolve(spawnedVisual());
			await runtime.destroy();
		}
	});

	it("installs the latest accepted placement when a tick arrives during visual loading", async () => {
		const visualLoad = controlledPromise<DecodedStaticPresentation>();
		const runtime = await buildSpawnRuntime({
			load: () => visualLoad.promise,
		});
		try {
			const initial = spawnedEntity(9, 1);
			const realization = runtime.upsertDynamicEntity(initial);
			const moved = spawnedEntity(9, 1, { noDraw: true });
			if (moved.placement.kind !== "world")
				throw new Error("Moved fixture lost world placement.");
			moved.placement.pose.coords.x = 19;
			const endpoint = {
				pose: moved.placement.pose,
				spatialMembership: moved.placement.spatialMembership,
			};

			runtime.applyDynamicEntityTick(
				{
					hostTime: { seconds: 2 },
					durationMs: 30,
					advances: [
						{
							entity: moved,
							kind: "integrated",
							path: {
								initial: endpoint,
								legs: [{ endFraction: 1, end: endpoint }],
							},
						},
					],
					updates: [],
				},
				1_000,
			);
			visualLoad.resolve(spawnedVisual());
			await realization;

			expect(runtime.spawnedEntityPlacement(9)?.localTransform.m41).toBe(19);
			expect(
				[...runtime.listPresentedSpawnedEntities()][0]?.view.physics.noDraw,
			).toBe(true);
		} finally {
			visualLoad.resolve(spawnedVisual());
			await runtime.destroy();
		}
	});

	it("cannot publish a superseded generation when one shared visual load completes", async () => {
		const visualLoad = controlledPromise<DecodedStaticPresentation>();
		const runtime = await buildSpawnRuntime({
			load: () => visualLoad.promise,
		});
		try {
			const stale = runtime.upsertDynamicEntity(spawnedEntity(9, 1));
			const current = runtime.upsertDynamicEntity(spawnedEntity(9, 2));
			visualLoad.resolve(spawnedVisual());
			await Promise.all([stale, current]);

			runtime.removeDynamicEntity(9, 1);
			expect(runtime.dynamicEntityOrigin(9)).not.toBeNull();
			runtime.removeDynamicEntity(9, 2);
			expect(runtime.dynamicEntityOrigin(9)).toBeNull();
		} finally {
			visualLoad.resolve(spawnedVisual());
			await runtime.destroy();
		}
	});

	it("defers child-first attachment and tears children down before their parent", async () => {
		const baseVisual = spawnedVisual();
		const holdingOffset = Mat4.identity();
		holdingOffset.m41 = 2;
		const visual: DecodedStaticPresentation = {
			...baseVisual,
			presentation: {
				...baseVisual.presentation,
				holdingLocations: new Map([
					[
						"right-hand",
						{
							location: "right-hand",
							offsetTransform: holdingOffset,
							partIndex: 0,
						},
					],
				]),
			},
		};
		const runtime = await buildSpawnRuntime({
			load: async (setup, appearance) => ({
				...visual,
				setupId: setup === 0x02000002 ? "0x02000002" : "0x02000001",
				presentation: {
					...visual.presentation,
					appearanceKey: `held-appearance:${appearance.paletteDid}`,
				},
			}),
		});
		const parent = spawnedEntity(20, 1, { translucency: 0.25 });
		const child = attachedEntity(21, 1, 20);
		child.physics.translucency = 0.75;

		expect(await runtime.upsertDynamicEntity(child)).toBe("deferred");
		expect(
			runtime.getAuthoredDynamicRuntimeDiagnostics().dynamics.entityCount,
		).toBe(0);
		expect(await runtime.upsertDynamicEntity(parent)).toBe("installed");
		expect(
			runtime.getAuthoredDynamicRuntimeDiagnostics().dynamics.entityCount,
		).toBe(2);
		await runtime.replaceDynamicEntitySnapshot([]);
		expect(
			runtime.getAuthoredDynamicRuntimeDiagnostics().dynamics.entityCount,
		).toBe(0);

		expect(await runtime.upsertDynamicEntity(parent)).toBe("installed");
		expect(await runtime.upsertDynamicEntity(child)).toBe("installed");
		expect(
			runtime.getAuthoredDynamicRuntimeDiagnostics().dynamics.entityCount,
		).toBe(2);
		runtime.setSelectedEntityGuid(child.identity.guid);
		const selectedChild = runtime.selectedEntityPresentationState(
			child.identity.guid,
		);
		if (selectedChild.kind !== "realized")
			throw new Error("Attached selection fixture was not realized.");
		expect(selectedChild.frame.guid).toBe(child.identity.guid);
		expect(selectedChild.frame.placement.localToLandblock.m41).toBeCloseTo(22);
		const placementRevision = runtime.dynamicEntityPlacementRevision;
		const changedParent = {
			...parent,
			presentation: {
				...parent.presentation,
				appearance: { ...parent.presentation.appearance, paletteDid: 2 },
			},
		};
		await runtime.upsertDynamicEntity(changedParent);
		expect(runtime.dynamicEntityPlacementRevision).toBe(placementRevision);
		const retainedChild = runtime.selectedEntityPresentationState(
			child.identity.guid,
		);
		if (retainedChild.kind !== "realized")
			throw new Error("Parent appearance replacement removed its held child.");
		expect(retainedChild.frame.placement.localToLandblock.m41).toBeCloseTo(22);
		changedParent.presentation.content = {
			...changedParent.presentation.content,
			setupDid: 0x02000002,
		};
		expect(await runtime.upsertDynamicEntity(changedParent)).toBe("installed");
		const reattachedChild = runtime.selectedEntityPresentationState(
			child.identity.guid,
		);
		if (reattachedChild.kind !== "realized")
			throw new Error("Setup replacement failed to reattach its held child.");
		expect(reattachedChild.frame.placement.localToLandblock.m41).toBeCloseTo(
			22,
		);
		expect(
			runtime.getAuthoredDynamicRuntimeDiagnostics().dynamics.entityCount,
		).toBe(2);
		await activateSpawnScene(runtime, "0x0002ffff", 2);
		expect(
			runtime.selectedEntityPresentationState(child.identity.guid),
		).toEqual({
			kind: "frontend-evicted",
		});
		await runtime.destroy();
	});

	it("replaces outdoor demand with dungeon demand and reacquires it when returning", async () => {
		const requests: LandblockIdLayer[][] = [];
		const runtime = await buildGamePresentationRuntimeForTest(
			{
				buildRenderer: async () => testRenderer(),
				resources: TEST_RESOURCES,
			},
			{
				async prepareLandblockLayers(layers) {
					requests.push([...layers]);
					return [];
				},
			},
			{} as TexturePixelSource,
			ANIMATION_SOURCE,
			PHYSICS_SCRIPT_SOURCE,
			{ playOneShot: () => null, prepare: async () => {} },
			PARTICLE_EMITTER_SOURCE,
			SOUND_TABLE_SOURCE,
			PARTICLE_MESH_SOURCE,
			null,
		);
		const outdoor = sceneInterest("0xda55ffff");
		const outdoorWithEnv = {
			...outdoor,
			radii: { ...outdoor.radii, envCellRadius: 0 },
		};
		runtime.updateSceneInterest(outdoorWithEnv);
		await Promise.resolve();
		expect(runtime.sceneInterestState().interest).toEqual(
			new Map([
				[
					"0xda55ffff",
					new Set([LandblockLayerKind.Terrain, LandblockLayerKind.EnvCells]),
				],
			]),
		);
		expect(runtime.terrainFogCoverage()).toEqual({ terrainRadius: 0 });
		requests.length = 0;

		runtime.updateSceneInterest({
			ambientOutdoorEnvCellOwners: new Set(),
			target: {
				kind: "dungeon",
				requested: {
					kind: "automatic-landblock",
					landblockId: "0x0005ffff",
				},
			},
			radii: outdoorWithEnv.radii,
		});
		await Promise.resolve();
		expect(requests).toEqual([
			[{ id: "0x0005ffff", layer: LandblockLayerKind.EnvCells }],
		]);
		expect(runtime.sceneInterestState().interest).toEqual(
			new Map([["0x0005ffff", new Set([LandblockLayerKind.EnvCells])]]),
		);
		expect(runtime.terrainFogCoverage()).toBeNull();
		requests.length = 0;

		runtime.updateSceneInterest({
			ambientOutdoorEnvCellOwners: new Set(),
			target: {
				kind: "dungeon",
				requested: {
					kind: "automatic-landblock",
					landblockId: "0x0006ffff",
				},
			},
			radii: outdoorWithEnv.radii,
		});
		await Promise.resolve();
		expect(requests).toEqual([
			[{ id: "0x0006ffff", layer: LandblockLayerKind.EnvCells }],
		]);
		expect(runtime.sceneInterestState().interest).toEqual(
			new Map([["0x0006ffff", new Set([LandblockLayerKind.EnvCells])]]),
		);

		requests.length = 0;
		runtime.updateSceneInterest(outdoorWithEnv);
		await Promise.resolve();
		expect(requests).toEqual([
			[
				{ id: "0xda55ffff", layer: LandblockLayerKind.Terrain },
				{ id: "0xda55ffff", layer: LandblockLayerKind.EnvCells },
			],
		]);
		expect(runtime.sceneInterestState().interest).toEqual(
			new Map([
				[
					"0xda55ffff",
					new Set([LandblockLayerKind.Terrain, LandblockLayerKind.EnvCells]),
				],
			]),
		);

		runtime.clearSceneInterest();
		expect(runtime.sceneInterestState().interest).toEqual(new Map());
		expect(runtime.sceneInterestState().resolvedTarget).toBeNull();
		expect(runtime.terrainFogCoverage()).toBeNull();
		requests.length = 0;
		runtime.updateSceneInterest({
			ambientOutdoorEnvCellOwners: new Set(),
			target: {
				kind: "dungeon",
				requested: {
					kind: "env-cell",
					envCellId: "0x00050100",
					landblockId: "0x0005ffff",
				},
			},
			radii: outdoorWithEnv.radii,
		});
		await Promise.resolve();
		expect(requests).toEqual([
			[{ id: "0x0005ffff", layer: LandblockLayerKind.EnvCells }],
		]);
		expect(runtime.sceneInterestState().interest).toEqual(
			new Map([["0x0005ffff", new Set([LandblockLayerKind.EnvCells])]]),
		);
		await runtime.destroy();
	});

	it("filters ambient EnvCells for outdoor intent and replaces it with explicit dungeon demand", async () => {
		const runtime = await buildGamePresentationRuntimeForTest(
			{
				buildRenderer: async () => testRenderer(),
				resources: TEST_RESOURCES,
			},
			{
				async prepareLandblockLayers() {
					return [];
				},
			},
			{} as TexturePixelSource,
			ANIMATION_SOURCE,
			PHYSICS_SCRIPT_SOURCE,
			{ playOneShot: () => null, prepare: async () => {} },
			PARTICLE_EMITTER_SOURCE,
			SOUND_TABLE_SOURCE,
			PARTICLE_MESH_SOURCE,
			null,
		);
		const radii = {
			buildingRadius: 0,
			envCellRadius: 0,
			explicitObjectRadius: 0,
			generatedObjectRadius: 0,
			terrainRadius: 0,
		} as const;
		const outdoorTarget = {
			kind: "outdoor" as const,
			landblockId: "0x5f50ffff" as const,
		};

		runtime.updateSceneInterest({
			ambientOutdoorEnvCellOwners: new Set(),
			radii,
			target: { kind: "outdoor", requested: outdoorTarget },
		});
		expect(runtime.sceneInterestState().interest).toEqual(
			new Map([
				[
					"0x5f50ffff",
					new Set([
						LandblockLayerKind.Terrain,
						LandblockLayerKind.Buildings,
						LandblockLayerKind.Objects,
						LandblockLayerKind.Generated,
					]),
				],
			]),
		);

		runtime.updateSceneInterest({
			ambientOutdoorEnvCellOwners: new Set(),
			radii,
			target: {
				kind: "dungeon",
				requested: {
					kind: "automatic-landblock",
					landblockId: "0x5f50ffff",
				},
			},
		});
		expect(runtime.sceneInterestState().interest).toEqual(
			new Map([["0x5f50ffff", new Set([LandblockLayerKind.EnvCells])]]),
		);

		runtime.updateSceneInterest({
			ambientOutdoorEnvCellOwners: new Set(),
			radii,
			target: { kind: "outdoor", requested: outdoorTarget },
		});
		expect(runtime.sceneInterestState().interest).toEqual(
			new Map([
				[
					"0x5f50ffff",
					new Set([
						LandblockLayerKind.Terrain,
						LandblockLayerKind.Buildings,
						LandblockLayerKind.Objects,
						LandblockLayerKind.Generated,
					]),
				],
			]),
		);
		await runtime.destroy();
	});
});

async function buildSpawnRuntime(
	setupVisualSource: SetupVisualSource,
	animationSource: AnimationAssetSource = ANIMATION_SOURCE,
	renderer?: Renderer,
	physicsScriptSource: PhysicsScriptSource = PHYSICS_SCRIPT_SOURCE,
	physicsScriptTableSource: PhysicsScriptTableSource = PHYSICS_SCRIPT_TABLE_SOURCE,
	particleEmitterSource: ParticleEmitterSource = PARTICLE_EMITTER_SOURCE,
	particleMeshSource: ParticleMeshSource = PARTICLE_MESH_SOURCE,
): Promise<GamePresentationRuntime> {
	const runtime = await buildUnscopedSpawnRuntime(
		setupVisualSource,
		animationSource,
		renderer,
		physicsScriptSource,
		physicsScriptTableSource,
		particleEmitterSource,
		particleMeshSource,
	);
	await activateSpawnScene(runtime, "0x0001ffff", 1);
	return runtime;
}

/** Build the dynamic-capable runtime without granting any implicit residency capability. */
async function buildUnscopedSpawnRuntime(
	setupVisualSource: SetupVisualSource,
	animationSource: AnimationAssetSource = ANIMATION_SOURCE,
	renderer?: Renderer,
	physicsScriptSource: PhysicsScriptSource = PHYSICS_SCRIPT_SOURCE,
	physicsScriptTableSource: PhysicsScriptTableSource = PHYSICS_SCRIPT_TABLE_SOURCE,
	particleEmitterSource: ParticleEmitterSource = PARTICLE_EMITTER_SOURCE,
	particleMeshSource: ParticleMeshSource = PARTICLE_MESH_SOURCE,
): Promise<GamePresentationRuntime> {
	const device: GamePresentationRuntimeRenderDevice = {
		buildRenderer: async () => renderer ?? testRenderer(),
		resources: TEST_RESOURCES,
	};
	return buildGamePresentationRuntimeForTest(
		device,
		{
			async prepareLandblockLayers(layers) {
				return [...layers].map(({ id, layer }) => {
					if (layer !== LandblockLayerKind.Terrain)
						throw new Error(`Unexpected spawn-test layer ${layer}.`);
					return terrainArtifact(id);
				});
			},
		},
		new EchoTexturePixelSource(),
		animationSource,
		physicsScriptSource,
		{ playOneShot: () => null, prepare: async () => {} },
		particleEmitterSource,
		SOUND_TABLE_SOURCE,
		particleMeshSource,
		setupVisualSource,
		physicsScriptTableSource,
	);
}

function particleEmitterInfo(
	id: DatAssetId,
	meshId: DatAssetId,
): DecodedParticleEmitterInfo {
	return {
		a: acVector3([0, 0, 0]),
		b: acVector3([0, 0, 0]),
		birthrateSeconds: 0.25,
		c: acVector3([0, 0, 0]),
		emitsPerMeter: false,
		emitsPerSecond: true,
		finalScale: 1,
		finalTrans: 1,
		followsParent: false,
		hardwareMesh: { id: meshId, radius: 1 },
		id,
		initialParticles: 1,
		isPersistent: true,
		lifespan: 2,
		lifespanRand: 0,
		maxA: 1,
		maxB: 1,
		maxC: 1,
		maxOffset: 0,
		maxParticles: 10,
		minA: 1,
		minB: 1,
		minC: 1,
		minOffset: 0,
		motionType: 1,
		offsetDir: acVector3([0, 0, 1]),
		scaleRand: 0,
		startScale: 1,
		startTrans: 0,
		totalParticles: 0,
		totalSeconds: 0,
		transRand: 0,
	};
}

/** Install one explicit outdoor scope before a focused dynamic presentation test uses it. */
async function activateSpawnScene(
	runtime: GamePresentationRuntime,
	landblockId: LandblockOwnerId,
	generation: number,
): Promise<void> {
	const receipt = await runtime.activateScene({
		generation,
		target: sceneInterest(landblockId),
	});
	await vi.waitFor(() => {
		runtime.tick();
		const status = runtime.sceneActivationStatus(receipt);
		if (status.kind === "failed") throw new Error(status.diagnostic);
		expect(status.kind).toBe("ready");
	});
	runtime.completeSceneActivation(generation);
}

/// Reaches one animation from one table, which is all a staged clip swap needs.
const MOTION_TABLE_ANIMATION_SOURCE: AnimationAssetSource = {
	async loadMotionTableClosure() {
		return [IDLE_ANIMATION_ID];
	},
	async loadAnimation(animationId) {
		return {
			frameCount: 1,
			hooks: [],
			id: animationId,
			partCount: 1,
			partFrames: [Mat4.identity()],
			positionFrames: [],
		};
	},
	destroy() {},
};

const IDLE_ANIMATION_ID = "0x03000001" as DatAssetId;

const SPAWN_TEST_CAMERA: Camera = {
	far: 800,
	fov: 90,
	near: 0.5,
	placement: {
		envCellId: null,
		landblockId: "0x00000000",
		position: sceneVec3(Vec3.zero()),
		rotation: Quat.identity(),
	},
};

/// An entity that animates from a table, optionally already playing a clip when it is realized.
function motionDrivenEntity(
	guid: number,
	motion: DynamicEntityView["motion"],
): DynamicEntityView {
	const entity = spawnedEntity(guid, 1);
	return {
		...entity,
		motion,
		presentation: {
			...entity.presentation,
			content: {
				...entity.presentation.content,
				motionTableDid: 0x09000001,
			},
		},
	};
}

async function buildGamePresentationRuntimeForTest(
	device: GamePresentationRuntimeRenderDevice,
	commitPipeline: CommitPipeline,
	texturePixelSource: TexturePixelSource,
	animationSource: AnimationAssetSource,
	physicsScriptSource: PhysicsScriptSource,
	audioDevice: GamePresentationRuntimeDependencies["audioDevice"],
	particleEmitterSource: ParticleEmitterSource,
	soundTableSource: SoundTableSource,
	particleMeshSource: ParticleMeshSource,
	setupVisualSource: SetupVisualSource | null,
	physicsScriptTableSource: PhysicsScriptTableSource = PHYSICS_SCRIPT_TABLE_SOURCE,
): Promise<GamePresentationRuntime> {
	return GamePresentationRuntime.build(
		device,
		commitPipeline,
		texturePixelSource,
		animationSource,
		physicsScriptSource,
		physicsScriptTableSource,
		audioDevice,
		particleEmitterSource,
		soundTableSource,
		particleMeshSource,
		setupVisualSource,
		SHARED_FRAME_SETTINGS,
		undefined,
		undefined,
		{ createTerrainWorker: () => new TestTerrainWorkerPort() },
	);
}

/** Executes the production terrain kernel behind the same closed transport used by the browser. */
class TestTerrainWorkerPort implements ClosedWorkerPort {
	onerror: ((event: ErrorEvent) => void) | null = null;
	onmessage:
		((event: MessageEvent<ClosedWorkerResponse<unknown>>) => void) | null =
		null;
	#terminated = false;

	postMessage(
		message: ClosedWorkerRequest<unknown>,
		transfer: readonly Transferable[],
	): void {
		if (this.#terminated) throw new Error("Test terrain worker is terminated.");
		const request = structuredClone(
			message as ClosedWorkerRequest<TerrainWorkerJob>,
			{ transfer: [...transfer] },
		);
		queueMicrotask(() => {
			try {
				const result = generateTerrain(request.input);
				validateTerrainGenerationValues(result);
				const response = structuredClone(
					{
						id: request.id,
						ok: true,
						result,
					} satisfies ClosedWorkerResponse<TerrainWorkerResult>,
					{ transfer: terrainWorkerResultTransferables(result) },
				);
				this.onmessage?.({ data: response } as MessageEvent<
					ClosedWorkerResponse<unknown>
				>);
			} catch (cause) {
				this.onmessage?.({
					data: {
						error: cause instanceof Error ? cause.message : String(cause),
						id: request.id,
						ok: false,
					},
				} as MessageEvent<ClosedWorkerResponse<unknown>>);
			}
		});
	}

	terminate(): void {
		this.#terminated = true;
	}
}

/** Returns one compatible pixel for every terrain texture role used by the activation fixture. */
class EchoTexturePixelSource implements TexturePixelSource {
	async loadTexturePixels(
		request: TexturePreparationServiceRequest,
	): Promise<TexturePreparationServiceResponse> {
		if (request.kind !== "prepared-texture-surface")
			throw new Error(`Unexpected texture request ${request.kind}.`);
		const format = texturePurposePolicy(request.purpose).format;
		const surface = {
			format,
			height: 1,
			pixels: new Uint8Array(texturePixelFormatByteLength(format)).fill(1),
			sourceAssetId: request.sourceAssetId,
			width: 1,
		};
		if (request.purpose === TexturePurpose.TerrainColor) {
			return {
				kind: request.kind,
				purpose: request.purpose,
				surface: { ...surface, meanRgb: [1 / 255, 2 / 255, 3 / 255] },
			};
		}
		return { kind: request.kind, purpose: request.purpose, surface };
	}
}

function spawnedEntity(
	guid: number,
	generation: number,
	physics: Partial<DynamicEntityView["physics"]> = {},
): DynamicEntityView {
	return {
		generation,
		motion: null,
		identity: { guid, wcid: 42 },
		display: { name: `Entity ${guid}`, level: null },
		physics: {
			cloaked: false,
			translucency: 0,
			defaultAnimation: true,
			defaultScript: false,
			hidden: false,
			lighting: false,
			noDraw: false,
			participation: "pose-only",
			semanticMask: 0,
			...physics,
		},
		placement: {
			kind: "world",
			spatialMembership: {
				reachesOutdoors: true,
				reachedEnvCellIds: [],
			},
			contact: "unknown",
			pose: {
				coords: { x: guid, y: 2, z: 3 },
				landblockId: cellId(0x00010001),
				rotation: { w: 1, x: 0, y: 0, z: 0 },
			},
			sampleMode: "authoritative-only",
		},
		presentation: {
			entityClass: "other",
			appearance: {
				paletteDid: null,
				partChanges: [],
				subPalettes: [],
				textureChanges: [],
			},
			content: {
				physicsEffectTableDid: null,
				motionTableDid: null,
				setupDid: 0x02000001,
				soundTableDid: null,
			},
			objectScale: 1,
			radar: {
				behavior: null,
				category: "other",
				obviousRange: null,
			},
		},
	};
}

function controlledPromise<T>(): {
	readonly promise: Promise<T>;
	readonly resolve: (value: T) => void;
} {
	let resolve: (value: T) => void = () => {
		throw new Error("Controlled promise was not initialized.");
	};
	const promise = new Promise<T>((accept) => {
		resolve = accept;
	});
	return { promise, resolve: (value) => resolve(value) };
}

function attachedEntity(
	guid: number,
	generation: number,
	parent: number,
): DynamicEntityView {
	return {
		...spawnedEntity(guid, generation),
		placement: {
			kind: "attached",
			parent,
			parentLocation: "right-hand",
			placement: "right-hand-combat",
		},
	};
}

/** Synthetic appearance with distinct geometry bounds so tests observe installed mesh state. */
function appearanceVisual(radius: number): DecodedStaticPresentation {
	const base = spawnedVisual();
	return {
		...base,
		presentation: {
			...base.presentation,
			appearanceKey: `appearance:${radius}`,
			parts: base.presentation.parts.map((part) => ({
				...part,
				geometry: {
					...part.geometry,
					id: `geometry:appearance/${radius}` as const,
					positions: new Float32Array([
						-radius,
						0,
						0,
						radius,
						0,
						0,
						0,
						radius,
						0,
					]),
					bounds: new AABB3(
						new Vec3(-radius, 0, 0),
						new Vec3(radius, radius, 0),
					),
				},
			})),
		},
	};
}

function spawnedVisual(): DecodedStaticPresentation {
	return {
		behavior: {
			animationId: "0x03000001",
			kind: "animation-only",
			physicsScriptId: null,
			physicsScriptTableId: null,
			motionTableId: null,
			soundTableId: null,
		},
		localBounds: null,
		presentation: {
			appearanceKey: "setup:0x02000001|base",
			holdingLocations: new Map(),
			id: "presentation:spawned",
			lights: [],
			parts: [
				{
					defaultScale: new Vec3(1, 1, 1),
					geometry: {
						bounds: AABB3.zero(),
						id: "geometry:spawned",
						indices: new Uint32Array([0, 1, 2]),
						materialSideKinds: new Uint8Array([0]),
						materialSideTypes: new Uint8Array([0]),
						materialSlotIndices: new Uint16Array([0]),
						materialStippling: new Uint8Array([0]),
						materialWrapModes: new Uint8Array([0]),
						normals: new Float32Array(9),
						positions: new Float32Array(9),
						sourceDiagnostics: { rejectedDegenerateTriangles: [] },
						textureCoordinates: new Float32Array(6),
					},
					materials: [
						{
							color: [1, 1, 1, 1],
							diffuseScale: 1,
							id: "material:spawned",
							kind: "solid-color",
							luminosity: 0,
							rawSurfaceFlags: 0,
							translucency: 0,
						},
					],
					partIndex: 0,
					retailVisibility: "normally-visible",
				},
			],
			placementPoses: new Map([
				[0, { partTransforms: [Mat4.identity()], placementId: 0 }],
			]),
			selectionBounds: null,
			sortingBounds: null,
			sourceAssetId: "0x02000001",
		},
		setupId: "0x02000001",
	};
}

function sceneInterest(anchorLandblockId: string) {
	return {
		ambientOutdoorEnvCellOwners: new Set([
			anchorLandblockId as LandblockOwnerId,
		]),
		target: {
			kind: "outdoor",
			requested: {
				kind: "outdoor",
				landblockId: anchorLandblockId as LandblockOwnerId,
			},
		},
		radii: {
			buildingRadius: null,
			envCellRadius: null,
			explicitObjectRadius: null,
			generatedObjectRadius: null,
			terrainRadius: 0,
		},
	} as const;
}

function buildingSceneInterest(anchorLandblockId: string) {
	return {
		ambientOutdoorEnvCellOwners: new Set<LandblockOwnerId>(),
		target: {
			kind: "outdoor",
			requested: {
				kind: "outdoor",
				landblockId: anchorLandblockId as LandblockOwnerId,
			},
		},
		radii: {
			buildingRadius: 0,
			envCellRadius: null,
			explicitObjectRadius: null,
			generatedObjectRadius: null,
			terrainRadius: 0,
		},
	} as const;
}

function objectSceneInterest(anchorLandblockId: string) {
	return {
		ambientOutdoorEnvCellOwners: new Set<LandblockOwnerId>(),
		target: {
			kind: "outdoor",
			requested: {
				kind: "outdoor",
				landblockId: anchorLandblockId as LandblockOwnerId,
			},
		},
		radii: {
			buildingRadius: null,
			envCellRadius: null,
			explicitObjectRadius: 0,
			generatedObjectRadius: null,
			terrainRadius: 0,
		},
	} as const;
}

function generatedSceneInterest(anchorLandblockId: string) {
	return {
		ambientOutdoorEnvCellOwners: new Set<LandblockOwnerId>(),
		target: {
			kind: "outdoor",
			requested: {
				kind: "outdoor",
				landblockId: anchorLandblockId as LandblockOwnerId,
			},
		},
		radii: {
			buildingRadius: null,
			envCellRadius: null,
			explicitObjectRadius: null,
			generatedObjectRadius: 0,
			terrainRadius: 0,
		},
	} as const;
}

/** Complete one-landblock terrain source used to exercise production activation residency. */
function terrainArtifact(landblockId: LandblockOwnerId): LandblockLayerCommit {
	const composition = {
		activeRegionKey: "activation-handoff-test",
		cornerTerrainAlphaMaps: [
			{ blendMaskTextureId: "0x05000002", terrainCode: 1 },
		],
		landscapeDetail: { textureId: "0x05000004", tiling: 1 },
		roadAlphaMaps: [{ roadCode: 1, roadMaskTextureId: "0x05000003" }],
		sideTerrainAlphaMaps: [
			{ blendMaskTextureId: "0x05000002", terrainCode: 3 },
		],
		terrainMaterials: resolveTerrainMaterialTable([
			{
				colorTextureId: "0x05000001",
				colorVariation: {
					maxVertexBrightness: 0,
					maxVertexHue: 0,
					maxVertexSaturation: 0,
					minVertexBrightness: 0,
					minVertexHue: 0,
					minVertexSaturation: 0,
				},
				terrainType: 0,
				tiling: 1,
			},
		]),
	} as const;
	const textures = resolveTerrainTextureFacts(composition);
	return {
		commit: {
			generation: {
				cellDiagonals: new Uint8Array(64),
				gridSize: 9,
				heightIndices: new Uint8Array(81),
				heights: new Float32Array(81),
				landblockId,
				terrainSamples: new Uint16Array(81),
				tileSize: 24,
			},
			presentation: {
				composition,
				compositionTable: compileTerrainCompositionTable(composition, textures),
				textures,
			},
		},
		landblockId,
		layer: LandblockLayerKind.Terrain,
	};
}

/** Minimal stale artifact: applying it would fail, so a passing test proves it was discarded. */
function staleTerrainArtifact(landblockId: string): LandblockLayerCommit {
	const commit: StaticLandblockLayerCommitTerrain = {
		get generation(): never {
			throw new Error("Withdrawn terrain artifact was applied.");
		},
		get presentation(): never {
			throw new Error("Withdrawn terrain artifact was applied.");
		},
	};
	return {
		commit,
		landblockId,
		layer: LandblockLayerKind.Terrain,
	};
}

/** Minimal promoted record: any accidental dynamic installation reaches the throwing resource port. */
function promotedBuildingArtifact(
	landblockId: string,
	physicsScriptId: DatAssetId | null = null,
): LandblockLayerCommit {
	return promotedStaticArtifact(
		landblockId,
		LandblockLayerKind.Buildings,
		physicsScriptId,
	);
}

function promotedObjectArtifact(landblockId: string): LandblockLayerCommit {
	return promotedStaticArtifact(landblockId, LandblockLayerKind.Objects);
}

function promotedGeneratedArtifact(landblockId: string): LandblockLayerCommit {
	return promotedStaticArtifact(landblockId, LandblockLayerKind.Generated);
}

function promotedStaticArtifact(
	landblockId: string,
	layer:
		| LandblockLayerKind.Buildings
		| LandblockLayerKind.Objects
		| LandblockLayerKind.Generated,
	physicsScriptId: DatAssetId | null = null,
): LandblockLayerCommit {
	const residentBehavior: AuthoredDynamicSource["behavior"] =
		physicsScriptId === null
			? {
					animationId: "0x03000001",
					kind: "animation-only",
					physicsScriptId: null,
					physicsScriptTableId: null,
					motionTableId: null,
					soundTableId: null,
				}
			: {
					animationId: "0x03000001",
					kind: "animation-and-script",
					physicsScriptId,
					physicsScriptTableId: null,
					motionTableId: null,
					soundTableId: null,
				};
	const promotedResident: AuthoredDynamicSource = {
		behavior: residentBehavior,
		identity: { kind: "authored", sourceId: "resident:promoted" },
		localBounds: null,
		placement: {
			envCellId: null,
			landblockId,
			localTransform: Mat4.identity(),
		},
		presentation: {
			appearanceKey: "setup:0x02000001|base",
			id: "presentation:promoted",
			parts: [
				{
					defaultScale: new Vec3(1, 1, 1),
					geometry: {
						bounds: AABB3.zero(),
						id: "geometry:promoted",
						indices: new Uint32Array([0, 1, 2]),
						materialSideKinds: new Uint8Array([0]),
						materialSideTypes: new Uint8Array([0]),
						materialSlotIndices: new Uint16Array([0]),
						materialStippling: new Uint8Array([0]),
						materialWrapModes: new Uint8Array([0]),
						normals: new Float32Array(9),
						positions: new Float32Array(9),
						sourceDiagnostics: { rejectedDegenerateTriangles: [] },
						textureCoordinates: new Float32Array(6),
					},
					materials: [
						{
							color: [1, 1, 1, 1],
							diffuseScale: 1,
							id: "material:promoted",
							kind: "solid-color",
							luminosity: 0,
							rawSurfaceFlags: 0,
							translucency: 0,
						},
					],
					partIndex: 0,
					retailVisibility: "normally-visible",
				},
			],
			lights: [],
			holdingLocations: new Map(),
			placementPoses: new Map([
				[0, { partTransforms: [Mat4.identity()], placementId: 0 }],
			]),
			selectionBounds: null,
			sortingBounds: null,
			sourceAssetId: "0x02000001",
		},
		scale: new Vec3(1, 1, 1),
		setupId: "0x02000001",
	};
	const staticResident: ResolvedObjectResident = {
		...promotedResident,
		behavior: {
			animationId: null,
			kind: "none",
			motionTableId: null,
			physicsScriptId: null,
			physicsScriptTableId: null,
			soundTableId: null,
		},
	};
	const source = {
		dynamicSources: [promotedResident],
		landblockId,
		staticResidents: [staticResident],
	};
	switch (layer) {
		case LandblockLayerKind.Buildings:
			return {
				commit: {
					source: {
						...source,
						kind: layer,
						mapBlockers: new Map(),
						staticResidents: [],
					},
				},
				landblockId,
				layer,
			};
		case LandblockLayerKind.Objects:
			return {
				commit: { source: { ...source, kind: layer } },
				landblockId,
				layer,
			};
		case LandblockLayerKind.Generated:
			return {
				commit: { source: { ...source, kind: layer } },
				landblockId,
				layer,
			};
	}
}

function setTestCamera(runtime: GamePresentationRuntime, camera: Camera): void {
	runtime.setPrimaryView({ camera, extent: { height: 480, width: 640 } });
}

class DeferredCommitPipeline implements CommitPipeline {
	readonly #pending: Array<
		(artifacts: readonly LandblockLayerCommit[]) => void
	> = [];

	async prepareLandblockLayers(): Promise<readonly LandblockLayerCommit[]> {
		return new Promise((resolve) => this.#pending.push(resolve));
	}

	resolveNext(artifacts: readonly LandblockLayerCommit[]): void {
		const resolve = this.#pending.shift();
		if (!resolve) throw new Error("No commit preparation is pending.");
		resolve(artifacts);
	}
}
