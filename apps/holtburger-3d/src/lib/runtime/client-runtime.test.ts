import { describe, expect, it, vi } from "vitest";
import type {
	AssetService,
	AssetServiceOverviewSnapshot,
	AssetServiceSnapshot,
	HostAssetKey,
	PreparedAsset,
	PreparedAssetLease,
} from "../assets/contracts";
import { HostBackedAssetService } from "../assets/asset-service";
import type {
	RuntimeHost,
	RuntimeHostSnapshot,
} from "../host/runtime-contracts";
import type {
	AnimationPayloadDto,
	PreparedTexturePayloadDto,
} from "../host/contracts";
import {
	applyWeenieSpawnSeedToForm,
	createDefaultBrowserSpawnFormState,
	validateBrowserSpawnForm,
} from "../browser/runtime-spawn-form";
import { DYNAMIC_ANIMATION_FRAME_RATE_FPS } from "../dynamic/dynamic-animation-player";
import type {
	DebugOverlayPrimitive,
	Renderer,
	RendererFrameTelemetry,
	RendererFrameTelemetryListener,
	RendererStaticLayerVisibility,
	RendererSnapshot,
	DynamicRendererResourceCommit,
	DynamicRendererInstanceCommit,
	EnvCellSystemLayerPayload,
	OutdoorBuildingsLayerPayload,
	OutdoorDetailsLayerPayload,
	PortalFrameWorkPlan,
	RenderPassPlan,
	SamplerPolicyUpdate,
	TerrainLayerPayload,
	TexturePlacementUpdate,
} from "../renderer/types";
import { StaticCoordinator } from "../static/coordinator/static-coordinator";
import type {
	PreparedRgbaRenderSurfaceTextureUseIdentity,
	StaticBakeTextureUse,
	StaticMaterialCoverageReport,
	OutdoorStaticObjectsScopePayload,
	StaticObjectGeometryStaticDrawUnit,
	StaticObjectRenderInstance,
	StaticObjectVisualResource,
	StaticPortalApertureResource,
	StaticPortalInteriorRecord,
	StructuredInteriorGeometryStaticDrawUnit,
	StaticAuthoredDynamicSeedRecord,
	StaticDomain,
	StaticWorkPeerRecordOwner,
	TerrainStaticScopePayload,
	TerrainGeometryStaticDrawUnit,
	TerrainMaterialFallbackReason,
} from "../static/contracts";
import {
	DeferredStaticBaker,
	DeferredStaticResolver,
} from "../static/fake-workers";
import { createEnvCellStaticPortalGraph } from "../static/portal-graphs";
import {
	createClientRuntime,
	type RuntimeEvent,
	type RuntimeDiagnosticsSnapshot,
} from "./client-runtime";
import {
	FIRST_RUNTIME_SPAWN_FIXTURE,
	createFirstRuntimeSpawnFixtureRequest,
} from "./runtime-spawn-fixtures";
import {
	createOutdoorStaticObjectSelectionKey,
	createTerrainQuadSelectionKey,
} from "./scene-query/static-selection-keys";
import type { RuntimeDiagnostics } from "./diagnostics";

const TEST_SET_OMEGA_HOOK_TYPE = 22;
const TEST_SET_OMEGA_Z = -0.03836006671190262;
const TEST_SET_OMEGA_RAW_PAYLOAD_BYTES = [
	0, 0, 0, 0, 0, 0, 0, 0, 0x72, 0x20, 0x1d, 0xbd,
] as const;

const silentDiagnostics: RuntimeDiagnostics = {
	warn() {},
};

