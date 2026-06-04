import { describe, expect, it } from "vitest";

import type { TexturePageAtlasPlan } from "../texture-pages/texture-page-atlas-planner";
import {
	buildTextureAtlasWorkerResult,
	collectBuildTextureAtlasInputTransferables,
	collectBuildTextureAtlasResultTransferables,
	createBuildTextureAtlasWorkerInput,
} from "./texture-atlas-worker-payloads";
import { runRenderResourceWorkerJob } from "../../../workers/render-resource-worker";

describe("texture atlas worker payloads", () => {
	it("packs RGBA and detail atlas bytes through the worker contract", () => {
		const input = createBuildTextureAtlasWorkerInput({
			plan: createTextureAtlasPlan(),
			textureFilteringMode: "anisotropic-4x",
			maxAnisotropy: 1,
		});
		const result = runRenderResourceWorkerJob({
			type: "build-texture-atlas",
			key: "texture-page-atlas/test;filter=anisotropic-4x;aniso=1",
			input,
		});

		expect(result.type).toBe("build-texture-atlas");
		if (result.type !== "build-texture-atlas") {
			throw new Error("expected texture atlas result");
		}
		expect(result.key).toBe(
			"texture-page-atlas/test;filter=anisotropic-4x;aniso=1",
		);
		expect(result.generation?.textures).toHaveLength(1);
		expect(result.generation?.detailTextures).toHaveLength(1);
		expect([
			...(result.generation?.textures[0]?.pixels.slice(0, 8) ?? []),
		]).toEqual([1, 2, 3, 255, 1, 2, 3, 255]);
		expect([
			...(result.generation?.detailTextures[0]?.pixels.slice(0, 8) ?? []),
		]).toEqual([11, 12, 13, 14, 11, 12, 13, 14]);
	});

	it("copies source bytes before transfer so the source plan remains readable", () => {
		const plan = createTextureAtlasPlan();
		const originalBaseBytes =
			plan.families[0]?.atlasEntryRecords[0]?.entry.level.bytes;
		const originalDetailBytes =
			plan.families[0]?.detailAtlasEntryRecords[0]?.bytes;
		if (!originalBaseBytes || !originalDetailBytes) {
			throw new Error("expected texture atlas fixture bytes");
		}

		const input = createBuildTextureAtlasWorkerInput({
			plan,
			textureFilteringMode: "anisotropic-4x",
			maxAnisotropy: 1,
		});

		expect(input.families[0]?.atlasEntryRecords[0]?.entry.level.bytes).not.toBe(
			originalBaseBytes,
		);
		expect(input.families[0]?.detailAtlasEntryRecords[0]?.bytes).not.toBe(
			originalDetailBytes,
		);
		expect([...originalBaseBytes.slice(0, 4)]).toEqual([1, 2, 3, 255]);
		expect([...originalDetailBytes.slice(0, 4)]).toEqual([11, 12, 13, 14]);
	});

	it("collects input and result transferables from worker-owned buffers", () => {
		const input = createBuildTextureAtlasWorkerInput({
			plan: createTextureAtlasPlan(),
			textureFilteringMode: "anisotropic-4x",
			maxAnisotropy: 1,
		});
		const inputTransferables =
			collectBuildTextureAtlasInputTransferables(input);
		const result = buildTextureAtlasWorkerResult(input);
		const resultTransferables =
			collectBuildTextureAtlasResultTransferables(result);

		expect(inputTransferables).toHaveLength(2);
		expect(new Set(inputTransferables).size).toBe(inputTransferables.length);
		expect(resultTransferables).toHaveLength(2);
		expect(new Set(resultTransferables).size).toBe(resultTransferables.length);
	});
});

function createTextureAtlasPlan(): TexturePageAtlasPlan {
	const levelBytes = Uint8Array.from([
		1, 2, 3, 255, 4, 5, 6, 255, 7, 8, 9, 255, 10, 11, 12, 255,
	]);
	const detailBytes = Uint8Array.from([
		11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26,
	]);
	return {
		key: "texture-page-atlas/test",
		rgbaAtlasReadyDrawUnitIds: ["draw-a"],
		detailAtlasReadyDrawUnitIds: ["draw-a"],
		failures: [],
		atlasEntryRecords: [],
		atlasTextures: [],
		detailAtlasEntryRecords: [],
		detailAtlasTextures: [],
		families: [
			{
				family: "static-rgba",
				atlasEntryRecords: [
					{
						key: "entry-a",
						entry: {
							renderSurfaceId: 0x0600_0001,
							preparedTextureAssetId: "prepared-texture/entry-a",
							sourceHash: "hash-a",
							sourceFormatRaw: 0x3154_5844,
							level: {
								level: 0,
								width: 2,
								height: 2,
								formatRaw: 0x15,
								format: "A8R8G8B8",
								byteLength: levelBytes.byteLength,
								bytes: levelBytes,
							},
						},
					},
				],
				atlasTextures: [
					{
						textureIndex: 0,
						width: 4,
						height: 4,
						placements: [
							{
								atlasEntryKey: "entry-a",
								textureIndex: 0,
								x: 1,
								y: 1,
								width: 2,
								height: 2,
								gutterPixels: 1,
							},
						],
					},
				],
				detailAtlasEntryRecords: [
					{
						key: "detail-a",
						renderSurfaceId: 0x0600_0002,
						sourceFormatRaw: 0x15,
						width: 2,
						height: 2,
						bytes: detailBytes,
						format: "rgba8",
						tiling: 12,
						blendMode: "dst-color",
					},
				],
				detailAtlasTextures: [
					{
						textureIndex: 0,
						width: 4,
						height: 4,
						placements: [
							{
								atlasEntryKey: "detail-a",
								textureIndex: 0,
								x: 1,
								y: 1,
								width: 2,
								height: 2,
								gutterPixels: 1,
							},
						],
					},
				],
			},
		],
		preparedTextureAssetIds: ["prepared-texture/entry-a"],
	};
}
