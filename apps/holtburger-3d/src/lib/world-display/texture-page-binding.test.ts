import { describe, expect, it } from "vitest";

import type { TexturePageAtlasPlan } from "./texture-page-atlas-planner";
import { resolveDirectDrawBaseTexturePageBinding } from "./texture-page-binding";
import type { Webgl2TextureAtlasGenerationResource } from "./webgl2-texture-atlas-generation";
import type { Webgl2Texture2DResource } from "./webgl2-gl";
import type { Webgl2WorldDrawUnit } from "./webgl2-world-resources";

describe("texture page binding", () => {
	it("reports retained-direct atlas coverage gaps as not atlas-planned", () => {
		const resolution = resolveDirectDrawBaseTexturePageBinding({
			drawUnit: createDrawUnit("draw-a", "entry-a"),
			generation: createGeneration(),
			atlasPlan: createAtlasPlan(),
			fallbackSamples: [],
		});

		expect(resolution.binding?.pageKind).toBe("single-entry");
		expect(resolution.fallbackSamples).toEqual([
			"direct packed base page entry not atlas-planned for retained direct material entry-a",
		]);
	});

	it("reports atlas placement failures separately from resource sync failures", () => {
		const resolution = resolveDirectDrawBaseTexturePageBinding({
			drawUnit: createDrawUnit("draw-a", "entry-a"),
			generation: createGeneration(),
			atlasPlan: createAtlasPlan({
				bypasses: [
					{
						drawUnitId: "draw-a",
						reason: "atlas-full",
						blockerKind: "atlas",
						blocker: "atlas-full",
						detail: "atlas is full",
					},
				],
			}),
			fallbackSamples: [],
		});

		expect(resolution.fallbackSamples).toEqual([
			"direct packed base page atlas placement unavailable entry-a (atlas-full)",
		]);
	});

	it("reports missing realized placements when the atlas plan promised an entry", () => {
		const resolution = resolveDirectDrawBaseTexturePageBinding({
			drawUnit: createDrawUnit("draw-a", "entry-a"),
			generation: createGeneration(),
			atlasPlan: createAtlasPlan({
				atlasEntryRecords: [
					{
						key: "entry-a",
						entry: {
							renderSurfaceId: 1,
							preparedTextureAssetId: "prepared-texture/entry-a",
							sourceHash: "hash-a",
							sourceFormatRaw: 0x15,
							level: {
								level: 0,
								width: 1,
								height: 1,
								formatRaw: 0x15,
								format: "A8R8G8B8",
								byteLength: 4,
								bytes: Uint8Array.from([1, 2, 3, 4]),
							},
						},
					},
				],
			}),
			fallbackSamples: [],
		});

		expect(resolution.fallbackSamples).toEqual([
			"direct packed base page atlas generation missing promised placement entry-a",
		]);
	});
});

function createDrawUnit(id: string, atlasEntryKey: string): Webgl2WorldDrawUnit {
	return {
		id,
		texture: createTexture(),
		texturePageReadiness: {
			materialSlotKey: `slot-${atlasEntryKey}`,
			atlasEntryKey,
			atlasEntry: {
				renderSurfaceId: 1,
				preparedTextureAssetId: `prepared-texture/${atlasEntryKey}`,
				sourceHash: "hash",
				sourceFormatRaw: 0x15,
				level: {
					level: 0,
					width: 1,
					height: 1,
					formatRaw: 0x15,
					format: "A8R8G8B8",
					byteLength: 4,
					bytes: Uint8Array.from([1, 2, 3, 4]),
				},
			},
			samplingPolicy: { wrapS: "clamp", wrapT: "clamp" },
			samplingKey: "sampling",
			renderStateKey: "render-state",
		},
		detailOverlay: null,
		directTextureSamplingPolicy: null,
	} as Webgl2WorldDrawUnit;
}

function createTexture(): Webgl2Texture2DResource {
	return {
		texture: {} as WebGLTexture,
		width: 4,
		height: 4,
		dispose() {
			return;
		},
	};
}

function createGeneration(): Webgl2TextureAtlasGenerationResource {
	return {
		key: "generation",
		textures: [],
		placements: [],
		detailTextures: [],
		detailPlacements: [],
		preparedTextureAssetIds: [],
		rgbaAtlasReadyDrawUnitIds: [],
		dispose() {
			return;
		},
	};
}

function createAtlasPlan(
	overrides: Partial<TexturePageAtlasPlan> = {},
): TexturePageAtlasPlan {
	return {
		key: "texture-page-atlas/test",
		rgbaAtlasReadyDrawUnitIds: [],
		detailAtlasReadyDrawUnitIds: [],
		bypasses: [],
		atlasEntryRecords: [],
		atlasTextures: [],
		detailAtlasEntryRecords: [],
		detailAtlasTextures: [],
		preparedTextureAssetIds: [],
		...overrides,
	};
}