describe("browser client runtime", () => {
	it("creates explicit runtime diagnostics snapshots on demand", () => {
		const renderer = new FakeRenderer();
		const runtime = createClientRuntime({
			diagnostics: silentDiagnostics,
			host: new FakeRuntimeHost(),
			renderer,
		});

		const initialDiagnosticsSnapshot = runtime.createDiagnosticsSnapshot();
		runtime.setTextureFilteringMode("nearest");
		const updatedDiagnosticsSnapshot = runtime.createDiagnosticsSnapshot();

		expect(initialDiagnosticsSnapshot.renderPolicy.textureFilteringMode).toBe(
			"anisotropic-4x",
		);
		expect(updatedDiagnosticsSnapshot.renderPolicy.textureFilteringMode).toBe(
			"nearest",
		);
		expect(renderer.diagnosticsSnapshotCount).toBeGreaterThanOrEqual(3);
		runtime.dispose();
	});

	it("creates cheap runtime overview snapshots without full diagnostic builders", () => {
		const assetService = new DeferredAssetService();
		const renderer = new FakeRenderer();
		const staticCoordinator = createImmediateStaticCoordinator({
			baker: new DeferredStaticBaker(),
			resolver: new DeferredStaticResolver(),
		});
		const runtime = createClientRuntime({
			assetService,
			diagnostics: silentDiagnostics,
			host: new FakeRuntimeHost(),
			renderer,
			staticCoordinator,
		});
		const staticSnapshotSpy = vi
			.spyOn(staticCoordinator, "createSnapshot")
			.mockImplementation(() => {
				throw new Error("Full static coordinator snapshot should not run.");
			});
		const rendererDiagnosticsBeforeOverview = renderer.diagnosticsSnapshotCount;

		runtime.setTextureFilteringMode("nearest");
		const overviewSnapshot = runtime.createOverviewSnapshot();

		expect(overviewSnapshot.renderPolicy.textureFilteringMode).toBe("nearest");
		expect(overviewSnapshot.assets).toEqual({
			committedCount: 0,
			pendingCount: 0,
		});
		expect(overviewSnapshot.staticSceneQuery).toEqual({
			envCellLandblockCount: 0,
			envCellRecordCount: 0,
			outdoorRecordCount: 0,
		});
		expect(assetService.snapshotCount).toBe(0);
		expect(renderer.diagnosticsSnapshotCount).toBe(
			rendererDiagnosticsBeforeOverview,
		);
		expect(staticSnapshotSpy).not.toHaveBeenCalled();

		staticSnapshotSpy.mockRestore();
		runtime.dispose();
	});

	it("passes manual domain coverage radii into static demand planning", () => {
		const resolver = new DeferredStaticResolver();
		const runtime = createClientRuntime({
			diagnostics: silentDiagnostics,
			host: new FakeRuntimeHost(),
			renderer: new FakeRenderer(),
			staticCoordinator: createImmediateStaticCoordinator({
				baker: new DeferredStaticBaker(),
				resolver,
			}),
		});

		updateOutdoorSceneInterest(runtime, {
			domains: ["buildings", "terrain", "env-cells"],
			lod: {
				buildings: 0,
				terrain: 1,
				envCells: 0,
			},
		});

		expect(
			resolver.pendingRequests.filter(
				(request) => request.job.domain === "outdoor-terrain",
			),
		).toHaveLength(9);
		expect(
			resolver.pendingRequests.filter(
				(request) => request.job.domain === "outdoor-buildings",
			),
		).toHaveLength(1);
		expect(
			resolver.pendingRequests.filter(
				(request) => request.job.domain === "landblock-env-cells",
			),
		).toHaveLength(1);
		runtime.dispose();
	});

	it("ingests outdoor static-authored dynamic seeds and evicts them with source scopes", async () => {
		const resolver = new DeferredStaticResolver();
		const baker = new DeferredStaticBaker();
		const renderer = new FakeRenderer();
		const runtime = createClientRuntime({
			assetService: createResolvingAssetService(),
			diagnostics: silentDiagnostics,
			host: new FakeRuntimeHost(),
			renderer,
			staticCoordinator: createImmediateStaticCoordinator({ baker, resolver }),
		});

		updateOutdoorSceneInterest(runtime, {
			domains: ["buildings", "terrain"],
			lod: {
				buildings: 0,
				terrain: 0,
			},
		});
		completeResolverRequest(resolver, "outdoor-buildings", 0xda55ffff);
		await flushPromises();

		const workId = "1:landblock:da55ffff:outdoor-buildings";
		baker.complete(workId, {
			staticAuthoredDynamicSeeds: [createOutdoorDynamicSeedRecord(workId)],
		});
		await flushRuntimeWork();

		const loadedDiagnosticsSnapshot = runtime.createDiagnosticsSnapshot();
		expect(loadedDiagnosticsSnapshot.dynamic).toMatchObject({
			activeEntityCount: 1,
			nonRenderableEntityCount: 0,
			staticSeedCount: 1,
		});
		expect(loadedDiagnosticsSnapshot.dynamic.records[0]).toMatchObject({
			animation: {
				defaultAnimationId: 0x0300061b,
			},
			source: {
				setupModelId: 0x020003e5,
			},
			resources: {
				setupAnimation: {
					animationAssetId: "animation/0300061b",
					status: "ready",
				},
				status: "ready",
				visual: {
					status: "ready",
				},
			},
		});
		const diagnosticsReport = runtime.createDiagnosticsReport();
		const dynamicReport = diagnosticsReport.domains.find(
			(domain) => domain.kind === "dynamic",
		);
		expect(dynamicReport).toEqual({
			kind: "dynamic",
			summary: {
				active: 1,
				indexed: 1,
				nonRenderable: 0,
				renderable: 1,
				resourceFailed: 0,
				resourcePending: 0,
				staticAuthoredSeeds: 1,
			},
		});
		expect(dynamicReport).not.toHaveProperty("records");

		updateRuntimeFrame(runtime, 1);
		const tickedDynamicReport = runtime
			.createDiagnosticsReport()
			.domains.find((domain) => domain.kind === "dynamic");
		expect(tickedDynamicReport).toMatchObject({
			summary: {
				indexed: 1,
			},
		});
		const entityId = runtime.createDiagnosticsSnapshot().dynamic.records[0]?.id;
		if (!entityId) {
			throw new Error("Expected an ingested dynamic entity id.");
		}
		const dynamicSelectionReport =
			runtime.createDynamicSelectionDiagnosticsReport(entityId, {
				pickDistance: 4,
			});
		expect(dynamicSelectionReport).toMatchObject({
			debugBounds: {
				max: { x: 1, y: 1, z: 1 },
				min: { x: 0, y: 0, z: 0 },
			},
			entity: {
				animation: {
					frameCount: 1,
					partCount: 1,
					status: "ready",
				},
				renderability: {
					reasons: [],
					status: "renderable",
				},
				rendererIdentity: {
					eligible: true,
					instanceId: `dynamic-instance:${entityId}`,
					visualResourceId: `dynamic-visual-resource:${entityId}`,
				},
				resources: {
					status: "ready",
					visual: {
						renderPartCount: 1,
						status: "ready",
					},
				},
				source: {
					setupModelId: 0x020003e5,
				},
			},
			kind: "dynamic-selection-diagnostics-report",
			selection: {
				entityId,
				pickDistance: 4,
			},
		});
		expect(JSON.stringify(dynamicSelectionReport)).not.toContain("partPoses");
		expect(JSON.stringify(dynamicSelectionReport)).not.toContain("renderParts");
		runtime.setSceneDebugSelection({
			entityId,
			kind: "dynamic",
		});
		expect(renderer.debugOverlayUpdates.at(-1)).toEqual([
			{
				color: [1, 0.85, 0.1, 1],
				id: `dynamic:${entityId}`,
				kind: "aabb",
				max: [1, 1, 1],
				min: [0, 0, 0],
			},
		]);

		runtime.updateSceneInterest({ kind: "none" });

		expect(runtime.createDiagnosticsSnapshot().dynamic).toMatchObject({
			activeEntityCount: 0,
			staticSeedCount: 0,
		});
		runtime.dispose();
	});

	it("exposes dynamic setup and animation resource readiness through explicit snapshots", async () => {
		const resolver = new DeferredStaticResolver();
		const baker = new DeferredStaticBaker();
		const assetService = new DeferredAssetService();
		const runtime = createClientRuntime({
			assetService,
			diagnostics: silentDiagnostics,
			host: new FakeRuntimeHost(),
			renderer: new FakeRenderer(),
			staticCoordinator: createImmediateStaticCoordinator({ baker, resolver }),
		});

		updateOutdoorSceneInterest(runtime, {
			domains: ["buildings", "terrain"],
			lod: {
				buildings: 0,
				terrain: 0,
			},
		});
		completeResolverRequest(resolver, "outdoor-buildings", 0xda55ffff);
		await flushPromises();
		const workId = "1:landblock:da55ffff:outdoor-buildings";
		baker.complete(workId, {
			staticAuthoredDynamicSeeds: [createOutdoorDynamicSeedRecord(workId)],
		});
		await flushPromises();

		expect(
			runtime.createDiagnosticsSnapshot().dynamic.records[0]?.resources,
		).toMatchObject({
			setupAnimation: {
				status: "pending",
			},
			status: "pending",
		});
		expect(assetService.pendingKeys).toEqual([
			{ id: "020003e5", kind: "setup-model" },
			{ id: "0300061b", kind: "animation" },
		]);

		assetService.resolveNext(
			createPreparedAsset(assetService.pendingKeys[0] ?? failKey()),
		);
		assetService.resolveNext(
			createPreparedAsset(assetService.pendingKeys[1] ?? failKey()),
		);
		await flushRuntimeWork();

		const readyDiagnosticsSnapshot = runtime.createDiagnosticsSnapshot();
		expect(readyDiagnosticsSnapshot.dynamic.records[0]).toMatchObject({
			animation: {
				status: "ready",
			},
			renderability: {
				reasons: ["visual-resources-pending"],
			},
			resources: {
				setupAnimation: {
					animationAssetId: "animation/0300061b",
					status: "ready",
				},
				status: "setup-animation-ready",
			},
		});
		expect(
			"payload" in
				(readyDiagnosticsSnapshot.dynamic.records[0]?.resources
					.setupAnimation ?? {}),
		).toBe(false);

		runtime.dispose();
	});

	it("commits ready dynamic visual resources to the renderer without static layer ownership", async () => {
		const resolver = new DeferredStaticResolver();
		const baker = new DeferredStaticBaker();
		const assetService = new DeferredAssetService();
		const renderer = new FakeRenderer();
		const runtime = createClientRuntime({
			assetService,
			diagnostics: silentDiagnostics,
			host: new FakeRuntimeHost(),
			renderer,
			staticCoordinator: createImmediateStaticCoordinator({ baker, resolver }),
		});

		updateOutdoorSceneInterest(runtime, {
			domains: ["buildings", "terrain"],
			lod: {
				buildings: 0,
				terrain: 0,
			},
		});
		completeResolverRequest(resolver, "outdoor-buildings", 0xda55ffff);
		await flushPromises();
		const workId = "1:landblock:da55ffff:outdoor-buildings";
		baker.complete(workId, {
			staticAuthoredDynamicSeeds: [createOutdoorDynamicSeedRecord(workId)],
		});
		await flushRuntimeWork();

		await resolvePendingDynamicAssetsUntil(
			assetService,
			() => renderer.createDiagnosticsSnapshot().dynamicVisualResources > 0,
		);

		const rendererSnapshot = renderer.createDiagnosticsSnapshot();
		expect(rendererSnapshot).toMatchObject({
			dynamicVisualResources: 1,
			staticObjectRenderInstances: 0,
			staticObjectVisualResources: 0,
		});
		expect(rendererSnapshot.recentDynamicResourceCommits.at(-1)).toMatchObject({
			addedVisualResources: 1,
			removedVisualResources: 0,
			textureUses: 1,
		});
		const dynamicResource =
			renderer.dynamicResourceCommits.at(-1)?.addedVisualResources[0];
		expect(dynamicResource?.parts[0]).toMatchObject({
			indexType: "uint16",
			materialFamily: "texture-rgba",
			materialPass: "opaque",
			partIndex: 0,
			sourceAssetId: "gfx-obj/01000020",
			textureUseIds: [
				dynamicResource.materialPlan.textureUses[0]?.textureUseId,
			],
			triangleCount: 1,
			vertexCount: 3,
		});
		expect(Array.from(dynamicResource?.parts[0]?.positions ?? [])).toEqual([
			0, 0, 0, 1, 0, 0, 0, 1, 0,
		]);
		expect(Array.from(dynamicResource?.parts[0]?.texCoords ?? [])).toEqual([
			0, 0, 1, 0, 0, 1,
		]);

		updateRuntimeFrame(runtime, 1);
		expect(renderer.createDiagnosticsSnapshot()).toMatchObject({
			dynamicInstances: 1,
			skippedDynamicSubmissions: 0,
		});
		expect(runtime.createDiagnosticsSnapshot().renderer).toMatchObject({
			dynamicInstances: 1,
			dynamicVisualResources: 1,
		});

		runtime.dispose();
	});

	it("renders and removes the ACE WCID 1 runtime spawn fixture without animation playback", async () => {
		const renderer = new FakeRenderer();
		const runtime = createClientRuntime({
			assetService: createResolvingAssetService(),
			diagnostics: silentDiagnostics,
			host: new FakeRuntimeHost(),
			renderer,
		});

		const entityId = runtime.createRuntimeSpawn(
			createFirstRuntimeSpawnFixtureRequest(),
		);
		await flushDynamicRendererResources(renderer);

		expect(
			runtime.createDiagnosticsSnapshot().dynamic.records[0],
		).toMatchObject({
			animation: {
				playback: {
					reason: "animation-not-selected",
					status: "not-required",
				},
				status: "not-required",
			},
			presentation: {
				diagnostics: {
					kind: "runtime-spawn",
				},
			},
			renderability: {
				reasons: [],
				status: "renderable",
			},
			resources: {
				setupAnimation: {
					reason: "animation-not-selected",
					status: "not-required",
				},
				status: "ready",
				visual: {
					status: "ready",
				},
			},
			source: {
				animationSelection: { kind: "none" },
				kind: "runtime-spawn",
				runtimeEntityId: entityId,
				setupModelId: FIRST_RUNTIME_SPAWN_FIXTURE.setupModelId,
			},
		});

		updateRuntimeFrame(runtime, 1);

		expect(renderer.createDiagnosticsSnapshot()).toMatchObject({
			dynamicInstances: 1,
			dynamicVisualResources: 1,
			skippedDynamicSubmissions: 0,
		});
		expect(renderer.dynamicInstanceCommits.at(-1)?.instances[0]).toMatchObject({
			entityId,
			instanceId: `dynamic-instance:${entityId}`,
			partToObjectMatrices: [
				{
					partIndex: 0,
				},
			],
			resourceId: `dynamic-visual-resource:${entityId}`,
		});
		const dynamicSelectionReport =
			runtime.createDynamicSelectionDiagnosticsReport(entityId);
		expect(dynamicSelectionReport).toMatchObject({
			debugBounds: {
				max: { x: 1, y: 1, z: 1 },
				min: { x: 0, y: 0, z: 0 },
			},
			entity: {
				rendererIdentity: {
					eligible: true,
					instanceId: `dynamic-instance:${entityId}`,
					visualResourceId: `dynamic-visual-resource:${entityId}`,
				},
			},
		});

		expect(runtime.removeRuntimeSpawn(entityId)).toBe(true);
		await flushRuntimeWork();
		updateRuntimeFrame(runtime, 2);

		expect(runtime.createDiagnosticsSnapshot().dynamic).toMatchObject({
			activeEntityCount: 0,
			runtimeSpawnCount: 0,
		});
		expect(renderer.createDiagnosticsSnapshot()).toMatchObject({
			dynamicInstances: 0,
			dynamicVisualResources: 0,
		});

		runtime.dispose();
	});

	it("renders manual, WCID-seeded, and env-cell browser spawn requests independently", async () => {
		const renderer = new FakeRenderer();
		const runtime = createClientRuntime({
			assetService: createResolvingAssetService(),
			diagnostics: silentDiagnostics,
			host: new FakeRuntimeHost(),
			renderer,
		});
		const manualResult = validateBrowserSpawnForm({
			...createDefaultBrowserSpawnFormState(),
			label: "Manual runtime human",
			originX: "4",
			serverInstanceId: "server-object:manual",
			weenieClassId: "",
		});
		const seededResult = validateBrowserSpawnForm(
			applyWeenieSpawnSeedToForm(createDefaultBrowserSpawnFormState(), {
				label: FIRST_RUNTIME_SPAWN_FIXTURE.label,
				setupModelId: FIRST_RUNTIME_SPAWN_FIXTURE.setupModelId,
				weenieClassId: FIRST_RUNTIME_SPAWN_FIXTURE.weenieClassId,
			}),
		);
		const envCellResult = validateBrowserSpawnForm({
			...createDefaultBrowserSpawnFormState(),
			envCellId: "0xda550100",
			label: "Env-cell runtime human",
			residenceMode: "env-cell",
			serverInstanceId: "server-object:env-cell",
		});
		if (
			manualResult.kind !== "accepted" ||
			seededResult.kind !== "accepted" ||
			envCellResult.kind !== "accepted"
		) {
			throw new Error("expected accepted browser runtime spawn form requests");
		}
		expect(envCellResult.request.sourceResidence).toEqual({
			envCellId: 0xda550100,
			kind: "env-cell",
			landblockId: 0xda55ffff,
		});

		const manualEntityId = runtime.createRuntimeSpawn(manualResult.request);
		const seededEntityId = runtime.createRuntimeSpawn(seededResult.request);
		const envCellEntityId = runtime.createRuntimeSpawn(envCellResult.request);
		await flushDynamicRendererResourceCount(renderer, 3);
		updateRuntimeFrame(runtime, 1);

		const dynamicSnapshot = runtime.createDiagnosticsSnapshot().dynamic;
		expect(dynamicSnapshot).toMatchObject({
			activeEntityCount: 3,
			runtimeSpawnCount: 3,
		});
		expect(
			dynamicSnapshot.records.find((record) => record.id === envCellEntityId),
		).toMatchObject({
			sourceResidence: {
				envCellId: 0xda550100,
				kind: "env-cell",
				landblockId: 0xda55ffff,
			},
		});
		expect(
			runtime.createDynamicSelectionDiagnosticsReport(manualEntityId),
		).toMatchObject({
			entity: {
				source: {
					serverInstanceIdMetadata: { id: "server-object:manual" },
				},
			},
		});
		expect(renderer.createDiagnosticsSnapshot()).toMatchObject({
			dynamicInstances: 3,
			dynamicVisualResources: 3,
		});
		expect(
			runtime.createDynamicSelectionDiagnosticsReport(envCellEntityId),
		).toMatchObject({
			entity: {
				source: {
					serverInstanceIdMetadata: { id: "server-object:env-cell" },
				},
			},
		});

		expect(runtime.removeRuntimeSpawn(manualEntityId)).toBe(true);
		await flushRuntimeWork();
		updateRuntimeFrame(runtime, 2);

		expect(runtime.createDiagnosticsSnapshot().dynamic).toMatchObject({
			activeEntityCount: 2,
			runtimeSpawnCount: 2,
		});
		expect(renderer.createDiagnosticsSnapshot()).toMatchObject({
			dynamicInstances: 2,
			dynamicVisualResources: 2,
		});
		expect(runtime.removeRuntimeSpawn(seededEntityId)).toBe(true);
		expect(runtime.removeRuntimeSpawn(envCellEntityId)).toBe(true);

		runtime.dispose();
	});

	it("requests setup appearance override assets for browser spawns with model data", async () => {
		const assetService = new DeferredAssetService();
		const renderer = new FakeRenderer();
		const runtime = createClientRuntime({
			assetService,
			diagnostics: silentDiagnostics,
			host: new FakeRuntimeHost(),
			renderer,
		});
		const result = validateBrowserSpawnForm(
			applyWeenieSpawnSeedToForm(createDefaultBrowserSpawnFormState(), {
				appearance: {
					animPartChanges: [{ partId: 0x01001234, partIndex: 16 }],
					paletteId: 0x04000001,
					subPalettes: [{ numColors: 24, offset: 0, subId: 0x04000101 }],
					textureChanges: [
						{
							newTexture: 0x05002222,
							oldTexture: 0x05001111,
							partIndex: 16,
						},
					],
				},
				label: "Runtime appearance bartender",
				setupModelId: 0x0200004e,
				weenieClassId: 42810,
			}),
		);
		if (result.kind !== "accepted") {
			throw new Error("expected accepted browser runtime spawn form request");
		}

		runtime.createRuntimeSpawn(result.request);
		await resolvePendingDynamicAssetsUntil(
			assetService,
			() => renderer.createDiagnosticsSnapshot().dynamicVisualResources > 0,
		);

		expect(
			assetService.pendingKeys.some(
				(key) =>
					key.kind === "setup-appearance" &&
					key.id.startsWith("0200004e?"),
			),
		).toBe(true);

		runtime.dispose();
	});

	it("updates dynamic renderer submissions from frame ticks without creating full runtime snapshots", async () => {
		const resolver = new DeferredStaticResolver();
		const baker = new DeferredStaticBaker();
		const assetService = new DeferredAssetService();
		const renderer = new FakeRenderer();
		const runtime = createClientRuntime({
			assetService,
			diagnostics: silentDiagnostics,
			host: new FakeRuntimeHost(),
			renderer,
			staticCoordinator: createImmediateStaticCoordinator({ baker, resolver }),
		});

		updateOutdoorSceneInterest(runtime, {
			domains: ["buildings", "terrain"],
			lod: {
				buildings: 0,
				terrain: 0,
			},
		});
		completeResolverRequest(resolver, "outdoor-buildings", 0xda55ffff);
		await flushPromises();
		const workId = "1:landblock:da55ffff:outdoor-buildings";
		baker.complete(workId, {
			staticAuthoredDynamicSeeds: [createOutdoorDynamicSeedRecord(workId)],
		});
		await flushRuntimeWork();

		await resolvePendingDynamicAssetsUntil(
			assetService,
			() => renderer.createDiagnosticsSnapshot().dynamicVisualResources > 0,
		);
		const assetSnapshotCountBeforeFrames = assetService.snapshotCount;
		const instanceCommitCountBeforeFrames =
			renderer.dynamicInstanceCommits.length;

		updateRuntimeFrame(runtime, 1);
		updateRuntimeFrame(runtime, 2);

		expect(renderer.dynamicInstanceCommits).toHaveLength(
			instanceCommitCountBeforeFrames + 2,
		);
		expect(renderer.dynamicInstanceCommits.at(-1)?.instances).toHaveLength(1);
		expect(assetService.snapshotCount).toBe(assetSnapshotCountBeforeFrames);
		runtime.dispose();
	});

	it("commits active SetOmega object-root transforms into dynamic instances", async () => {
		const resolver = new DeferredStaticResolver();
		const baker = new DeferredStaticBaker();
		const renderer = new FakeRenderer();
		const runtime = createClientRuntime({
			assetService: createResolvingSetOmegaAssetService(),
			diagnostics: silentDiagnostics,
			host: new FakeRuntimeHost(),
			renderer,
			staticCoordinator: createImmediateStaticCoordinator({ baker, resolver }),
		});

		updateOutdoorSceneInterest(runtime, {
			domains: ["buildings", "terrain"],
			lod: {
				buildings: 0,
				terrain: 0,
			},
		});
		completeResolverRequest(resolver, "outdoor-buildings", 0xda55ffff);
		await flushPromises();
		const workId = "1:landblock:da55ffff:outdoor-buildings";
		baker.complete(workId, {
			staticAuthoredDynamicSeeds: [createOutdoorDynamicSeedRecord(workId)],
		});
		await flushRuntimeWork();

		updateRuntimeFrame(runtime, 1);
		updateRuntimeFrame(runtime, 2);

		const instance =
			renderer.dynamicInstanceCommits.at(-1)?.instances[0] ?? null;
		expect(instance?.objectToRenderMatrix[0]).toBeCloseTo(
			Math.cos(TEST_SET_OMEGA_Z * DYNAMIC_ANIMATION_FRAME_RATE_FPS),
			7,
		);
		expect(instance?.objectToRenderMatrix[2]).toBeCloseTo(
			-Math.sin(TEST_SET_OMEGA_Z * DYNAMIC_ANIMATION_FRAME_RATE_FPS),
			7,
		);

		runtime.dispose();
	});

	it("ingests classified env-cell dynamic seeds through the dynamic render path", async () => {
		const resolver = new DeferredStaticResolver();
		const baker = new DeferredStaticBaker();
		const renderer = new FakeRenderer();
		const warnings: unknown[] = [];
		const runtime = createClientRuntime({
			assetService: createResolvingAssetService(),
			diagnostics: {
				warn(event) {
					warnings.push(event);
				},
			},
			host: new FakeRuntimeHost(),
			renderer,
			staticCoordinator: createImmediateStaticCoordinator({ baker, resolver }),
		});

		updateInteriorSceneInterest(runtime);
		completeResolverRequest(resolver, "landblock-env-cells", 0xda55ffff);
		await flushPromises();

		const workId = "1:landblock:da55ffff:landblock-env-cells";
		baker.complete(workId, {
			staticAuthoredDynamicSeeds: [
				createEnvCellStaticSeedRecord(workId),
				createEnvCellDynamicSeedRecord(workId),
			],
		});
		await flushRuntimeWork();

		const loadedDiagnosticsSnapshot = runtime.createDiagnosticsSnapshot();
		expect(loadedDiagnosticsSnapshot.dynamic).toMatchObject({
			activeEntityCount: 1,
			nonRenderableEntityCount: 0,
			staticSeedCount: 1,
		});
		expect(loadedDiagnosticsSnapshot.dynamic.records[0]).toMatchObject({
			id: "static-authored-env-cell:landblock-env-cells:landblock:da55ffff:env-cell:da550100:object:building:env-cell-static-0:setup:020003e5",
			provenance: {
				kind: "static-authored-env-cell",
				sourceScopeKey: "landblock-env-cells:landblock:da55ffff",
			},
			renderability: {
				reasons: [],
				status: "renderable",
			},
			resources: {
				setupAnimation: {
					animationAssetId: "animation/0300061b",
					status: "ready",
				},
				status: "ready",
				visual: {
					status: "ready",
				},
			},
			sourceResidence: {
				envCellId: 0xda550100,
				kind: "env-cell",
				landblockId: 0xda55ffff,
			},
		});
		for (let attempt = 0; attempt < 10; attempt += 1) {
			if (renderer.createDiagnosticsSnapshot().dynamicVisualResources > 0) {
				break;
			}
			await flushRuntimeWork();
		}
		if (
			!renderer.dynamicResourceCommits.some(
				(commit) => commit.addedVisualResources.length === 1,
			)
		) {
			throw new Error(
				`Expected env-cell dynamic visual resource commit. Warnings: ${JSON.stringify(warnings)}`,
			);
		}
		expect(warnings).toEqual([]);
		updateRuntimeFrame(runtime, 1);
		updateRuntimeFrame(runtime, 2);
		expect(renderer.dynamicInstanceCommits.at(-1)?.instances[0]).toMatchObject({
			renderResidence: {
				envCellId: 0xda550100,
				kind: "env-cell",
				landblockId: 0xda55ffff,
			},
		});

		runtime.updateSceneInterest({ kind: "none" });

		expect(runtime.createDiagnosticsSnapshot().dynamic).toMatchObject({
			activeEntityCount: 0,
			staticSeedCount: 0,
		});
		runtime.dispose();
	});

	it("accepts explicit current camera residency without provenance accounting", () => {
		const renderer = new FakeRenderer();
		const runtime = createClientRuntime({
			diagnostics: silentDiagnostics,
			host: new FakeRuntimeHost(),
			renderer,
			staticCoordinator: createImmediateStaticCoordinator({
				baker: new DeferredStaticBaker(),
				resolver: new DeferredStaticResolver(),
			}),
		});

		runtime.setCurrentCameraResidency({
			envCellId: 0xda550100,
			kind: "env-cell",
			landblockId: 0xda55ffff,
		});
		runtime.setCurrentCameraResidency({
			envCellId: 0xda550100,
			kind: "env-cell",
			landblockId: 0xda55ffff,
		});

		expect(runtime.createDiagnosticsSnapshot().currentCameraResidency).toEqual({
			envCellId: 0xda550100,
			kind: "env-cell",
			landblockId: 0xda55ffff,
		});
		expect(renderer.renderPassPlans).toEqual([]);

		runtime.dispose();
	});

	it("keeps renderer frame telemetry out of runtime snapshot planning", () => {
		const renderer = new FakeRenderer();
		const runtime = createClientRuntime({
			diagnostics: silentDiagnostics,
			host: new FakeRuntimeHost(),
			renderer,
			staticCoordinator: createImmediateStaticCoordinator({
				baker: new DeferredStaticBaker(),
				resolver: new DeferredStaticResolver(),
			}),
		});
		const frameTelemetry: RendererFrameTelemetry[] = [];
		const unsubscribeFrameTelemetry = runtime.subscribeFrameTelemetry(
			(telemetry) => {
				frameTelemetry.push(telemetry);
			},
		);
		const diagnosticsSnapshotCount = renderer.diagnosticsSnapshotCount;
		const renderPassPlanCount = renderer.renderPassPlans.length;
		const portalFrameWorkPlanCount = renderer.portalFrameWorkPlans.length;

		renderer.emitFrameTelemetry({
			directEnvCellDrawCalls: 3,
			frameCount: 42,
			frameHandlerMs: 1.5,
		});

		expect(frameTelemetry).toEqual([
			{
				directEnvCellDrawCalls: 3,
				frameCount: 42,
				frameHandlerMs: 1.5,
			},
		]);
		expect(renderer.diagnosticsSnapshotCount).toBe(diagnosticsSnapshotCount);
		expect(renderer.renderPassPlans).toHaveLength(renderPassPlanCount);
		expect(renderer.portalFrameWorkPlans).toHaveLength(
			portalFrameWorkPlanCount,
		);

		unsubscribeFrameTelemetry();
		runtime.dispose();
	});

	it("tracks flat vision mode in runtime snapshots", () => {
		const renderer = new FakeRenderer();
		const runtime = createClientRuntime({
			diagnostics: silentDiagnostics,
			host: new FakeRuntimeHost(),
			renderer,
			staticCoordinator: createImmediateStaticCoordinator({
				baker: new DeferredStaticBaker(),
				resolver: new DeferredStaticResolver(),
			}),
		});

		runtime.setFlatVisionModeEnabled(true);

		const diagnosticsSnapshot = runtime.createDiagnosticsSnapshot();
		expect(diagnosticsSnapshot.debugOverlays.flatVisionModeEnabled).toBe(true);
		expect(diagnosticsSnapshot.portalFrameWorkPlan).toEqual({
			kind: "legacy-render-pass",
			mode: "flat-resident-diagnostic",
			renderPassPlan: { kind: "single-surface-resident" },
		});
		expect(renderer.renderPassPlans).toEqual([]);
		expect(renderer.portalFrameWorkPlans).toEqual([
			{
				kind: "legacy-render-pass",
				mode: "flat-resident-diagnostic",
				renderPassPlan: { kind: "single-surface-resident" },
			},
		]);

		runtime.dispose();
	});

	it("forwards static layer visibility without changing scene interest plans", () => {
		const renderer = new FakeRenderer();
		const runtime = createClientRuntime({
			diagnostics: silentDiagnostics,
			host: new FakeRuntimeHost(),
			renderer,
			staticCoordinator: createImmediateStaticCoordinator({
				baker: new DeferredStaticBaker(),
				resolver: new DeferredStaticResolver(),
			}),
		});

		runtime.setStaticLayerVisibility({
			envCellInteriors: true,
			outdoorBuildings: false,
			outdoorDetail: true,
			terrain: false,
		});

		expect(renderer.staticLayerVisibilityUpdates).toEqual([
			{
				envCellInteriors: true,
				outdoorBuildings: false,
				outdoorDetail: true,
				terrain: false,
			},
		]);
		expect(renderer.renderPassPlans).toEqual([]);
		expect(renderer.portalFrameWorkPlans).toEqual([]);

		runtime.dispose();
	});

	it("publishes env-cell projection frame plans from committed projection inputs and runtime membership", async () => {
		const renderer = new FakeRenderer();
		const resolver = new DeferredStaticResolver();
		const baker = new DeferredStaticBaker();
		const runtime = createClientRuntime({
			diagnostics: silentDiagnostics,
			host: new FakeRuntimeHost(),
			renderer,
			staticCoordinator: createImmediateStaticCoordinator({
				baker,
				resolver,
			}),
		});

		runtime.setCurrentCameraResidency({
			envCellId: 0xda550100,
			kind: "env-cell",
			landblockId: 0xda55ffff,
		});
		updateInteriorSceneInterest(runtime);
		const buildingRequest = resolver.pendingRequests.find(
			(request) => request.job.domain === "outdoor-buildings",
		);
		const envCellRequest = resolver.pendingRequests.find(
			(request) => request.job.domain === "landblock-env-cells",
		);
		resolver.complete(buildingRequest?.requestId ?? failKey());
		await flushPromises();
		baker.complete("1:landblock:da55ffff:outdoor-buildings");
		await flushPromises();
		resolver.complete(envCellRequest?.requestId ?? failKey());
		await flushPromises();
		const portalInteriorRecord = createPortalInteriorRecord({
			envCellIds: [0xda550100, 0xda550101],
			portalLinks: [
				{
					flags: 0,
					linkId: "a-to-b",
					polygonId: null,
					source: {
						envCellId: 0xda550100,
						kind: "env-cell",
						portalId: "portal-a",
					},
					sourceIndex: 0,
					target: {
						envCellId: 0xda550101,
						kind: "env-cell",
						portalId: "portal-b",
					},
				},
			],
		});
		baker.complete("1:landblock:da55ffff:landblock-env-cells", {
			drawUnits: [
				createStructuredInteriorDrawUnit({
					drawUnitId: "structured:da550100",
					envCellId: 0xda550100,
				}),
				createStaticObjectDrawUnit("env-static-shared", {
					ownership: {
						envCellIds: [0xda550100, 0xda550101],
						kind: "env-cell-static-object-seeds",
						landblockId: 0xda55ffff,
						seedIdentities: [],
					},
				}),
			],
			staticPortalGraphs: [
				createEnvCellStaticPortalGraph(
					createEnvCellWorkOwner("work-env-portals", 0xda55ffff),
					portalInteriorRecord,
				),
			],
			staticPortalInteriorRecords: [portalInteriorRecord],
		});
		await flushRuntimeWork();

		expect(
			runtime.queryEnvCellResourceMembership({
				envCellId: 0xda550100,
				landblockId: 0xda55ffff,
			}),
		).toEqual({
			envCellId: 0xda550100,
			envCellStaticObjectDrawUnitIds: ["env-static-shared"],
			landblockId: 0xda55ffff,
			sharedEnvCellStaticObjectDrawUnits: 1,
			structuredInteriorDrawUnitIds: ["structured:da550100"],
		});
		expect(
			runtime.queryEnvCellResourceMembership({
				envCellId: 0xda550101,
				landblockId: 0xda55ffff,
			}),
		).toEqual({
			envCellId: 0xda550101,
			envCellStaticObjectDrawUnitIds: ["env-static-shared"],
			landblockId: 0xda55ffff,
			sharedEnvCellStaticObjectDrawUnits: 1,
			structuredInteriorDrawUnitIds: [],
		});
		expect(renderer.renderPassPlans).toEqual([
			{
				baseScene: {
					envCellId: 0xda550100,
					kind: "interior",
					landblockId: 0xda55ffff,
				},
				kind: "portal-scene-domains",
				transitionDepthPolicy: { maxDepth: 4 },
			},
		]);
		expect(renderer.portalFrameWorkPlans.at(-1)).toMatchObject({
			kind: "direct-env-cell",
			mode: "portal-projection",
		});
		const cachedPortalFrameWorkPlanCount = renderer.portalFrameWorkPlans.length;

		runtime.setCurrentCameraResidency({
			envCellId: 0xda550100,
			kind: "env-cell",
			landblockId: 0xda55ffff,
		});

		expect(renderer.portalFrameWorkPlans).toHaveLength(
			cachedPortalFrameWorkPlanCount,
		);

		runtime.setDirectEnvCellPortalMaxDepth(0);

		expect(renderer.portalFrameWorkPlans.at(-1)).toMatchObject({
			layeredGraph: {
				baseEntry: expect.objectContaining({
					scene: expect.objectContaining({ envCellId: 0xda550100 }),
				}),
				renderEntries: [],
				renderLayers: [],
			},
			kind: "direct-env-cell",
			mode: "portal-projection",
		});
		expect(
			renderer.portalFrameWorkPlans.at(-1)?.kind === "direct-env-cell" &&
				renderer.portalFrameWorkPlans.at(-1)?.mode === "portal-projection"
				? renderer.portalFrameWorkPlans.at(-1)?.layeredGraph.renderEntries
						.length
				: -1,
		).toBe(0);
		const depthChangedPortalFrameWorkPlanCount =
			renderer.portalFrameWorkPlans.length;

		runtime.setCurrentCameraResidency({
			envCellId: 0xda550101,
			kind: "env-cell",
			landblockId: 0xda55ffff,
		});

		expect(renderer.portalFrameWorkPlans.length).toBeGreaterThan(
			depthChangedPortalFrameWorkPlanCount,
		);

		runtime.dispose();
	});

	it("attaches retained exterior suffix composites to env-cell outdoor crossing plans", async () => {
		const renderer = new FakeRenderer();
		const resolver = new DeferredStaticResolver();
		const baker = new DeferredStaticBaker();
		const runtime = createClientRuntime({
			diagnostics: silentDiagnostics,
			host: new FakeRuntimeHost(),
			renderer,
			staticCoordinator: createImmediateStaticCoordinator({
				baker,
				resolver,
			}),
		});

		runtime.setCurrentCameraResidency({
			envCellId: 0xda550100,
			kind: "env-cell",
			landblockId: 0xda55ffff,
		});
		updateInteriorSceneInterest(runtime);

		completeResolverRequest(resolver, "outdoor-buildings", 0xda55ffff, {
			scope: {
				...createOutdoorStaticObjectsPayload({
					domain: "outdoor-buildings",
					landblockId: 0xda55ffff,
				}),
				buildingTransitionApertures: [
					createBuildingTransitionAperture(0xda55ffff, 0xda550100),
				],
			},
		});
		completeResolverRequest(resolver, "landblock-env-cells", 0xda55ffff);
		await flushPromises();
		completeBakerWork(baker, "outdoor-buildings", 0xda55ffff, {
			portalApertureResources: [
				createBuildingTransitionPortalApertureResource({
					landblockId: 0xda55ffff,
					targetEnvCellId: 0xda550100,
				}),
			],
		});
		completeBakerWork(baker, "landblock-env-cells", 0xda55ffff, {
			drawUnits: [
				createStructuredInteriorDrawUnit({
					drawUnitId: "structured:da550100",
					envCellId: 0xda550100,
				}),
			],
			staticPortalInteriorRecords: [
				createPortalInteriorRecord({
					envCellIds: [0xda550100],
					portalLinks: [],
				}),
			],
		});
		await flushRuntimeWork();

		const plan = renderer.portalFrameWorkPlans.at(-1);
		expect(plan).toMatchObject({
			exteriorComposite: {
				maxDepth: 1,
			},
			kind: "direct-env-cell",
			mode: "portal-projection",
		});
		if (plan?.kind !== "direct-env-cell") {
			throw new Error("Expected direct env-cell portal projection plan.");
		}
		expect(plan.layeredGraph.outdoorCrossings).toEqual([
			expect.objectContaining({
				outdoorLandblockId: 0xda55ffff,
				targetEnvCellId: 0xda550100,
			}),
		]);
		expect(plan.exteriorComposite?.graphs).toHaveLength(1);
		expect(plan.exteriorComposite?.graphs[0]?.baseEntry.scene).toEqual({
			kind: "outdoor-target",
			landblockId: 0xda55ffff,
		});
		expect(plan.exteriorComposite?.graphs[0]?.renderEntries).toEqual([]);
		expect(plan.exteriorComposite?.graphs[0]?.renderLayers).toEqual([]);
		expect(plan.exteriorComposite?.graphs[0]?.maskEdges).toEqual([]);
		expect(plan.exteriorComposite?.graphs[0]?.outdoorCrossings).toEqual([]);

		runtime.dispose();
	});

	it("does not derive portal pass plans without a committed interior scene", () => {
		const renderer = new FakeRenderer();
		const runtime = createClientRuntime({
			diagnostics: silentDiagnostics,
			host: new FakeRuntimeHost(),
			renderer,
			staticCoordinator: createImmediateStaticCoordinator({
				baker: new DeferredStaticBaker(),
				resolver: new DeferredStaticResolver(),
			}),
		});

		runtime.setCurrentCameraResidency({
			kind: "outdoor-landblock",
			landblockId: 0xda55ffff,
		});

		expect(renderer.renderPassPlans).toEqual([]);

		runtime.setCurrentCameraResidency({
			kind: "unknown",
			landblockId: 0xdb55ffff,
		});

		expect(renderer.renderPassPlans).toEqual([]);

		runtime.dispose();
	});

	it("publishes outdoor projection frame plans from committed projection inputs", async () => {
		const renderer = new FakeRenderer();
		const resolver = new DeferredStaticResolver();
		const baker = new DeferredStaticBaker();
		const runtime = createClientRuntime({
			diagnostics: silentDiagnostics,
			host: new FakeRuntimeHost(),
			renderer,
			staticCoordinator: createImmediateStaticCoordinator({
				baker,
				resolver,
			}),
		});

		runtime.setCurrentCameraResidency({
			kind: "outdoor-landblock",
			landblockId: 0xda55ffff,
		});
		updateOutdoorSceneInterest(runtime, {
			domains: ["terrain", "buildings", "env-cells"],
			lod: { buildings: 0, envCells: 0, terrain: 0 },
		});
		const buildingRequest = resolver.pendingRequests.find(
			(request) => request.job.domain === "outdoor-buildings",
		);
		expect(buildingRequest).toBeDefined();
		resolver.complete(buildingRequest?.requestId ?? "", {
			scope: {
				...createOutdoorStaticObjectsPayload(),
				buildingTransitionApertures: [
					{
						apertureId: "transition-aperture:0",
						buildingInstanceId: "building-0",
						buildingPortalId: "building-portal-0",
						buildingPortalSourceIndex: 0,
						flags: 0,
						linkedEnvCellIds: [0xda550100],
						otherCellId: 0x0100,
						otherPortalId: 0xffff,
						points: [
							{ x: 0, y: 0, z: 0 },
							{ x: 1, y: 0, z: 0 },
							{ x: 0, y: 1, z: 0 },
						],
						polyId: 7,
						portalIndex: 0,
						sourceAssetId: "gfx-obj/01001234",
						sourceDid: 0x01001234,
					},
				],
				domain: "outdoor-buildings",
			},
		});
		await flushPromises();
		baker.complete("1:landblock:da55ffff:outdoor-buildings", {
			portalApertureResources: [
				createBuildingTransitionPortalApertureResource({
					targetEnvCellId: 0xda550100,
				}),
			],
		});
		await flushPromises();
		const envCellRequest = resolver.pendingRequests.find(
			(request) => request.job.domain === "landblock-env-cells",
		);
		expect(envCellRequest).toBeDefined();
		resolver.complete(envCellRequest?.requestId ?? "");
		await flushPromises();
		baker.complete("1:landblock:da55ffff:landblock-env-cells", {
			drawUnits: [
				createStructuredInteriorDrawUnit({
					drawUnitId: "structured:da550100",
					envCellId: 0xda550100,
				}),
			],
			staticPortalInteriorRecords: [
				createPortalInteriorRecord({
					envCellIds: [0xda550100],
					portalLinks: [],
				}),
			],
		});
		await flushRuntimeWork();

		expect(renderer.portalFrameWorkPlans.at(-1)).toMatchObject({
			kind: "direct-env-cell",
			mode: "portal-projection",
			layeredGraph: {
				renderEntries: [
					expect.objectContaining({
						envCellId: 0xda550100,
						renderLayer: 1,
						resources: expect.objectContaining({
							structuredInteriorDrawUnitIds: ["structured:da550100"],
						}),
					}),
				],
				renderLayers: [{ renderEntryIds: [0], renderLayer: 1 }],
			},
		});
		expect(
			renderer.portalFrameWorkPlans.at(-1)?.kind === "direct-env-cell" &&
				renderer.portalFrameWorkPlans.at(-1)?.mode === "portal-projection"
				? renderer.portalFrameWorkPlans.at(-1)?.layeredGraph.maskEdges.length
				: 0,
		).toBe(1);

		runtime.dispose();
	});

	it("publishes outdoor projection frame plans across retained neighboring outdoor landblocks", async () => {
		const renderer = new FakeRenderer();
		const resolver = new DeferredStaticResolver();
		const baker = new DeferredStaticBaker();
		const runtime = createClientRuntime({
			diagnostics: silentDiagnostics,
			host: new FakeRuntimeHost(),
			renderer,
			staticCoordinator: createImmediateStaticCoordinator({
				baker,
				resolver,
			}),
		});

		runtime.setCurrentCameraResidency({
			kind: "outdoor-landblock",
			landblockId: 0xda55ffff,
		});
		updateOutdoorSceneInterest(runtime, {
			anchorLandblockId: 0xdb55ffff,
			domains: ["buildings", "env-cells", "terrain"],
			lod: { buildings: 0, envCells: 0, terrain: 0 },
		});

		completeResolverRequest(resolver, "outdoor-terrain", 0xdb55ffff);
		completeResolverRequest(resolver, "outdoor-buildings", 0xdb55ffff, {
			scope: {
				...createOutdoorStaticObjectsPayload({
					domain: "outdoor-buildings",
					landblockId: 0xdb55ffff,
				}),
				buildingTransitionApertures: [
					createBuildingTransitionAperture(0xdb55ffff, 0xdb550100),
				],
			},
		});
		completeResolverRequest(resolver, "landblock-env-cells", 0xdb55ffff);
		await flushPromises();

		completeBakerWork(baker, "outdoor-terrain", 0xdb55ffff);
		completeBakerWork(baker, "outdoor-buildings", 0xdb55ffff, {
			portalApertureResources: [
				createBuildingTransitionPortalApertureResource({
					landblockId: 0xdb55ffff,
					targetEnvCellId: 0xdb550100,
				}),
			],
		});
		completeBakerWork(baker, "landblock-env-cells", 0xdb55ffff, {
			drawUnits: [
				createStructuredInteriorDrawUnit({
					drawUnitId: "structured:db550100",
					envCellId: 0xdb550100,
					landblockId: 0xdb55ffff,
				}),
			],
			staticPortalInteriorRecords: [
				createPortalInteriorRecord({
					envCellIds: [0xdb550100],
					landblockId: 0xdb55ffff,
					portalLinks: [],
				}),
			],
		});
		await flushRuntimeWork();

		expect(renderer.portalFrameWorkPlans.at(-1)).toMatchObject({
			kind: "direct-env-cell",
			mode: "portal-projection",
			layeredGraph: {
				renderEntries: [
					expect.objectContaining({
						envCellId: 0xdb550100,
						landblockId: 0xdb55ffff,
						renderLayer: 1,
					}),
				],
			},
		});
		expect(
			renderer.portalFrameWorkPlans.at(-1)?.kind === "direct-env-cell" &&
				renderer.portalFrameWorkPlans.at(-1).mode === "portal-projection"
				? renderer.portalFrameWorkPlans.at(-1).layeredGraph.maskEdges.length
				: 0,
		).toBe(1);

		runtime.dispose();
	});

	it("keeps unknown residency single-surface without a committed interior scene", () => {
		const renderer = new FakeRenderer();
		const runtime = createClientRuntime({
			diagnostics: silentDiagnostics,
			host: new FakeRuntimeHost(),
			renderer,
			staticCoordinator: createImmediateStaticCoordinator({
				baker: new DeferredStaticBaker(),
				resolver: new DeferredStaticResolver(),
			}),
		});

		updateOutdoorSceneInterest(runtime);

		expect(renderer.renderPassPlans).toEqual([]);

		runtime.dispose();
	});

	it("exposes a browser-pollable camera residency candidate query", () => {
		const runtime = createClientRuntime({
			diagnostics: silentDiagnostics,
			host: new FakeRuntimeHost(),
			renderer: new FakeRenderer(),
			staticCoordinator: createImmediateStaticCoordinator({
				baker: new DeferredStaticBaker(),
				resolver: new DeferredStaticResolver(),
			}),
		});

		expect(
			runtime.queryCameraResidencyAtPoint({
				outdoorAnchorLandblockId: 0xda55ffff,
				point: { x: 0, y: 10, z: 0 },
			}),
		).toEqual({
			kind: "outdoor-landblock",
			landblockId: 0xda55ffff,
		});

		runtime.dispose();
	});

	it("prunes runtime-owned warm asset cache entries on the maintenance cadence", () => {
		vi.useFakeTimers();
		try {
			const assetService = new DeferredAssetService();
			const runtime = createClientRuntime({
				assetMaintenanceIntervalMs: 25,
				assetService,
				diagnostics: silentDiagnostics,
				host: new FakeRuntimeHost(),
				renderer: new FakeRenderer(),
				staticCoordinator: createImmediateStaticCoordinator({
					baker: new DeferredStaticBaker(),
					resolver: new DeferredStaticResolver(),
				}),
			});

			vi.advanceTimersByTime(24);
			expect(assetService.pruneCalls).toBe(0);

			vi.advanceTimersByTime(1);
			expect(assetService.pruneCalls).toBe(1);

			runtime.dispose();
			vi.advanceTimersByTime(25);
			expect(assetService.pruneCalls).toBe(1);
		} finally {
			vi.useRealTimers();
		}
	});

	it("emits manual scene interest update and settled events", async () => {
		const resolver = new DeferredStaticResolver();
		const baker = new DeferredStaticBaker();
		const runtime = createClientRuntime({
			diagnostics: silentDiagnostics,
			host: new FakeRuntimeHost(),
			renderer: new FakeRenderer(),
			staticCoordinator: createImmediateStaticCoordinator({
				baker,
				resolver,
			}),
		});
		const events: RuntimeEvent[] = [];
		const unsubscribe = runtime.subscribeEvents((event) => {
			events.push(event);
		});

		updateInteriorSceneInterest(runtime);
		const buildingRequest = resolver.pendingRequests.find(
			(request) => request.job.domain === "outdoor-buildings",
		);
		const envCellRequest = resolver.pendingRequests.find(
			(request) => request.job.domain === "landblock-env-cells",
		);
		resolver.complete(buildingRequest?.requestId ?? failKey());
		await flushRuntimeWork();
		baker.complete("1:landblock:da55ffff:outdoor-buildings");
		await flushRuntimeWork();
		resolver.complete(envCellRequest?.requestId ?? failKey());
		await flushRuntimeWork();
		baker.complete("1:landblock:da55ffff:landblock-env-cells");
		await flushRuntimeWork();

		expect(events).toEqual([
			expect.objectContaining({
				interest: expect.objectContaining({
					envCellId: 0xda550100,
					kind: "interior-cell",
					landblockId: 0xda55ffff,
				}),
				kind: "scene-interest-updated",
				revision: 1,
				source: "manual",
			}),
			expect.objectContaining({
				kind: "scene-interest-settled",
				result: "ready",
				revision: 1,
				source: "manual",
			}),
		]);

		unsubscribe();
		runtime.dispose();
	});

	it("emits follow scene interest source separately from manual updates", async () => {
		const runtime = createClientRuntime({
			diagnostics: silentDiagnostics,
			host: new FakeRuntimeHost(),
			renderer: new FakeRenderer(),
		});
		const events: RuntimeEvent[] = [];
		const unsubscribe = runtime.subscribeEvents((event) => {
			events.push(event);
		});

		updateOutdoorSceneInterest(runtime, {
			domains: [],
			source: "follow",
		});
		await flushRuntimeWork();

		expect(events).toEqual([
			expect.objectContaining({
				kind: "scene-interest-updated",
				revision: 1,
				source: "follow",
			}),
			expect.objectContaining({
				kind: "scene-interest-settled",
				result: "ready",
				revision: 1,
				source: "follow",
			}),
		]);

		unsubscribe();
		runtime.dispose();
	});

	it("emits settings scene interest source separately from manual updates", async () => {
		const runtime = createClientRuntime({
			diagnostics: silentDiagnostics,
			host: new FakeRuntimeHost(),
			renderer: new FakeRenderer(),
		});
		const events: RuntimeEvent[] = [];
		const unsubscribe = runtime.subscribeEvents((event) => {
			events.push(event);
		});

		updateOutdoorSceneInterest(runtime, {
			domains: [],
			source: "settings",
		});
		await flushRuntimeWork();

		expect(events).toEqual([
			expect.objectContaining({
				kind: "scene-interest-updated",
				revision: 1,
				source: "settings",
			}),
			expect.objectContaining({
				kind: "scene-interest-settled",
				result: "ready",
				revision: 1,
				source: "settings",
			}),
		]);

		unsubscribe();
		runtime.dispose();
	});

	it("refreshes static debug overlays when selected source bounds arrive", async () => {
		const renderer = new FakeRenderer();
		const resolver = new DeferredStaticResolver();
		const runtime = createClientRuntime({
			diagnostics: silentDiagnostics,
			host: new FakeRuntimeHost(),
			renderer,
			staticCoordinator: createImmediateStaticCoordinator({
				baker: new DeferredStaticBaker(),
				resolver,
			}),
		});
		const selectionKey = createTerrainQuadSelectionKey({
			landblockId: 0xda55ffff,
			quadIndex: 0,
		});

		runtime.setSceneDebugSelection({
			kind: "static",
			selectionKey,
		});
		expect(renderer.debugOverlayUpdates.at(-1)).toEqual([]);

		updateOutdoorSceneInterest(runtime);
		resolver.complete(resolver.pendingRequests[0]?.requestId ?? "", {
			scope: createTerrainSourceScopePayload(),
		});
		await flushPromises();

		expect(renderer.debugOverlayUpdates.at(-1)).toEqual([
			{
				color: [1, 0.85, 0.1, 1],
				id: "terrain-quad:outdoor-terrain:da55ffff:0",
				kind: "aabb",
				max: [24, 3, 0],
				min: [0, 0, -24],
			},
		]);

		runtime.setSceneDebugSelection(null);
		expect(renderer.debugOverlayUpdates.at(-1)).toEqual([]);
		runtime.dispose();
	});

	it("keeps flat static debug overlay bounds visible", async () => {
		const renderer = new FakeRenderer();
		const resolver = new DeferredStaticResolver();
		const runtime = createClientRuntime({
			diagnostics: silentDiagnostics,
			host: new FakeRuntimeHost(),
			renderer,
			staticCoordinator: createImmediateStaticCoordinator({
				baker: new DeferredStaticBaker(),
				resolver,
			}),
		});

		runtime.setSceneDebugSelection({
			kind: "static",
			selectionKey: createTerrainQuadSelectionKey({
				landblockId: 0xda55ffff,
				quadIndex: 0,
			}),
		});
		updateOutdoorSceneInterest(runtime);
		resolver.complete(resolver.pendingRequests[0]?.requestId ?? "", {
			scope: createTerrainSourceScopePayload({
				quadBounds: {
					max: { x: 24, y: 0, z: 0 },
					min: { x: 0, y: 0, z: -24 },
				},
			}),
		});
		await flushPromises();

		expect(renderer.debugOverlayUpdates.at(-1)).toEqual([
			expect.objectContaining({
				max: [24, 0.05, 0],
				min: [0, -0.05, -24],
			}),
		]);
		runtime.dispose();
	});

	it("forwards committed static layers to the renderer", async () => {
		const renderer = new FakeRenderer();
		const resolver = new DeferredStaticResolver();
		const baker = new DeferredStaticBaker();
		const staticCoordinator = createImmediateStaticCoordinator({
			baker,
			resolver,
		});
		const runtime = createClientRuntime({
			diagnostics: silentDiagnostics,
			host: new FakeRuntimeHost(),
			renderer,
			staticCoordinator,
		});

		updateOutdoorSceneInterest(runtime);
		resolver.complete(resolver.pendingRequests[0]?.requestId ?? "");
		await flushPromises();
		baker.complete("1:landblock:da55ffff:outdoor-terrain", {
			drawUnits: [createTerrainDrawUnit("terrain-a", 0xdb55ffff)],
		});
		await flushPromises();

		expect(renderer.terrainLayerUpdates).toEqual([
			[
				0xdb55ffff,
				expect.objectContaining({
					drawUnits: [createTerrainDrawUnit("terrain-a", 0xdb55ffff)],
					kind: "terrain",
					landblockId: 0xdb55ffff,
				}),
			],
		]);
		expect(renderer.staticAnchorLandblockIds).toEqual([0xda55ffff]);

		runtime.updateSceneInterest({ kind: "none" });
		await flushPromises();

		expect(renderer.terrainLayerUpdates.at(-1)).toEqual([0xdb55ffff, null]);
		expect(renderer.staticAnchorLandblockIds.at(-1)).toBeNull();
		runtime.dispose();
	});

	it("forwards instanced-only outdoor detail layers to the renderer", async () => {
		const renderer = new FakeRenderer();
		const resolver = new DeferredStaticResolver();
		const baker = new DeferredStaticBaker();
		const staticCoordinator = createImmediateStaticCoordinator({
			baker,
			resolver,
		});
		const runtime = createClientRuntime({
			diagnostics: silentDiagnostics,
			host: new FakeRuntimeHost(),
			renderer,
			staticCoordinator,
		});
		const landblockId = 0xdc59ffff;
		const resource = createStaticObjectVisualResource({
			resourceId: "detail-resource-a",
		});
		const instance = createStaticObjectRenderInstance({
			instanceId: "detail-instance-a",
			landblockId,
			resourceId: resource.resourceId,
		});

		updateOutdoorSceneInterest(runtime, {
			anchorLandblockId: landblockId,
			domains: ["terrain", "detail"],
			lod: { detail: 0, terrain: 0 },
		});
		const detailRequest = resolver.pendingRequests.find(
			(request) => request.job.domain === "outdoor-detail",
		);
		resolver.complete(detailRequest?.requestId ?? "", {
			scope: createOutdoorStaticObjectsPayload({ landblockId }),
		});
		await flushPromises();
		baker.complete("1:landblock:dc59ffff:outdoor-detail", {
			drawUnits: [],
			staticObjectRenderInstances: [instance],
			staticObjectVisualResources: [resource],
		});
		await flushPromises();

		expect(renderer.outdoorDetailsLayerUpdates).toEqual([
			[
				landblockId,
				expect.objectContaining({
					drawUnits: [],
					instancedObjectInstances: [instance],
					instancedObjectResources: [resource],
					kind: "outdoor-detail",
					landblockId,
				}),
			],
		]);
		runtime.dispose();
	});

	it("joins selected outdoor static diagnostics to source parts and materialized draw units", async () => {
		const resolver = new DeferredStaticResolver();
		const baker = new DeferredStaticBaker();
		const runtime = createClientRuntime({
			diagnostics: silentDiagnostics,
			host: new FakeRuntimeHost(),
			renderer: new FakeRenderer(),
			staticCoordinator: createImmediateStaticCoordinator({
				baker,
				resolver,
			}),
		});

		updateOutdoorSceneInterest(runtime, {
			domains: ["terrain", "buildings", "detail"],
			lod: { buildings: 0, detail: 0, terrain: 0 },
		});
		const detailRequest = resolver.pendingRequests.find(
			(request) => request.job.domain === "outdoor-detail",
		);
		resolver.complete(detailRequest?.requestId ?? "", {
			scope: createOutdoorStaticObjectsPayload(),
		});
		await flushPromises();
		baker.complete("1:landblock:da55ffff:outdoor-detail", {
			drawUnits: [createStaticObjectDrawUnit("static-draw-a")],
		});
		await flushPromises();

		const report = runtime.createStaticSelectionDiagnosticsReport(
			createOutdoorStaticObjectSelectionKey({
				domain: "outdoor-detail",
				instanceId: "outdoor-static-0",
				landblockId: 0xda55ffff,
			}),
			{ pickDistance: 4 },
		);

		expect(report.rendering).toMatchObject({
			drawUnits: [
				{
					drawUnitId: "static-draw-a",
					materialEntryCount: 1,
					materialEntries: [
						{
							blendMode: "opaque",
							materialIds: [0x08000010],
							slot: 0,
						},
					],
					sourceMapping: {
						geometrySurfaceIds: [0],
						partIndices: [0],
						polygonCount: 1,
						polygonRange: { max: 0, min: 0 },
						sourceTriangleCount: 1,
					},
					textureUseCount: 0,
				},
			],
			kind: "outdoor-static-object-rendering",
			partCoverage: [
				{
					drawUnitIds: ["static-draw-a"],
					materialIds: [0x08000010],
					partIndex: 0,
					polygonRange: { max: 0, min: 0 },
				},
			],
			source: {
				materialIds: [0x08000010],
				materialSlots: [
					{
						geometrySurfaceId: 0,
						materialId: 0x08000010,
						partIndex: 0,
					},
				],
				sourceAsset: {
					parts: [
						{
							partIndex: 0,
						},
					],
				},
				textureRefs: {
					count: 0,
				},
			},
			unmatchedReason: null,
		});
		runtime.dispose();
	});

	it("rebases resident static draw units through renderer anchor state", async () => {
		const renderer = new FakeRenderer();
		const resolver = new DeferredStaticResolver();
		const baker = new DeferredStaticBaker();
		const runtime = createClientRuntime({
			diagnostics: silentDiagnostics,
			host: new FakeRuntimeHost(),
			renderer,
			staticCoordinator: createImmediateStaticCoordinator({
				baker,
				resolver,
			}),
		});

		updateOutdoorSceneInterest(runtime);
		resolver.complete(resolver.pendingRequests[0]?.requestId ?? "");
		await flushPromises();
		baker.complete("1:landblock:da55ffff:outdoor-terrain", {
			drawUnits: [createTerrainDrawUnit("terrain-a", 0xdb55ffff)],
		});
		await flushPromises();

		updateOutdoorSceneInterest(runtime, {
			anchorLandblockId: 0xdb55ffff,
			source: "follow",
		});

		expect(renderer.terrainLayerUpdates).toHaveLength(1);
		expect(renderer.staticAnchorLandblockIds).toEqual([0xda55ffff, 0xdb55ffff]);
		runtime.dispose();
	});

	it("does not add textured static draw units before texture materialization is ready", async () => {
		const renderer = new FakeRenderer();
		const resolver = new DeferredStaticResolver();
		const baker = new DeferredStaticBaker();
		const assetService = new DeferredAssetService();
		const staticCoordinator = createImmediateStaticCoordinator({
			baker,
			resolver,
		});
		const runtime = createClientRuntime({
			assetService,
			diagnostics: silentDiagnostics,
			host: new FakeRuntimeHost(),
			renderer,
			staticCoordinator,
		});
		const textureUse = createPreparedTextureUse();
		const drawUnit = createTerrainDrawUnit("terrain-textured", 0xda55ffff, {
			primaryTextureUseId: "terrain-textured:prepared-texture:06000010",
			textureUseIds: ["terrain-textured:prepared-texture:06000010"],
		});

		updateOutdoorSceneInterest(runtime);
		resolver.complete(resolver.pendingRequests[0]?.requestId ?? "");
		await flushPromises();
		baker.complete("1:landblock:da55ffff:outdoor-terrain", {
			drawUnits: [drawUnit],
			textureUses: [createBakeTextureUse(drawUnit.drawUnitId, textureUse)],
		});
		await flushPromises();

		expect(renderer.terrainLayerUpdates).toEqual([]);
		expect(renderer.textureUpdates).toEqual([]);
		expect(
			runtimeDiagnosticsSnapshotSummary(runtime.createDiagnosticsSnapshot())
				.staticMaterialization.pendingRevisions,
		).toEqual([1]);
		assetService.resolveNext(
			createPreparedTextureAsset(assetService.pendingKeys[0] ?? failKey()),
		);
		await flushPromises();

		expect(renderer.events).toEqual([
			"texture:1:terrain-textured",
			"terrain-layer:3663069183:terrain-textured",
		]);
		expect(
			runtimeDiagnosticsSnapshotSummary(runtime.createDiagnosticsSnapshot())
				.staticMaterialization,
		).toEqual({
			committedRevisions: [1],
			envCellResourceMembershipRevision: 0,
			materializedDrawUnits: 1,
			pendingRevisions: [],
			sourceDrawUnits: 1,
		});
		runtime.dispose();
	});

	it("updates resident texture sampler policy without rebaking static draw units", async () => {
		const renderer = new FakeRenderer();
		const resolver = new DeferredStaticResolver();
		const baker = new DeferredStaticBaker();
		const assetService = new DeferredAssetService();
		const staticCoordinator = createImmediateStaticCoordinator({
			baker,
			resolver,
		});
		const runtime = createClientRuntime({
			assetService,
			diagnostics: silentDiagnostics,
			host: new FakeRuntimeHost(),
			renderer,
			staticCoordinator,
		});
		const textureUse = createPreparedTextureUse();
		const drawUnit = createTerrainDrawUnit("terrain-textured", 0xda55ffff, {
			primaryTextureUseId: "terrain-textured:prepared-texture:06000010",
			textureUseIds: ["terrain-textured:prepared-texture:06000010"],
		});

		updateOutdoorSceneInterest(runtime);
		resolver.complete(resolver.pendingRequests[0]?.requestId ?? "");
		await flushPromises();
		baker.complete("1:landblock:da55ffff:outdoor-terrain", {
			drawUnits: [drawUnit],
			textureUses: [createBakeTextureUse(drawUnit.drawUnitId, textureUse)],
		});
		await flushPromises();
		assetService.resolveNext(
			createPreparedTextureAsset(assetService.pendingKeys[0] ?? failKey()),
		);
		await flushPromises();

		runtime.setTextureFilteringMode("nearest");

		expect(renderer.samplerPolicyUpdates).toEqual([
			{
				policies: [
					{
						anisotropy: 1,
						filteringMode: "nearest",
						mipmapsGenerated: false,
						samplerPolicyKey:
							"sample=rgba-color;filter=nearest;mips=off;aniso=1",
						textureRefId:
							"texture-ref:outdoor-terrain:batch-a:terrain-textured:prepared-texture:06000010",
					},
				],
				revision: 2,
			},
		]);
		expect(renderer.terrainLayerUpdates).toHaveLength(1);
		runtime.dispose();
	});

	it("keeps failed texture materialization out of renderer residency", async () => {
		const renderer = new FakeRenderer();
		const resolver = new DeferredStaticResolver();
		const baker = new DeferredStaticBaker();
		const assetService = new DeferredAssetService();
		const staticCoordinator = createImmediateStaticCoordinator({
			baker,
			resolver,
		});
		const runtime = createClientRuntime({
			assetService,
			diagnostics: silentDiagnostics,
			host: new FakeRuntimeHost(),
			renderer,
			staticCoordinator,
		});
		const textureUse = createPreparedTextureUse();
		const drawUnit = createTerrainDrawUnit("terrain-textured", 0xda55ffff, {
			primaryTextureUseId: "terrain-textured:prepared-texture:06000010",
			textureUseIds: ["terrain-textured:prepared-texture:06000010"],
		});

		updateOutdoorSceneInterest(runtime);
		resolver.complete(resolver.pendingRequests[0]?.requestId ?? "");
		await flushPromises();
		baker.complete("1:landblock:da55ffff:outdoor-terrain", {
			drawUnits: [drawUnit],
			textureUses: [createBakeTextureUse(drawUnit.drawUnitId, textureUse)],
		});
		await flushPromises();

		assetService.rejectNext(new Error("prepared texture unavailable"));
		await flushPromises();

		expect(renderer.terrainLayerUpdates).toEqual([]);
		expect(renderer.textureUpdates).toEqual([]);
		expect(
			runtimeDiagnosticsSnapshotSummary(runtime.createDiagnosticsSnapshot())
				.staticMaterialization,
		).toEqual({
			committedRevisions: [],
			envCellResourceMembershipRevision: 0,
			materializedDrawUnits: 0,
			pendingRevisions: [],
			sourceDrawUnits: 0,
		});
		runtime.dispose();
	});

	it("warns when committed static coverage contains deferred blended materials", async () => {
		const warnings: unknown[] = [];
		const diagnostics: RuntimeDiagnostics = {
			warn(event) {
				warnings.push(event);
			},
		};
		const renderer = new FakeRenderer();
		const resolver = new DeferredStaticResolver();
		const baker = new DeferredStaticBaker();
		const runtime = createClientRuntime({
			diagnostics,
			host: new FakeRuntimeHost(),
			renderer,
			staticCoordinator: createImmediateStaticCoordinator({
				baker,
				resolver,
			}),
		});

		updateOutdoorSceneInterest(runtime);
		resolver.complete(resolver.pendingRequests[0]?.requestId ?? "");
		await flushPromises();
		baker.complete("1:landblock:da55ffff:outdoor-terrain", {
			materialCoverage: [createDeferredBlendedMaterialCoverage()],
		});
		await flushPromises();

		expect(warnings).toContainEqual({
			buckets: [
				{
					family: "texture-rgba",
					materialCount: 1,
					outcome: "render-deferred",
					partitionCount: 99,
					pass: "transparent",
					reasonCodes: ["translucent-render-deferred"],
					triangleCount: 1584,
				},
			],
			domain: "outdoor-detail",
			kind: "static-material-coverage-deferred",
			landblockId: 0xda55ffff,
			revision: 1,
		});
		runtime.dispose();
	});

	it("logs static resolver failures without retaining failure diagnostics", async () => {
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => {});
		const resolver = new DeferredStaticResolver();
		const runtime = createClientRuntime({
			diagnostics: silentDiagnostics,
			host: new FakeRuntimeHost(),
			renderer: new FakeRenderer(),
			staticCoordinator: createImmediateStaticCoordinator({
				baker: new DeferredStaticBaker(),
				resolver,
			}),
		});
		updateOutdoorSceneInterest(runtime);
		resolver.fail(
			resolver.pendingRequests[0]?.requestId ?? "",
			new Error("landblock env-cell bundle unavailable"),
		);
		await flushPromises();

		expect(consoleError).toHaveBeenCalledWith(
			"static resolver work 1:landblock:da55ffff:outdoor-terrain failed; static content for landblock:da55ffff/outdoor-terrain was not resolved.",
			{
				message: "landblock env-cell bundle unavailable",
				revision: 1,
			},
		);
		const diagnosticsSnapshot = runtime.createDiagnosticsSnapshot();
		expect(diagnosticsSnapshot.static.failed).toBe(1);
		expect(JSON.stringify(diagnosticsSnapshot)).not.toContain(
			"landblock env-cell bundle unavailable",
		);
		runtime.dispose();
		consoleError.mockRestore();
	});
});

