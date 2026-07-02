import { describe, expect, it } from "vitest";
import type {
	MaterialTextureDataUseIdentity,
	StaticBakeTextureUse,
} from "../contracts";
import { createStaticTexturePlacementIntent } from "../../textures/placement";
import {
	createStaticMaterialTextureBindingRequirement,
	createStaticMaterialTextureSamplingPolicy,
	createStaticMaterialTextureUseId,
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

	it("includes sampling policy in static material texture-use identity", () => {
		const dataUse = createPreparedTextureUse("rgba-color");

		expect(
			createStaticMaterialTextureUseId({
				dataUse,
				textureUseNamespace: "static-object-texture",
				textureUseScopeId: "static-object-layer-a",
				wrapMode: "clamp",
			}),
		).toBe(
			"static-object-layer-a:static-object-texture:prepared-render-surface-texture-use:06000010:rgba-color:sampling:wrap=clamp-to-edge,clamp-to-edge",
		);
		expect(
			createStaticMaterialTextureUseId({
				dataUse,
				textureUseNamespace: "static-object-texture",
				textureUseScopeId: "static-object-layer-a",
				wrapMode: "repeat",
			}),
		).toBe(
			"static-object-layer-a:static-object-texture:prepared-render-surface-texture-use:06000010:rgba-color:sampling:wrap=repeat,repeat",
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
		const placementIntent = createStaticTexturePlacementIntent(textureUse);

		expect(requirement).toMatchObject({
			bindingKey:
				"static-object-layer-a:static-object-texture:prepared-render-surface-texture-use:06000010:rgba-color:sampling:wrap=repeat,repeat",
			placementItemId:
				"static-object-layer-a:static-object-texture:prepared-render-surface-texture-use:06000010:rgba-color:sampling:wrap=repeat,repeat",
			purpose: "object-base-color",
			sourceKey: "prepared-render-surface-texture-use:06000010:rgba-color",
		});
		expect(textureUse.textureUseId).toBe(requirement.bindingKey);
		expect(placementIntent.itemId).toBe(requirement.placementItemId);
		expect({
			itemIds: [requirement.placementItemId],
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
	const textureUse: StaticBakeTextureUse = {
		domain: "outdoor-buildings",
		owners: [],
		source: requirement.source.dataUse,
		textureUseId: requirement.bindingKey,
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
		firstIndex: 0,
		indexCount: 256,
		kind: "palette-texture-use",
		palette: {
			kind: "palette",
			paletteId: 0x0400007e,
		},
		subPalettes: [],
		usage: "palette-rgba",
	};
}
