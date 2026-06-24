import { describe, expect, it } from "vitest";
import type { AssetLookupResponseDto } from "../../lib/host/contracts";
import type { HostAssetKey } from "./contracts";
import { prepareV2StaticAssetPayload } from "./preparation/route-payloads";
import {
	createHostAssetLookupRequest,
	prepareHostAssetResponse,
} from "./preparation";

describe("host asset preparation", () => {
	it("creates host lookup requests from typed browser keys", () => {
		const key: HostAssetKey = {
			id: "da55ffff",
			kind: "landblock-outdoor",
		};

		expect(createHostAssetLookupRequest(key, "request-1")).toEqual({
			assetId: "landblock/da55ffff/outdoor",
			priority: "streaming",
			requestId: "request-1",
		});
	});

	it("prepares host responses into prepared assets without exposing old records", () => {
		const key: HostAssetKey = {
			id: "04000001",
			kind: "palette",
		};
		const response: AssetLookupResponseDto = {
			assetId: "palette/04000001",
			payload: {
				colorCount: 2,
				colorsArgb: [0xff112233, 0x80445566],
				kind: "palette",
				paletteId: 0x04000001,
				provenance: {
					detail: null,
					errorCode: null,
					source: "repo-local-hba",
					sourceAssetKind: "palette",
				},
				residencyKind: "unknown",
				sourceAssetKind: "palette",
			},
			payloadKind: "json",
			requestId: "request-1",
		};

		const prepared = prepareHostAssetResponse({
			key,
			now: () => new Date("2026-06-10T00:00:00.000Z"),
			requestId: "request-1",
			response,
			revision: 4,
		});

		expect(prepared).toMatchObject({
			key,
			preparedAt: "2026-06-10T00:00:00.000Z",
			revision: 4,
			sourceAssetId: "palette/04000001",
		});
		expect(prepared.payload).toMatchObject({ kind: "palette" });
		expect(prepared.payload).toMatchObject({
			colorsArgb: expect.any(Uint32Array),
		});
	});

	it("fails hard when a host response id does not match the requested key", () => {
		const key: HostAssetKey = {
			id: "04000001",
			kind: "palette",
		};

		expect(() =>
			prepareHostAssetResponse({
				key,
				requestId: "request-1",
				response: {
					assetId: "palette/04000002",
					payload: {},
					payloadKind: "json",
					requestId: "request-1",
				},
				revision: 1,
			}),
		).toThrow("Host response asset id palette/04000002 did not match");
	});

	it("recognizes every static asset route and reports route-specific schema failures", () => {
		const routes = [
			["landblock/da55ffff/outdoor", "landblock-outdoor"],
			["landblock/da55ffff/env-cells", "landblock-env-cells"],
			["gfx-obj/01000001", "gfx-obj"],
			["setup-model/02000001", "setup-model"],
			["setup-appearance/02000001", "setup-appearance"],
			["material/08000001", "material-recipe"],
			["terrain-material/1", "terrain-material"],
			["region-render-profile/1", "region-render-profile"],
			["surface-texture/06000001", "surface-texture"],
			["render-surface/06000001", "render-surface"],
			["prepared-texture/06000001?usage=color", "prepared-texture"],
			["palette/04000001", "palette"],
		] as const;

		for (const [assetId, expectedKind] of routes) {
			expect(() =>
				prepareV2StaticAssetPayload({
					assetId,
					payload: { kind: "definitely-wrong" },
					payloadKind: "json",
					requestId: "request-1",
				}),
			).toThrow(
				`Asset ${assetId} matched the ${expectedKind} route but its payload failed the ${expectedKind} contract`,
			);
		}
	});

	it("rejects routes outside the static preparation set", () => {
		expect(() =>
			prepareV2StaticAssetPayload({
				assetId: "unknown-static/01000001",
				payload: {},
				payloadKind: "json",
				requestId: "request-1",
			}),
		).toThrow("asset preparation does not support host asset route");
	});

	it("accepts only the normalized browser landblock env-cell bundle shape", () => {
		const payload = createLandblockEnvCellsPayload();

		expect(
			prepareV2StaticAssetPayload({
				assetId: "landblock/da55ffff/env-cells",
				payload,
				payloadKind: "json",
				requestId: "request-1",
			}),
		).toMatchObject({
			kind: "landblock-env-cells",
			landblockEnvCellBvh: {
				items: [{ source: "env-cell-root" }],
			},
		});

		expect(() =>
			prepareV2StaticAssetPayload({
				assetId: "landblock/da55ffff/env-cells",
				payload: {
					...payload,
					classification: "dungeon",
					envCellResidencyBvh: payload.landblockEnvCellBvh,
					envCells: payload.envCells,
				},
				payloadKind: "json",
				requestId: "request-1",
			}),
		).toThrow(
			"Asset landblock/da55ffff/env-cells matched the landblock-env-cells route but its payload failed the landblock-env-cells contract",
		);

		expect(() =>
			prepareV2StaticAssetPayload({
				assetId: "landblock/da55ffff/env-cells",
				payload: {
					...payload,
					landblockEnvCellBvh: {
						...payload.landblockEnvCellBvh,
						items: payload.landblockEnvCellBvh.items.map((item) => ({
							...item,
							bounds: null,
						})),
					},
				},
				payloadKind: "json",
				requestId: "request-2",
			}),
		).toThrow(
			"Asset landblock/da55ffff/env-cells matched the landblock-env-cells route but its payload failed the landblock-env-cells contract",
		);

		expect(() =>
			prepareV2StaticAssetPayload({
				assetId: "landblock/da55ffff/env-cells",
				payload: {
					...payload,
					landblockEnvCellBvh: {
						...payload.landblockEnvCellBvh,
						nodes: payload.landblockEnvCellBvh.nodes.map((node) => ({
							...node,
							kindMask: 1,
						})),
					},
				},
				payloadKind: "json",
				requestId: "request-3",
			}),
		).toThrow(
			"Asset landblock/da55ffff/env-cells matched the landblock-env-cells route but its payload failed the landblock-env-cells contract",
		);
	});
});