function updateOutdoorSceneInterest(
	runtime: ReturnType<typeof createClientRuntime>,
	options: {
		readonly anchorLandblockId?: number;
		readonly domains?: readonly (
			| "buildings"
			| "detail"
			| "env-cells"
			| "terrain"
		)[];
		readonly lod?: {
			readonly buildings?: number;
			readonly detail?: number;
			readonly envCells?: number;
			readonly terrain?: number;
		};
		readonly source?: "manual" | "follow" | "settings";
	} = {},
): void {
	runtime.updateSceneInterest({
		anchorLandblockId: options.anchorLandblockId ?? 0xda55ffff,
		domains: options.domains ?? ["terrain"],
		...(options.lod ? { lod: options.lod } : {}),
		kind: "outdoor-anchor",
		source: options.source ?? "manual",
	});
}

function updateInteriorSceneInterest(
	runtime: ReturnType<typeof createClientRuntime>,
): void {
	runtime.updateSceneInterest({
		envCellId: 0xda550100,
		kind: "interior-cell",
		landblockId: 0xda55ffff,
		source: "manual",
	});
}

function updateRuntimeFrame(
	runtime: ReturnType<typeof createClientRuntime>,
	timeSeconds: number,
): void {
	runtime.updateCameraState({
		pitchRadians: 0,
		position: [0, 0, 0],
		yawRadians: 0,
	});
	runtime.tickFrame(timeSeconds);
}

