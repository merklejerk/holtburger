import { describe, expect, it } from "vitest";

import { planTexturePageAtlas } from "./texture-page-atlas-planner";
import {
	planIndexedResourceAtlas,
	type IndexedPaletteAtlasCandidate,
	type IndexedTexelAtlasCandidate,
} from "./indexed-resource-atlas-planner";
import type { TexturePageAtlasRgbaCandidate } from "./texture-page-atlas-planner";
import type { CompactionFamilyPlanningPolicy } from "../compaction/compaction-family-planner";

describe("planIndexedResourceAtlas", () => {
	it("places P8 and Index16 index pages in separate deterministic atlas families", () => {
		const firstPlan = planIndexedResourceAtlas({
			indexCandidates: [
				createIndexCandidate({
					drawUnitId: "draw-b",
					indexTextureKey: "index/b",
					format: "index16",
					width: 8,
					height: 4,
				}),
				createIndexCandidate({
					drawUnitId: "draw-a",
					indexTextureKey: "index/a",
					format: "p8",
					width: 8,
					height: 4,
				}),
			],
			paletteCandidates: [],
			policy: createIndexedPolicy(),
		});
		const secondPlan = planIndexedResourceAtlas({
			indexCandidates: [
				createIndexCandidate({
					drawUnitId: "draw-a",
					indexTextureKey: "index/a",
					format: "p8",
					width: 8,
					height: 4,
				}),
				createIndexCandidate({
					drawUnitId: "draw-b",
					indexTextureKey: "index/b",
					format: "index16",
					width: 8,
					height: 4,
				}),
			],
			paletteCandidates: [],
			policy: createIndexedPolicy(),
		});

		expect(firstPlan.p8IndexAtlasTextures).toMatchObject([
			{
				format: "p8",
				textureIndex: 0,
				placements: [{ indexTextureKey: "index/a", format: "p8" }],
			},
		]);
		expect(firstPlan.index16AtlasTextures).toMatchObject([
			{
				format: "index16",
				textureIndex: 0,
				placements: [{ indexTextureKey: "index/b", format: "index16" }],
			},
		]);
		expect(firstPlan.key).toBe(secondPlan.key);
	});

	it("packs palettes into tight row textures", () => {
		const plan = planIndexedResourceAtlas({
			indexCandidates: [],
			paletteCandidates: [
				createPaletteCandidate({
					drawUnitId: "draw-b",
					paletteTextureKey: "palette/b",
					colorCount: 4,
				}),
				createPaletteCandidate({
					drawUnitId: "draw-a",
					paletteTextureKey: "palette/a",
					colorCount: 2,
				}),
			],
			policy: createIndexedPolicy(),
		});

		expect(plan.paletteAtlasTextures).toMatchObject([
			{
				textureIndex: 0,
				width: 4,
				height: 2,
				placements: [
					{ paletteTextureKey: "palette/a", x: 0, y: 0, colorCount: 2 },
					{ paletteTextureKey: "palette/b", x: 0, y: 1, colorCount: 4 },
				],
			},
		]);
	});

	it("dedupes matching index and palette keys", () => {
		const plan = planIndexedResourceAtlas({
			indexCandidates: [
				createIndexCandidate({
					drawUnitId: "draw-a",
					indexTextureKey: "index/shared",
				}),
				createIndexCandidate({
					drawUnitId: "draw-b",
					indexTextureKey: "index/shared",
				}),
			],
			paletteCandidates: [
				createPaletteCandidate({
					drawUnitId: "draw-a",
					paletteTextureKey: "palette/shared",
				}),
				createPaletteCandidate({
					drawUnitId: "draw-b",
					paletteTextureKey: "palette/shared",
				}),
			],
			policy: createIndexedPolicy(),
		});

		expect(plan.p8IndexAtlasTextures[0]?.placements).toHaveLength(1);
		expect(plan.paletteAtlasTextures[0]?.placements).toHaveLength(1);
		expect(plan.indexReadyDrawUnitIds).toEqual(["draw-a", "draw-b"]);
		expect(plan.paletteReadyDrawUnitIds).toEqual(["draw-a", "draw-b"]);
		expect(plan.failures).toEqual([]);
	});

	it("rejects duplicate index keys with mismatched source metadata", () => {
		const plan = planIndexedResourceAtlas({
			indexCandidates: [
				createIndexCandidate({
					drawUnitId: "draw-a",
					indexTextureKey: "index/shared",
					sourceBytes: Uint8Array.from([1, 2, 3, 4]),
				}),
				createIndexCandidate({
					drawUnitId: "draw-b",
					indexTextureKey: "index/shared",
					sourceBytes: Uint8Array.from([4, 3, 2, 1]),
				}),
			],
			paletteCandidates: [],
			policy: createIndexedPolicy(),
		});

		expect(plan.p8IndexAtlasTextures).toEqual([]);
		expect(plan.indexReadyDrawUnitIds).toEqual([]);
		expect(plan.failures).toMatchObject([
			{
				drawUnitId: "draw-b",
				reason: "duplicate-index-texture-mismatch",
			},
		]);
	});

	it("rejects duplicate palette keys with mismatched source metadata", () => {
		const plan = planIndexedResourceAtlas({
			indexCandidates: [],
			paletteCandidates: [
				createPaletteCandidate({
					drawUnitId: "draw-a",
					paletteTextureKey: "palette/shared",
					rgbaBytes: Uint8Array.from([1, 2, 3, 4]),
				}),
				createPaletteCandidate({
					drawUnitId: "draw-b",
					paletteTextureKey: "palette/shared",
					rgbaBytes: Uint8Array.from([4, 3, 2, 1]),
				}),
			],
			policy: createIndexedPolicy(),
		});

		expect(plan.paletteAtlasTextures).toEqual([]);
		expect(plan.paletteReadyDrawUnitIds).toEqual([]);
		expect(plan.failures).toMatchObject([
			{
				drawUnitId: "draw-b",
				reason: "duplicate-palette-mismatch",
			},
		]);
	});

	it("keeps indexed atlas failures local to the indexed atlas planner", () => {
		const indexedPlan = planIndexedResourceAtlas({
			indexCandidates: [
				createIndexCandidate({
					drawUnitId: "indexed-too-large",
					indexTextureKey: "index/too-large",
					width: 128,
					height: 1,
				}),
			],
			paletteCandidates: [],
			policy: { maxTextureSize: 64, maxTextureCount: 1 },
		});
		const rgbaPlan = planTexturePageAtlas({
			rgbaCandidates: [createRgbaCandidate("rgba-a")],
			detailCandidates: [],
			policy: createRgbaPolicy(),
		});

		expect(indexedPlan.failures).toMatchObject([
			{ drawUnitId: "indexed-too-large", reason: "source-texture-too-large" },
		]);
		expect(rgbaPlan.rgbaAtlasReadyDrawUnitIds).toEqual(["rgba-a"]);
		expect(rgbaPlan.failures).toEqual([]);
	});
});

