import { describe, expect, it } from "vitest";
import type { AssetLookupResponseDto } from "../../lib/host/contracts";
import type { HostAssetKey } from "./contracts";
import { prepareV2AssetPayload } from "./preparation/route-payloads";
import {
	createHostAssetLookupRequest,
	prepareHostAssetResponse,
} from "./preparation";

describe("host asset preparation", () => {
	it("creates host lookup requests from typed browser keys", () => {
		const key: HostAssetKey = {
			id: "da55ffff:2",
			kind: "landblock-scene-lod",
		};

		expect(createHostAssetLookupRequest(key, "request-1")).toEqual({
			assetId: "landblock/da55ffff/lod/2",
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
			["landblock/da55ffff/lod/3", "landblock-scene-lod"],
			["animation/0300061b", "animation"],
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
				prepareV2AssetPayload({
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

	it("prepares animation payloads with typed SetOmega hook bytes intact", () => {
		const payload = createAnimationPayload();

		const prepared = prepareV2AssetPayload({
			assetId: "animation/03000751",
			payload,
			payloadKind: "json",
			requestId: "request-animation",
		});

		expect(prepared).toMatchObject({
			animationId: 0x03000751,
			frameCount: 1,
			kind: "animation",
			partCount: 2,
		});
		if (prepared.kind !== "animation") {
			throw new Error("expected animation payload");
		}
		expect(prepared.partFrames[0]?.hooks[0]).toMatchObject({
			hookName: "SetOmega",
			hookType: 22,
			payload: {
				omega: {
					x: 0,
					y: 0,
					z: expect.closeTo(-0.03836006671190262, 12),
				},
			},
			payloadKind: "set-omega",
			rawPayloadBytes: [0, 0, 0, 0, 0, 0, 0, 0, 0x72, 0x20, 0x1d, 0xbd],
		});
	});

	it("rejects malformed animation frame counts", () => {
		expect(() =>
			prepareV2AssetPayload({
				assetId: "animation/03000751",
				payload: {
					...createAnimationPayload(),
					frameCount: 2,
				},
				payloadKind: "json",
				requestId: "request-animation",
			}),
		).toThrow(
			"Asset animation/03000751 matched the animation route but its payload failed the animation contract",
		);
	});

	it("rejects routes outside the static preparation set", () => {
		expect(() =>
			prepareV2AssetPayload({
				assetId: "unknown-static/01000001",
				payload: {},
				payloadKind: "json",
				requestId: "request-1",
			}),
		).toThrow("asset preparation does not support host asset route");
	});

	it("prepares landblock scene LoD payloads as their own contract", () => {
		const payload = createLandblockSceneLodPayload();

		const prepared = prepareV2AssetPayload({
			assetId: "landblock/da55ffff/lod/2",
			payload,
			payloadKind: "json",
			requestId: "request-lod",
		});

		expect(prepared).toMatchObject({
			kind: "landblock-scene-lod",
			source: { context: "outdoor", level: 2 },
		});
		if (prepared.kind !== "landblock-scene-lod") {
			throw new Error("expected landblock scene LoD payload");
		}
		expect(prepared.layers.map((layer) => layer.kind)).toEqual([
			"terrain",
			"outdoor-buildings",
			"outdoor-explicit-objects",
		]);
	});

	it("accepts scene LoD env-cell portal apertures with contract portal ids", () => {
		const payload = {
			...createLandblockSceneLodPayload(),
			landblockId: 0x0007ffff,
			layers: [createEnvCellSystemLayer()],
			source: {
				context: "interior",
				level: 4,
			},
		};

		const prepared = prepareV2AssetPayload({
			assetId: "landblock/0007ffff/lod/4",
			payload,
			payloadKind: "json",
			requestId: "request-lod-env-cell",
		});

		expect(prepared).toMatchObject({
			kind: "landblock-scene-lod",
			source: { context: "interior", level: 4 },
		});
		if (prepared.kind !== "landblock-scene-lod") {
			throw new Error("expected landblock scene LoD payload");
		}
		expect(prepared.layers[0]).toMatchObject({
			envCells: [
				{
					portalApertures: [
						{
							portalId: "env-cell/00070100/portal/0001",
						},
					],
				},
			],
			kind: "env-cell-system",
		});
	});

	it("rejects duplicate and impossible landblock scene LoD layers", () => {
		const payload = createLandblockSceneLodPayload();

		expect(() =>
			prepareV2AssetPayload({
				assetId: "landblock/da55ffff/lod/2",
				payload: {
					...payload,
					layers: [...payload.layers, payload.layers[0]],
				},
				payloadKind: "json",
				requestId: "request-lod-duplicate",
			}),
		).toThrow(
			"Asset landblock/da55ffff/lod/2 matched the landblock-scene-lod route but its payload failed the landblock-scene-lod contract",
		);

		expect(() =>
			prepareV2AssetPayload({
				assetId: "landblock/da55ffff/lod/2",
				payload: {
					...payload,
					layers: [
						...payload.layers,
						{
							kind: "outdoor-generated-scenery",
							outdoorBvh: null,
							statics: [],
						},
					],
				},
				payloadKind: "json",
				requestId: "request-lod-impossible",
			}),
		).toThrow(
			"Asset landblock/da55ffff/lod/2 matched the landblock-scene-lod route but its payload failed the landblock-scene-lod contract",
		);
	});

});

function createLandblockSceneLodPayload() {
	return {
		diagnostics: createDiagnostics(),
		kind: "landblock-scene-lod",
		landblockId: 0xda55ffff,
		regionId: 1,
		regionNumber: 2,
		layers: [
			{
				kind: "terrain",
				terrain: createEmptyTerrain(),
			},
			{
				buildingTransitionApertures: [],
				kind: "outdoor-buildings",
				outdoorBvh: null,
				statics: [],
			},
			{
				kind: "outdoor-explicit-objects",
				outdoorBvh: null,
				statics: [],
			},
		],
		provenance: {
			detail: null,
			errorCode: null,
			source: "repo-local-hba",
			sourceAssetKind: "landblock-scene-lod",
		},
		source: {
			context: "outdoor",
			level: 2,
		},
	};
}

function createEmptyTerrain() {
	return {
		bounds: null,
		gridSize: 9,
		maxHeight: 0,
		minHeight: 0,
		quads: [],
		terrainBvh: {
			coordinateSpace: "landblock-terrain-local",
			items: [],
			nodes: [],
		},
		tileSize: 24,
		triangles: [],
		vertices: [],
	};
}

function createEnvCellSystemLayer() {
	return {
		buildingTransitionApertures: [],
		diagnostics: createDiagnostics(),
		envCellSystemBvh: {
			items: [],
			nodes: [],
		},
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
				envCellId: 0x00070100,
				environmentId: 0x0d000001,
				localPlacement: createPlacement(),
				memberId: "env-cell/00070100",
				portalApertures: [
					{
						plane: null,
						points: [],
						polygonId: 0,
						portalId: "env-cell/00070100/portal/0001",
						sourceIndex: 0,
					},
				],
				portals: [],
				renderGeometry: {
					bounds: null,
					invalidPolygons: [],
					normals: [],
					positions: [],
					skippedPolygonCount: 0,
					sourceId: 0x0d000001,
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
		kind: "env-cell-system",
		landblockInfoId: 0x0007fffe,
		portalLinks: [],
	};
}

function createPlacement(origin = { x: 0, y: 0, z: 0 }) {
	return {
		orientation: { w: 1, x: 0, y: 0, z: 0 },
		origin,
	};
}

function createAnimationPayload() {
	return {
		animationId: 0x03000751,
		animationAssetId: "animation/03000751",
		dependencies: {},
		flags: 0,
		frameCount: 1,
		kind: "animation",
		objectPositionFrames: [],
		partCount: 2,
		partFrames: [
			{
				frameIndex: 0,
				hooks: [
					{
						direction: 0,
						directionName: "Both",
						hookName: "SetOmega",
						hookType: 22,
						payload: {
							omega: {
								x: 0,
								y: 0,
								z: -0.03836006671190262,
							},
						},
						payloadKind: "set-omega",
						rawPayloadBytes: [0, 0, 0, 0, 0, 0, 0, 0, 0x72, 0x20, 0x1d, 0xbd],
					},
				],
				localPlacements: [
					createPlacement(),
					createPlacement({ x: 1, y: 0, z: 0 }),
				],
			},
		],
		provenance: {
			detail: null,
			errorCode: null,
			source: "repo-local-hba",
			sourceAssetKind: "animation",
		},
		residencyKind: "unknown",
		sourceAssetKind: "animation",
	};
}

function createDiagnostics() {
	return {
		errors: [],
		omissions: [],
		sourceRecords: [],
	};
}