function completeResolverRequest(
	resolver: DeferredStaticResolver,
	domain: StaticDomain,
	landblockId: number,
	payload: Parameters<DeferredStaticResolver["complete"]>[1] = {},
): void {
	const request = resolver.pendingRequests.find(
		(candidate) =>
			candidate.job.domain === domain &&
			candidate.job.scope.kind === "landblock" &&
			candidate.job.scope.landblockId === landblockId,
	);
	resolver.complete(request?.requestId ?? failKey(), payload);
}

function completeBakerWork(
	baker: DeferredStaticBaker,
	domain: StaticDomain,
	landblockId: number,
	result: Parameters<DeferredStaticBaker["complete"]>[1] = {},
): void {
	const input = baker.pendingInputs.find((candidate) =>
		candidate.items.some(
			(item) =>
				item.work.job.domain === domain &&
				item.work.job.scope.kind === "landblock" &&
				item.work.job.scope.landblockId === landblockId,
		),
	);
	const work = input?.items.find(
		(item) =>
			item.work.job.domain === domain &&
			item.work.job.scope.kind === "landblock" &&
			item.work.job.scope.landblockId === landblockId,
	);
	baker.complete(work?.work.workId ?? failKey(), result);
}

function createPortalInteriorRecord(options: {
	readonly envCellIds: readonly number[];
	readonly landblockId?: number;
	readonly portalLinks: StaticPortalInteriorRecord["portalLinks"];
}): StaticPortalInteriorRecord {
	const landblockId = options.landblockId ?? 0xda55ffff;
	return {
		envCells: options.envCellIds.map((envCellId) => ({
			envCellId,
			localPlacement: createPlacement(),
			portalApertures: options.portalLinks
				.filter(
					(link) =>
						link.source.kind === "env-cell" &&
						link.source.envCellId === envCellId,
				)
				.map((link, index) => ({
					plane: {
						constant: 0,
						normal: { x: 0, y: 0, z: 1 },
						source: "derived-from-render-points" as const,
					},
					points: [
						{ x: index, y: 0, z: 0 },
						{ x: index + 1, y: 0, z: 0 },
						{ x: index, y: 1, z: 0 },
					],
					polygonId: index,
					portalId: link.source.portalId,
					sourceIndex: link.sourceIndex,
				})),
			portals: [],
			seenOutside: true,
		})),
		kind: "env-cell-portal-interior",
		landblockId,
		owner: createEnvCellWorkOwner("work-env-portals", landblockId),
		portalLinks: options.portalLinks,
	};
}

