import { describe, expect, it } from "vitest";
import { AtlasTexturePacker } from "./packer";
import type { TexturePackingJob } from "./protocol";

describe("browser atlas texture packer", () => {
	it("packs multiple sources using the V1-derived atlas layout", async () => {
		const result = await new AtlasTexturePacker().pack({
			...createJob(),
			page: {
				format: "rgba8",
				height: 64,
				width: 64,
			},
			sources: [
				createSource("b", 16, 16, [20, 0, 0, 255]),
				createSource("a", 16, 16, [10, 0, 0, 255]),
			],
		});

		expect(result.pages).toMatchObject([
			{
				height: 16,
				pageId: "pack-job:page:0",
				width: 32,
			},
		]);
		expect(result.rects).toEqual([
			{
				pageId: "pack-job:page:0",
				rect: [0, 0, 16, 16],
				textureUseId: "a",
			},
			{
				pageId: "pack-job:page:0",
				rect: [16, 0, 16, 16],
				textureUseId: "b",
			},
		]);
		expect(Array.from(result.pages[0]?.pixels.slice(0, 4) ?? [])).toEqual([
			10, 0, 0, 255,
		]);
	});

	it("duplicates clamped edge pixels into explicit gutter padding", async () => {
		const result = await new AtlasTexturePacker().pack({
			...createJob(),
			page: {
				format: "rgba8",
				gutterPixels: 1,
				height: 8,
				width: 8,
			},
			sources: [
				{
					source: {
						format: "rgba8",
						height: 2,
						kind: "texture-packing-pixel-source",
						pixels: new Uint8Array([
							1, 0, 0, 255, 2, 0, 0, 255, 3, 0, 0, 255, 4, 0, 0, 255,
						]),
						width: 2,
					},
					textureUseId: "terrain-color",
				},
			],
		});

		expect(result.pages[0]).toMatchObject({
			height: 4,
			width: 4,
		});
		expect(result.rects).toEqual([
			{
				pageId: "pack-job:page:0",
				rect: [1, 1, 2, 2],
				textureUseId: "terrain-color",
			},
		]);
		expect(
			readRedChannel(result.pages[0]?.pixels ?? new Uint8Array(), 4),
		).toEqual([1, 1, 2, 2, 1, 1, 2, 2, 3, 3, 4, 4, 3, 3, 4, 4]);
	});

	it("wraps repeatable source pixels into explicit source-level gutter padding", async () => {
		const result = await new AtlasTexturePacker().pack({
			...createJob(),
			page: {
				format: "rgba8",
				gutterPixels: 1,
				height: 8,
				width: 8,
			},
			sources: [
				{
					source: {
						format: "rgba8",
						height: 2,
						kind: "texture-packing-pixel-source",
						pixels: new Uint8Array([
							1, 0, 0, 255, 2, 0, 0, 255, 3, 0, 0, 255, 4, 0, 0, 255,
						]),
						width: 2,
					},
					gutterEdgeMode: "repeat",
					textureUseId: "terrain-color",
				},
			],
		});

		expect(
			readRedChannel(result.pages[0]?.pixels ?? new Uint8Array(), 4),
		).toEqual([4, 3, 4, 3, 2, 1, 2, 1, 4, 3, 4, 3, 2, 1, 2, 1]);
	});

	it("fills unused atlas pixels with the requested page color", async () => {
		const result = await new AtlasTexturePacker().pack({
			...createJob(),
			page: {
				fillRgba: [128, 128, 128, 255],
				format: "rgba8",
				height: 8,
				pageSelection: "minimize-textures",
				width: 8,
			},
			sources: [
				createSource("terrain-color-a", 2, 2, [10, 0, 0, 255]),
				createSource("terrain-color-b", 1, 1, [20, 0, 0, 255]),
			],
		});

		expect(
			hasRgbaPixel(
				result.pages[0]?.pixels ?? new Uint8Array(),
				[128, 128, 128, 255],
			),
		).toBe(true);
	});

	it("fails explicitly when atlas capacity is exhausted", async () => {
		await expect(
			new AtlasTexturePacker().pack({
				...createJob(),
				page: {
					format: "rgba8",
					height: 64,
					maxTextureCount: 1,
					width: 64,
				},
				sources: [
					createSource("a", 64, 64, [1, 0, 0, 255]),
					createSource("b", 64, 64, [2, 0, 0, 255]),
				],
			}),
		).rejects.toThrow("could not place b");
	});

	it("packs byte-index sources with the same atlas layout path", async () => {
		const result = await new AtlasTexturePacker().pack({
			...createJob(),
			page: {
				format: "r8",
				gutterPixels: 1,
				height: 8,
				width: 8,
			},
			sources: [
				{
					source: {
						format: "r8",
						height: 2,
						kind: "texture-packing-pixel-source",
						pixels: new Uint8Array([1, 2, 3, 4]),
						width: 2,
					},
					textureUseId: "index8",
				},
			],
		});

		expect(result.pages[0]).toMatchObject({
			format: "r8",
			height: 4,
			width: 4,
		});
		expect(Array.from(result.pages[0]?.pixels ?? [])).toEqual([
			1, 1, 2, 2, 1, 1, 2, 2, 3, 3, 4, 4, 3, 3, 4, 4,
		]);
	});

	it("packs two-byte index sources without RGBA stride assumptions", async () => {
		const result = await new AtlasTexturePacker().pack({
			...createJob(),
			page: {
				format: "rg8",
				height: 8,
				width: 8,
			},
			sources: [
				{
					source: {
						format: "rg8",
						height: 1,
						kind: "texture-packing-pixel-source",
						pixels: new Uint8Array([0x34, 0x12, 0x78, 0x56]),
						width: 2,
					},
					textureUseId: "index16",
				},
			],
		});

		expect(result.pages[0]).toMatchObject({
			format: "rg8",
			height: 1,
			width: 2,
		});
		expect(Array.from(result.pages[0]?.pixels ?? [])).toEqual([
			0x34, 0x12, 0x78, 0x56,
		]);
	});

	it("fails explicitly when a source format does not match the page format", async () => {
		await expect(
			new AtlasTexturePacker().pack({
				...createJob(),
				page: {
					format: "r8",
					height: 8,
					width: 8,
				},
				sources: [createSource("rgba", 1, 1, [1, 2, 3, 4])],
			}),
		).rejects.toThrow("expected r8 sources, got rgba8");
	});

	it("fails explicitly when source bytes do not match the typed format", async () => {
		await expect(
			new AtlasTexturePacker().pack({
				...createJob(),
				page: {
					format: "rg8",
					height: 8,
					width: 8,
				},
				sources: [
					{
						source: {
							format: "rg8",
							height: 1,
							kind: "texture-packing-pixel-source",
							pixels: new Uint8Array([1]),
							width: 1,
						},
						textureUseId: "short-index16",
					},
				],
			}),
		).rejects.toThrow("expected 2 bytes for rg8, got 1");
	});

	it("keeps rgba fill policy constrained to rgba pages", async () => {
		await expect(
			new AtlasTexturePacker().pack({
				...createJob(),
				page: {
					fillRgba: [1, 2, 3, 4],
					format: "r8",
					height: 8,
					width: 8,
				},
				sources: [
					{
						source: {
							format: "r8",
							height: 1,
							kind: "texture-packing-pixel-source",
							pixels: new Uint8Array([1]),
							width: 1,
						},
						textureUseId: "index8",
					},
				],
			}),
		).rejects.toThrow("cannot use RGBA fill pixels");
	});
});

