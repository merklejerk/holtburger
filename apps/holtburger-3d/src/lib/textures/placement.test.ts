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
import {
	createMaterialTextureSourceKey,
	createPaletteReplacementFingerprint,
	createPaletteReplacementRecipeKey,
	createTextureBindingId,
	createTextureKey,
	createTexturePageClass,
} from "./identity";
import { getRuntimeTexturePageGutterPixels } from "./material-texture-identity";
import { createRuntimeTexturePagePolicy } from "./sampling-policy";

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

	it("classifies prepared palette uses by domain", () => {
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
			itemId: textureUse.bindingId,
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
			itemId: textureUse.bindingId,
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

	it("preserves prepared palette recipe identity in the placement source", () => {
		const dataUse = createPaletteDataUse();
		const textureUse = createStaticTextureUse({
			domain: "outdoor-buildings",
			source: dataUse,
			textureUseId: "building:palette:04000010:domain=index8",
		});

		const intent = createStaticTexturePlacementIntent(textureUse);

		expect(intent.itemId).toBe(textureUse.bindingId);
		expect(intent.source).toMatchObject({
			kind: "material-texture-data-use",
			samplingPolicy: {
				wrapS: "repeat",
				wrapT: "clamp-to-edge",
			},
		});
		expect(intent.source.dataUse).toBe(dataUse);
		if (intent.source.dataUse.kind !== "prepared-palette-texture-use") {
			throw new Error("Expected prepared palette texture use.");
		}
		expect(intent.source.dataUse).toMatchObject({
			domain: "index8",
			palette: { kind: "palette", paletteId: 0x04000010 },
			replacements: [
				{
					count: 16,
					offset: 48,
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
		...createPlacementTestIdentity({
			domain: options.domain,
			samplingPolicy: {
				wrapS: "repeat",
				wrapT: "clamp-to-edge",
			},
			source: options.source,
			textureUseId: options.textureUseId,
		}),
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
		...createPlacementTestIdentity({
			domain: options.textureDomain,
			samplingPolicy: {
				wrapS: "clamp-to-edge",
				wrapT: "repeat",
			},
			source: options.source,
			textureUseId: options.textureUseId,
		}),
		samplingPolicy: {
			wrapS: "clamp-to-edge",
			wrapT: "repeat",
		},
		source: options.source,
		textureDomain: options.textureDomain,
		textureUseId: options.textureUseId,
	};
}

function createPlacementTestIdentity(input: {
	readonly domain: VisualTextureDomain;
	readonly samplingPolicy: NonNullable<StaticBakeTextureUse["samplingPolicy"]>;
	readonly source: MaterialTextureDataUseIdentity;
	readonly textureUseId: string;
}): Pick<
	StaticBakeTextureUse,
	"bindingId" | "ownerIds" | "pageClass" | "textureKey"
> {
	const pagePolicy = createRuntimeTexturePagePolicy(
		input.source,
		input.samplingPolicy,
	);
	const purpose = classifyTextureUsagePurpose(input.source, input.domain);
	const outputFormat = createPlacementTestOutputFormat(input.source);
	const sourceKey = createPlacementTestSourceKey(input.source);
	return {
		bindingId: createTextureBindingId({
			resourceId: "placement-test",
			role: purpose,
			slot: input.textureUseId,
			wrapMode: input.samplingPolicy.wrapS,
		}),
		ownerIds: [],
		pageClass: createTexturePageClass({
			domain: input.domain,
			format: outputFormat,
			gutterPixels: getRuntimeTexturePageGutterPixels(
				input.domain,
				pagePolicy,
			),
			physicalWrapMode:
				input.domain === "outdoor-terrain" ? pagePolicy.wrapS : undefined,
			purpose,
			sampleClass: pagePolicy.sampleClass,
		}),
		textureKey: createTextureKey({
			outputFormat,
			sampleClass: pagePolicy.sampleClass,
			sourceKey,
		}),
	};
}

function createPlacementTestSourceKey(source: MaterialTextureDataUseIdentity) {
	if (source.kind === "prepared-palette-texture-use") {
		return createMaterialTextureSourceKey({
			basePaletteId: source.palette.paletteId,
			domain: source.domain,
			kind: "palette",
			replacementRecipeKey: createPaletteReplacementRecipeKey(
				source.replacements.map((replacement) =>
					createPaletteReplacementFingerprint({
						count: replacement.count,
						offset: replacement.offset,
						rgbaBytes: createPlacementTestPaletteBytes(
							replacement.palette.paletteId,
							replacement.count,
						),
					}),
				),
			),
			usage: source.usage,
		});
	}
	return createMaterialTextureSourceKey({
		kind: "render-surface",
		renderSurfaceId: source.renderSurface.renderSurfaceId,
		usage: source.usage,
	});
}

function createPlacementTestPaletteBytes(
	paletteId: number,
	count: number,
): Uint8Array {
	const bytes = new Uint8Array(count * 4);
	for (let index = 0; index < count; index += 1) {
		bytes[index * 4] = paletteId & 0xff;
		bytes[index * 4 + 1] = (paletteId >> 8) & 0xff;
		bytes[index * 4 + 2] = (paletteId >> 16) & 0xff;
		bytes[index * 4 + 3] = 255;
	}
	return bytes;
}

function createPlacementTestOutputFormat(
	source: MaterialTextureDataUseIdentity,
): "rgba8" | "index8" | "index16" {
	if (source.kind === "prepared-palette-texture-use") {
		return "rgba8";
	}
	switch (source.usage) {
		case "index8":
			return "index8";
		case "index16":
			return "index16";
		case "rgba-color":
		case "rgba-detail":
		case "rgba-mask":
		case "rgba-raw":
			return "rgba8";
	}
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
		domain: "index8",
		kind: "prepared-palette-texture-use",
		palette: {
			kind: "palette",
			paletteId: 0x04000010,
		},
		replacements: [
			{
				count: 16,
				offset: 48,
				palette: {
					kind: "palette",
					paletteId: 0x04000020,
				},
			},
		],
		usage: "palette-rgba",
	};
}