function createBuildingTransitionAperture(
	landblockId: number,
	targetEnvCellId: number,
): OutdoorStaticObjectsScopePayload["buildingTransitionApertures"][number] {
	return {
		apertureId: `transition-aperture:${landblockId.toString(16)}:0`,
		buildingInstanceId: "building-0",
		buildingPortalId: "building-portal-0",
		buildingPortalSourceIndex: 0,
		flags: 0,
		linkedEnvCellIds: [targetEnvCellId],
		otherCellId: targetEnvCellId & 0xffff,
		otherPortalId: 0xffff,
		points: [
			{ x: 0, y: 0, z: 0 },
			{ x: 1, y: 0, z: 0 },
			{ x: 0, y: 1, z: 0 },
		],
		polyId: 7,
		portalIndex: 0,
		sourceAssetId: "gfx-obj/01001234",
		sourceDid: 0x01001234,
	};
}

function createBuildingTransitionPortalApertureResource(options: {
	readonly landblockId?: number;
	readonly targetEnvCellId: number;
}): StaticPortalApertureResource {
	const landblockId = options.landblockId ?? 0xda55ffff;
	const apertureResourceId = `portal-aperture-resource:building-transition:0x${landblockId
		.toString(16)
		.padStart(8, "0")}`;
	const portalId = "transition-portal:0";
	return {
		apertureResourceId,
		coordinateSpace: "landblock-render-local",
		indices: [0, 1, 2],
		kind: "portal-aperture-resource",
		landblockId,
		ranges: [
			{
				firstIndex: 0,
				indexCount: 3,
				rangeId: [
					"portal-aperture",
					"building-transition",
					apertureResourceId,
					portalId,
					0,
					3,
				].join(":"),
				source: {
					buildingInstanceId: "building-0",
					buildingPortalId: "building-portal-0",
					buildingPortalSourceIndex: 0,
					kind: "building-transition",
					landblockId,
					linkedEnvCellIds: [options.targetEnvCellId],
					otherCellId: options.targetEnvCellId & 0xffff,
					otherPortalId: 0xffff,
					polyId: 7,
					portalId,
					portalIndex: 0,
					sourceAssetId: "gfx-obj/01001234",
					sourceDid: 0x01001234,
					targetEnvCellId: options.targetEnvCellId,
				},
				sourceId: [
					"building-transition",
					apertureResourceId,
					portalId,
					0,
					3,
				].join(":"),
				sourceKind: "building-transition",
			},
		],
		sourceDomain: "outdoor-buildings",
		vertices: [
			{ x: 0, y: 0, z: 0 },
			{ x: 1, y: 0, z: 0 },
			{ x: 0, y: 1, z: 0 },
		],
	};
}

function createEnvCellWorkOwner(
	workId: string,
	landblockId: number,
): StaticWorkPeerRecordOwner {
	return {
		domain: "landblock-env-cells",
		kind: "work",
		scope: {
			kind: "landblock",
			landblockId,
		},
		scopeKey: `landblock:${landblockId.toString(16).padStart(8, "0")}`,
		workId,
	};
}

