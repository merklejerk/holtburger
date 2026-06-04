import { describe, expect, it } from "vitest";

import type {
	AssetLookupRequestDto,
	AssetLookupResponseDto,
} from "../../lib/host/contracts";
import { prepareAssetPayload } from "./asset-prepare";

describe("worker asset preparation", () => {
	it("fails hard when a landblock outdoor route returns a non-outdoor payload", () => {
		const request = createRequest(
			"request-outdoor",
			"landblock/da5fffff/outdoor",
		);
		const response: AssetLookupResponseDto = {
			requestId: request.requestId,
			assetId: request.assetId,
			payloadKind: "json",
			payload: {
				kind: "landblock-outdoor",
				residencyKind: "outdoor-landblock",
				sourceAssetKind: "landblock-outdoor",
			},
		};

		expect(() => prepareAssetPayload(request, response)).toThrow(
			/landblock-outdoor route.*payload failed the landblock-outdoor contract/,
		);
	});

	it("fails hard when a gfx object payload omits host-prepared render geometry", () => {
		const request = createRequest("request-gfx", "gfx-obj/01000001");
		const response: AssetLookupResponseDto = {
			requestId: request.requestId,
			assetId: request.assetId,
			payloadKind: "json",
			payload: {
				kind: "gfx-obj",
				residencyKind: "unknown",
				sourceAssetKind: "gfx-obj",
				gfxObjId: 0x01000001,
				flags: null,
				surfaceIds: [],
				vertexArray: {
					vertexType: 0,
					vertexCount: 0,
					vertices: [],
				},
				drawingPolygons: [],
				drawingBsp: null,
				dependencies: { materialAssetIds: [] },
				physicsWitness: {
					polygonCount: 0,
					hasBsp: false,
				},
				sortCenter: null,
				didDegrade: null,
				provenance: {
					source: "repo-local-hba",
					sourceAssetKind: "gfx-obj",
					errorCode: null,
					detail: null,
				},
			},
		};

		expect(() => prepareAssetPayload(request, response)).toThrow(
			/gfx-obj route.*payload failed the gfx-obj contract.*renderGeometry/,
		);
	});

	it("normalizes JSON palette color arrays into Uint32Array payloads", () => {
		const request = createRequest("request-palette", "palette/04000001");
		const response: AssetLookupResponseDto = {
			requestId: request.requestId,
			assetId: request.assetId,
			payloadKind: "json",
			payload: {
				kind: "palette",
				residencyKind: "unknown",
				sourceAssetKind: "palette",
				paletteId: 0x04000001,
				colorCount: 2,
				colorsArgb: [0xff112233, 0x80445566],
				provenance: {
					source: "repo-local-hba",
					sourceAssetKind: "palette",
					errorCode: null,
					detail: null,
				},
			},
		};

		const prepared = prepareAssetPayload(request, response);

		expect(prepared.payload.kind).toBe("palette");
		if (prepared.payload.kind !== "palette") {
			throw new Error("expected palette payload");
		}
		expect(prepared.payload.colorsArgb).toBeInstanceOf(Uint32Array);
		expect(Array.from(prepared.payload.colorsArgb)).toEqual([
			0xff112233, 0x80445566,
		]);
	});
});

function createRequest(
	requestId: string,
	assetId: string,
): AssetLookupRequestDto {
	return {
		requestId,
		assetId,
		priority: "streaming",
	};
}
