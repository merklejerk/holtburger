import { describe, expect, it } from "vitest";
import type { TexturePackingResult } from "./protocol";
import { collectTexturePackingResultTransfers } from "./transfers";

describe("texture packing transfer extraction", () => {
	it("collects worker-owned result page pixel buffers", () => {
		const firstPixels = new Uint8Array(16);
		const secondPixels = new Uint8Array(4);

		expect(
			collectTexturePackingResultTransfers({
				...createResult(),
				pages: [
					createPage("page:0", firstPixels),
					createPage("page:1", secondPixels),
				],
			}),
		).toEqual([firstPixels.buffer, secondPixels.buffer]);
	});

	it("rejects partial page pixel views instead of accidentally detaching shared buffers", () => {
		const source = new Uint8Array(16);
		const partialPixels = source.subarray(4, 12);

		expect(() =>
			collectTexturePackingResultTransfers({
				...createResult(),
				pages: [createPage("page:partial", partialPixels)],
			}),
		).toThrow(
			"Texture packing result page pixels: partial typed-array views are not transferable by default.",
		);
	});
});

function createResult(): TexturePackingResult {
	return {
		domain: "outdoor-terrain",
		jobId: "pack-job:1",
		pages: [],
		placementRevision: 1,
		rects: [],
	};
}

function createPage(
	pageId: string,
	pixels: Uint8Array,
): TexturePackingResult["pages"][number] {
	return {
		format: "rgba8",
		height: 2,
		pageId,
		pixels,
		width: 2,
	};
}