function createOutdoorWorkOwner(
	workId: string,
	landblockId: number,
	domain: "outdoor-buildings" | "outdoor-detail" = "outdoor-buildings",
): StaticWorkPeerRecordOwner {
	return {
		domain,
		kind: "work",
		scope: {
			kind: "landblock",
			landblockId,
		},
		scopeKey: `landblock:${landblockId.toString(16).padStart(8, "0")}`,
		workId,
	};
}

function createOutdoorDynamicSeedRecord(
	workId: string,
): StaticAuthoredDynamicSeedRecord {
	return {
		kind: "outdoor-static-object-dynamic-seed",
		owner: createOutdoorWorkOwner(workId, 0xda55ffff),
		seed: {
			classificationReason: "setup-default-animation",
			defaultAnimationId: 0x0300061b,
			domain: "outdoor-buildings",
			landblockId: 0xda55ffff,
			localPlacement: createPlacement(),
			object: {
				instanceId: "windmill-0",
				kind: "static-object-instance",
				landblockId: 0xda55ffff,
				objectKind: "building",
			},
			setupModelId: 0x020003e5,
			source: {
				kind: "static-object-source",
				sourceAssetKind: "setup-model",
				sourceDid: 0x020003e5,
			},
			sourceAssetId: "setup-model/020003e5",
			sourceResidence: {
				kind: "landblock-source",
				landblockId: 0xda55ffff,
				source: "outdoor",
			},
			sourceScale: { x: 1, y: 1, z: 1 },
		},
	};
}

function createEnvCellStaticSeedRecord(
	workId: string,
): StaticAuthoredDynamicSeedRecord {
	return {
		envCellId: 0xda550100,
		kind: "env-cell-static-object-seed",
		landblockId: 0xda55ffff,
		owner: createEnvCellWorkOwner(workId, 0xda55ffff),
		seed: {
			debug: { sourceAssetId: "setup-model/020003e5" },
			identity: {
				instanceId: "env-cell-static-0",
				kind: "static-object-instance",
				landblockId: 0xda55ffff,
				objectKind: "building",
			},
			localPlacement: createPlacement(),
			source: {
				kind: "static-object-source",
				sourceAssetKind: "setup-model",
				sourceDid: 0x020003e5,
			},
			sourceIndex: 0,
			sourceScale: { x: 1, y: 1, z: 1 },
		},
	};
}

function createEnvCellDynamicSeedRecord(
	workId: string,
): StaticAuthoredDynamicSeedRecord {
	return {
		kind: "env-cell-static-object-dynamic-seed",
		owner: createEnvCellWorkOwner(workId, 0xda55ffff),
		seed: {
			classificationReason: "setup-default-animation",
			defaultAnimationId: 0x0300061b,
			envCellId: 0xda550100,
			landblockId: 0xda55ffff,
			localPlacement: createPlacement(),
			object: {
				instanceId: "env-cell-static-0",
				kind: "static-object-instance",
				landblockId: 0xda55ffff,
				objectKind: "building",
			},
			setupModelId: 0x020003e5,
			source: {
				kind: "static-object-source",
				sourceAssetKind: "setup-model",
				sourceDid: 0x020003e5,
			},
			sourceAssetId: "setup-model/020003e5",
			sourceResidence: {
				kind: "landblock-source",
				landblockId: 0xda55ffff,
				source: "env-cells",
			},
			sourceScale: { x: 1, y: 1, z: 1 },
		},
	};
}

function createPlacement() {
	return {
		orientation: { w: 1, x: 0, y: 0, z: 0 },
		origin: { x: 0, y: 0, z: 0 },
	};
}

class FakeRenderer implements Renderer {
	readonly dynamicResourceCommits: DynamicRendererResourceCommit[] = [];
	readonly dynamicInstanceCommits: DynamicRendererInstanceCommit[] = [];
	readonly staticAnchorLandblockIds: (number | null)[] = [];
	readonly debugOverlayUpdates: readonly DebugOverlayPrimitive[][] = [];
	readonly textureUpdates: TexturePlacementUpdate[] = [];
	readonly samplerPolicyUpdates: SamplerPolicyUpdate[] = [];
	readonly renderPassPlans: RenderPassPlan[] = [];
	readonly portalFrameWorkPlans: PortalFrameWorkPlan[] = [];
	readonly terrainLayerUpdates: readonly [
		number,
		TerrainLayerPayload | null,
	][] = [];
	readonly outdoorBuildingsLayerUpdates: readonly [
		number,
		OutdoorBuildingsLayerPayload | null,
	][] = [];
	readonly outdoorDetailsLayerUpdates: readonly [
		number,
		OutdoorDetailsLayerPayload | null,
	][] = [];
	readonly envCellSystemLayerUpdates: readonly [
		number,
		EnvCellSystemLayerPayload | null,
	][] = [];
	readonly staticLayerVisibilityUpdates: RendererStaticLayerVisibility[] = [];
	readonly events: string[] = [];
	readonly #telemetryListeners = new Set<RendererFrameTelemetryListener>();
	readonly #residentDynamicResourceIds = new Set<string>();
	diagnosticsSnapshotCount = 0;
	#snapshot: RendererSnapshot = {
		backend: "webgl2",
		canvasHeight: 1,
		canvasWidth: 1,
		debugOverlayPrimitives: 0,
		error: null,
		frameCount: 0,
		frameHandlerMs: 0,
		isRunning: true,
		renderPassPlan: { kind: "single-surface-resident" },
		portalFrameWorkPlan: {
			kind: "legacy-render-pass",
			mode: "single-surface-resident",
			renderPassPlan: { kind: "single-surface-resident" },
		},
		renderedTriangles: 0,
		directEnvCellDrawCalls: 0,
		dynamicVisualResources: 0,
		dynamicVisualResourceTextureUses: 0,
		dynamicDrawCalls: 0,
		dynamicInstances: 0,
		skippedDynamicSubmissions: 0,
		recentDynamicResourceCommits: [],
		sceneDomainTargets: {
			active: false,
			apertureBatchDrawCalls: 0,
			colorFormat: "rgb8",
			compositePasses: 0,
			compositingMode: "none",
			depthFormat: "depth24-stencil8",
			executedCompositeDepth: 0,
			exteriorSuffixCompositeDepth: 0,
			exteriorSuffixCompositePasses: 0,
			exteriorDrawCalls: 0,
			height: 0,
			interiorDrawCalls: 0,
			outdoorCrossingSource: "none",
			width: 0,
		},
		staticDrawUnits: 0,
		staticObjectBakedDirectDrawCalls: 0,
		staticObjectDirectRenderInstanceDrawCalls: 0,
		staticObjectFarTransparentDirectRenderInstanceDrawCalls: 0,
		staticObjectFarTransparentInstancedRenderInstanceDrawCalls: 0,
		staticObjectFarTransparentInstancedRenderInstances: 0,
		staticObjectInstancedRenderInstanceDrawCalls: 0,
		staticObjectInstancedRenderInstances: 0,
		staticObjectNearTransparentDirectRenderInstanceDrawCalls: 0,
		staticObjectRenderInstances: 0,
		staticObjectResources: 0,
		staticObjectUploadedBufferBytes: 0,
		staticObjectVisualResources: 0,
		outdoorDetailStaticObjectBakedDirectDrawCalls: 0,
		outdoorDetailStaticObjectBakedDirectDrawCallsByPass: {
			additive: 0,
			alphaTest: 0,
			opaque: 0,
			transparent: 0,
		},
		outdoorDetailStaticObjectRenderInstances: 0,
		outdoorDetailStaticObjectResources: 0,
		outdoorDetailStaticObjectUploadedBufferBytes: 0,
		outdoorDetailStaticObjectVisualResources: 0,
		recentStaticObjectUploads: [],
		terrainDrawUnits: 0,
	};

	setTerrainLayer(
		landblockId: number,
		payload: TerrainLayerPayload | null,
	): void {
		this.terrainLayerUpdates.push([landblockId, payload]);
		this.events.push(
			`terrain-layer:${landblockId}:${
				payload?.drawUnits.map((drawUnit) => drawUnit.drawUnitId).join(",") ??
				"clear"
			}`,
		);
	}
	setOutdoorBuildingsLayer(
		landblockId: number,
		payload: OutdoorBuildingsLayerPayload | null,
	): void {
		this.outdoorBuildingsLayerUpdates.push([landblockId, payload]);
	}
	setOutdoorDetailsLayer(
		landblockId: number,
		payload: OutdoorDetailsLayerPayload | null,
	): void {
		this.outdoorDetailsLayerUpdates.push([landblockId, payload]);
	}
	setEnvCellSystemLayer(
		landblockId: number,
		payload: EnvCellSystemLayerPayload | null,
	): void {
		this.envCellSystemLayerUpdates.push([landblockId, payload]);
	}
	commitDynamicResources(commit: DynamicRendererResourceCommit): void {
		this.dynamicResourceCommits.push(commit);
		for (const resourceId of commit.removedVisualResourceIds) {
			this.#residentDynamicResourceIds.delete(resourceId);
		}
		for (const resource of commit.addedVisualResources) {
			this.#residentDynamicResourceIds.add(resource.resourceId);
		}
		this.#snapshot = {
			...this.#snapshot,
			dynamicVisualResources: this.#residentDynamicResourceIds.size,
			dynamicVisualResourceTextureUses:
				this.#snapshot.dynamicVisualResourceTextureUses +
				commit.addedVisualResources.reduce(
					(total, resource) => total + resource.materialPlan.textureUses.length,
					0,
				),
			recentDynamicResourceCommits: [
				...this.#snapshot.recentDynamicResourceCommits,
				{
					addedVisualResources: commit.addedVisualResources.length,
					removedVisualResources: commit.removedVisualResourceIds.length,
					revision: commit.revision,
					skippedMaterials: commit.addedVisualResources.reduce(
						(total, resource) => total + resource.materialPlan.skipped.length,
						0,
					),
					textureUses: commit.addedVisualResources.reduce(
						(total, resource) =>
							total + resource.materialPlan.textureUses.length,
						0,
					),
				},
			],
		};
	}
	commitDynamicInstances(commit: DynamicRendererInstanceCommit): void {
		this.dynamicInstanceCommits.push(commit);
		const submitted = commit.instances.filter((instance) =>
			this.#residentDynamicResourceIds.has(instance.resourceId),
		);
		this.#snapshot = {
			...this.#snapshot,
			dynamicDrawCalls: 0,
			dynamicInstances: submitted.length,
			skippedDynamicSubmissions: commit.instances.length - submitted.length,
		};
	}
	applyTexturePlacementUpdate(update: TexturePlacementUpdate): void {
		this.textureUpdates.push(update);
		this.events.push(
			`texture:${update.revision}:${update.textureBindings
				.map((binding) =>
					binding.owner.kind === "draw-unit"
						? binding.owner.drawUnitId
						: binding.owner.resourceId,
				)
				.join(",")}`,
		);
	}
	applySamplerPolicyUpdate(update: SamplerPolicyUpdate): void {
		this.samplerPolicyUpdates.push(update);
		this.events.push(`sampler:${update.revision}:${update.policies.length}`);
	}
	setStaticRenderAnchorLandblockId(anchorLandblockId: number | null): void {
		this.staticAnchorLandblockIds.push(anchorLandblockId);
	}
	setFlatVisionModeEnabled(): void {}
	setStaticLayerVisibility(visibility: RendererStaticLayerVisibility): void {
		this.staticLayerVisibilityUpdates.push(visibility);
	}
	setRenderPassPlan(plan: RenderPassPlan): void {
		this.renderPassPlans.push(plan);
		this.#snapshot = {
			...this.#snapshot,
			renderPassPlan: plan,
		};
	}
	setPortalFrameWorkPlan(plan: PortalFrameWorkPlan): void {
		this.portalFrameWorkPlans.push(plan);
		this.#snapshot = {
			...this.#snapshot,
			portalFrameWorkPlan: plan,
		};
	}
	setDebugOverlayPrimitives(
		primitives: readonly DebugOverlayPrimitive[],
	): void {
		this.debugOverlayUpdates.push([...primitives]);
		this.#snapshot = {
			...this.#snapshot,
			debugOverlayPrimitives: primitives.length,
		};
	}
	updateFrameState(): void {}

	subscribeTelemetry(listener: RendererFrameTelemetryListener): () => void {
		this.#telemetryListeners.add(listener);
		listener(this.#createFrameTelemetry());
		return () => {
			this.#telemetryListeners.delete(listener);
		};
	}

	createDiagnosticsSnapshot(): RendererSnapshot {
		this.diagnosticsSnapshotCount += 1;
		return this.#snapshot;
	}

	emitFrameTelemetry(telemetry: Partial<RendererFrameTelemetry> = {}): void {
		const nextTelemetry = {
			...this.#createFrameTelemetry(),
			...telemetry,
		};
		for (const listener of this.#telemetryListeners) {
			listener(nextTelemetry);
		}
	}

	dispose(): void {
		this.#snapshot = {
			...this.#snapshot,
			isRunning: false,
		};
	}

	#createFrameTelemetry(): RendererFrameTelemetry {
		return {
			directEnvCellDrawCalls: this.#snapshot.directEnvCellDrawCalls,
			frameCount: this.#snapshot.frameCount,
			frameHandlerMs: this.#snapshot.frameHandlerMs,
		};
	}
}

class FakeRuntimeHost implements RuntimeHost {
	lookupAsset(): Promise<PreparedAsset> {
		return Promise.reject(new Error("host lookup should not run in this test"));
	}

	createSnapshot(): RuntimeHostSnapshot {
		return {
			failure: null,
			isAvailable: false,
		};
	}
}

class ResolvingAssetRuntimeHost implements RuntimeHost {
	lookupAsset(key: HostAssetKey, revision: number): Promise<PreparedAsset> {
		return Promise.resolve(createPreparedAsset(key, revision));
	}

	createSnapshot(): RuntimeHostSnapshot {
		return {
			failure: null,
			isAvailable: true,
		};
	}
}

class ResolvingSetOmegaAssetRuntimeHost implements RuntimeHost {
	lookupAsset(key: HostAssetKey, revision: number): Promise<PreparedAsset> {
		return Promise.resolve({
			...createPreparedAsset(key, revision),
			payload:
				key.kind === "animation"
					? createDynamicSetOmegaAnimationPayload()
					: createDynamicPreparedPayload(key),
		});
	}

	createSnapshot(): RuntimeHostSnapshot {
		return {
			failure: null,
			isAvailable: true,
		};
	}
}

class DeferredAssetService implements AssetService {
	readonly pendingKeys: HostAssetKey[] = [];
	pruneCalls = 0;
	snapshotCount = 0;
	readonly #pending: DeferredAssetRequest[] = [];

	get pendingCount(): number {
		return this.#pending.length;
	}

	requestPreparedAsset(key: HostAssetKey): Promise<PreparedAsset> {
		this.pendingKeys.push(key);
		return new Promise<PreparedAsset>((resolve, reject) => {
			this.#pending.push({ reject, resolve });
		});
	}

	resolveNext(asset: PreparedAsset): void {
		const pending = this.#pending.shift();
		if (!pending) {
			throw new Error("No pending prepared asset request to resolve.");
		}
		pending.resolve(asset);
	}

	rejectNext(error: Error): void {
		const pending = this.#pending.shift();
		if (!pending) {
			throw new Error("No pending prepared asset request to reject.");
		}
		pending.reject(error);
	}

	acquirePreparedAssetLease(key: HostAssetKey): PreparedAssetLease {
		return {
			key,
			release() {},
		};
	}

	pruneExpiredWarmAssets(): number {
		this.pruneCalls += 1;
		return 0;
	}

	createSnapshot(): AssetServiceSnapshot {
		this.snapshotCount += 1;
		return {
			committed: [],
			pending: this.pendingKeys.map((key, index) => ({
				key,
				revision: index + 1,
				waiterCount: 1,
			})),
		};
	}

	createOverviewSnapshot(): AssetServiceOverviewSnapshot {
		return {
			committedCount: 0,
			pendingCount: this.#pending.length,
		};
	}
}

interface DeferredAssetRequest {
	readonly resolve: (asset: PreparedAsset) => void;
	readonly reject: (error: Error) => void;
}

function createResolvingAssetService(): HostBackedAssetService {
	return new HostBackedAssetService({
		host: new ResolvingAssetRuntimeHost(),
	});
}

function createResolvingSetOmegaAssetService(): HostBackedAssetService {
	return new HostBackedAssetService({
		host: new ResolvingSetOmegaAssetRuntimeHost(),
	});
}

