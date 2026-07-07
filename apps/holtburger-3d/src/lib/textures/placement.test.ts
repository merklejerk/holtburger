import { describe, expect, it } from "vitest";
import type {
	MaterialTextureDataUseIdentity,
	StaticBakeTextureUse,
	VisualTextureDomain,
} from "../static/contracts";
import {
	classifyTextureUsagePurpose,
	createDynamicTexturePlacementIntent,
	createStaticTexturePlacementIntent,
	type DynamicTexturePlacementUse,
	type TexturePlacementPolicy,
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
			textureBindingId: "terrain:mask:06000010",
		});

		expect(
			createStaticTexturePlacementIntent(textureUse, {
				placementPolicy: staticDomainPolicy(),
			}),
		).toMatchObject({
			domain: "outdoor-terrain",
			itemId: textureUse.bindingId,
			placementPolicy: staticDomainPolicy(),
			purpose: "terrain-mask",
		});
	});

	it("maps static-authored dynamic object texture uses to object purposes", () => {
		const textureUse = createDynamicTextureUse({
			source: createPreparedDataUse("rgba-detail"),
			textureDomain: "outdoor-generated-scenery",
			textureBindingId: "static-authored-dynamic:detail:06000020",
		});

		expect(
			createDynamicTexturePlacementIntent(textureUse, {
				placementPolicy: staticDomainPolicy(),
			}),
		).toMatchObject({
			domain: "outdoor-generated-scenery",
			itemId: textureUse.bindingId,
			placementPolicy: staticDomainPolicy(),
			purpose: "object-detail",
		});
	});

	it("maps runtime-authored dynamic object texture uses to object purposes", () => {
		const textureUse = createDynamicTextureUse({
			source: createPreparedDataUse("index16"),
			textureDomain: "runtime-object-material",
			textureBindingId: "runtime-authored-dynamic:index:06000030",
		});

		expect(
			createDynamicTexturePlacementIntent(textureUse, {
				placementPolicy: runtimeOwnerPolicy("runtime-spawn:1"),
			}),
		).toMatchObject({
			domain: "runtime-object-material",
			itemId: textureUse.bindingId,
			placementPolicy: runtimeOwnerPolicy("runtime-spawn:1"),
			purpose: "object-index",
		});
	});

	it("passes affinity keys through without interpretation", () => {
		const textureUse = createStaticTextureUse({
			domain: "outdoor-buildings",
			source: createPreparedDataUse("rgba-color"),
			textureBindingId: "building:base:06000040",
		});

		expect(
			createStaticTexturePlacementIntent(textureUse, {
				affinityKey: "setup-model/020003e5",
				placementPolicy: staticDomainPolicy(),
			}),
		).toMatchObject({
			affinityKey: "setup-model/020003e5",
			itemId: textureUse.bindingId,
		});
	});

	it("preserves prepared palette recipe identity in the placement source", () => {
		const dataUse = createPaletteDataUse();
		const textureUse = createStaticTextureUse({
			domain: "outdoor-buildings",
			source: dataUse,
			textureBindingId: "building:palette:04000010:domain=index8",
		});

		const intent = createStaticTexturePlacementIntent(textureUse, {
			placementPolicy: staticDomainPolicy(),
		});

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
	readonly textureBindingId: string;
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
			textureBindingId: options.textureBindingId,
		}),
		domain: options.domain,
		owners: [],
		samplingPolicy: {
			wrapS: "repeat",
			wrapT: "clamp-to-edge",
		},
		source: options.source,
		textureBindingId: options.textureBindingId,
	};
}

function createDynamicTextureUse(options: {
	readonly source: MaterialTextureDataUseIdentity;
	readonly textureDomain: VisualTextureDomain;
	readonly textureBindingId: string;
}): DynamicTexturePlacementUse {
	return {
		...createPlacementTestIdentity({
			domain: options.textureDomain,
			samplingPolicy: {
				wrapS: "clamp-to-edge",
				wrapT: "repeat",
			},
			source: options.source,
			textureBindingId: options.textureBindingId,
		}),
		samplingPolicy: {
			wrapS: "clamp-to-edge",
			wrapT: "repeat",
		},
		source: options.source,
		textureDomain: options.textureDomain,
		textureBindingId: options.textureBindingId,
	};
}

function staticDomainPolicy(): TexturePlacementPolicy {
	return {
		bucketScope: { kind: "static-domain" },
		sourceStability: { kind: "content-stable" },
	};
}

function runtimeOwnerPolicy(ownerId: string): TexturePlacementPolicy {
	return {
		bucketScope: { kind: "runtime-owner", ownerId },
		sourceStability: {
			kind: "owner-specific",
			reason: "runtime-customized",
		},
	};
}

function createPlacementTestIdentity(input: {
	readonly domain: VisualTextureDomain;
	readonly samplingPolicy: NonNullable<StaticBakeTextureUse["samplingPolicy"]>;
	readonly source: MaterialTextureDataUseIdentity;
	readonly textureBindingId: string;
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
			slot: input.textureBindingId,
			wrapMode: input.samplingPolicy.wrapS,
		}),
		ownerIds: [],
		pageClass: createTexturePageClass({
			domain: input.domain,
			format: outputFormat,
			gutterPixels: getRuntimeTexturePageGutterPixels(input.domain, pagePolicy),
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
