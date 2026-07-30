import { describe, expect, it } from "vitest";
import type { ActiveRegionSource } from "../../assets/active-region-source";
import type { TexturePixelSource } from "../../assets/texture-pixel-source";
import { TexturePixelFormat } from "../textures/types";
import type {
	TexturePreparationServiceRequest,
	TexturePreparationServiceResponse,
} from "../textures/texture-preparer";
import { ActiveRegionStaticDetailOwner } from "./active-region-static-detail";

describe("ActiveRegionStaticDetailOwner", () => {
	it("prepares every rendered static role once, shares the set, then releases it", async () => {
		const pixels = new FakeTexturePixelSource();
		const owner = new ActiveRegionStaticDetailOwner(pixels);
		const first = await owner.install(activeRegion(1));
		const shared = await owner.install(activeRegion(1));

		expect(shared).toBe(first);
		expect(pixels.requests).toHaveLength(2);
		expect(first.roles.building.sourceAssetId).toBe(
			"surface-texture/0x05000102",
		);
		expect(first.roles.environment.sourceAssetId).toBe(
			"surface-texture/0x05000103",
		);
		expect([
			first.roles.building.tiling,
			first.roles.environment.tiling,
		]).toEqual([3, 4]);
		expect(
			Object.values(first.roles).every(
				({ surface }) => surface.format === TexturePixelFormat.RGBA8,
			),
		).toBe(true);

		owner.teardown();
		expect(owner.binding).toBeNull();
		await owner.install(activeRegion(2));
		expect(pixels.requests).toHaveLength(4);
	});

	it("fails the complete installation when an authored static role is missing", async () => {
		const owner = new ActiveRegionStaticDetailOwner(
			new FakeTexturePixelSource(),
		);

		await expect(owner.install(activeRegion(1, 2))).rejects.toThrow(
			"no environment detail texture role",
		);
		expect(owner.binding).toBeNull();
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

function activeRegion(
	version: number,
	detailRoleCount = 4,
): ActiveRegionSource {
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
					terrainTextures: Array.from(
						{ length: detailRoleCount },
						(_, terrainType) => ({
							terrainType,
							colorTextureId: "0x05000001",
							tiling: 1,
							maxVertexBrightness: 0,
							minVertexBrightness: 0,
							maxVertexSaturation: 0,
							minVertexSaturation: 0,
							maxVertexHue: 0,
							minVertexHue: 0,
							detailTiling: terrainType + 2,
							detailTextureId: `0x0500010${terrainType + 1}`,
						}),
					),
				},
			},
		},
		landHeightTable: new Float32Array(256),
	};
}