function createOutdoorStaticObjectsPayload(
	options: {
		readonly domain?: OutdoorStaticObjectsScopePayload["domain"];
		readonly landblockId?: number;
	} = {},
): OutdoorStaticObjectsScopePayload {
	const landblockId = options.landblockId ?? 0xda55ffff;
	const object = {
		debug: { sourceAssetId: "setup-model/02000010" },
		generated: null,
		identity: {
			instanceId: "outdoor-static-0",
			kind: "static-object-instance" as const,
			landblockId,
			objectKind: "explicit-object" as const,
		},
		instanceBounds: {
			max: { x: 1, y: 1, z: -4 },
			min: { x: -1, y: -1, z: -5 },
		},
		localPlacement: createStaticPlacement(),
		portalCount: 0,
		source: {
			kind: "static-object-source" as const,
			sourceAssetKind: "setup-model" as const,
			sourceDid: 0x02000010,
		},
		sourceBounds: {
			max: { x: 1, y: 1, z: 1 },
			min: { x: -1, y: -1, z: -1 },
		},
		sourceIndex: 0,
		sourceScale: { x: 1, y: 1, z: 1 },
	};
	const material = {
		diffuse: 0xffffffff,
		identity: {
			kind: "static-material-source" as const,
			materialId: 0x08000010,
		},
		luminosity: 0,
		source: {
			argb: 0xffffffff,
			kind: "solid-color" as const,
		},
		surfaceId: 0,
		surfaceType: 0,
		translucency: 0,
	};
	const gfxObj = {
		kind: "static-object-source" as const,
		sourceAssetKind: "gfx-obj" as const,
		sourceDid: 0x01000020,
	};
	const partMaterialSlot = {
		geometrySurfaceId: 0,
		material: material.identity,
		materialSurfaceId: 0,
		materialVariantSignature: null,
		paletteOverride: null,
		paletteViews: [],
		slotIndex: 0,
	};

	return {
		domain: options.domain ?? "outdoor-detail",
		kind: "outdoor-static-objects",
		landblock: {
			kind: "landblock-source",
			landblockId,
			source: "outdoor",
		},
		materialSlots: [
			{
				...partMaterialSlot,
				gfxObj,
				identity: {
					geometrySurfaceId: 0,
					kind: "static-material-slot",
					materialSurfaceId: 0,
					part: {
						kind: "static-object-part",
						object: object.identity,
						partIndex: 0,
					},
					slotIndex: 0,
				},
				object: object.identity,
				source: object.source,
			},
		],
		materialSources: [material],
		missingRefs: [],
		objects: [object],
		paletteSources: [],
		regionRenderProfile: {
			detailRoles: [],
			identity: {
				kind: "region-render-profile",
				regionNumber: 1,
			},
		},
		sourceAssets: [
			{
				bounds: object.sourceBounds,
				debug: object.debug,
				identity: object.source,
				invalidPolygonCount: 0,
				materialSlotCount: 1,
				partCount: 1,
				parts: [
					{
						bounds: object.sourceBounds,
						defaultPlacements: [createStaticPlacement()],
						gfxObj,
						invalidPolygonCount: 0,
						materialSlotCount: 1,
						materialSlots: [partMaterialSlot],
						normals: new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]),
						partIndex: 0,
						physicsPolygonCount: 0,
						positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
						renderTriangleCount: 1,
						scale: { x: 1, y: 1, z: 1 },
						skippedPolygonCount: 0,
						source: object.source,
						texCoords: new Float32Array([0, 0, 1, 0, 0, 1]),
						triangles: [
							{
								firstVertex: 0,
								geometrySurfaceId: 0,
								materialVariantSignature: null,
								polygonId: 0,
							},
						],
					},
				],
				physicsPolygonCount: 0,
				renderTriangleCount: 1,
				skippedPolygonCount: 0,
				sourceAssetKind: "setup-model",
			},
		],
		sourceSpatial: {
			bounds: object.instanceBounds,
			coordinateSpace: "landblock-render-local",
			outdoorBvh: {
				coordinateSpace: "landblock-render-local",
				items: [
					{
						bvhItemIndex: 0,
						instanceId: object.identity.instanceId,
						kind: "static",
						object,
					},
				],
				nodes: [
					{
						bounds: object.instanceBounds,
						itemIndices: [0],
						left: null,
						right: null,
					},
				],
			},
			outdoorBvhItemCount: 1,
			outdoorBvhNodeCount: 1,
		},
		textureRefs: [],
	};
}

function createStaticObjectDrawUnit(
	drawUnitId: string,
	options: {
		readonly ownership?: StaticObjectGeometryStaticDrawUnit["ownership"];
	} = {},
): StaticObjectGeometryStaticDrawUnit {
	const renderState = {
		blend: {
			dstFactor: null,
			enabled: false,
			mode: "opaque" as const,
			srcFactor: null,
		},
		depthTest: true as const,
		depthWrite: true,
	};

	return {
		coordinateSpace: "landblock-render-local",
		domain:
			options.ownership?.kind === "env-cell-static-object-seeds"
				? "landblock-env-cells"
				: "outdoor-detail",
		drawUnitId,
		indexType: "uint16",
		indices: new Uint16Array([0, 1, 2]),
		kind: "static-object-geometry",
		landblockId: options.ownership?.landblockId ?? 0xda55ffff,
		materialBucketKey: "flat-color:test",
		materialEntries: [
			{
				alphaTest: 0,
				detailTextureTiling: 1,
				detailTextureUseId: null,
				indexTextureUseId: null,
				indexedClipThreshold: 0,
				indexedTextureFormat: null,
				materialColor: [1, 1, 1, 1],
				materialEmissiveColor: [0, 0, 0],
				materialIds: [0x08000010],
				paletteFirstIndex: 0,
				paletteTextureUseId: null,
				primaryTextureUseId: null,
				primaryTextureWrapMode: "clamp",
				renderState,
				slot: 0,
			},
		],
		materialFamily: "flat-color",
		materialIds: [0x08000010],
		materialPass: "opaque",
		materialSlotIndices: new Float32Array([0, 0, 0]),
		positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
		ownership:
			options.ownership ??
			({
				domain: "outdoor-detail",
				kind: "outdoor-static-objects",
				landblockId: 0xda55ffff,
			} satisfies StaticObjectGeometryStaticDrawUnit["ownership"]),
		renderState,
		sort: {
			bounds: null,
			center: [0, 0, 0],
			objectPartKey: null,
			policy: "depth-writing",
		},
		sourceMappingCoverage: [
			{
				geometrySurfaceIds: [0],
				gfxObj: {
					kind: "static-object-source",
					sourceAssetKind: "gfx-obj",
					sourceDid: 0x01000020,
				},
				materialIds: [0x08000010],
				materialSlot: 0,
				materialVariantSignatures: [null],
				object: {
					instanceId: "outdoor-static-0",
					kind: "static-object-instance",
					landblockId: 0xda55ffff,
					objectKind: "explicit-object",
				},
				partIndex: 0,
				polygonCount: 1,
				polygonRange: { max: 0, min: 0 },
				source: {
					kind: "static-object-source",
					sourceAssetKind: "setup-model",
					sourceDid: 0x02000010,
				},
				sourceTriangleCount: 1,
			},
		],
		spatialRecord: {
			drawUnitId,
			kind: "draw-unit-bounds",
			owner: {
				drawUnitId,
				kind: "draw-unit",
			},
			triangleCount: 1,
		},
		texCoords: new Float32Array([0, 0, 1, 0, 0, 1]),
		textureUseIds: [],
		triangleCount: 1,
		vertexCount: 3,
	};
}

function createStaticObjectVisualResource(options: {
	readonly resourceId: string;
}): StaticObjectVisualResource {
	const source = {
		kind: "static-object-source" as const,
		sourceAssetKind: "setup-model" as const,
		sourceDid: 0x02000010,
	};
	const gfxObj = {
		kind: "static-object-source" as const,
		sourceAssetKind: "gfx-obj" as const,
		sourceDid: 0x01000020,
	};
	const drawUnit = createStaticObjectDrawUnit(`${options.resourceId}:source`);
	const geometry = {
		gfxObj,
		kind: "static-object-source-geometry" as const,
		partIndex: 0,
		source,
	};

	return {
		bounds: {
			max: { x: 1, y: 1, z: 1 },
			min: { x: -1, y: -1, z: -1 },
		},
		coordinateSpace: "static-object-source-local",
		geometry,
		indexType: drawUnit.indexType,
		indices: drawUnit.indices,
		kind: "static-object-visual-resource",
		key: {
			geometry,
			indexType: drawUnit.indexType,
			kind: "static-object-visual-resource-key",
			materialEntries: drawUnit.materialEntries,
			materialFamily: drawUnit.materialFamily,
			materialPass: drawUnit.materialPass,
			renderState: drawUnit.renderState,
			textureUseIds: [],
		},
		materialEntries: drawUnit.materialEntries,
		materialFamily: drawUnit.materialFamily,
		materialPass: drawUnit.materialPass,
		materialSlotIndices: drawUnit.materialSlotIndices,
		positions: drawUnit.positions,
		renderState: drawUnit.renderState,
		resourceId: options.resourceId,
		texCoords: drawUnit.texCoords,
		textureUseIds: [],
		triangleCount: drawUnit.triangleCount,
		vertexCount: drawUnit.vertexCount,
	};
}

function createStaticObjectRenderInstance(options: {
	readonly instanceId: string;
	readonly landblockId: number;
	readonly resourceId: string;
}): StaticObjectRenderInstance {
	const bounds = {
		max: { x: 1, y: 1, z: 1 },
		min: { x: -1, y: -1, z: -1 },
	};

	return {
		bounds,
		domain: "outdoor-detail",
		generated: null,
		instanceId: options.instanceId,
		kind: "static-object-render-instance",
		landblockId: options.landblockId,
		resourceId: options.resourceId,
		sortCenter: { x: 0, y: 0, z: 0 },
		source: {
			instanceId: options.instanceId,
			kind: "static-object-instance",
			landblockId: options.landblockId,
			objectKind: "generated-scenery",
		},
		sourceToLandblockMatrix: new Float32Array([
			1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1,
		]),
		transform: createStaticPlacement(),
		transparency: { kind: "depth-writing" },
	};
}

function createStructuredInteriorDrawUnit(options: {
	readonly drawUnitId: string;
	readonly envCellId: number;
	readonly landblockId?: number;
}): StructuredInteriorGeometryStaticDrawUnit {
	const renderState = {
		blend: {
			dstFactor: null,
			enabled: false,
			mode: "opaque" as const,
			srcFactor: null,
		},
		depthTest: true as const,
		depthWrite: true,
	};
	const material = {
		kind: "static-material-source" as const,
		materialId: 0x08000010,
	};

	return {
		cellStructure: {
			cellStructureId: 1,
			kind: "cell-structure",
		},
		coordinateSpace: "landblock-render-local",
		domain: "landblock-env-cells",
		drawUnitId: options.drawUnitId,
		envCellId: options.envCellId,
		environment: {
			environmentId: 1,
			kind: "environment",
		},
		indexType: "uint16",
		indices: new Uint16Array([0, 1, 2]),
		kind: "structured-interior-geometry",
		landblockId: options.landblockId ?? 0xda55ffff,
		localPlacement: createPlacement(),
		materialBucketKey: "flat-color:test",
		materialEntries: [
			{
				alphaTest: 0,
				detailTextureTiling: 1,
				detailTextureUseId: null,
				indexTextureUseId: null,
				indexedClipThreshold: 0,
				indexedTextureFormat: null,
				materialColor: [1, 1, 1, 1],
				materialEmissiveColor: [0, 0, 0],
				materialIds: [material.materialId],
				paletteFirstIndex: 0,
				paletteTextureUseId: null,
				primaryTextureUseId: null,
				primaryTextureWrapMode: "clamp",
				renderState,
				slot: 0,
			},
		],
		materialFamily: "flat-color",
		materialIds: [material.materialId],
		materialPass: "opaque",
		materialPlan: [
			{
				diagnostics: [],
				family: "flat-color",
				material,
				outcome: "rendered",
				pass: "opaque",
				slotId: 0,
				surfaceId: 0,
				textureUseIds: [],
			},
		],
		materialSlotIndices: new Float32Array([0, 0, 0]),
		memberId: `${options.drawUnitId}:member`,
		positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
		renderState,
		sourceTriangleIds: [`${options.drawUnitId}:triangle-0`],
		surfaceIds: [0],
		texCoords: new Float32Array([0, 0, 1, 0, 0, 1]),
		textureUseIds: [],
		triangleCount: 1,
		vertexCount: 3,
	};
}

function createStaticPlacement() {
	return {
		orientation: {
			w: 1,
			x: 0,
			y: 0,
			z: 0,
		},
		origin: {
			x: 0,
			y: 0,
			z: 0,
		},
	};
}

function createTerrainSourceScopePayload(
	options: {
		readonly quadBounds?: TerrainStaticScopePayload["mesh"]["quads"][number]["bounds"];
	} = {},
): TerrainStaticScopePayload {
	const quadBounds = options.quadBounds ?? {
		max: { x: 24, y: 3, z: 0 },
		min: { x: 0, y: 0, z: -24 },
	};

	return {
		kind: "terrain",
		landblock: {
			kind: "landblock-source",
			landblockId: 0xda55ffff,
			source: "outdoor",
		},
		mesh: {
			bounds: quadBounds,
			gridSize: 2,
			maxHeight: 3,
			minHeight: 0,
			quadCount: 1,
			quads: [
				{
					averageHeight: 1,
					bounds: quadBounds,
					col: 0,
					cornerTerrainCodes: [1, 1, 1, 1],
					diagonal: "southwest-northeast",
					pcode: 1,
					quadIndex: 0,
					row: 0,
					sourceTerrainIndices: [0, 1, 2, 3],
					terrainQuadId: "q0",
					triangleIndices: [0, 1],
					vertexIndices: [0, 1, 2, 3],
				},
			],
			tileSize: 24,
			triangleCount: 2,
			triangles: [
				{
					averageHeight: 1,
					bounds: quadBounds,
					quadIndex: 0,
					terrainTriangleId: "t0",
					triangleInQuad: 0,
					vertexIndices: [0, 1, 2],
				},
				{
					averageHeight: 1,
					bounds: quadBounds,
					quadIndex: 0,
					terrainTriangleId: "t1",
					triangleInQuad: 1,
					vertexIndices: [1, 3, 2],
				},
			],
			vertexCount: 4,
			vertices: [
				{ x: 0, y: 0, z: 0 },
				{ x: 24, y: 1, z: 0 },
				{ x: 0, y: 2, z: -24 },
				{ x: 24, y: 3, z: -24 },
			],
		},
		missingRefs: [],
		regionRenderProfile: {
			detailRoles: [],
			identity: {
				kind: "region-render-profile",
				regionNumber: 1,
			},
		},
		sourceSpatial: {
			bounds: quadBounds,
			coordinateSpace: "landblock-render-local",
			terrainBvh: {
				coordinateSpace: "landblock-render-local",
				items: [{ quadIndex: 0 }],
				nodes: [
					{
						bounds: quadBounds,
						itemIndices: [0],
						left: null,
						right: null,
					},
				],
			},
			terrainBvhItemCount: 1,
			terrainBvhNodeCount: 1,
		},
		terrainMaterial: {
			alphaMapCount: 0,
			identity: {
				kind: "terrain-material",
				regionNumber: 1,
			},
			materialKind: "tex-merge-table",
			pcodeEncoding: {
				roadCodeBits: 2,
				sizeBitMask: 0,
				terrainCodeBits: 5,
			},
			roadAlphaMapCount: 0,
			roadAlphaMaps: [],
			terrainAlphaMaps: [],
			terrainTypeCount: 0,
			terrainTypes: [],
		},
		textureUses: [],
	};
}

