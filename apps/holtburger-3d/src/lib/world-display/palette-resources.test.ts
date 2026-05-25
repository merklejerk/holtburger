import { DataTexture, NearestFilter, RGBAFormat, SRGBColorSpace } from "three";
import { describe, expect, it } from "vitest";

import type { PreparedPalettePayload } from "../assets/types";
import {
	argbToRgbaBytes,
	createPaletteTextureResource,
} from "./palette-resources";

describe("palette resources", () => {
	it("converts ARGB palette colors into RGBA upload bytes", () => {
		const rgba = argbToRgbaBytes(
			new Uint32Array([0xff112233, 0x80445566, 0x00778899]),
		);

		expect(Array.from(rgba)).toEqual([
			0x11, 0x22, 0x33, 0xff, 0x44, 0x55, 0x66, 0x80, 0x77, 0x88, 0x99, 0x00,
		]);
	});

	it("rejects empty palettes as invalid renderer resources", () => {
		expect(() => argbToRgbaBytes(new Uint32Array())).toThrow(
			/at least one color/,
		);
	});

	it("creates an exact one-row nearest-filtered palette texture", () => {
		const resource = createPaletteTextureResource(
			createPalettePayload([0xff112233, 0x80445566]),
		);

		expect(resource.colorCount).toBe(2);
		expect(resource.texture).toBeInstanceOf(DataTexture);
		expect(resource.texture.image).toMatchObject({
			width: 2,
			height: 1,
		});
		expect(resource.texture.format).toBe(RGBAFormat);
		expect(resource.texture.colorSpace).toBe(SRGBColorSpace);
		expect(resource.texture.magFilter).toBe(NearestFilter);
		expect(resource.texture.minFilter).toBe(NearestFilter);
		expect(resource.texture.generateMipmaps).toBe(false);
		expect(Array.from(resource.texture.image.data as Uint8Array)).toEqual([
			0x11, 0x22, 0x33, 0xff, 0x44, 0x55, 0x66, 0x80,
		]);
	});
});

function createPalettePayload(colorsArgb: number[]): PreparedPalettePayload {
	return {
		kind: "palette",
		sourceAssetKind: "palette",
		residencyKind: "unknown",
		provenance: {
			source: "repo-local-hba",
			sourceAssetKind: "palette",
			errorCode: null,
			detail: null,
		},
		paletteId: 0x04000001,
		colorCount: colorsArgb.length,
		colorsArgb: Uint32Array.from(colorsArgb),
	};
}
