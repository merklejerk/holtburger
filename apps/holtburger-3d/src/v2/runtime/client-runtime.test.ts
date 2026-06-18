import { describe, expect, it, vi } from "vitest";
import type {
	AssetService,
	AssetServiceSnapshot,
	HostAssetKey,
	PreparedAsset,
	PreparedAssetLease,
} from "../assets/contracts";
import type { RuntimeHost, RuntimeHostSnapshot } from "../host/contracts";
import type {
	DebugOverlayPrimitive,
	Renderer,
	RendererSnapshot,
	RendererSnapshotListener,
	RenderPassPlan,
	SamplerPolicyUpdate,
	StaticResidencyDelta,
	TexturePlacementUpdate,
} from "../renderer/types";
import { StaticCoordinator } from "../static/coordinator/static-coordinator";
import type {
	PreparedRgbaRenderSurfaceTextureUseIdentity,
	StaticBakeTextureUse,
	StaticMaterialCoverageReport,
	OutdoorStaticObjectsScopePayload,
	StaticObjectGeometryStaticDrawUnit,
	TerrainStaticScopePayload,
	TerrainGeometryStaticDrawUnit,
	TerrainMaterialFallbackReason,
} from "../static/contracts";
import {
	DeferredStaticBaker,
	DeferredStaticResolver,
} from "../static/fake-workers";
import { createClientRuntime, type RuntimeSnapshot } from "./client-runtime";
import {
	createOutdoorStaticObjectSelectionKey,
	createTerrainQuadSelectionKey,
} from "./static-scene-query";
import type { RuntimeDiagnostics } from "./diagnostics";

const silentDiagnostics: RuntimeDiagnostics = {
	warn() {},
};

