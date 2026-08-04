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
	ResolvedOutdoorStaticLayerSource,
} from "../resolution/landblock-layer";
import type { FrameSelectionMetrics, Renderer } from "../renderer/renderer";
import { FRONTEND_TUNING } from "../../frontend-tuning";
import type { RendererResourceManager } from "../renderer/resource-manager";
import { LandblockLayerKind, type LandblockIdLayer } from "./scene-interest";
import { GameRuntime, type GameRuntimeRenderDevice } from "./game-runtime";
import type { SceneAvailabilityEvent } from "./scene-availability";

const ANIMATION_SOURCE: AnimationAssetSource = {
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
	uploadTextureArrayLayer() {},
} as RendererResourceManager;

const EMPTY_RENDERER_FRAME_FEEDBACK = { selectedDynamicNodeIds: [] } as const;

describe("GameRuntime view and interest control", () => {
	it("keeps frontend scene interest independent from the primary camera", async () => {
		const requestedLayers: LandblockIdLayer[] = [];
		const frames: Parameters<Renderer["drawFrame"]>[0][] = [];
		const frameSelectionMetrics: FrameSelectionMetrics = {
			envCellRenderMode: "portal",
			envCellShellCullOverrideCount: 0,
			portalExteriorRenderCount: 0,
			portalMaskEdgeCount: 0,
			portalNearPlaneSeedCount: 0,
			portalRejectedFacingCrossingCount: 0,
			portalRejectedFootprintCount: 0,
			portalRenderLayerCount: 0,
			portalRenderNodeCount: 0,
			portalSameDomainBoundaryCrossingCount: 0,
			portalAdmittedScopeWindowStateCount: 0,
			portalSubmittedRenderNodeCount: 0,
			sceneDomainTargetBytes: 0,
			sceneDomainTargetCount: 0,
			submittedEnvCellResidentDrawCount: 0,
			submittedEnvCellResidentTriangleCount: 0,
			submittedEnvCellShellDrawCount: 0,
			submittedEnvCellShellTriangleCount: 0,
			submittedPortalApertureDrawCount: 0,
			terrainFrameInputs: 2,
			viewCount: 1,
			visibleDynamicEntityCount: 3,
			visibleDynamicPartCount: 0,
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
			selectedGeneratedInstanceFragmentCount: 0,
			selectedGeneratedInstanceCount: 0,
			testedGeneratedInstanceCount: 0,
			retainedGeneratedInstanceCount: 0,
			rejectedGeneratedInstanceCount: 0,
			submittedCompactedGeneratedDrawCount: 0,
			submittedCompactedGeneratedInstanceCount: 0,
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
			submittedDynamicInstanceCount: 0,
			frameInstanceCapacity: 0,
			frameInstanceGrowthCount: 0,
			frameInstanceViewHighWaterMark: 0,
			objectProgramChanges: 0,
			droppedLights: 0,
			objectLightingBinds: 0,
			objectTextureBinds: 0,
		};
		const setFrameProfilingEnabled = vi.fn();
		const renderer: Renderer = {
			async destroy() {},
			drawFrame(input) {
				frames.push(input);
				return EMPTY_RENDERER_FRAME_FEEDBACK;
			},
			frameDiagnostics: {
				setProfilingEnabled: setFrameProfilingEnabled,
				snapshot: () => ({
					profile: null,
					profilingEnabled: false,
					selectionMetrics: frameSelectionMetrics,
				}),
			},
		};
		const pipeline: CommitPipeline = {
			async prepareLandblockLayers(
				layers,
			): Promise<readonly LandblockLayerCommit[]> {
				requestedLayers.push(...layers);
				return [];
			},
		};
		const device: GameRuntimeRenderDevice = {
			buildRenderer: async () => renderer,
			resources: TEST_RESOURCES,
		};
		const runtime = await GameRuntime.build(
			device,
			pipeline,
			{} as TexturePixelSource,
			ANIMATION_SOURCE,
		);

		runtime.updateSceneInterest({
			anchorLandblockId: "0x1010ffff",
			lod: {
				buildingRadius: null,
				envCellRadius: null,
				explicitObjectRadius: null,
				generatedObjectRadius: null,
				terrainRadius: 0,
			},
		});
		runtime.setPrimaryCamera({
			far: 800,
			fov: 90,
			near: 0.5,
			placement: {
				envCellId: null,
				landblockId: "0x2020ffff",
				position: createLandblockWorldOrigin("0x2020ffff").add(
					new Vec3(10, 40, -20),
				),
				rotation: Quat.identity(),
			},
		});
		runtime.frame(1);
		await Promise.resolve();

		expect(requestedLayers).toEqual([{ id: "0x1010ffff", layer: "terrain" }]);
		expect(frames[0]?.anchorLandblockId).toBe("0x2020ffff");
		expect(frames[0]?.frameSettings).toEqual({
			distanceFogEnabled: true,
			viewerLightEnabled:
				FRONTEND_TUNING.rendering.frameDefaults.viewerLightEnabled,
			envCellRenderMode: "portal",
			quality: {
				minimumObjectFootprintPixelArea:
					FRONTEND_TUNING.rendering.frameDefaults
						.minimumObjectFootprintPixelArea,
				minimumPortalFootprintPixelArea:
					FRONTEND_TUNING.rendering.frameDefaults
						.minimumPortalFootprintPixelArea,
				textureFiltering:
					FRONTEND_TUNING.rendering.frameDefaults.textureFiltering,
			},
		});
		runtime.setFrameSettings({
			distanceFogEnabled: false,
			viewerLightEnabled: false,
			envCellRenderMode: "flat",
			quality: {
				minimumObjectFootprintPixelArea: 8,
				minimumPortalFootprintPixelArea: 4,
				textureFiltering: "nearest",
			},
		});
		runtime.render(2);
		expect(frames[1]?.frameSettings).toEqual({
			distanceFogEnabled: false,
			viewerLightEnabled: false,
			envCellRenderMode: "flat",
			quality: {
				minimumObjectFootprintPixelArea: 8,
				minimumPortalFootprintPixelArea: 4,
				textureFiltering: "nearest",
			},
		});
		expect(runtime.getRendererFrameDiagnostics()).toEqual({
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
			runtime.setPrimaryCamera({
				far: 800,
				fov: 90,
				near: 0.5,
				placement: {
					envCellId: null,
					landblockId: "0x2020ffff",
					position: new Vec3(Number.NaN, 0, 0),
					rotation: Quat.identity(),
				},
			}),
		).toThrow("must be finite");

		await runtime.destroy();
	});

	it("discards a terrain commit whose scene interest was withdrawn while loading", async () => {
		const pipeline = new DeferredCommitPipeline();
		const device: GameRuntimeRenderDevice = {
			buildRenderer: async () => ({
				async destroy() {},
				drawFrame: () => EMPTY_RENDERER_FRAME_FEEDBACK,
			}),
			resources: TEST_RESOURCES,
		};
		const runtime = await GameRuntime.build(
			device,
			pipeline,
			{} as TexturePixelSource,
			ANIMATION_SOURCE,
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
		const device: GameRuntimeRenderDevice = {
			buildRenderer: async () => ({
				async destroy() {},
				drawFrame: () => EMPTY_RENDERER_FRAME_FEEDBACK,
			}),
			resources: TEST_RESOURCES,
		};
		const runtime = await GameRuntime.build(
			device,
			pipeline,
			{} as TexturePixelSource,
			ANIMATION_SOURCE,
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
		const device: GameRuntimeRenderDevice = {
			buildRenderer: async () => ({
				async destroy() {},
				drawFrame: () => EMPTY_RENDERER_FRAME_FEEDBACK,
			}),
			resources: TEST_RESOURCES,
		};
		const runtime = await GameRuntime.build(
			device,
			pipeline,
			{} as TexturePixelSource,
			ANIMATION_SOURCE,
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
		const device: GameRuntimeRenderDevice = {
			buildRenderer: async () => ({
				async destroy() {},
				drawFrame: () => EMPTY_RENDERER_FRAME_FEEDBACK,
			}),
			resources: TEST_RESOURCES,
		};
		const runtime = await GameRuntime.build(
			device,
			pipeline,
			{} as TexturePixelSource,
			ANIMATION_SOURCE,
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
		const device: GameRuntimeRenderDevice = {
			buildRenderer: async () => ({
				async destroy() {},
				drawFrame: () => EMPTY_RENDERER_FRAME_FEEDBACK,
			}),
			resources: TEST_RESOURCES,
		};
		const runtime = await GameRuntime.build(
			device,
			pipeline,
			{} as TexturePixelSource,
			ANIMATION_SOURCE,
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

	it("routes a synthetic explicit-object source through static realization", async () => {
		const pipeline = new DeferredCommitPipeline();
		const device: GameRuntimeRenderDevice = {
			buildRenderer: async () => ({
				async destroy() {},
				drawFrame: () => EMPTY_RENDERER_FRAME_FEEDBACK,
			}),
			resources: TEST_RESOURCES,
		};
		const runtime = await GameRuntime.build(
			device,
			pipeline,
			{} as TexturePixelSource,
			ANIMATION_SOURCE,
		);

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
				sceneNodeCount: 0,
			}),
		]);

		await runtime.destroy();
	});

	it("routes generated source through independent static realization", async () => {
		const pipeline = new DeferredCommitPipeline();
		const device: GameRuntimeRenderDevice = {
			buildRenderer: async () => ({
				async destroy() {},
				drawFrame: () => EMPTY_RENDERER_FRAME_FEEDBACK,
			}),
			resources: TEST_RESOURCES,
		};
		const runtime = await GameRuntime.build(
			device,
			pipeline,
			{} as TexturePixelSource,
			ANIMATION_SOURCE,
		);

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
				sceneNodeCount: 0,
			}),
		]);

		await runtime.destroy();
	});
});

function sceneInterest(anchorLandblockId: string) {
	return {
		anchorLandblockId,
		lod: {
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
		anchorLandblockId,
		lod: {
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
		anchorLandblockId,
		lod: {
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
		anchorLandblockId,
		lod: {
			buildingRadius: null,
			envCellRadius: null,
			explicitObjectRadius: null,
			generatedObjectRadius: 0,
			terrainRadius: 0,
		},
	} as const;
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
function promotedBuildingArtifact(landblockId: string): LandblockLayerCommit {
	return promotedStaticArtifact(landblockId, LandblockLayerKind.Buildings);
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
): LandblockLayerCommit {
	const promotedResident: AuthoredDynamicSource = {
		behavior: {
			animationId: "0x03000001",
			kind: "animation-only",
			physicsScriptId: null,
			physicsScriptTableId: null,
			soundTableId: null,
		},
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
	const source = {
		dynamicSources: [promotedResident],
		kind: layer,
		landblockId,
		staticResidents: [],
	} satisfies ResolvedOutdoorStaticLayerSource;
	return {
		commit: { source },
		landblockId,
		layer,
	};
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
