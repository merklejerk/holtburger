import { describe, expect, it } from "vitest";
import {
	createRuntimeTexturePagePolicy,
	createRuntimeTextureSamplerPolicy,
} from "./sampling-policy";

describe("runtime texture sampling policy", () => {
	it("generates GPU mipmaps only for filtered color and detail pages", () => {
		expect(
			createRuntimeTextureSamplerPolicy({
				filteringMode: "anisotropic-4x",
				sampleClass: "rgba-color",
			}),
		).toMatchObject({
			anisotropy: 4,
			generateMipmaps: true,
			policyKey: "sample=rgba-color;filter=anisotropic-4x;mips=on;aniso=4",
		});
		expect(
			createRuntimeTextureSamplerPolicy({
				filteringMode: "linear",
				sampleClass: "rgba-detail",
			}),
		).toMatchObject({
			anisotropy: 1,
			generateMipmaps: true,
			policyKey: "sample=rgba-detail;filter=linear;mips=on;aniso=1",
		});
		expect(
			createRuntimeTextureSamplerPolicy({
				filteringMode: "anisotropic-4x",
				sampleClass: "rgba-mask",
			}),
		).toMatchObject({
			generateMipmaps: false,
			policyKey: "sample=rgba-mask;filter=anisotropic-4x;mips=off;aniso=4",
		});
		expect(
			createRuntimeTextureSamplerPolicy({
				filteringMode: "nearest",
				sampleClass: "rgba-color",
			}),
		).toMatchObject({
			generateMipmaps: false,
			policyKey: "sample=rgba-color;filter=nearest;mips=off;aniso=1",
		});
	});

	it("maps prepared texture usage to page sample classes and wrapping", () => {
		expect(createRuntimeTexturePagePolicy(createUse("rgba-color"))).toEqual({
			sampleClass: "rgba-color",
			wrapS: "repeat",
			wrapT: "repeat",
		});
		expect(createRuntimeTexturePagePolicy(createUse("rgba-detail"))).toEqual({
			sampleClass: "rgba-detail",
			wrapS: "repeat",
			wrapT: "repeat",
		});
		expect(createRuntimeTexturePagePolicy(createUse("rgba-mask"))).toEqual({
			sampleClass: "rgba-mask",
			wrapS: "clamp-to-edge",
			wrapT: "clamp-to-edge",
		});
		expect(createRuntimeTexturePagePolicy(createUse("rgba-raw"))).toEqual({
			sampleClass: "rgba-exact",
			wrapS: "clamp-to-edge",
			wrapT: "clamp-to-edge",
		});
		expect(createRuntimeTexturePagePolicy(createUse("index8"))).toEqual({
			sampleClass: "index8",
			wrapS: "clamp-to-edge",
			wrapT: "clamp-to-edge",
		});
		expect(createRuntimeTexturePagePolicy(createUse("index16"))).toEqual({
			sampleClass: "index16",
			wrapS: "clamp-to-edge",
			wrapT: "clamp-to-edge",
		});
		expect(createRuntimeTexturePagePolicy(createPaletteUse())).toEqual({
			sampleClass: "palette-rgba",
			wrapS: "clamp-to-edge",
			wrapT: "clamp-to-edge",
		});
	});

	it("forces data texture sampler policy to nearest without mipmaps", () => {
		expect(
			createRuntimeTextureSamplerPolicy({
				filteringMode: "anisotropic-4x",
				sampleClass: "index8",
			}),
		).toEqual({
			anisotropy: 1,
			filteringMode: "nearest",
			generateMipmaps: false,
			policyKey: "sample=index8;filter=nearest;mips=off;aniso=1",
		});
		expect(
			createRuntimeTextureSamplerPolicy({
				filteringMode: "linear",
				sampleClass: "palette-rgba",
			}),
		).toMatchObject({
			filteringMode: "nearest",
			policyKey: "sample=palette-rgba;filter=nearest;mips=off;aniso=1",
		});
	});

	it("allows authored sampling policy to override color wrapping without changing sample class", () => {
		expect(
			createRuntimeTexturePagePolicy(createUse("rgba-color"), {
				wrapS: "clamp-to-edge",
				wrapT: "clamp-to-edge",
			}),
		).toEqual({
			sampleClass: "rgba-color",
			wrapS: "clamp-to-edge",
			wrapT: "clamp-to-edge",
		});
	});
});

function createUse(
	usage:
		| "index16"
		| "index8"
		| "rgba-color"
		| "rgba-detail"
		| "rgba-mask"
		| "rgba-raw",
) {
	return {
		kind: "prepared-render-surface-texture-use" as const,
		renderSurface: {
			kind: "render-surface" as const,
			renderSurfaceId: 0x06000010,
		},
		usage,
	};
}

function createPaletteUse() {
	return {
		firstIndex: 0,
		indexCount: 256,
		kind: "palette-texture-use" as const,
		palette: {
			kind: "palette" as const,
			paletteId: 0x04000010,
		},
		usage: "palette-rgba" as const,
	};
}
