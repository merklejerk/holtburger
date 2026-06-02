import { describe, expect, it } from "vitest";

import {
	planTexturePageAtlas,
	type TexturePageFamily,
	type TexturePageAtlasRgbaCandidate,
	type TexturePageAtlasDetailCandidate,
} from "./texture-page-atlas-planner";
import type { CompactionFamilyPlanningPolicy } from "../compaction/compaction-family-planner";

describe("planTexturePageAtlas", () => {
	it("keeps rgba atlas pages isolated by texture page family", () => {
		const plan = planTexturePageAtlas({
			rgbaCandidates: [
				createRgbaCandidate({
					drawUnitId: "static-a",
					entryKey: "shared-size-static",
					family: "static-rgba",
				}),
				createRgbaCandidate({
					drawUnitId: "terrain-a",
					entryKey: "shared-size-terrain",
					family: "terrain-color",
				}),
			],
			detailCandidates: [],
			policy: createPolicy(),
		});

		expect(plan.rgbaAtlasReadyDrawUnitIds).toEqual([
			"static-a",
			"terrain-a",
		]);
		expect(plan.families.map((family) => family.family)).toEqual([
			"static-rgba",
			"terrain-color",
		]);
		expect(plan.families[0]?.atlasTextures).toHaveLength(1);
		expect(plan.families[1]?.atlasTextures).toHaveLength(1);
		expect(plan.atlasTextures).toHaveLength(2);
		expect(
			plan.atlasTextures.map((texture) =>
				texture.placements.map((placement) => placement.atlasEntryKey),
			),
		).toEqual([["shared-size-static"], ["shared-size-terrain"]]);
	});

	it("keeps detail atlas pages isolated by texture page family", () => {
		const plan = planTexturePageAtlas({
			rgbaCandidates: [],
			detailCandidates: [
				createDetailCandidate({
					drawUnitId: "static-detail",
					entryKey: "static-detail-entry",
					family: "static-detail",
				}),
				createDetailCandidate({
					drawUnitId: "terrain-detail",
					entryKey: "terrain-detail-entry",
					family: "terrain-detail",
				}),
			],
			policy: createPolicy(),
		});

		expect(plan.detailAtlasReadyDrawUnitIds).toEqual([
			"static-detail",
			"terrain-detail",
		]);
		expect(plan.families.map((family) => family.family)).toEqual([
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
});

function createRgbaCandidate({
	drawUnitId,
	entryKey,
	family,
}: {
	drawUnitId: string;
	entryKey: string;
	family: TexturePageFamily;
}): TexturePageAtlasRgbaCandidate {
	return {
		drawUnitId,
		family,
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
	drawUnitId,
	entryKey,
	family,
}: {
	drawUnitId: string;
	entryKey: string;
	family: TexturePageFamily;
}): TexturePageAtlasDetailCandidate {
	return {
		drawUnitId,
		family,
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
		maxAtlasTextureSize: 64,
		maxAtlasTextureCount: 8,
		baseGutterPixels: 0,
		maxMaterialSlotsPerDraw: 8,
	};
}
