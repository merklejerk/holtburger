import { describe, expect, it } from "vitest";
import type {
	MaterialTextureDataUseIdentity,
	StaticBakeTextureUse,
	VisualTextureDomain,
} from "../static/contracts";
import {
	classifyTextureUsagePurpose,
	createDynamicTexturePlacementIntent,
	createRuntimeAuthoredDynamicTexturePlacementBucketKey,
	createStaticAuthoredDynamicTexturePlacementBucketKey,
	createStaticTexturePlacementIntent,
	createStaticAuthoredTexturePlacementBucketKey,
	type DynamicTexturePlacementUse,
} from "./placement";

describe("texture placement vocabulary bridge", () => {
	it.each([
		["rgba-color", "outdoor-buildings", "object-base-color"],
		["rgba-raw", "outdoor-buildings", "object-base-color"],
		["rgba-detail", "outdoor-buildings", "object-detail"],
		["rgba-mask", "outdoor-buildings", "object-base-color"],
		["index8", "runtime-object-material", "object-index"],
		["index16", "runtime-object-material", "object-index"],
		["rgba-color", "outdoor-terrain", "terrain-color"],
		["rgba-raw", "outdoor-terrain", "terrain-color"],
		["rgba-detail", "outdoor-terrain", "terrain-detail"],
		["rgba-mask", "outdoor-terrain", "terrain-mask"],
	] as const)("classifies %s in %s as %s", (usage, domain, expectedPurpose) => {
		expect(
			classifyTextureUsagePurpose(createPreparedDataUse(usage), domain),
		).toBe(expectedPurpose);
	});

	it("classifies palette uses by domain while preserving palette range identity", () => {
		const dataUse = createPaletteDataUse();

		expect(classifyTextureUsagePurpose(dataUse, "outdoor-buildings")).toBe(
			"object-palette",
		);
		expect(
			classifyTextureUsagePurpose(dataUse, "runtime-object-material"),
		).toBe("object-palette");
		expect(classifyTextureUsagePurpose(dataUse, "outdoor-terrain")).toBe(
			"terrain-color",
		);
	});

	it("maps terrain static texture uses to terrain purposes", () => {
		const textureUse = createStaticTextureUse({
			domain: "outdoor-terrain",
			source: createPreparedDataUse("rgba-mask"),
			textureUseId: "terrain:mask:06000010",
		});

		expect(createStaticTexturePlacementIntent(textureUse)).toMatchObject({
			domain: "outdoor-terrain",
			itemId: "terrain:mask:06000010",
			purpose: "terrain-mask",
		});
	});

	it("maps static-authored dynamic object texture uses to object purposes", () => {
		const textureUse = createDynamicTextureUse({
			source: createPreparedDataUse("rgba-detail"),
			textureDomain: "outdoor-generated-scenery",
			textureUseId: "static-authored-dynamic:detail:06000020",
		});

		expect(
			createDynamicTexturePlacementIntent(textureUse, {
				placementBucketKey:
					createStaticAuthoredDynamicTexturePlacementBucketKey({
						domain: "outdoor-generated-scenery",
						ownerId: "static-layer-owner:generated:0xda55ffff",
						purpose: "object-detail",
					}),
			}),
		).toMatchObject({
			domain: "outdoor-generated-scenery",
			itemId: "static-authored-dynamic:detail:06000020",
			placementBucketKey: createStaticAuthoredDynamicTexturePlacementBucketKey({
				domain: "outdoor-generated-scenery",
				ownerId: "static-layer-owner:generated:0xda55ffff",
				purpose: "object-detail",
			}),
			purpose: "object-detail",
		});
	});

	it("maps runtime-authored dynamic object texture uses to object purposes", () => {
		const textureUse = createDynamicTextureUse({
			source: createPreparedDataUse("index16"),
			textureDomain: "runtime-object-material",
			textureUseId: "runtime-authored-dynamic:index:06000030",
		});

		expect(
			createDynamicTexturePlacementIntent(textureUse, {
				placementBucketKey:
					createRuntimeAuthoredDynamicTexturePlacementBucketKey({
						entityId: "runtime-spawn:1",
						purpose: "object-index",
					}),
			}),
		).toMatchObject({
			domain: "runtime-object-material",
			itemId: "runtime-authored-dynamic:index:06000030",
			placementBucketKey: createRuntimeAuthoredDynamicTexturePlacementBucketKey(
				{
					entityId: "runtime-spawn:1",
					purpose: "object-index",
				},
			),
			purpose: "object-index",
		});
	});

	it("requires dynamic placement intents to declare their bucket lifetime", () => {
		const textureUse = createDynamicTextureUse({
			source: createPreparedDataUse("rgba-color"),
			textureDomain: "runtime-object-material",
			textureUseId: "runtime-authored-dynamic:base:06000031",
		});

		expect(() => createDynamicTexturePlacementIntent(textureUse)).toThrow(
			"Dynamic texture placement intents require an explicit placement bucket key.",
		);
	});

	it("passes affinity keys through without interpretation", () => {
		const textureUse = createStaticTextureUse({
			domain: "outdoor-buildings",
			source: createPreparedDataUse("rgba-color"),
			textureUseId: "building:base:06000040",
		});

		expect(
			createStaticTexturePlacementIntent(textureUse, {
				affinityKey: "setup-model/020003e5",
			}),
		).toMatchObject({
			affinityKey: "setup-model/020003e5",
			itemId: "building:base:06000040",
		});
	});

	it("derives one static-authored bucket across different placement affinities", () => {
		const source = createPreparedDataUse("rgba-color");
		const firstIntent = createStaticTexturePlacementIntent(
			createStaticTextureUse({
				domain: "outdoor-generated-scenery",
				source,
				textureUseId: "scenery:base:06000050:first",
			}),
			{ affinityKey: "setup-model/020003e5" },
		);
		const secondIntent = createStaticTexturePlacementIntent(
			createStaticTextureUse({
				domain: "outdoor-generated-scenery",
				source,
				textureUseId: "scenery:base:06000050:second",
			}),
			{ affinityKey: "setup-model/020003e5:alternate" },
		);

		expect(createStaticAuthoredTexturePlacementBucketKey(firstIntent)).toBe(
			createStaticAuthoredTexturePlacementBucketKey(secondIntent),
		);
	});

	it("keeps static-authored buckets separated by shader purpose", () => {
		const baseColorIntent = createStaticTexturePlacementIntent(
			createStaticTextureUse({
				domain: "outdoor-buildings",
				source: createPreparedDataUse("rgba-color"),
				textureUseId: "building:base:06000060",
			}),
		);
		const detailIntent = createStaticTexturePlacementIntent(
			createStaticTextureUse({
				domain: "outdoor-buildings",
				source: createPreparedDataUse("rgba-detail"),
				textureUseId: "building:detail:06000061",
			}),
		);

		expect(
			createStaticAuthoredTexturePlacementBucketKey(baseColorIntent),
		).not.toBe(createStaticAuthoredTexturePlacementBucketKey(detailIntent));
	});

	it("derives static-authored dynamic buckets from static owner lifetime", () => {
		const firstBucket = createStaticAuthoredDynamicTexturePlacementBucketKey({
			domain: "outdoor-generated-scenery",
			ownerId: "static-layer-owner:generated:0xda55ffff",
			purpose: "object-base-color",
		});
		const secondBucket = createStaticAuthoredDynamicTexturePlacementBucketKey({
			domain: "outdoor-generated-scenery",
			ownerId: "static-layer-owner:generated:0xda55ffff",
			purpose: "object-base-color",
		});
		const otherOwnerBucket =
			createStaticAuthoredDynamicTexturePlacementBucketKey({
				domain: "outdoor-generated-scenery",
				ownerId: "static-layer-owner:generated:0xda56ffff",
				purpose: "object-base-color",
			});

		expect(firstBucket).toBe(secondBucket);
		expect(firstBucket).not.toBe(otherOwnerBucket);
	});

	it("keeps runtime-authored dynamic buckets out of static-authored dynamic buckets", () => {
		const staticAuthoredBucket =
			createStaticAuthoredDynamicTexturePlacementBucketKey({
				domain: "outdoor-explicit-objects",
				ownerId: "static-layer-owner:explicit:0xda55ffff",
				purpose: "object-index",
			});
		const runtimeAuthoredBucket =
			createRuntimeAuthoredDynamicTexturePlacementBucketKey({
				entityId: "runtime-spawn:1",
				purpose: "object-index",
			});

		expect(runtimeAuthoredBucket).not.toBe(staticAuthoredBucket);
	});

	it("preserves current palette and subpalette identity in the placement source", () => {
		const dataUse = createPaletteDataUse();
		const textureUse = createStaticTextureUse({
			domain: "outdoor-buildings",
			source: dataUse,
			textureUseId: "building:palette:04000010:first=32:count=64",
		});

		const intent = createStaticTexturePlacementIntent(textureUse);

		expect(intent.itemId).toBe("building:palette:04000010:first=32:count=64");
		expect(intent.source).toMatchObject({
			kind: "material-texture-data-use",
			samplingPolicy: {
				wrapS: "repeat",
				wrapT: "clamp-to-edge",
			},
		});
		expect(intent.source.dataUse).toBe(dataUse);
		if (intent.source.dataUse.kind !== "palette-texture-use") {
			throw new Error("Expected palette texture use.");
		}
		expect(intent.source.dataUse).toMatchObject({
			firstIndex: 32,
			indexCount: 64,
			palette: { kind: "palette", paletteId: 0x04000010 },
			subPalettes: [
				{
					firstIndex: 48,
					indexCount: 16,
					palette: { kind: "palette", paletteId: 0x04000020 },
				},
			],
		});
	});
});

