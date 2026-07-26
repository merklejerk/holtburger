import { describe, expect, it } from "vitest";
import type { TexturePixelSource } from "../../assets/texture-pixel-source";
import {
	CommitBundleSourceKind,
	type CommitBundle,
	type CommitPipeline,
} from "../commit/types";
import { createLandblockWorldOrigin } from "../landblocks";
import { Quat, Vec3 } from "../math/types";
import type { FrameSelectionMetrics, Renderer } from "../renderer/renderer";
import type { RendererResourceManager } from "../renderer/resource-manager";
import { LandblockLayerKind, type LandblockIdLayer } from "./scene-interest";
import { GameRuntime, type GameRuntimeRenderDevice } from "./game-runtime";
import type { SceneAvailabilityEvent } from "./scene-availability";

describe("GameRuntime view and interest control", () => {
	it("keeps frontend scene interest independent from the primary camera", async () => {
		const requestedLayers: LandblockIdLayer[] = [];
		const frames: Parameters<Renderer["drawFrame"]>[0][] = [];
		const frameSelectionMetrics: FrameSelectionMetrics = {
			terrainFrameInputs: 2,
			viewCount: 1,
			visibleDynamics: 3,
			visibleEnvCellShells: 5,
			visiblePortalCrossings: 7,
			visibleSceneEntries: 11,
			visibleStaticObjects: 13,
			submittedBuildingRanges: 0,
			submittedBuildingTriangles: 0,
			submittedTransparentBuildingRanges: 0,
			submittedAdditiveBuildingRanges: 0,
			objectProgramChanges: 0,
			objectTexturePageBinds: 0,
		};
		const renderer: Renderer = {
			async destroy() {},
			drawFrame(input) {
				frames.push(input);
			},
			getFrameSelectionMetrics: () => frameSelectionMetrics,
		};
		const pipeline: CommitPipeline = {
			async destroy() {},
			async prepareLandblockLayers(layers): Promise<readonly CommitBundle[]> {
				requestedLayers.push(...layers);
				return [];
			},
		};
		const device: GameRuntimeRenderDevice = {
			buildRenderer: async () => renderer,
			resources: {} as RendererResourceManager,
		};
		const runtime = await GameRuntime.build(
			device,
			pipeline,
			{} as TexturePixelSource,
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
		expect(frames[0]?.frameSettings).toEqual({ distanceFogEnabled: true });
		runtime.setFrameSettings({ distanceFogEnabled: false });
		runtime.render(2);
		expect(frames[1]?.frameSettings).toEqual({ distanceFogEnabled: false });
		expect(runtime.getFrameSelectionMetrics()).toEqual(frameSelectionMetrics);
		const queriedPoint = createLandblockWorldOrigin("0x0102ffff").add(
			new Vec3(1, 10, -1),
		);
		expect(runtime.queryWorldPointResidency(queriedPoint)).toEqual({
			envCellId: null,
			landblockId: "0x0102ffff",
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
			buildRenderer: async () => ({ async destroy() {}, drawFrame() {} }),
			resources: {} as RendererResourceManager,
		};
		const runtime = await GameRuntime.build(
			device,
			pipeline,
			{} as TexturePixelSource,
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
			buildRenderer: async () => ({ async destroy() {}, drawFrame() {} }),
			resources: {} as RendererResourceManager,
		};
		const runtime = await GameRuntime.build(
			device,
			pipeline,
			{} as TexturePixelSource,
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
				kind: "scene-content-failed",
				message: "No terrain content is available for 0x1010ffff.",
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
			buildRenderer: async () => ({ async destroy() {}, drawFrame() {} }),
			resources: {} as RendererResourceManager,
		};
		const runtime = await GameRuntime.build(
			device,
			pipeline,
			{} as TexturePixelSource,
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
			buildRenderer: async () => ({ async destroy() {}, drawFrame() {} }),
			resources: {} as RendererResourceManager,
		};
		const runtime = await GameRuntime.build(
			device,
			pipeline,
			{} as TexturePixelSource,
		);

		runtime.updateSceneInterest(sceneInterest("0x1010ffff"));
		pipeline.resolveNext([staleTerrainArtifact("0x1010ffff")]);
		await new Promise((resolve) => setTimeout(resolve, 0));
		runtime.clearSceneInterest();
		runtime.updateSceneInterest(sceneInterest("0x1010ffff"));

		expect(() => runtime.tick()).not.toThrow();

		await runtime.destroy();
	});

	it("defers a promoted building resident without creating dynamic resources", async () => {
		const pipeline = new DeferredCommitPipeline();
		const device: GameRuntimeRenderDevice = {
			buildRenderer: async () => ({ async destroy() {}, drawFrame() {} }),
			resources: {} as RendererResourceManager,
		};
		const runtime = await GameRuntime.build(
			device,
			pipeline,
			{} as TexturePixelSource,
		);

		runtime.updateSceneInterest(buildingSceneInterest("0xda55ffff"));
		pipeline.resolveNext([]);
		pipeline.resolveNext([promotedBuildingArtifact("0xda55ffff")]);
		await new Promise((resolve) => setTimeout(resolve, 0));
		runtime.tick();
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(runtime.getDeferredStaticDynamicDiagnostics()).toEqual([
			{
				defaultAnimationId: "0x09000001",
				landblockId: "0xda55ffff",
				layer: LandblockLayerKind.Buildings,
				reason: "setup-default-animation",
				residentId: "resident:promoted",
				setupSourceId: "0x02000001",
			},
		]);
		expect(runtime.getStaticObjectRuntimeDiagnostics().layers).toEqual([
			expect.objectContaining({
				expectedResidentCount: 1,
				landblockId: "0xda55ffff",
				promotedDynamicResidentCount: 1,
				runtimeDeferredResidentCount: 1,
				staticArtifactInstalled: false,
			}),
		]);

		await runtime.destroy();
	});

	it("routes a synthetic explicit-object source through static realization", async () => {
		const pipeline = new DeferredCommitPipeline();
		const device: GameRuntimeRenderDevice = {
			buildRenderer: async () => ({ async destroy() {}, drawFrame() {} }),
			resources: {} as RendererResourceManager,
		};
		const runtime = await GameRuntime.build(
			device,
			pipeline,
			{} as TexturePixelSource,
		);

		runtime.updateSceneInterest(objectSceneInterest("0xda55ffff"));
		pipeline.resolveNext([]);
		pipeline.resolveNext([promotedObjectArtifact("0xda55ffff")]);
		await new Promise((resolve) => setTimeout(resolve, 0));
		runtime.tick();
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(runtime.getDeferredStaticDynamicDiagnostics()).toEqual([
			expect.objectContaining({
				landblockId: "0xda55ffff",
				layer: LandblockLayerKind.Objects,
				residentId: "resident:promoted",
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

/** Minimal stale artifact: applying it would fail, so a passing test proves it was discarded. */
function staleTerrainArtifact(landblockId: string): CommitBundle {
	return {
		commit: new Proxy(
			{},
			{
				get() {
					throw new Error("Withdrawn terrain artifact was applied.");
				},
			},
		),
		dynamicEntities: [],
		kind: CommitBundleSourceKind.LandblockLayer,
		landblockId,
		layer: LandblockLayerKind.Terrain,
	} as CommitBundle;
}

/** Minimal promoted record: any accidental dynamic installation reaches the throwing resource port. */
function promotedBuildingArtifact(landblockId: string): CommitBundle {
	return promotedStaticArtifact(landblockId, LandblockLayerKind.Buildings);
}

function promotedObjectArtifact(landblockId: string): CommitBundle {
	return promotedStaticArtifact(landblockId, LandblockLayerKind.Objects);
}

function promotedStaticArtifact(
	landblockId: string,
	layer: LandblockLayerKind.Buildings | LandblockLayerKind.Objects,
): CommitBundle {
	return {
		commit: {
			source: {
				dynamicResidents: [],
				kind: layer,
				landblockId,
				staticResidents: [],
			} as import("../resolution/landblock-layer").ResolvedObjectLayerSource,
		},
		dynamicEntities: [
			{
				id: "resident:promoted",
				placement: { envCellId: null, landblockId },
				presentation: {
					effects: { animationId: "0x09000001" },
					sourceAssetId: "0x02000001",
				},
			} as CommitBundle["dynamicEntities"][number],
		],
		kind: CommitBundleSourceKind.LandblockLayer,
		landblockId,
		layer,
	};
}

class DeferredCommitPipeline implements CommitPipeline {
	readonly #pending: Array<
		(resolve: (artifacts: readonly CommitBundle[]) => void) => void
	> = [];

	async prepareLandblockLayers(): Promise<readonly CommitBundle[]> {
		return new Promise((resolve) => this.#pending.push(resolve));
	}

	resolveNext(artifacts: readonly CommitBundle[]): void {
		const resolve = this.#pending.shift();
		if (!resolve) throw new Error("No commit preparation is pending.");
		resolve(artifacts);
	}

	async destroy(): Promise<void> {}
}
