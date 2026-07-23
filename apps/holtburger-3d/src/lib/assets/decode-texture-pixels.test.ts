import { describe, expect, it } from "vitest";
import { decodeTexturePixels } from "./decode-texture-pixels";
import { TexturePurpose } from "../game/textures/types";

describe("decodeTexturePixels", () => {
	it("decodes an R8 terrain-mask response", () => {
		const request = {
			kind: "prepared-texture-surface" as const,
			purpose: TexturePurpose.TerrainBlendMask,
			sourceAssetId: "surface-texture/0x05001234" as const,
		};

		const response = decodeTexturePixels(
			textureResponse({
				format: "r8",
				pixels: [1, 2, 3, 4],
				purpose: request.purpose,
				sourceAssetId: request.sourceAssetId,
				width: 2,
				height: 2,
			}),
			request,
		);

		expect(response.surface.format).toBe("r8");
		expect(response.surface.pixels).toEqual(new Uint8Array([1, 2, 3, 4]));
	});

	it("rejects a surface encoding incompatible with the requested purpose", () => {
		const request = {
			kind: "prepared-texture-surface" as const,
			purpose: TexturePurpose.TerrainColor,
			sourceAssetId: "surface-texture/0x05001234" as const,
		};

		expect(() =>
			decodeTexturePixels(
				textureResponse({
					format: "r8",
					pixels: [1, 2, 3, 4],
					purpose: request.purpose,
					sourceAssetId: request.sourceAssetId,
					width: 2,
					height: 2,
				}),
				request,
			),
		).toThrow("requires rgba8");
	});
});

function textureResponse(options: {
	readonly format: "rgba8" | "r8";
	readonly height: number;
	readonly pixels: readonly number[];
	readonly purpose: string;
	readonly sourceAssetId: string;
	readonly width: number;
}): Uint8Array {
	const manifest = new TextEncoder().encode(
		JSON.stringify({
			byteOrder: "little-endian",
			purpose: options.purpose,
			sectionByteOffsetBase: "section-data",
			sections: [
				{
					byteLength: options.pixels.length,
					byteOffset: 0,
					elementCount: options.pixels.length,
					name: "pixels",
					scalarType: "u8",
				},
			],
			sourceAssetId: options.sourceAssetId,
			surface: {
				format: options.format,
				height: options.height,
				renderSurfaceId: "0x06001234",
				width: options.width,
			},
			transport: "holtburger-texture-pixels",
			version: 1,
		}),
	);
	const paddedManifestLength = Math.ceil((16 + manifest.length) / 4) * 4 - 16;
	const response = new Uint8Array(
		16 + paddedManifestLength + options.pixels.length,
	);
	response.set(new TextEncoder().encode("HBTP"), 0);
	new DataView(response.buffer).setUint32(4, 1, true);
	new DataView(response.buffer).setUint32(8, paddedManifestLength, true);
	new DataView(response.buffer).setUint32(12, response.byteLength, true);
	response.set(manifest, 16);
	response.fill(0x20, 16 + manifest.length, 16 + paddedManifestLength);
	response.set(options.pixels, 16 + paddedManifestLength);
	return response;
}
