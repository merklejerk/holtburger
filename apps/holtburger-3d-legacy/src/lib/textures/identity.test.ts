import { describe, expect, it } from "vitest";
import {
	createMaterialTextureSourceKey,
	createPaletteReplacementFingerprint,
	createPaletteReplacementRecipeKey,
	createTextureBindingId,
	createTextureKey,
	createTextureOwnerId,
	createTexturePageClass,
} from "./identity";

describe("texture identity builders", () => {
	it("keeps texture identity stable across different landblock owners", () => {
		const sourceKey = createMaterialTextureSourceKey({
			kind: "render-surface",
			renderSurfaceId: 0x0600422e,
			usage: "rgba-color",
		});
		const textureKey = createTextureKey({
			outputFormat: "rgba8",
			sampleClass: "rgba-color",
			sourceKey,
		});

		expect(
			createTextureKey({
				outputFormat: "rgba8",
				sampleClass: "rgba-color",
				sourceKey,
			}),
		).toBe(textureKey);
		expect(
			createTextureOwnerId({
				kind: "layer",
				layerOwnerId: "static-layer-owner:buildings:0xda55ffff",
			}),
		).not.toBe(
			createTextureOwnerId({
				kind: "layer",
				layerOwnerId: "static-layer-owner:buildings:0xdb56ffff",
			}),
		);
	});

	it("allows different bindings and owners to share one texture key", () => {
		const sourceKey = createMaterialTextureSourceKey({
			kind: "render-surface",
			renderSurfaceId: 0x060039f2,
			usage: "rgba-detail",
		});
		const textureKey = createTextureKey({
			outputFormat: "rgba8",
			sampleClass: "rgba-detail",
			sourceKey,
		});

		const clampBinding = createTextureBindingId({
			resourceId: "object-visual:building-a",
			role: "detail",
			slot: 0,
			wrapMode: "clamp-to-edge",
		});
		const repeatBinding = createTextureBindingId({
			resourceId: "object-visual:building-b",
			role: "detail",
			slot: 0,
			wrapMode: "repeat",
		});

		expect(repeatBinding).not.toBe(clampBinding);
		expect(textureKey).toBe(
			createTextureKey({
				outputFormat: "rgba8",
				sampleClass: "rgba-detail",
				sourceKey,
			}),
		);
		expect(
			createTextureOwnerId({
				kind: "visual-resource",
				visualResourceId: "object-visual:building-a",
			}),
		).not.toBe(
			createTextureOwnerId({
				kind: "visual-resource",
				visualResourceId: "object-visual:building-b",
			}),
		);
	});

	it("keeps filter, mip, and anisotropy policy out of texture identity", () => {
		const sourceKey = createMaterialTextureSourceKey({
			kind: "render-surface",
			renderSurfaceId: 0x060041b7,
			usage: "rgba-color",
		});
		const nearestPolicy = {
			anisotropy: 1,
			filteringMode: "nearest",
			generateMipmaps: false,
		};
		const anisotropicPolicy = {
			anisotropy: 4,
			filteringMode: "anisotropic-4x",
			generateMipmaps: true,
		};

		expect(nearestPolicy).not.toEqual(anisotropicPolicy);
		expect(
			createTextureKey({
				outputFormat: "rgba8",
				sampleClass: "rgba-color",
				sourceKey,
			}),
		).toBe(
			createTextureKey({
				outputFormat: "rgba8",
				sampleClass: "rgba-color",
				sourceKey,
			}),
		);
	});

	it("keeps material wrap on bindings and physical page classes, not source identity", () => {
		const sourceKey = createMaterialTextureSourceKey({
			kind: "render-surface",
			renderSurfaceId: 0x06003ca7,
			usage: "rgba-color",
		});
		const textureKey = createTextureKey({
			outputFormat: "rgba8",
			sampleClass: "rgba-color",
			sourceKey,
		});

		expect(
			createTextureBindingId({
				resourceId: "draw-unit:a",
				role: "base-color",
				slot: 0,
				wrapMode: "clamp-to-edge",
			}),
		).not.toBe(
			createTextureBindingId({
				resourceId: "draw-unit:a",
				role: "base-color",
				slot: 0,
				wrapMode: "repeat",
			}),
		);
		expect(
			createTexturePageClass({
				domain: "outdoor-buildings",
				format: "rgba8",
				gutterPixels: 4,
				physicalWrapMode: "clamp-to-edge",
				purpose: "object-base-color",
				sampleClass: "rgba-color",
			}),
		).not.toBe(
			createTexturePageClass({
				domain: "outdoor-buildings",
				format: "rgba8",
				gutterPixels: 4,
				physicalWrapMode: "repeat",
				purpose: "object-base-color",
				sampleClass: "rgba-color",
			}),
		);
		expect(textureKey).toBe(
			createTextureKey({
				outputFormat: "rgba8",
				sampleClass: "rgba-color",
				sourceKey,
			}),
		);
	});

	it("keys palette replacements by range bytes instead of replacement asset ids or content hashes", () => {
		const replacement = createPaletteReplacementFingerprint({
			count: 2,
			offset: 16,
			rgbaBytes: new Uint8Array([1, 2, 3, 255, 4, 5, 6, 255]),
		});
		const recipeKey = createPaletteReplacementRecipeKey([replacement]);
		const sourceKey = createMaterialTextureSourceKey({
			basePaletteId: 0x04000010,
			domain: "index8",
			kind: "palette",
			replacementRecipeKey: recipeKey,
			usage: "palette-rgba",
		});

		expect(recipeKey).toContain("16+2@");
		expect(sourceKey).toContain("base=04000010");
		expect(sourceKey).not.toContain("replacement-palette");
		expect(sourceKey).not.toContain("contentHash");
	});

	it("canonicalizes palette replacement recipe order", () => {
		const lowRange = createPaletteReplacementFingerprint({
			count: 1,
			offset: 4,
			rgbaBytes: [10, 20, 30, 255],
		});
		const highRange = createPaletteReplacementFingerprint({
			count: 1,
			offset: 12,
			rgbaBytes: [40, 50, 60, 255],
		});

		expect(createPaletteReplacementRecipeKey([highRange, lowRange])).toBe(
			createPaletteReplacementRecipeKey([lowRange, highRange]),
		);
	});

	it("rejects malformed palette replacement byte ranges loudly", () => {
		expect(() =>
			createPaletteReplacementFingerprint({
				count: 2,
				offset: 0,
				rgbaBytes: [1, 2, 3, 255],
			}),
		).toThrow("Palette replacement byte length must be count * 4");
	});
});