function createLandblockEnvCellsPayload() {
	return {
		diagnostics: createDiagnostics(),
		envCells: [
			{
				cellBsp: {
					index: 0,
					kind: "leaf",
					polyIds: [],
					solid: 0,
					sphere: null,
				},
				cellStructureId: 0x0d000001,
				diagnostics: createDiagnostics(),
				environmentId: 0x0e000001,
				envCellId: 0xda550100,
				localPlacement: createPlacement({ x: 1, y: 3, z: -2 }),
				memberId: "env-cell/da550100",
				portalApertures: [],
				portals: [],
				renderGeometry: {
					bounds: null,
					invalidPolygons: [],
					normals: [],
					positions: [],
					skippedPolygonCount: 0,
					sourceId: 0xda550100,
					surfaceIds: [],
					triangleCount: 0,
					triangles: [],
					uvs: [],
					vertexCount: 0,
				},
				restrictionObjectId: null,
				seenOutside: null,
				statics: [],
				surfaces: [],
				visibleEnvCellIds: [],
			},
		],
		kind: "landblock-env-cells",
		landblockEnvCellBvh: {
			items: [
				{
					bounds: {
						max: { x: 1, y: 3, z: -2 },
						min: { x: 1, y: 3, z: -2 },
					},
					envCellId: 0xda550100,
					memberId: "env-cell/da550100",
					source: "env-cell-root",
				},
			],
			nodes: [
				{
					bounds: {
						max: { x: 1, y: 3, z: -2 },
						min: { x: 1, y: 3, z: -2 },
					},
					itemIndices: [0],
					kindMask: {
						domain: "landblock-env-cells",
						envCellRoot: true,
					},
					left: null,
					right: null,
				},
			],
		},
		landblockId: 0xda55ffff,
		landblockInfoId: 0xda55fffe,
		portalLinks: [],
		provenance: {
			detail: null,
			errorCode: null,
			source: "repo-local-hba",
			sourceAssetKind: "landblock-env-cells",
		},
		regionId: 1,
		regionNumber: 1,
		residencyKind: "landblock",
		sourceAssetKind: "landblock-env-cells",
	};
}

function createPlacement(origin = { x: 0, y: 0, z: 0 }) {
	return {
		orientation: { w: 1, x: 0, y: 0, z: 0 },
		origin,
	};
}

function createDiagnostics() {
	return {
		errors: [],
		omissions: [],
		sourceRecords: [],
	};
}
