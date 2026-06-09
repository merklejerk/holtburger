import { describe, expect, it } from "vitest";

import {
	planTexturePageAtlas,
	TERRAIN_COLOR_ATLAS_GUTTER_PIXELS,
	TERRAIN_MASK_ATLAS_GUTTER_PIXELS,
	type TexturePageAtlasRgbaCandidate,
	type TexturePageAtlasDetailCandidate,
} from "./texture-page-atlas-planner";
import type { TexturePageBucket } from "./texture-page-binding";
import type { CompactionFamilyPlanningPolicy } from "../compaction/compaction-family-planner";

describe("planTexturePageAtlas", () => {
	it("keeps rgba atlas pages isolated by texture page bucket", () => {
		const plan = planTexturePageAtlas({
			rgbaCandidates: [
				createRgbaCandidate({
					candidateId: "static-a",
					entryKey: "shared-size-static",
					bucket: "static-base-color",
				}),
				createRgbaCandidate({
					candidateId: "terrain-a",
					entryKey: "shared-size-terrain",
					bucket: "terrain-color",
				}),
			],
			detailCandidates: [],
			policy: createPolicy(),
		});

		expect(plan.rgbaAtlasReadyCandidateIds).toEqual([
			"static-a",
			"terrain-a",
		]);
		expect(plan.buckets.map((bucket) => bucket.bucket)).toEqual([
			"static-base-color",
			"terrain-color",
		]);
		expect(plan.buckets[0]?.atlasTextures).toHaveLength(1);
		expect(plan.buckets[1]?.atlasTextures).toHaveLength(1);
		expect(plan.atlasTextures).toHaveLength(2);
		expect(
			plan.atlasTextures.map((texture) =>
				texture.placements.map((placement) => placement.atlasEntryKey),
			),
		).toEqual([["shared-size-static"], ["shared-size-terrain"]]);
	});

	it("keeps detail atlas pages isolated by texture page bucket", () => {
		const plan = planTexturePageAtlas({
			rgbaCandidates: [],
			detailCandidates: [
				createDetailCandidate({
					candidateId: "static-detail",
					entryKey: "static-detail-entry",
					bucket: "static-detail",
				}),
				createDetailCandidate({
					candidateId: "terrain-detail",
					entryKey: "terrain-detail-entry",
					bucket: "terrain-detail",
				}),
			],
			policy: createPolicy(),
		});

		expect(plan.detailAtlasReadyCandidateIds).toEqual([
			"static-detail",
			"terrain-detail",
		]);
		expect(plan.buckets.map((bucket) => bucket.bucket)).toEqual([
			"static-detail",
			"terrain-detail",
		]);
		expect(plan.detailAtlasTextures).toHaveLength(2);
		expect(
			plan.detailAtlasTextures.map((texture) =>
				texture.placements.map((placement) => placement.atlasEntryKey),
			),
		).toEqual([["static-detail-entry"], ["terrain-detail-entry"]]);
	});

	it("uses a short stable key derived from the canonical layout signature", () => {
		const candidates = [
			createRgbaCandidate({
				candidateId: "b",
				entryKey: "entry-b",
				bucket: "static-base-color",
			}),
			createRgbaCandidate({
				candidateId: "a",
				entryKey: "entry-a",
				bucket: "static-base-color",
			}),
		];
		const first = planTexturePageAtlas({
			rgbaCandidates: candidates,
			detailCandidates: [],
			policy: createPolicy(),
		});
		const second = planTexturePageAtlas({
			rgbaCandidates: [...candidates].reverse(),
			detailCandidates: [],
			policy: createPolicy(),
		});

		expect(first.key).toMatch(/^texture-page-atlas\/[0-9a-f]{16}$/);
		expect(second.key).toBe(first.key);
		expect(first.key).not.toContain("entry-a");
		expect(first.key).not.toContain("rgba-page");
	});

	it("changes the short key when cohort constraints change atlas layout", () => {
		const rgbaCandidates = [
			createRgbaCandidate({
				candidateId: "wide",
				entryKey: "terrain-wide",
				bucket: "terrain-color",
				width: 300,
				height: 8,
			}),
			createRgbaCandidate({
				candidateId: "small",
				entryKey: "terrain-small",
				bucket: "terrain-color",
				width: 8,
				height: 8,
			}),
		];
		const unconstrained = planTexturePageAtlas({
			rgbaCandidates,
			detailCandidates: [],
			policy: {
				...createPolicy(),
				baseGutterPixels: 0,
				maxAtlasTextureSize: 512,
			},
		});
		const constrained = planTexturePageAtlas({
			rgbaCandidates,
			detailCandidates: [],
			cohorts: [
				{
					key: "terrain-unit",
					bucket: "terrain-color",
					atlasEntryKeys: ["terrain-small", "terrain-wide"],
				},
			],
			policy: {
				...createPolicy(),
				baseGutterPixels: 0,
				maxAtlasTextureSize: 512,
			},
		});

		expect(constrained.key).toMatch(/^texture-page-atlas\/[0-9a-f]{16}$/);
		expect(constrained.key).not.toBe(unconstrained.key);
	});

	it("uses wider gutters for mipmapped terrain atlas buckets", () => {
		const plan = planTexturePageAtlas({
			rgbaCandidates: [
				createRgbaCandidate({
					candidateId: "terrain-color",
					entryKey: "terrain-color-entry",
					bucket: "terrain-color",
				}),
				createRgbaCandidate({
					candidateId: "terrain-mask",
					entryKey: "terrain-mask-entry",
					bucket: "terrain-mask",
				}),
				createRgbaCandidate({
					candidateId: "static",
					entryKey: "static-entry",
					bucket: "static-base-color",
				}),
			],
			detailCandidates: [],
			policy: createPolicy(),
		});

		const placements = new Map(
			plan.buckets.flatMap((bucket) =>
				bucket.atlasTextures.flatMap((texture) =>
					texture.placements.map(
						(placement) => [bucket.bucket, placement.gutterPixels] as const,
					),
				),
			),
		);

		expect(TERRAIN_COLOR_ATLAS_GUTTER_PIXELS).toBe(96);
		expect(TERRAIN_MASK_ATLAS_GUTTER_PIXELS).toBe(16);
		expect(placements.get("terrain-color")).toBe(
			TERRAIN_COLOR_ATLAS_GUTTER_PIXELS,
		);
		expect(placements.get("terrain-mask")).toBe(
			TERRAIN_MASK_ATLAS_GUTTER_PIXELS,
		);
		expect(placements.get("static-base-color")).toBe(0);
	});

	it("sizes terrain atlas pages to include large gutter padding", () => {
		const plan = planTexturePageAtlas({
			rgbaCandidates: [
				createRgbaCandidate({
					candidateId: "terrain-color",
					entryKey: "terrain-color-entry",
					bucket: "terrain-color",
				}),
				createRgbaCandidate({
					candidateId: "terrain-mask",
					entryKey: "terrain-mask-entry",
					bucket: "terrain-mask",
				}),
			],
			detailCandidates: [],
			policy: createPolicy(),
		});

		const pagesByBucket = new Map(
			plan.buckets.map((bucket) => [bucket.bucket, bucket.atlasTextures] as const),
		);

		expect(pagesByBucket.get("terrain-color")?.[0]).toMatchObject({
			width: 256,
			height: 256,
		});
		expect(pagesByBucket.get("terrain-mask")?.[0]).toMatchObject({
			width: 64,
			height: 64,
		});
	});

	it("keeps terrain cohort atlas entries on one page", () => {
		const plan = planTexturePageAtlas({
			rgbaCandidates: [
				createRgbaCandidate({
					candidateId: "wide",
					entryKey: "terrain-wide",
					bucket: "terrain-color",
					width: 300,
					height: 8,
				}),
				createRgbaCandidate({
					candidateId: "small",
					entryKey: "terrain-small",
					bucket: "terrain-color",
					width: 8,
					height: 8,
				}),
			],
			detailCandidates: [],
			cohorts: [
				{
					key: "terrain-tile",
					bucket: "terrain-color",
					atlasEntryKeys: ["terrain-small", "terrain-wide"],
				},
			],
			policy: {
				...createPolicy(),
				baseGutterPixels: 0,
				maxAtlasTextureSize: 512,
			},
		});

		const terrainColorPages = plan.buckets.find(
			(bucket) => bucket.bucket === "terrain-color",
		)?.atlasTextures;

		expect(terrainColorPages).toHaveLength(1);
		expect(terrainColorPages?.[0]).toMatchObject({ width: 512, height: 512 });
		expect(
			terrainColorPages?.[0]?.placements
				.map((placement) => placement.atlasEntryKey)
				.sort(),
		).toEqual(["terrain-small", "terrain-wide"]);
	});

	it("allows independent terrain atlas entries to use smaller pages without cohorts", () => {
		const plan = planTexturePageAtlas({
			rgbaCandidates: [
				createRgbaCandidate({
					candidateId: "wide-a",
					entryKey: "terrain-wide-a",
					bucket: "terrain-color",
					width: 300,
					height: 8,
				}),
				createRgbaCandidate({
					candidateId: "wide-b",
					entryKey: "terrain-wide-b",
					bucket: "terrain-color",
					width: 300,
					height: 8,
				}),
				createRgbaCandidate({
					candidateId: "wide-c",
					entryKey: "terrain-wide-c",
					bucket: "terrain-color",
					width: 300,
					height: 8,
				}),
			],
			detailCandidates: [],
			policy: {
				...createPolicy(),
				baseGutterPixels: 0,
				maxAtlasTextureSize: 512,
			},
		});

		const terrainColorPages = plan.buckets.find(
			(bucket) => bucket.bucket === "terrain-color",
		)?.atlasTextures;

		expect(terrainColorPages).toHaveLength(3);
		expect(terrainColorPages?.map((page) => page.width * page.height)).toEqual([
			512 * 256,
			512 * 256,
			512 * 256,
		]);
	});
});