function createStaticTextureUse(options: {
	readonly domain: VisualTextureDomain;
	readonly source: MaterialTextureDataUseIdentity;
	readonly textureUseId: string;
}): StaticBakeTextureUse {
	if (options.domain === "runtime-object-material") {
		throw new Error("Static texture uses cannot use runtime-object-material.");
	}
	return {
		domain: options.domain,
		owners: [],
		samplingPolicy: {
			wrapS: "repeat",
			wrapT: "clamp-to-edge",
		},
		source: options.source,
		textureUseId: options.textureUseId,
	};
}

function createDynamicTextureUse(options: {
	readonly source: MaterialTextureDataUseIdentity;
	readonly textureDomain: VisualTextureDomain;
	readonly textureUseId: string;
}): DynamicTexturePlacementUse {
	return {
		samplingPolicy: {
			wrapS: "clamp-to-edge",
			wrapT: "repeat",
		},
		source: options.source,
		textureDomain: options.textureDomain,
		textureUseId: options.textureUseId,
	};
}

function createPreparedDataUse(
	usage: Extract<
		MaterialTextureDataUseIdentity,
		{ readonly kind: "prepared-render-surface-texture-use" }
	>["usage"],
): MaterialTextureDataUseIdentity {
	return {
		kind: "prepared-render-surface-texture-use",
		renderSurface: {
			kind: "render-surface",
			renderSurfaceId: 0x06000010,
		},
		usage,
	};
}

function createPaletteDataUse(): MaterialTextureDataUseIdentity {
	return {
		firstIndex: 32,
		indexCount: 64,
		kind: "palette-texture-use",
		palette: {
			kind: "palette",
			paletteId: 0x04000010,
		},
		subPalettes: [
			{
				firstIndex: 48,
				indexCount: 16,
				palette: {
					kind: "palette",
					paletteId: 0x04000020,
				},
			},
		],
		usage: "palette-rgba",
	};
}