function createJob(): TexturePackingJob {
	return {
		domain: "outdoor-terrain",
		jobId: "pack-job",
		page: {
			format: "rgba8",
			height: 1,
			width: 1,
		},
		placementRevision: 1,
		sources: [],
	};
}

function createSource(
	textureUseId: string,
	width: number,
	height: number,
	rgba: readonly [number, number, number, number],
): TexturePackingJob["sources"][number] {
	const pixels = new Uint8Array(width * height * 4);
	for (let offset = 0; offset < pixels.length; offset += 4) {
		pixels.set(rgba, offset);
	}
	return {
		source: {
			format: "rgba8",
			height,
			kind: "texture-packing-pixel-source",
			pixels,
			width,
		},
		textureUseId,
	};
}

function readRedChannel(pixels: Uint8Array, width: number): number[] {
	const values = [];
	for (let offset = 0; offset < pixels.length; offset += 4) {
		values.push(pixels[offset] ?? 0);
	}
	expect(values).toHaveLength(width * width);
	return values;
}

function hasRgbaPixel(
	pixels: Uint8Array,
	rgba: readonly [number, number, number, number],
): boolean {
	for (let offset = 0; offset < pixels.length; offset += 4) {
		if (
			pixels[offset] === rgba[0] &&
			pixels[offset + 1] === rgba[1] &&
			pixels[offset + 2] === rgba[2] &&
			pixels[offset + 3] === rgba[3]
		) {
			return true;
		}
	}

	return false;
}
