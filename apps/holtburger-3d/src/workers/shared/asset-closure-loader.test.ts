import { describe, expect, it } from "vitest";

import type {
	AssetLookupRequestDto,
	AssetLookupResponseDto,
} from "../../lib/host/contracts";
import { loadWorkerAssetClosure } from "./asset-closure-loader";

describe("worker asset closure loader", () => {
	it("loads roots and expands response dependencies in deterministic batches", async () => {
		const lookup = new FakeClosureLookup([
			createResponse("material/01000001", {
				kind: "material-recipe",
				residencyKind: "unknown",
				sourceAssetKind: "material-recipe",
				surfaceId: 0x01000001,
				surfaceType: 0,
				source: {
					kind: "texture",
					surfaceTextureId: 0x02000002,
					selectedRenderSurfaceId: 0x03000003,
					paletteId: 0x04000004,
					renderSurfaceDefaultPaletteIds: [],
				},
				translucency: 0,
				luminosity: 0,
				diffuse: 1,
				dependencies: {
					surfaceTextureAssetIds: ["surface-texture/02000002"],
					renderSurfaceAssetIds: ["render-surface/03000003"],
					paletteAssetIds: ["palette/04000004"],
				},
				provenance: createProvenance("material-recipe"),
			}),
			createResponse("palette/04000004", {
				kind: "palette",
				residencyKind: "unknown",
				sourceAssetKind: "palette",
				paletteId: 0x04000004,
				colorCount: 0,
				colorsArgb: new Uint32Array(),
				provenance: createProvenance("palette"),
			}),
			createResponse("render-surface/03000003", {
				kind: "render-surface",
				residencyKind: "unknown",
				sourceAssetKind: "render-surface",
				renderSurfaceId: 0x03000003,
				unknown: 0,
				width: 1,
				height: 1,
				formatRaw: 0,
				format: "rgba8",
				sourceByteLength: 4,
				sourceBytes: new Uint8Array([1, 2, 3, 4]),
				defaultPaletteId: null,
				dependencies: {
					paletteAssetIds: [],
				},
				provenance: createProvenance("render-surface"),
			}),
			createResponse("surface-texture/02000002", {
				kind: "surface-texture",
				residencyKind: "unknown",
				sourceAssetKind: "surface-texture",
				surfaceTextureId: 0x02000002,
				textureType: 0,
				unknown: 0,
				selectedRenderSurfaceId: 0x03000003,
				renderSurfaceIds: [0x03000003],
				dependencies: {
					renderSurfaceAssetIds: ["render-surface/03000003"],
				},
				provenance: createProvenance("surface-texture"),
			}),
		]);

		const result = await loadWorkerAssetClosure({
			rootAssetIds: ["material/01000001"],
			createRequest: (assetId) => ({
				requestId: `request:${assetId}`,
				assetId,
				priority: "streaming",
			}),
			lookup,
		});

		expect(lookup.requestedAssetBatches).toEqual([
			["material/01000001"],
			[
				"palette/04000004",
				"render-surface/03000003",
				"surface-texture/02000002",
			],
		]);
		expect(result.loadedAssetIds).toEqual([
			"material/01000001",
			"palette/04000004",
			"render-surface/03000003",
			"surface-texture/02000002",
		]);
	});
});

class FakeClosureLookup {
	readonly requestedAssetBatches: string[][] = [];
	private readonly responsesByAssetId: ReadonlyMap<
		string,
		AssetLookupResponseDto
	>;

	constructor(responses: readonly AssetLookupResponseDto[]) {
		this.responsesByAssetId = new Map(
			responses.map((response) => [response.assetId, response]),
		);
	}

	async lookupBinaryAssets(
		requests: readonly AssetLookupRequestDto[],
	): Promise<{ responses: readonly AssetLookupResponseDto[] }> {
		this.requestedAssetBatches.push(requests.map((request) => request.assetId));
		return {
			responses: requests.map((request) => {
				const response = this.responsesByAssetId.get(request.assetId);
				if (!response) {
					throw new Error(`missing fixture response ${request.assetId}`);
				}
				return response;
			}),
		};
	}
}

function createResponse(
	assetId: string,
	payload: unknown,
): AssetLookupResponseDto {
	return {
		requestId: `request:${assetId}`,
		assetId,
		payloadKind: "json",
		payload,
	};
}

function createProvenance(sourceAssetKind: string): {
	source: "repo-local-hba";
	sourceAssetKind: string;
	errorCode: null;
	detail: null;
} {
	return {
		source: "repo-local-hba",
		sourceAssetKind,
		errorCode: null,
		detail: null,
	};
}
