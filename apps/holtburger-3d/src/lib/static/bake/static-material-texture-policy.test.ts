import { describe, expect, it } from "vitest";
import type {
	MaterialTextureDataUseIdentity,
	StaticBakeTextureUse,
} from "../contracts";
import {
	createMaterialTextureSourceKey,
	createTextureKey,
	createTextureOwnerId,
	createTexturePageClass,
} from "../../textures/identity";
import {
	createStaticDomainTexturePlacementPolicy,
	createStaticTexturePlacementIntent,
} from "../../textures/placement";
import {
	createStaticMaterialTextureBindingId,
	createStaticMaterialTextureBindingRequirement,
	createStaticMaterialTextureSamplingPolicy,
} from "./static-material-texture-policy";

describe("static material texture policy", () => {
	it("uses primary wrap mode for base and index texture data", () => {
		expect(
			createStaticMaterialTextureSamplingPolicy({
				dataUse: createPreparedTextureUse("rgba-color"),
				wrapMode: "repeat",
			}),
		).toEqual({ wrapS: "repeat", wrapT: "repeat" });
		expect(
			createStaticMaterialTextureSamplingPolicy({
				dataUse: createPreparedTextureUse("index16"),
				wrapMode: "clamp",
			}),
		).toEqual({ wrapS: "clamp-to-edge", wrapT: "clamp-to-edge" });
	});

	it("keeps detail repeat while palette, mask, and raw data stay clamped", () => {
		expect(
			createStaticMaterialTextureSamplingPolicy({
				dataUse: createPreparedTextureUse("rgba-detail"),
				wrapMode: "clamp",
			}),
		).toEqual({ wrapS: "repeat", wrapT: "repeat" });
		expect(
			createStaticMaterialTextureSamplingPolicy({
				dataUse: createPaletteTextureUse(),
				wrapMode: "repeat",
			}),
		).toEqual({ wrapS: "clamp-to-edge", wrapT: "clamp-to-edge" });
		expect(
			createStaticMaterialTextureSamplingPolicy({
				dataUse: createPreparedTextureUse("rgba-mask"),
				wrapMode: "repeat",
			}),
		).toEqual({ wrapS: "clamp-to-edge", wrapT: "clamp-to-edge" });
		expect(
			createStaticMaterialTextureSamplingPolicy({
				dataUse: createPreparedTextureUse("rgba-raw"),
				wrapMode: "repeat",
			}),
		).toEqual({ wrapS: "clamp-to-edge", wrapT: "clamp-to-edge" });
	});

	it("creates material binding identity separately from texture-use compatibility strings", () => {
		const dataUse = createPreparedTextureUse("rgba-color");

		expect(
			createStaticMaterialTextureBindingId({
				dataUse,
				domain: "outdoor-buildings",
				textureUseNamespace: "static-object-texture",
				textureUseScopeId: "static-object-layer-a",
				wrapMode: "repeat",
			}),
		).toBe(
			"binding|resource=static-object-layer-a%3Astatic-object-texture|slot=prepared-render-surface-texture-use%3A06000010%3Argba-color|role=object-base-color|wrap=repeat|variant=default",
		);
	});

	it("creates explicit binding requirements for placement and renderer binding", () => {
		const dataUse = createPreparedTextureUse("rgba-color");
		const requirement = createStaticMaterialTextureBindingRequirement({
			dataUse,
			domain: "outdoor-generated-scenery",
			textureUseNamespace: "static-object-texture",
			textureUseScopeId: "static-object-layer-a",
			wrapMode: "repeat",
		});
		const textureUse = createTextureUseFromRequirement(requirement);
		const placementIntent = createStaticTexturePlacementIntent(textureUse, {
			bindingId: requirement.bindingId,
			ownerIds: [
				createTextureOwnerId({
					kind: "layer",
					layerOwnerId: "static-object-layer-a",
				}),
			],
			pageClass: createTexturePageClass({
				domain: "outdoor-generated-scenery",
				format: "rgba8",
				gutterPixels: 4,
				purpose: requirement.purpose,
				sampleClass: "rgba-color",
			}),
			placementPolicy: createStaticDomainTexturePlacementPolicy(),
			textureKey: createTextureKey({
				outputFormat: "rgba8",
				sampleClass: "rgba-color",
				sourceKey: createMaterialTextureSourceKey({
					kind: "render-surface",
					renderSurfaceId: 0x06000010,
					usage: "rgba-color",
				}),
			}),
		});

		expect(requirement).toMatchObject({
			bindingId:
				"binding|resource=static-object-layer-a%3Astatic-object-texture|slot=prepared-render-surface-texture-use%3A06000010%3Argba-color|role=object-base-color|wrap=repeat|variant=default",
			placementItemId:
				"binding|resource=static-object-layer-a%3Astatic-object-texture|slot=prepared-render-surface-texture-use%3A06000010%3Argba-color|role=object-base-color|wrap=repeat|variant=default",
			purpose: "object-base-color",
			sourceKey: "prepared-render-surface-texture-use:06000010:rgba-color",
		});
		expect(placementIntent.itemId).toBe(textureUse.bindingId);
		expect(placementIntent.placementPolicy).toEqual(
			createStaticDomainTexturePlacementPolicy(),
		);
		expect({
			itemIds: [placementIntent.itemId],
			purpose: requirement.purpose,
		}).toEqual({
			itemIds: [placementIntent.itemId],
			purpose: "object-base-color",
		});
	});
});

function createTextureUseFromRequirement(
	requirement: ReturnType<typeof createStaticMaterialTextureBindingRequirement>,
): StaticBakeTextureUse {
	const textureKey = createTextureKey({
		outputFormat: "rgba8",
		sampleClass: "rgba-color",
		sourceKey: createMaterialTextureSourceKey({
			kind: "render-surface",
			renderSurfaceId: 0x06000010,
			usage: "rgba-color",
		}),
	});
	const textureUse: StaticBakeTextureUse = {
		bindingId: requirement.bindingId,
		domain: "outdoor-buildings",
		ownerIds: [
			createTextureOwnerId({
				kind: "layer",
				layerOwnerId: "static-object-layer-a",
			}),
		],
		owners: [],
		pageClass: createTexturePageClass({
			domain: "outdoor-generated-scenery",
			format: "rgba8",
			gutterPixels: 4,
			purpose: requirement.purpose,
			sampleClass: "rgba-color",
		}),
		source: requirement.source.dataUse,
		textureKey,
	};
	if (!requirement.samplingPolicy) {
		return textureUse;
	}
	return {
		...textureUse,
		samplingPolicy: requirement.samplingPolicy,
	};
}

function createPreparedTextureUse(
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

function createPaletteTextureUse(): MaterialTextureDataUseIdentity {
	return {
		domain: "index8",
		kind: "prepared-palette-texture-use",
		palette: {
			kind: "palette",
			paletteId: 0x0400007e,
		},
		replacements: [],
		usage: "palette-rgba",
	};
}
