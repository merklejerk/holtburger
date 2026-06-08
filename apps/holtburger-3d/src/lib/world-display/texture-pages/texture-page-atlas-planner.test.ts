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
});

function createRgbaCandidate({
	candidateId,
	entryKey,
	bucket,
}: {
	candidateId: string;
	entryKey: string;
	bucket: TexturePageBucket;
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
					width: 16,
					height: 16,
					bytes: new Uint8Array(16 * 16 * 4),
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
