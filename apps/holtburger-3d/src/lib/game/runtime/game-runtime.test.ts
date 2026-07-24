import { describe, expect, it } from "vitest";
import type { TexturePixelSource } from "../../assets/texture-pixel-source";
import {
	CommitBundleSourceKind,
	type CommitBundle,
	type CommitPipeline,
} from "../commit/types";
import { createLandblockWorldOrigin } from "../landblocks";
import { Quat, Vec3 } from "../math/types";
import type { Renderer } from "../renderer/renderer";
import type { RendererResourceManager } from "../renderer/resource-manager";
import { LandblockLayerKind, type LandblockIdLayer } from "./scene-interest";
import { GameRuntime, type GameRuntimeRenderDevice } from "./game-runtime";
import type { SceneAvailabilityEvent } from "./scene-availability";

describe("GameRuntime view and interest control", () => {
	it("keeps frontend scene interest independent from the primary camera", async () => {
		const requestedLayers: LandblockIdLayer[] = [];
		const frames: Parameters<Renderer["drawFrame"]>[0][] = [];
		const renderer: Renderer = {
			async destroy() {},
			drawFrame(input) {
				frames.push(input);
			},
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
		await Promise.resolve();
		await Promise.resolve();
		expect(() => runtime.tick()).not.toThrow();

		await runtime.destroy();
	});

	it("reports unavailable content against the latest matching interest revision", async () => {
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
		const latest = runtime.updateSceneInterest(sceneInterest("0x1010ffff"));
		pipeline.resolveNext([]);
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(events).toEqual([
			{
				kind: "scene-content-failed",
				message: "No terrain content is available for 0x1010ffff.",
				residency: { envCellId: null, landblockId: "0x1010ffff" },
				revision: latest.revision,
			},
		]);

		unsubscribe();
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
