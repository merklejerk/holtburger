import { describe, expect, it } from "vitest";
import { decodeTexturePixels } from "./decode-texture-pixels";
import { TexturePurpose } from "../game/textures/types";
import type { TexturePreparationServiceRequest } from "../game/textures/texture-preparer";

describe("decodeTexturePixels", () => {
	it("decodes an R8 terrain-mask response", () => {
		const request = {
			kind: "prepared-texture-surface" as const,
			purpose: TexturePurpose.TerrainBlendMask,
			sourceAssetId: "surface-texture/0x05001234" as const,
		} satisfies TexturePreparationServiceRequest;

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
		} satisfies TexturePreparationServiceRequest;

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

	it("decodes selected object index16 pixels as RG8", () => {
		const request = {
			kind: "prepared-object-texture" as const,
			purpose: TexturePurpose.ObjectIndex16,
			sourceAssetId: "surface-texture/0x05001234" as const,
		} satisfies TexturePreparationServiceRequest;
		const response = decodeTexturePixels(
			textureResponse({
				format: "rg8",
				pixels: [1, 0, 2, 0],
				purpose: request.purpose,
				sourceAssetId: request.sourceAssetId,
				width: 2,
				height: 1,
			}),
			request,
		);

		expect(response.kind).toBe("prepared-object-texture");
		expect(response.surface.format).toBe("rg8");
	});

	it("requires mean RGB only for terrain-color responses", () => {
		const terrainColorRequest = {
			kind: "prepared-texture-surface" as const,
			purpose: TexturePurpose.TerrainColor,
			sourceAssetId: "surface-texture/0x05001234" as const,
		} satisfies TexturePreparationServiceRequest;
		const terrainColor = decodeTexturePixels(
			textureResponse({
				format: "rgba8",
				height: 1,
				meanRgb: [0.25, 0.5, 0.75],
				pixels: [1, 2, 3, 4],
				purpose: terrainColorRequest.purpose,
				sourceAssetId: terrainColorRequest.sourceAssetId,
				width: 1,
			}),
			terrainColorRequest,
		);
		if (terrainColor.purpose !== TexturePurpose.TerrainColor) {
			throw new Error("Fixture returned the wrong texture purpose.");
		}
		expect(terrainColor.surface.meanRgb).toEqual([0.25, 0.5, 0.75]);

		expect(() =>
			decodeTexturePixels(
				textureResponse({
					format: "rgba8",
					height: 1,
					pixels: [1, 2, 3, 4],
					purpose: terrainColorRequest.purpose,
					sourceAssetId: terrainColorRequest.sourceAssetId,
					width: 1,
				}),
				terrainColorRequest,
			),
		).toThrow("requires a mean RGB array");

		const detailRequest = {
			kind: "prepared-texture-surface" as const,
			purpose: TexturePurpose.TerrainDetail,
			sourceAssetId: "surface-texture/0x05001234" as const,
		} satisfies TexturePreparationServiceRequest;
		expect(() =>
			decodeTexturePixels(
				textureResponse({
					format: "rgba8",
					height: 1,
					meanRgb: [0.25, 0.5, 0.75],
					pixels: [1, 2, 3, 4],
					purpose: detailRequest.purpose,
					sourceAssetId: detailRequest.sourceAssetId,
					width: 1,
				}),
				detailRequest,
			),
		).toThrow("must not carry terrain-color mean metadata");
	});

	it.each([
		["non-array", "not-rgb", "requires a mean RGB array"],
		["wrong channel count", [0.25, 0.5], "requires exactly three"],
		["non-numeric channel", [0.25, "green", 0.75], "non-numeric"],
		["out-of-range channel", [0.25, 1.01, 0.75], "out-of-range"],
	] as const)(
		"rejects %s terrain-color mean metadata",
		(_, meanRgb, message) => {
			const request = {
				kind: "prepared-texture-surface" as const,
				purpose: TexturePurpose.TerrainColor,
				sourceAssetId: "surface-texture/0x05001234" as const,
			} satisfies TexturePreparationServiceRequest;

			expect(() =>
				decodeTexturePixels(
					textureResponse({
						format: "rgba8",
						height: 1,
						meanRgb,
						pixels: [1, 2, 3, 4],
						purpose: request.purpose,
						sourceAssetId: request.sourceAssetId,
						width: 1,
					}),
					request,
				),
			).toThrow(message);
		},
	);
});

function textureResponse(options: {
	readonly format: "rgba8" | "r8" | "rg8";
	readonly height: number;
	readonly meanRgb?: unknown;
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
				...(options.meanRgb === undefined ? {} : { meanRgb: options.meanRgb }),
				sourceRecordId: "0x06001234",
				width: options.width,
			},
			transport: "holtburger-texture-pixels",
		}),
	);
	const headerLength = 12;
	const paddedManifestLength =
		Math.ceil((headerLength + manifest.length) / 4) * 4 - headerLength;
	const response = new Uint8Array(
		headerLength + paddedManifestLength + options.pixels.length,
	);
	response.set(new TextEncoder().encode("HBTP"), 0);
	new DataView(response.buffer).setUint32(4, paddedManifestLength, true);
	new DataView(response.buffer).setUint32(8, response.byteLength, true);
	response.set(manifest, headerLength);
	response.fill(
		0x20,
		headerLength + manifest.length,
		headerLength + paddedManifestLength,
	);
	response.set(options.pixels, headerLength + paddedManifestLength);
	return response;
}