function createRgbaCandidate({
	candidateId,
	entryKey,
	bucket,
	width = 16,
	height = 16,
}: {
	candidateId: string;
	entryKey: string;
	bucket: TexturePageBucket;
	width?: number;
	height?: number;
}): TexturePageAtlasRgbaCandidate {
	return {
		candidateId,
		bucket,
		detailAtlasEntry: null,
		texturePageReadiness: {
			atlasEntryKey: entryKey,
			renderStateKey: `${entryKey}/render-state`,
			samplingKey: `${entryKey}/sampling`,
			samplingPolicy: {
				wrapS: "clamp",
				wrapT: "clamp",
				alphaTest: 0,
				doubleSided: false,
			},
			materialSlotKey: `${entryKey}/slot`,
			atlasEntry: {
				renderSurfaceId: 1,
				preparedTextureAssetId: `prepared/${entryKey}`,
				level: {
					level: 0,
					width,
					height,
					bytes: new Uint8Array(width * height * 4),
					format: "rgba8",
				},
				sourceHash: `hash/${entryKey}`,
				sourceFormatRaw: 0,
			},
		},
	};
}

function createDetailCandidate({
	candidateId,
	entryKey,
	bucket,
}: {
	candidateId: string;
	entryKey: string;
	bucket: TexturePageBucket;
}): TexturePageAtlasDetailCandidate {
	return {
		candidateId,
		bucket,
		detailAtlasEntry: {
			key: entryKey,
			renderSurfaceId: 2,
			sourceFormatRaw: 0,
			width: 16,
			height: 16,
			bytes: new Uint8Array(16 * 16 * 4),
			format: "rgba8",
			tiling: 1,
			blendMode: "dst-color",
		},
	};
}

function createPolicy(): CompactionFamilyPlanningPolicy {
	return {
		maxAtlasTextureSize: 512,
		maxAtlasTextureCount: 8,
		baseGutterPixels: 0,
		maxMaterialSlotsPerDraw: 8,
	};
}
