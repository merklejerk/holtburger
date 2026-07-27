import { describe, expect, it } from "vitest";
import type { ActiveRegionSource } from "../../assets/active-region-source";
import type { TexturePixelSource } from "../../assets/texture-pixel-source";
import { TexturePixelFormat } from "../textures/types";
import type {
	TexturePreparationServiceRequest,
	TexturePreparationServiceResponse,
} from "../textures/texture-preparer";
import { ActiveRegionObjectDetailOwner } from "./active-region-object-detail";

describe("ActiveRegionObjectDetailOwner", () => {
	it("prepares the building role once, shares it, then releases it for replacement", async () => {
		const pixels = new FakeTexturePixelSource();
		const owner = new ActiveRegionObjectDetailOwner(pixels);
		const first = await owner.install(activeRegion(1));
		const shared = await owner.install(activeRegion(1));

		expect(shared).toBe(first);
		expect(pixels.requests).toHaveLength(1);
		expect(first.sourceAssetId).toBe("surface-texture/0x05000102");
		expect(first.surface.format).toBe(TexturePixelFormat.RGBA8);

		owner.teardown();
		expect(owner.binding).toBeNull();
		await owner.install(activeRegion(2));
		expect(pixels.requests).toHaveLength(2);
	});
});

class FakeTexturePixelSource implements TexturePixelSource {
	readonly requests: TexturePreparationServiceRequest[] = [];

	async loadTexturePixels(
		request: TexturePreparationServiceRequest,
	): Promise<TexturePreparationServiceResponse> {
		this.requests.push(request);
		if (request.kind !== "prepared-object-texture") {
			throw new Error("test expected an object texture request");
		}
		return {
			kind: request.kind,
			purpose: request.purpose,
			surface: {
				format: TexturePixelFormat.RGBA8,
				height: 1,
				pixels: Uint8Array.from([1, 2, 3, 4]),
				sourceAssetId: request.sourceAssetId,
				width: 1,
			},
		};
	}
}

function activeRegion(version: number): ActiveRegionSource {
	return {
		provenance: {
			sourceRecordId: "0x13000000",
			number: 1,
			version,
			name: "test",
			partsMask: 4,
		},
		data: {
			land: {
				numBlockLength: 255,
				numBlockWidth: 255,
				squareLength: 24,
				landblockLength: 192,
				verticesPerCell: 8,
				maxObjectHeight: 64,
				skyHeight: 500,
				roadWidth: 1,
			},
			calendar: {
				zeroTimeOfYear: 0,
				zeroYear: 0,
				dayLength: 1,
				daysPerYear: 365,
				yearSpec: "year",
				timesOfDay: [],
				daysOfTheWeek: [],
				seasons: [],
			},
			sky: null,
			sound: null,
			scenes: null,
			misc: null,
			terrain: {
				types: [],
				landSurface: {
					kind: "texture-merge",
					baseTextureSize: 1,
					cornerTerrainMaps: [],
					sideTerrainMaps: [],
					roadMaps: [],
					terrainTextures: [0, 1, 2, 3].map((terrainType) => ({
						terrainType,
						colorTextureId: "0x05000001",
						tiling: 1,
						maxVertexBrightness: 0,
						minVertexBrightness: 0,
						maxVertexSaturation: 0,
						minVertexSaturation: 0,
						maxVertexHue: 0,
						minVertexHue: 0,
						detailTiling: 2,
						detailTextureId: `0x0500010${terrainType + 1}`,
					})),
				},
			},
		},
		landHeightTable: new Float32Array(256),
	};
}
