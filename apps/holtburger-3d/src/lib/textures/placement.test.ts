import { describe, expect, it } from "vitest";
import type {
	MaterialTextureDataUseIdentity,
	StaticBakeTextureUse,
	VisualTextureDomain,
} from "../static/contracts";
import {
	classifyTexturePlacementPool,
	classifyTextureUsagePurpose,
	createDynamicTexturePlacementIntent,
	createStaticTexturePlacementIntent,
	type DynamicTexturePlacementUse,
} from "./placement";

describe("texture placement vocabulary bridge", () => {
	it.each([
		["rgba-color", "static-authored-object", "object-base-color"],
		["rgba-raw", "static-authored-object", "object-base-color"],
		["rgba-detail", "static-authored-object", "object-detail"],
		["rgba-mask", "static-authored-object", "object-base-color"],
		["index8", "static-authored-object", "object-index"],
		["index16", "static-authored-object", "object-index"],
		["rgba-color", "terrain", "terrain-color"],
		["rgba-raw", "terrain", "terrain-color"],
		["rgba-detail", "terrain", "terrain-detail"],
		["rgba-mask", "terrain", "terrain-mask"],
	] as const)("classifies %s in %s as %s", (usage, pool, expectedPurpose) => {
		expect(
			classifyTextureUsagePurpose(createPreparedDataUse(usage), pool),
		).toBe(expectedPurpose);
	});

	it("classifies palette uses by pool while preserving palette range identity", () => {
		const dataUse = createPaletteDataUse();

		expect(classifyTextureUsagePurpose(dataUse, "static-authored-object")).toBe(
			"object-palette",
		);
		expect(
			classifyTextureUsagePurpose(dataUse, "runtime-authored-object"),
		).toBe("object-palette");
		expect(classifyTextureUsagePurpose(dataUse, "terrain")).toBe(
			"terrain-color",
		);
	});

	it.each([
		["outdoor-terrain", "terrain"],
		["outdoor-buildings", "static-authored-object"],
		["outdoor-explicit-objects", "static-authored-object"],
		["outdoor-generated-scenery", "static-authored-object"],
		["env-cell-system", "static-authored-object"],
		["runtime-object-material", "runtime-authored-object"],
	] as const)("maps %s to %s pool", (domain, pool) => {
		expect(classifyTexturePlacementPool(domain)).toBe(pool);
	});

	it("maps terrain static texture uses to the terrain pool", () => {
		const textureUse = createStaticTextureUse({
			domain: "outdoor-terrain",
			source: createPreparedDataUse("rgba-mask"),
			textureUseId: "terrain:mask:06000010",
		});

		expect(createStaticTexturePlacementIntent(textureUse)).toMatchObject({
			itemId: "terrain:mask:06000010",
			pool: "terrain",
			purpose: "terrain-mask",
		});
	});

	it("maps static-authored dynamic object texture uses to the static-authored object pool", () => {
		const textureUse = createDynamicTextureUse({
			source: createPreparedDataUse("rgba-detail"),
			textureDomain: "outdoor-generated-scenery",
			textureUseId: "static-authored-dynamic:detail:06000020",
		});

		expect(createDynamicTexturePlacementIntent(textureUse)).toMatchObject({
			itemId: "static-authored-dynamic:detail:06000020",
			pool: "static-authored-object",
			purpose: "object-detail",
		});
	});

	it("maps runtime-authored dynamic object texture uses to the runtime-authored object pool", () => {
		const textureUse = createDynamicTextureUse({
			source: createPreparedDataUse("index16"),
			textureDomain: "runtime-object-material",
			textureUseId: "runtime-authored-dynamic:index:06000030",
		});

		expect(createDynamicTexturePlacementIntent(textureUse)).toMatchObject({
			itemId: "runtime-authored-dynamic:index:06000030",
			pool: "runtime-authored-object",
			purpose: "object-index",
		});
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
		staticBatchId: "static-batch:test",
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
