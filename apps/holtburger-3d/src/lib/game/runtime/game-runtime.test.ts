import { describe, expect, it } from "vitest";
import type { AssetBridge } from "../../assets/asset-bridge";
import type { CommitBundle, CommitPipeline } from "../commit/types";
import { createLandblockWorldOrigin } from "../landblocks";
import { Quat, Vec3 } from "../math/types";
import type { Renderer } from "../renderer/renderer";
import type { RendererResourceManager } from "../renderer/resource-manager";
import type { LandblockIdLayer } from "./scene-interest";
import { GameRuntime, type GameRuntimeRenderDevice } from "./game-runtime";

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
			{} as AssetBridge,
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
});