function createIndexCandidate({
	drawUnitId,
	indexTextureKey,
	format = "p8",
	width = 2,
	height = 2,
	sourceBytes = Uint8Array.from([1, 2, 3, 4]),
}: Partial<IndexedTexelAtlasCandidate> & {
	drawUnitId: string;
	indexTextureKey: string;
}): IndexedTexelAtlasCandidate {
	return {
		drawUnitId,
		indexTextureKey,
		format,
		width,
		height,
		sourceBytes,
	};
}

function createPaletteCandidate({
	drawUnitId,
	paletteTextureKey,
	colorCount = 2,
	rgbaBytes = Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]),
}: Partial<IndexedPaletteAtlasCandidate> & {
	drawUnitId: string;
	paletteTextureKey: string;
}): IndexedPaletteAtlasCandidate {
	return {
		drawUnitId,
		paletteTextureKey,
		colorCount,
		rgbaBytes,
	};
}

function createIndexedPolicy(): {
	maxTextureSize: number;
	maxTextureCount: number;
} {
	return {
		maxTextureSize: 64,
		maxTextureCount: 4,
	};
}

function createRgbaCandidate(drawUnitId: string): TexturePageAtlasRgbaCandidate {
	return {
		drawUnitId,
		family: "static-rgba",
		detailAtlasEntry: null,
		texturePageReadiness: {
			atlasEntryKey: `${drawUnitId}/rgba`,
			renderStateKey: `${drawUnitId}/render-state`,
			samplingKey: `${drawUnitId}/sampling`,
			samplingPolicy: { wrapS: "clamp", wrapT: "clamp" },
			materialSlotKey: `${drawUnitId}/slot`,
			atlasEntry: {
				renderSurfaceId: 1,
				preparedTextureAssetId: `prepared/${drawUnitId}`,
				level: {
					level: 0,
					width: 8,
					height: 8,
					bytes: new Uint8Array(8 * 8 * 4),
					format: "rgba8",
				},
				sourceHash: `hash/${drawUnitId}`,
				sourceFormatRaw: 0,
			},
		},
	};
}

function createRgbaPolicy(): CompactionFamilyPlanningPolicy {
	return {
		maxAtlasTextureSize: 64,
		maxAtlasTextureCount: 4,
		baseGutterPixels: 0,
		maxMaterialSlotsPerDraw: 8,
	};
}