function createTerrainDrawUnit(
	drawUnitId: string,
	landblockId: number,
	options: {
		readonly fallbackReasons?: readonly TerrainMaterialFallbackReason[];
		readonly primaryTextureUseId?: string | null;
		readonly textureUseIds?: readonly string[];
	} = {},
): TerrainGeometryStaticDrawUnit {
	return {
		coordinateSpace: "landblock-render-local",
		domain: "outdoor-terrain",
		drawUnitId,
		indexType: "uint16",
		indices: new Uint16Array([0, 1, 2]),
		kind: "terrain-geometry",
		landblockId,
		materialBucketKey: options.primaryTextureUseId
			? `shader:terrain-single-base-color|domain:outdoor-terrain|sampler:color-repeat-filterable|placement:0|texture:${options.primaryTextureUseId}`
			: "shader:terrain-debug-flat|domain:outdoor-terrain|sampler:none|placement:none",
		materialFamily: options.primaryTextureUseId
			? "terrain-single-base-color"
			: "terrain-debug-flat",
		primaryTextureUseId: options.primaryTextureUseId ?? null,
		positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1]),
		sourceTriangleIds: ["triangle-a"],
		terrainFallbackReasons: options.fallbackReasons ?? [],
		terrainMaterialPlan: null,
		texCoords: new Float32Array([0, 0, 1, 0, 0, 1]),
		textureUseIds: options.textureUseIds ?? [],
		triangleCount: 1,
		vertexCount: 3,
	};
}

function createPreparedTextureUse(): PreparedRgbaRenderSurfaceTextureUseIdentity {
	return {
		kind: "prepared-render-surface-texture-use",
		renderSurface: {
			kind: "render-surface",
			renderSurfaceId: 0x06000010,
		},
		usage: "rgba-color",
	};
}

function createImmediateStaticCoordinator(options: {
	readonly baker: DeferredStaticBaker;
	readonly resolver: DeferredStaticResolver;
}): StaticCoordinator {
	return new StaticCoordinator({
		baker: options.baker,
		batching: {
			maxPayloadsPerBatch: 8,
			maxWaitMs: 0,
		},
		resolver: options.resolver,
	});
}

function createBakeTextureUse(
	drawUnitId: string,
	source: PreparedRgbaRenderSurfaceTextureUseIdentity,
): StaticBakeTextureUse {
	return {
		domain: "outdoor-terrain",
		owners: [{ drawUnitId, kind: "draw-unit" }],
		source,
		staticBatchId: "batch-a",
		textureUseId: `${drawUnitId}:prepared-texture:${source.renderSurface.renderSurfaceId
			.toString(16)
			.padStart(8, "0")}`,
	};
}

function createDeferredBlendedMaterialCoverage(): StaticMaterialCoverageReport {
	return {
		buckets: [
			{
				family: "texture-rgba",
				filteringMode: "none",
				materialCount: 1,
				outcome: "render-deferred",
				partitionCount: 99,
				pass: "transparent",
				textureRoleCount: 1,
				triangleCount: 1584,
			},
		],
		coverageKey: "outdoor-detail:static-objects",
		coverageKind: "outdoor-static-objects",
		deferredTriangleCount: 1584,
		detailRoleCount: 0,
		domain: "outdoor-detail",
		fallbackReasonCount: 1,
		fallbackReasonCounts: [{ code: "translucent-render-deferred", count: 1 }],
		landblockId: 0xda55ffff,
		materialCount: 1,
		partitionCount: 99,
		renderedTriangleCount: 0,
		triangleCount: 1584,
		unrenderedBuckets: [
			{
				family: "texture-rgba",
				materialCount: 1,
				outcome: "render-deferred",
				partitionCount: 99,
				pass: "transparent",
				reasonCodes: ["translucent-render-deferred"],
				triangleCount: 1584,
			},
		],
		unsupportedTriangleCount: 0,
	};
}

function createPreparedTextureAsset(key: HostAssetKey): PreparedAsset {
	const policy = parsePreparedTexturePolicyFromKey(key);
	const bytes = new Uint8Array([
		255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255,
	]);

	return {
		key,
		payload: {
			colorSpace: policy.colorSpace,
			dependencies: {
				renderSurfaceAssetIds: ["render-surface/06000010"],
			},
			diagnostics: {
				decodeMs: 0,
				downsampleMs: 0,
				encodeMs: 0,
				generatedByteLength: bytes.byteLength,
				generatedLevelCount: 1,
				totalMs: 0,
			},
			kind: "prepared-texture",
			levels: [
				{
					byteLength: bytes.byteLength,
					bytes,
					format: "A8R8G8B8",
					formatRaw: 0,
					height: 2,
					level: 0,
					width: 2,
				},
			],
			mipPolicy: policy.mipPolicy,
			outputFormat: policy.outputFormat,
			provenance: {
				detail: null,
				errorCode: null,
				source: "generated-fallback",
				sourceAssetKind: "prepared-texture",
			},
			renderSurfaceId: 0x06000010,
			residencyKind: "unknown",
			sourceAssetKind: "prepared-texture",
			sourceByteLength: bytes.byteLength,
			sourceFormat: "A8R8G8B8",
			sourceFormatRaw: 0,
			sourceHash: "hash",
			sourceHeight: 2,
			sourceWidth: 2,
			usage: policy.usage,
		},
		preparedAt: "2026-06-11T00:00:00.000Z",
		revision: 1,
		sourceAssetId: "prepared-texture/06000010",
	};
}

function parsePreparedTexturePolicyFromKey(
	key: HostAssetKey,
): Pick<
	PreparedTexturePayloadDto,
	"colorSpace" | "mipPolicy" | "outputFormat" | "usage"
> {
	if (key.kind !== "prepared-texture") {
		throw new Error(`Expected prepared-texture key, got ${key.kind}.`);
	}
	const [, query = ""] = key.id.split("?", 2);
	const params = new URLSearchParams(query);
	return {
		colorSpace: parsePreparedTextureColorSpace(params.get("cs")),
		mipPolicy: parsePreparedTextureMipPolicy(params.get("mips")),
		outputFormat: parsePreparedTextureOutputFormat(params.get("out")),
		usage: parsePreparedTextureUsage(params.get("usage")),
	};
}

function parsePreparedTextureColorSpace(
	value: string | null,
): PreparedTexturePayloadDto["colorSpace"] {
	if (
		value === "data" ||
		value === "linear" ||
		value === "source" ||
		value === "srgb"
	) {
		return value;
	}
	return "linear";
}

function parsePreparedTextureMipPolicy(
	value: string | null,
): PreparedTexturePayloadDto["mipPolicy"] {
	return value === "retail4" ? "retail4" : "none";
}

function parsePreparedTextureOutputFormat(
	value: string | null,
): PreparedTexturePayloadDto["outputFormat"] {
	if (
		value === "dxt1" ||
		value === "dxt3" ||
		value === "dxt5" ||
		value === "index16" ||
		value === "r8" ||
		value === "rgba8"
	) {
		return value;
	}
	return "rgba8";
}

function parsePreparedTextureUsage(
	value: string | null,
): PreparedTexturePayloadDto["usage"] {
	if (
		value === "color" ||
		value === "detail" ||
		value === "mask" ||
		value === "raw"
	) {
		return value;
	}
	return "color";
}

function runtimeDiagnosticsSnapshotSummary(
	snapshot: RuntimeDiagnosticsSnapshot,
): Pick<RuntimeDiagnosticsSnapshot, "staticMaterialization" | "status"> {
	return {
		staticMaterialization: snapshot.staticMaterialization,
		status: snapshot.status,
	};
}

function createPreparedAsset(key: HostAssetKey, revision = 1): PreparedAsset {
	return {
		key,
		payload: createDynamicPreparedPayload(key),
		preparedAt: "2026-06-26T00:00:00.000Z",
		revision,
		sourceAssetId: `${key.kind}/${key.id}`,
	};
}

async function resolvePendingDynamicAssetsUntil(
	assetService: DeferredAssetService,
	done: () => boolean,
): Promise<void> {
	let resolvedCount = 0;
	for (let attempt = 0; attempt < 40; attempt += 1) {
		await flushRuntimeWork();
		if (done()) {
			return;
		}
		while (assetService.pendingCount > 0) {
			const key = assetService.pendingKeys[resolvedCount] ?? failKey();
			resolvedCount += 1;
			assetService.resolveNext(
				key.kind === "prepared-texture"
					? createPreparedTextureAsset(key)
					: createPreparedAsset(key),
			);
			await flushRuntimeWork();
			if (done()) {
				return;
			}
		}
	}
	throw new Error("Dynamic renderer resource sync did not complete.");
}

async function flushDynamicRendererResources(
	renderer: FakeRenderer,
): Promise<void> {
	for (let attempt = 0; attempt < 40; attempt += 1) {
		await flushRuntimeWork();
		if (renderer.createDiagnosticsSnapshot().dynamicVisualResources > 0) {
			return;
		}
	}
	throw new Error("Dynamic renderer visual resources did not commit.");
}

async function flushDynamicRendererResourceCount(
	renderer: FakeRenderer,
	count: number,
): Promise<void> {
	for (let attempt = 0; attempt < 40; attempt += 1) {
		await flushRuntimeWork();
		if (renderer.createDiagnosticsSnapshot().dynamicVisualResources >= count) {
			return;
		}
	}
	throw new Error(`Dynamic renderer visual resources did not reach ${count}.`);
}

function createDynamicPreparedPayload(key: HostAssetKey): unknown {
	switch (key.kind) {
		case "animation":
			return createDynamicAnimationPayload();
		case "setup-model":
			return createDynamicSetupModelPayload(key);
		case "setup-appearance":
			return createDynamicSetupAppearancePayload(key);
		case "gfx-obj":
			return createDynamicGfxObjPayload();
		case "material":
			return createDynamicMaterialPayload();
		case "surface-texture":
			return createDynamicSurfaceTexturePayload();
		case "render-surface":
			return createDynamicRenderSurfacePayload();
		case "palette":
			return {
				colorCount: 256,
				colorsArgb: new Uint32Array(256),
				kind: "palette",
				paletteId: Number.parseInt(key.id, 16),
			};
		case "prepared-texture":
			return createPreparedTextureAsset(key).payload;
		case "raw":
			return { kind: key.kind };
		default:
			return { kind: key.kind };
	}
}

function createDynamicAnimationPayload(): AnimationPayloadDto {
	return {
		animationAssetId: "animation/0300061b",
		animationId: 0x0300061b,
		dependencies: {},
		flags: 0,
		frameCount: 1,
		kind: "animation",
		objectPositionFrames: [],
		partCount: 1,
		partFrames: [
			{
				frameIndex: 0,
				hooks: [],
				localPlacements: [createPlacement()],
			},
		],
		provenance: createProvenance("animation"),
		residencyKind: "unknown",
		sourceAssetKind: "animation",
	};
}

function createDynamicSetOmegaAnimationPayload(): AnimationPayloadDto {
	return {
		...createDynamicAnimationPayload(),
		partFrames: [
			{
				frameIndex: 0,
				hooks: [
					{
						direction: 0,
						directionName: "Both",
						hookName: "SetOmega",
						hookType: TEST_SET_OMEGA_HOOK_TYPE,
						payload: {
							omega: { x: 0, y: 0, z: TEST_SET_OMEGA_Z },
						},
						payloadKind: "set-omega",
						rawPayloadBytes: TEST_SET_OMEGA_RAW_PAYLOAD_BYTES,
					},
				],
				localPlacements: [createPlacement()],
			},
		],
	};
}

function createDynamicSetupModelPayload(key: HostAssetKey) {
	const setupModelId = Number.parseInt(key.id, 16);
	return {
		connectionPoints: [],
		defaultAnimation: 0x0300061b,
		defaultScript: null,
		defaultSoundTable: null,
		dependencies: { gfxObjAssetIds: ["gfx-obj/01000020"] },
		flags: null,
		height: null,
		holdingLocations: [],
		kind: "setup-model",
		lights: [],
		parts: [
			{
				gfxObjAssetId: "gfx-obj/01000020",
				gfxObjId: 0x01000020,
				parentIndex: null,
				partIndex: 0,
				scale: null,
			},
		],
		placementSets: [],
		provenance: createProvenance("setup-model"),
		radius: null,
		residencyKind: "unknown",
		selectionSphere: null,
		setupModelId,
		sortingSphere: null,
		sourceAssetKind: "setup-model",
		stepDown: null,
		stepUp: null,
	};
}

function createDynamicSetupAppearancePayload(key: HostAssetKey) {
	const setupHex = key.id.split("?")[0] ?? failKey();
	const setupModelId = Number.parseInt(setupHex, 16);
	return createDynamicSetupAppearancePayloadForSetup(
		setupModelId,
		`setup-appearance/${key.id}`,
	);
}

function createDynamicSetupAppearancePayloadForSetup(
	setupModelId: number,
	appearanceKey: string,
) {
	return {
		animPartChanges: [],
		appearanceKey,
		dependencies: {
			materialAssetIds: ["material/08000011"],
			paletteAssetIds: [],
		},
		kind: "setup-appearance",
		paletteId: null,
		parts: [
			{
				gfxObjAssetId: "gfx-obj/01000020",
				gfxObjId: 0x01000020,
				materialSlots: [
					{
						materialAssetId: "material/08000011",
						slotIndex: 0,
						surfaceId: 0x08000010,
					},
				],
				partIndex: 0,
			},
		],
		provenance: createProvenance("setup-appearance"),
		residencyKind: "unknown",
		setupModelId,
		sourceAssetKind: "setup-appearance",
		subPalettes: [],
		textureChanges: [],
	};
}

function createDynamicGfxObjPayload() {
	return {
		dependencies: { materialAssetIds: ["material/08000010"] },
		didDegrade: null,
		drawingBsp: null,
		drawingPolygons: [],
		flags: null,
		gfxObjId: 0x01000020,
		kind: "gfx-obj",
		physicsWitness: { hasBsp: false, polygonCount: 1, rootKind: null },
		provenance: createProvenance("gfx-obj"),
		renderGeometry: {
			bounds: createBounds(),
			invalidPolygons: [],
			normals: [],
			positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
			skippedPolygonCount: 0,
			sourceId: 0x01000020,
			surfaceIds: [0x08000010],
			triangleCount: 1,
			triangles: [
				{
					firstVertex: 0,
					materialVariantSignature: null,
					polygonId: 7,
					surfaceId: 0x08000010,
				},
			],
			uvs: new Float32Array([0, 0, 1, 0, 0, 1]),
			vertexCount: 3,
		},
		residencyKind: "unknown",
		sortCenter: null,
		sourceAssetKind: "gfx-obj",
		surfaceIds: [0x08000010],
		vertexArray: { vertices: [] },
	};
}

function createDynamicMaterialPayload() {
	return {
		dependencies: {
			paletteAssetIds: ["palette/04000010"],
			renderSurfaceAssetIds: ["render-surface/06000010"],
			surfaceTextureAssetIds: ["surface-texture/05000010"],
		},
		diffuse: 1,
		kind: "material-recipe",
		luminosity: 0,
		provenance: createProvenance("material-recipe"),
		residencyKind: "unknown",
		source: {
			kind: "texture",
			paletteId: null,
			renderSurfaceDefaultPaletteIds: [0x04000010],
			selectedRenderSurfaceId: 0x06000010,
			surfaceTextureId: 0x05000010,
		},
		sourceAssetKind: "material-recipe",
		surfaceId: 0x08000011,
		surfaceType: 0,
		translucency: 0,
	};
}

function createDynamicSurfaceTexturePayload() {
	return {
		dependencies: { renderSurfaceAssetIds: ["render-surface/06000010"] },
		kind: "surface-texture",
		provenance: createProvenance("surface-texture"),
		renderSurfaceIds: [0x06000010],
		residencyKind: "unknown",
		selectedRenderSurfaceId: 0x06000010,
		sourceAssetKind: "surface-texture",
		surfaceTextureId: 0x05000010,
		textureType: 0,
		unknown: 0,
	};
}

function createDynamicRenderSurfacePayload() {
	return {
		defaultPaletteId: 0x04000010,
		dependencies: { paletteAssetIds: ["palette/04000010"] },
		format: "A8R8G8B8",
		formatRaw: 0,
		height: 1,
		kind: "render-surface",
		provenance: createProvenance("render-surface"),
		renderSurfaceId: 0x06000010,
		residencyKind: "unknown",
		sourceAssetKind: "render-surface",
		sourceByteLength: 4,
		sourceBytes: new Uint8Array([255, 255, 255, 255]),
		unknown: 0,
		width: 1,
	};
}

function createBounds() {
	return {
		max: { x: 1, y: 1, z: 1 },
		min: { x: 0, y: 0, z: 0 },
	};
}

function createProvenance(sourceAssetKind: string) {
	return {
		detail: null,
		errorCode: null,
		source: "repo-local-hba" as const,
		sourceAssetKind,
	};
}

function failKey(): never {
	throw new Error("Expected a pending prepared asset key.");
}

async function flushPromises(): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, 0));
}

async function flushRuntimeWork(): Promise<void> {
	for (let index = 0; index < 5; index += 1) {
		await flushPromises();
	}
}