describe("V2 client runtime", () => {
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
		).toHaveLength(5);
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

	it("creates an on-demand diagnostics report across runtime domains", () => {
		const runtime = createClientRuntime({
			diagnostics: silentDiagnostics,
			host: new FakeRuntimeHost(),
			renderer: new FakeRenderer(),
			staticCoordinator: createImmediateStaticCoordinator({
				baker: new DeferredStaticBaker(),
				resolver: new DeferredStaticResolver(),
			}),
		});

		updateOutdoorSceneInterest(runtime);

		expect(runtime.createDiagnosticsReport()).toMatchObject({
			domains: expect.arrayContaining([
				expect.objectContaining({
					kind: "renderer",
				}),
				expect.objectContaining({
					kind: "static-coordinator",
					summary: expect.objectContaining({
						committed: 0,
						requested: 1,
						resolving: 1,
					}),
				}),
				expect.objectContaining({
					kind: "texture-atlas",
					summary: expect.objectContaining({
						approximateBytes: 0,
						batchCount: 0,
						entryAliasCount: 0,
						multiSourcePageCount: 0,
						texturePageCount: 0,
					}),
				}),
				expect.objectContaining({
					kind: "terrain-textures",
					summary: {
						recentFallbackCount: 0,
					},
				}),
			]),
			kind: "runtime-diagnostics-report",
			runtime: {
				sceneInterest: "manual|outdoor-anchor|0xda55ffff|terrain",
				materializedStaticDrawUnits: 0,
				pendingStaticMaterializationRevisions: [],
				sourceStaticDrawUnits: 0,
				status: "static-active",
			},
		});
		expect(JSON.stringify(runtime.createDiagnosticsReport())).not.toContain(
			"activeWork",
		);
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
		const snapshots: RuntimeSnapshot[] = [];
		const unsubscribe = runtime.subscribe((nextSnapshot) => {
			snapshots.push(nextSnapshot);
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

		expect(snapshots).toHaveLength(2);
		expect(snapshots.at(-1)?.currentCameraResidency).toEqual({
			envCellId: 0xda550100,
			kind: "env-cell",
			landblockId: 0xda55ffff,
		});
		expect(renderer.renderPassPlans.at(-1)).toEqual({
			kind: "portal-scene-domains",
			baseScene: {
				envCellId: 0xda550100,
				kind: "interior",
				landblockId: 0xda55ffff,
			},
			transitionDepthPolicy: { maxDepth: 5 },
		});
		expect(runtime.createDiagnosticsReport().runtime).toMatchObject({
			currentCameraResidency: {
				envCellId: 0xda550100,
				kind: "env-cell",
				landblockId: 0xda55ffff,
			},
			renderPassPlan: {
				kind: "portal-scene-domains",
				baseScene: {
					envCellId: 0xda550100,
					kind: "interior",
					landblockId: 0xda55ffff,
				},
				transitionDepthPolicy: { maxDepth: 5 },
			},
		});
		expect(JSON.stringify(runtime.createDiagnosticsReport())).not.toContain(
			'"source"',
		);

		unsubscribe();
		runtime.dispose();
	});

	it("derives portal pass plans from outdoor and unknown camera residency", () => {
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

		expect(runtime.createDiagnosticsReport().runtime.renderPassPlan).toEqual({
			kind: "single-surface-resident",
		});

		runtime.setCurrentCameraResidency({
			kind: "outdoor-landblock",
			landblockId: 0xda55ffff,
		});

		expect(renderer.renderPassPlans.at(-1)).toEqual({
			kind: "portal-scene-domains",
			baseScene: {
				kind: "exterior",
				landblockId: 0xda55ffff,
			},
			transitionDepthPolicy: { maxDepth: 5 },
		});

		runtime.setCurrentCameraResidency({
			kind: "unknown",
			landblockId: 0xdb55ffff,
		});

		expect(renderer.renderPassPlans.at(-1)).toEqual({
			kind: "portal-scene-domains",
			baseScene: {
				kind: "exterior",
				landblockId: 0xdb55ffff,
			},
			transitionDepthPolicy: { maxDepth: 5 },
		});

		runtime.dispose();
	});

	it("uses the render anchor as the conservative exterior portal pass plan for unknown residency", () => {
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

		expect(renderer.renderPassPlans.at(-1)).toEqual({
			kind: "portal-scene-domains",
			baseScene: {
				kind: "exterior",
				landblockId: 0xda55ffff,
			},
			transitionDepthPolicy: { maxDepth: 5 },
		});

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

	it("ingests env-cell source facts without static materialization or atlas batches", async () => {
		const runtime = createClientRuntime({
			diagnostics: silentDiagnostics,
			host: new FakeRuntimeHost(),
			renderer: new FakeRenderer(),
		});

		updateInteriorSceneInterest(runtime);
		await flushPromises();

		expect(runtime.createDiagnosticsReport()).toMatchObject({
			domains: expect.arrayContaining([
				expect.objectContaining({
					kind: "texture-atlas",
					summary: expect.objectContaining({
						batchCount: 0,
						emptyBatchCount: 0,
					}),
				}),
			]),
			runtime: expect.objectContaining({
				committedStaticMaterializationRevisions: [],
				materializedStaticDrawUnits: 0,
				pendingStaticMaterializationRevisions: [],
				sourceStaticDrawUnits: 0,
			}),
		});
		runtime.dispose();
	});

	it("exposes runtime-owned static ray picking", async () => {
		const runtime = createClientRuntime({
			diagnostics: silentDiagnostics,
			host: new FakeRuntimeHost(),
			renderer: new FakeRenderer(),
		});

		expect(
			runtime.pickStaticRay({
				context: { kind: "outdoor" },
				ray: {
					direction: { x: 0, y: 0, z: -1 },
					origin: { x: 0, y: 0, z: 0 },
				},
			}),
		).toBeNull();
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

		runtime.setStaticDebugSelection(selectionKey);
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

		runtime.setStaticDebugSelection(null);
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

		runtime.setStaticDebugSelection(
			createTerrainQuadSelectionKey({
				landblockId: 0xda55ffff,
				quadIndex: 0,
			}),
		);
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

	it("forwards committed static draw units and eviction deltas to the renderer", async () => {
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

		expect(renderer.staticDeltas).toEqual([
			{
				addedDrawUnits: [createTerrainDrawUnit("terrain-a", 0xdb55ffff)],
				addedTransitionApertureBatches: [],
				removedDrawUnitIds: [],
				removedTransitionApertureBatchIds: [],
				revision: 1,
			},
		]);
		expect(renderer.staticAnchorLandblockIds).toEqual([0xda55ffff]);

		runtime.updateSceneInterest({ kind: "none" });
		await flushPromises();

		expect(renderer.staticDeltas.at(-1)).toEqual({
			addedDrawUnits: [],
			addedTransitionApertureBatches: [],
			removedDrawUnitIds: ["terrain-a"],
			removedTransitionApertureBatchIds: [],
			revision: 2,
		});
		expect(renderer.staticAnchorLandblockIds.at(-1)).toBeNull();
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

		expect(renderer.staticDeltas).toHaveLength(1);
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
		const snapshots: ReturnType<typeof runtimeSnapshotSummary>[] = [];
		const unsubscribe = runtime.subscribe((snapshot) => {
			snapshots.push(runtimeSnapshotSummary(snapshot));
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

		expect(renderer.staticDeltas).toEqual([]);
		expect(renderer.textureUpdates).toEqual([]);
		expect(snapshots.at(-1)?.staticMaterialization.pendingRevisions).toEqual([
			1,
		]);
		expect(runtime.createDiagnosticsReport().domains).toContainEqual({
			kind: "asset-service",
			snapshot: {
				failures: [],
				pending: [
					{
						key: assetService.pendingKeys[0],
						revision: 1,
						waiterCount: 1,
					},
				],
			},
			summary: {
				committed: 0,
				failures: 0,
				leased: 0,
				pending: 1,
				pendingWaiters: 1,
				warmRetained: 0,
			},
		});
		expect(JSON.stringify(runtime.createDiagnosticsReport())).not.toContain(
			'"committed":[',
		);

		assetService.resolveNext(
			createPreparedTextureAsset(assetService.pendingKeys[0] ?? failKey()),
		);
		await flushPromises();

		expect(renderer.events).toEqual([
			"texture:1:terrain-textured",
			"static:1:terrain-textured",
		]);
		expect(snapshots.at(-1)?.staticMaterialization).toEqual({
			committedRevisions: [1],
			failed: [],
			materializedDrawUnits: 1,
			pendingRevisions: [],
			sourceDrawUnits: 1,
		});
		unsubscribe();
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
		expect(renderer.staticDeltas).toHaveLength(1);
		expect(runtime.createDiagnosticsReport().runtime.textureFilteringMode).toBe(
			"nearest",
		);
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
		const snapshots: ReturnType<typeof runtimeSnapshotSummary>[] = [];
		const unsubscribe = runtime.subscribe((snapshot) => {
			snapshots.push(runtimeSnapshotSummary(snapshot));
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

		expect(renderer.staticDeltas).toEqual([]);
		expect(renderer.textureUpdates).toEqual([]);
		expect(snapshots.at(-1)?.staticMaterialization).toEqual({
			committedRevisions: [],
			failed: [{ message: "prepared texture unavailable", revision: 1 }],
			materializedDrawUnits: 0,
			pendingRevisions: [],
			sourceDrawUnits: 0,
		});
		expect(
			runtime.createDiagnosticsReport().runtime.failedStaticMaterializations,
		).toEqual([{ message: "prepared texture unavailable", revision: 1 }]);
		expect(runtime.createDiagnosticsReport().domains).toContainEqual({
			kind: "terrain-textures",
			recentFallbacks: [],
			summary: {
				recentFallbackCount: 0,
			},
		});
		unsubscribe();
		runtime.dispose();
	});

	it("surfaces terrain material fallback reasons in diagnostics reports", async () => {
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
		const fallbackReason: TerrainMaterialFallbackReason = {
			code: "unsupported-material-binding",
			message: "Terrain material binding requires a prepared texture use.",
			pcode: 33825,
		};

		updateOutdoorSceneInterest(runtime);
		resolver.complete(resolver.pendingRequests[0]?.requestId ?? "");
		await flushPromises();
		baker.complete("1:landblock:da55ffff:outdoor-terrain", {
			drawUnits: [
				createTerrainDrawUnit("terrain-fallback", 0xda55ffff, {
					fallbackReasons: [fallbackReason],
				}),
			],
		});
		await flushPromises();

		expect(runtime.createDiagnosticsReport().domains).toContainEqual({
			kind: "terrain-textures",
			recentFallbacks: [
				{
					drawUnitId: "terrain-fallback",
					materialBucketKey:
						"shader:terrain-debug-flat|domain:outdoor-terrain|sampler:none|placement:none",
					materialFamily: "terrain-debug-flat",
					reasons: [fallbackReason],
					revision: 1,
				},
			],
			summary: {
				recentFallbackCount: 1,
			},
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

	it("reports static resolver failures through runtime diagnostics", async () => {
		const warnings: unknown[] = [];
		const diagnostics: RuntimeDiagnostics = {
			warn(event) {
				warnings.push(event);
			},
		};
		const resolver = new DeferredStaticResolver();
		const runtime = createClientRuntime({
			diagnostics,
			host: new FakeRuntimeHost(),
			renderer: new FakeRenderer(),
			staticCoordinator: createImmediateStaticCoordinator({
				baker: new DeferredStaticBaker(),
				resolver,
			}),
		});
		let latestSnapshot: RuntimeSnapshot | null = null;
		const unsubscribe = runtime.subscribe((snapshot) => {
			latestSnapshot = snapshot;
		});

		updateOutdoorSceneInterest(runtime);
		resolver.fail(
			resolver.pendingRequests[0]?.requestId ?? "",
			new Error("landblock env-cell bundle unavailable"),
		);
		await flushPromises();

		expect(warnings).toContainEqual({
			domain: "outdoor-terrain",
			kind: "static-resolver-failed",
			message: "landblock env-cell bundle unavailable",
			revision: 1,
			scopeKey: "landblock:da55ffff",
			workId: "1:landblock:da55ffff:outdoor-terrain",
		});
		expect(latestSnapshot?.static.latestResolverFailure).toMatchObject({
			message: "landblock env-cell bundle unavailable",
			workId: "1:landblock:da55ffff:outdoor-terrain",
		});
		unsubscribe();
		runtime.dispose();
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
		readonly source?: "manual" | "follow";
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

class FakeRenderer implements Renderer {
	readonly staticDeltas: StaticResidencyDelta[] = [];
	readonly staticAnchorLandblockIds: (number | null)[] = [];
	readonly debugOverlayUpdates: readonly DebugOverlayPrimitive[][] = [];
	readonly textureUpdates: TexturePlacementUpdate[] = [];
	readonly samplerPolicyUpdates: SamplerPolicyUpdate[] = [];
	readonly renderPassPlans: RenderPassPlan[] = [];
	readonly events: string[] = [];
	readonly #listeners = new Set<RendererSnapshotListener>();
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
		renderedTriangles: 0,
		sceneDomainTargets: {
			active: false,
			apertureBatchDrawCalls: 0,
			colorFormat: "rgb8",
			compositePasses: 0,
			compositingMode: "none",
			depthFormat: "depth-component24",
			executedCompositeDepth: 0,
			exteriorDrawCalls: 0,
			height: 0,
			interiorDrawCalls: 0,
			width: 0,
		},
		staticDrawUnits: 0,
		terrainDrawUnits: 0,
		transitionApertureBatches: 0,
		transitionApertures: 0,
	};

	applyStaticDelta(delta: StaticResidencyDelta): void {
		this.staticDeltas.push(delta);
		this.events.push(
			`static:${delta.revision}:${delta.addedDrawUnits
				.map((drawUnit) => drawUnit.drawUnitId)
				.join(",")}`,
		);
		this.#snapshot = {
			...this.#snapshot,
			renderedTriangles: delta.addedDrawUnits.length,
			staticDrawUnits: delta.addedDrawUnits.length,
			terrainDrawUnits: delta.addedDrawUnits.length,
		};
	}

	applyDynamicDelta(): void {}
	applyTexturePlacementUpdate(update: TexturePlacementUpdate): void {
		this.textureUpdates.push(update);
		this.events.push(
			`texture:${update.revision}:${update.drawUnitBindings
				.map((binding) => binding.drawUnitId)
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
	setRenderPassPlan(plan: RenderPassPlan): void {
		this.renderPassPlans.push(plan);
		this.#snapshot = {
			...this.#snapshot,
			renderPassPlan: plan,
		};
		this.#emit();
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

	subscribe(listener: RendererSnapshotListener): () => void {
		this.#listeners.add(listener);
		listener(this.#snapshot);
		return () => {
			this.#listeners.delete(listener);
		};
	}

	dispose(): void {
		this.#snapshot = {
			...this.#snapshot,
			isRunning: false,
		};
	}

	#emit(): void {
		const snapshot = this.#snapshot;
		for (const listener of this.#listeners) {
			listener(snapshot);
		}
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

class DeferredAssetService implements AssetService {
	readonly pendingKeys: HostAssetKey[] = [];
	pruneCalls = 0;
	readonly #pending: DeferredAssetRequest[] = [];

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
		return {
			committed: [],
			failures: [],
			pending: this.pendingKeys.map((key, index) => ({
				key,
				revision: index + 1,
				waiterCount: 1,
			})),
		};
	}
}

interface DeferredAssetRequest {
	readonly resolve: (asset: PreparedAsset) => void;
	readonly reject: (error: Error) => void;
}

function createOutdoorStaticObjectsPayload(): OutdoorStaticObjectsScopePayload {
	const object = {
		debug: { sourceAssetId: "setup-model/02000010" },
		generated: null,
		identity: {
			instanceId: "outdoor-static-0",
			kind: "static-object-instance" as const,
			landblockId: 0xda55ffff,
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
		domain: "outdoor-detail",
		kind: "outdoor-static-objects",
		landblock: {
			kind: "landblock-source",
			landblockId: 0xda55ffff,
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
		alphaTest: 0,
		coordinateSpace: "landblock-render-local",
		detailTextureTiling: 1,
		detailTextureUseId: null,
		domain: "outdoor-detail",
		drawUnitId,
		indexTextureUseId: null,
		indexType: "uint16",
		indexedClipThreshold: 0,
		indexedTextureFormat: null,
		indices: new Uint16Array([0, 1, 2]),
		kind: "static-object-geometry",
		landblockId: 0xda55ffff,
		materialBucketKey: "flat-color:test",
		materialColor: [1, 1, 1, 1],
		materialEmissiveColor: [0, 0, 0],
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
		paletteFirstIndex: 0,
		paletteTextureUseId: null,
		positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
		primaryTextureUseId: null,
		primaryTextureWrapMode: "clamp",
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
		ownerDrawUnitIds: [drawUnitId],
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
	const bytes = new Uint8Array([
		255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255,
	]);

	return {
		key,
		payload: {
			colorSpace: "linear",
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
			mipPolicy: "none",
			outputFormat: "rgba8",
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
			usage: "color",
		},
		preparedAt: "2026-06-11T00:00:00.000Z",
		revision: 1,
		sourceAssetId: "prepared-texture/06000010",
	};
}

function runtimeSnapshotSummary(
	snapshot: RuntimeSnapshot,
): Pick<RuntimeSnapshot, "staticMaterialization" | "status"> {
	return {
		staticMaterialization: snapshot.staticMaterialization,
		status: snapshot.status,
	};
}

function failKey(): never {
	throw new Error("Expected a pending prepared asset key.");
}

async function flushPromises(): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, 0));
}
