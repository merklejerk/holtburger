import { describe, expect, it } from "vitest";

import {
	planIndexedResourceAtlas,
	type IndexedResourceAtlasPlan,
} from "../texture-pages/indexed-resource-atlas-planner";
import {
	buildIndexedResourceAtlasWorkerResult,
	collectBuildIndexedResourceAtlasInputTransferables,
	collectBuildIndexedResourceAtlasResultTransferables,
	createBuildIndexedResourceAtlasWorkerInput,
} from "./indexed-atlas-worker-payloads";
import { runRenderResourceWorkerJob } from "../../../workers/render-resource-worker";

describe("indexed atlas worker payloads", () => {
	it("packs P8, Index16, and palette atlas bytes through the worker contract", () => {
		const plan = createIndexedPlan();
		const input = createBuildIndexedResourceAtlasWorkerInput(plan);
		const result = runRenderResourceWorkerJob({
			type: "build-indexed-resource-atlas",
			key: input.key,
			input,
		});

		expect(result.type).toBe("build-indexed-resource-atlas");
		if (result.type !== "build-indexed-resource-atlas") {
			throw new Error("expected indexed atlas result");
		}
		expect(result.key).toBe(plan.key);
		expect(result.generation?.key).toBe(`${plan.key};indexed-webgl2`);
		expect(result.generation?.indexTextures).toHaveLength(2);
		expect(result.generation?.paletteTextures).toHaveLength(1);
		expect([
			...(result.generation?.indexTextures[0]?.pixels.slice(0, 4) ?? []),
		]).toEqual([1, 2, 0, 0]);
		expect([
			...(result.generation?.indexTextures[1]?.pixels.slice(0, 4) ?? []),
		]).toEqual([5, 6, 7, 8]);
		expect([...(result.generation?.paletteTextures[0]?.pixels ?? [])]).toEqual([
			9, 10, 11, 12, 13, 14, 15, 16,
		]);
	});

	it("copies source bytes before transfer so the source plan remains readable", () => {
		const plan = createIndexedPlan();
		const originalP8Bytes =
			plan.p8IndexAtlasTextures[0]?.placements[0]?.sourceBytes;
		const originalPaletteBytes =
			plan.paletteAtlasTextures[0]?.placements[0]?.rgbaBytes;
		if (!originalP8Bytes || !originalPaletteBytes) {
			throw new Error("expected indexed atlas fixture bytes");
		}

		const input = createBuildIndexedResourceAtlasWorkerInput(plan);
		const copiedP8Bytes =
			input.p8IndexAtlasTextures[0]?.placements[0]?.sourceBytes;
		const copiedPaletteBytes =
			input.paletteAtlasTextures[0]?.placements[0]?.rgbaBytes;

		expect(copiedP8Bytes).not.toBe(originalP8Bytes);
		expect(copiedPaletteBytes).not.toBe(originalPaletteBytes);
		expect([...originalP8Bytes]).toEqual([1, 2, 3, 4]);
		expect([...originalPaletteBytes]).toEqual([9, 10, 11, 12, 13, 14, 15, 16]);
	});

	it("collects input and result transferables from worker-owned buffers", () => {
		const input =
			createBuildIndexedResourceAtlasWorkerInput(createIndexedPlan());
		const inputTransferables =
			collectBuildIndexedResourceAtlasInputTransferables(input);
		const result = buildIndexedResourceAtlasWorkerResult(input);
		const resultTransferables =
			collectBuildIndexedResourceAtlasResultTransferables(result);

		expect(inputTransferables).toHaveLength(3);
		expect(new Set(inputTransferables).size).toBe(inputTransferables.length);
		expect(resultTransferables).toHaveLength(6);
		expect(new Set(resultTransferables).size).toBe(resultTransferables.length);
	});
});

function createIndexedPlan(): IndexedResourceAtlasPlan {
	return planIndexedResourceAtlas({
		indexCandidates: [
			{
				drawUnitId: "p8-draw",
				indexTextureKey: "index/p8",
				format: "p8",
				width: 2,
				height: 2,
				sourceBytes: Uint8Array.from([1, 2, 3, 4]),
			},
			{
				drawUnitId: "p16-draw",
				indexTextureKey: "index/p16",
				format: "index16",
				width: 2,
				height: 1,
				sourceBytes: Uint8Array.from([5, 6, 7, 8]),
			},
		],
		paletteCandidates: [
			{
				drawUnitId: "palette-draw",
				paletteTextureKey: "palette/a",
				colorCount: 2,
				rgbaBytes: Uint8Array.from([9, 10, 11, 12, 13, 14, 15, 16]),
			},
		],
		policy: { maxTextureSize: 8, maxTextureCount: 4 },
	});
}
