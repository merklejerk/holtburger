import { describe, expect, it } from "vitest";
import type {
	LandblockEnvCellsStaticScopePayload,
	OutdoorStaticObjectsScopePayload,
} from "../static/contracts";
import { StaticSceneQuery } from "./static-scene-query";

describe("V2 static scene query", () => {
	it("picks outdoor static objects through source BVH roots without draw units", () => {
		const query = new StaticSceneQuery();
		query.ingestOutdoorStaticObjects(createOutdoorStaticObjectsPayload());

		const hit = query.pickRay({
			context: { kind: "outdoor" },
			ray: {
				direction: { x: 0, y: 0, z: -1 },
				origin: { x: 0, y: 0, z: 0 },
			},
		});

		expect(hit).toMatchObject({
			instanceId: "outdoor-static-0",
			itemKind: "outdoor-static-object",
			queryPath: "source-bvh",
			source: {
				sourceAssetKind: "setup-model",
				sourceDid: 0x02000010,
			},
		});
		expect(hit?.distance).toBe(4);
		expect(query.createSnapshot()).toMatchObject({
			outdoorRecordCount: 1,
		});
	});

	it("applies outdoor request-anchor root translation without rebuilding BVH nodes", () => {
		const query = new StaticSceneQuery();
		query.ingestOutdoorStaticObjects(
			createOutdoorStaticObjectsPayload({ landblockId: 0xdb55ffff }),
			0xda55ffff,
		);

		const hit = query.pickRay({
			context: { kind: "outdoor" },
			ray: {
				direction: { x: 0, y: 0, z: -1 },
				origin: { x: 192, y: 0, z: 0 },
			},
		});

		expect(hit).toMatchObject({
			instanceId: "outdoor-static-0",
			itemKind: "outdoor-static-object",
			queryPath: "source-bvh",
		});
		expect(hit?.distance).toBe(4);
	});

	it("does not pick outdoor source payloads without BVH roots", () => {
		const query = new StaticSceneQuery();
		query.ingestOutdoorStaticObjects(
			createOutdoorStaticObjectsPayload({ includeBvh: false }),
		);

		const hit = query.pickRay({
			context: { kind: "outdoor" },
			ray: {
				direction: { x: 0, y: 0, z: -1 },
				origin: { x: 0, y: 0, z: 0 },
			},
		});

		expect(hit).toBeNull();
		expect(query.createSnapshot().outdoorRecordCount).toBe(0);
	});

	it("does not flatten outdoor and env-cell scene contexts", () => {
		const query = new StaticSceneQuery();
		query.ingestOutdoorStaticObjects(createOutdoorStaticObjectsPayload());

		const hit = query.pickRay({
			context: {
				envCellId: 0xda550100,
				kind: "env-cell",
				landblockId: 0xda55ffff,
			},
			ray: {
				direction: { x: 0, y: 0, z: -1 },
				origin: { x: 0, y: 0, z: 0 },
			},
		});

		expect(hit).toBeNull();
	});

	it("ingests landblock env-cell source facts for env-cell-local picking", () => {
		const query = new StaticSceneQuery();
		query.ingestLandblockEnvCells(createLandblockEnvCellsPayload());

		const hit = query.pickRay({
			context: {
				acceptedEnvCellIds: [0xda550100],
				envCellId: 0xda550100,
				kind: "env-cell",
				landblockId: 0xda55ffff,
			},
			ray: {
				direction: { x: 0, y: 0, z: -1 },
				origin: { x: 0, y: 0, z: 0 },
			},
		});

		expect(hit).toMatchObject({
			debugSourceAssetId: "setup-model/02000010",
			envCellId: 0xda550100,
			instanceId: "env-static-0",
			itemKind: "env-cell-static-object",
			queryPath: "source-bvh",
			source: {
				sourceAssetKind: "setup-model",
				sourceDid: 0x02000010,
			},
		});
		expect(query.createSnapshot()).toEqual({
			envCellLandblockCount: 1,
			envCellRecordCount: 1,
			outdoorRecordCount: 0,
		});
	});

	it("does not query env-cell locals through a flat fallback when the landblock BVH is absent", () => {
		const query = new StaticSceneQuery();
		query.ingestLandblockEnvCells(
			createLandblockEnvCellsPayload({ includeLandblockBvh: false }),
		);

		const hit = query.pickRay({
			context: {
				acceptedEnvCellIds: [0xda550100],
				envCellId: 0xda550100,
				kind: "env-cell",
				landblockId: 0xda55ffff,
			},
			ray: {
				direction: { x: 0, y: 0, z: -1 },
				origin: { x: 0, y: 0, z: 0 },
			},
		});

		expect(hit).toBeNull();
		expect(query.createSnapshot()).toEqual({
			envCellLandblockCount: 0,
			envCellRecordCount: 0,
			outdoorRecordCount: 0,
		});
	});

	it("uses the landblock env-cell BVH for initial residency queries", () => {
		const query = new StaticSceneQuery();
		query.ingestLandblockEnvCells(createLandblockEnvCellsPayload());

		expect(
			query.queryEnvCellAtPoint({
				acceptedEnvCellIds: [0xda550100],
				landblockId: 0xda55ffff,
				point: { x: 0, y: 0, z: -4.5 },
			}),
		).toBe(0xda550100);
		expect(
			query.queryEnvCellAtPoint({
				acceptedEnvCellIds: [0xda550100],
				landblockId: 0xda55ffff,
				point: { x: 40, y: 0, z: -4.5 },
			}),
		).toBeNull();
	});

});

function createOutdoorStaticObjectsPayload(options: {
	readonly includeBvh?: boolean;
	readonly landblockId?: number;
} = {}): OutdoorStaticObjectsScopePayload {
	const landblockId = options.landblockId ?? 0xda55ffff;
	const includeBvh = options.includeBvh ?? true;
	return {
		domain: "outdoor-detail",
		kind: "outdoor-static-objects",
		landblock: {
			kind: "landblock-source",
			landblockId,
			source: "outdoor",
		},
		materialSlots: [],
		materialSources: [],
		missingRefs: [],
		objects: [
			{
				debug: { sourceAssetId: "setup-model/02000010" },
				generated: null,
				identity: {
					instanceId: "outdoor-static-0",
					kind: "static-object-instance",
					landblockId,
					objectKind: "explicit-object",
				},
				instanceBounds: {
					max: { x: 1, y: 1, z: -4 },
					min: { x: -1, y: -1, z: -5 },
				},
				localPlacement: createPlacement(),
				portalCount: 0,
				source: {
					kind: "static-object-source",
					sourceAssetKind: "setup-model",
					sourceDid: 0x02000010,
				},
				sourceBounds: {
					max: { x: 1, y: 1, z: 1 },
					min: { x: -1, y: -1, z: -1 },
				},
				sourceIndex: 0,
				sourceScale: { x: 1, y: 1, z: 1 },
			},
		],
		paletteSources: [],
		regionRenderProfile: {
			detailRoles: [],
			identity: {
				kind: "region-render-profile",
				regionNumber: 1,
			},
		},
		sourceAssets: [],
		sourceSpatial: {
			bounds: null,
			coordinateSpace: "landblock-render-local",
			outdoorBvh: includeBvh
				? {
						coordinateSpace: "landblock-render-local",
						items: [
							{
								bvhItemIndex: 0,
								instanceId: "outdoor-static-0",
								kind: "static",
								object: {
									debug: { sourceAssetId: "setup-model/02000010" },
									generated: null,
									identity: {
										instanceId: "outdoor-static-0",
										kind: "static-object-instance",
										landblockId,
										objectKind: "explicit-object",
									},
									instanceBounds: {
										max: { x: 1, y: 1, z: -4 },
										min: { x: -1, y: -1, z: -5 },
									},
									localPlacement: createPlacement(),
									portalCount: 0,
									source: {
										kind: "static-object-source",
										sourceAssetKind: "setup-model",
										sourceDid: 0x02000010,
									},
									sourceBounds: {
										max: { x: 1, y: 1, z: 1 },
										min: { x: -1, y: -1, z: -1 },
									},
									sourceIndex: 0,
									sourceScale: { x: 1, y: 1, z: 1 },
								},
							},
						],
						nodes: [
							{
								bounds: {
									max: { x: 1, y: 1, z: -4 },
									min: { x: -1, y: -1, z: -5 },
								},
								itemIndices: [0],
								kindMask: 1,
								left: null,
								right: null,
							},
						],
					}
				: null,
			outdoorBvhItemCount: includeBvh ? 1 : 0,
			outdoorBvhNodeCount: includeBvh ? 1 : 0,
		},
		textureRefs: [],
	};
}

function createLandblockEnvCellsPayload(options: {
	readonly includeLandblockBvh?: boolean;
} = {}): LandblockEnvCellsStaticScopePayload {
	const includeLandblockBvh = options.includeLandblockBvh ?? true;
	return {
		acceptedEnvCellIds: [0xda550100],
		envCells: [
			{
				cellBsp: {
					kind: "leaf",
					polyIds: [],
					solid: 0,
					sphere: null,
				},
				cellStructure: {
					cellStructureId: 0x0d000001,
					kind: "cell-structure",
				},
				environment: {
					environmentId: 0x0e000001,
					kind: "environment",
				},
				identity: {
					envCellId: 0xda550100,
					kind: "env-cell-source",
				},
				landblockId: 0xda55ffff,
				localPlacement: createPlacement(),
				localSpatial: {
					localBvh: {
						items: [{ instanceId: "env-static-0", kind: "static" }],
						nodes: [
							{
								bounds: {
									max: { x: 1, y: 1, z: -4 },
									min: { x: -1, y: -1, z: -5 },
								},
								itemIndices: [0],
								kindMask: 1,
								left: null,
								right: null,
							},
						],
					},
					localBvhItemCount: 1,
					localBvhNodeCount: 1,
				},
				memberId: "cell-0",
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
				staticObjectSeeds: [
					{
						debug: { sourceAssetId: "setup-model/02000010" },
						identity: {
							instanceId: "env-static-0",
							kind: "static-object-instance",
							landblockId: 0xda55ffff,
							objectKind: "explicit-object",
						},
						instanceBounds: {
							max: { x: 1, y: 1, z: -4 },
							min: { x: -1, y: -1, z: -5 },
						},
						localPlacement: createPlacement(),
						source: {
							kind: "static-object-source",
							sourceAssetKind: "setup-model",
							sourceDid: 0x02000010,
						},
						sourceBounds: {
							max: { x: 1, y: 1, z: 1 },
							min: { x: -1, y: -1, z: -1 },
						},
						sourceIndex: 0,
						sourceScale: { x: 1, y: 1, z: 1 },
					},
				],
				surfaces: [],
				visibleEnvCellIds: [],
			},
		],
		kind: "landblock-env-cells",
		landblock: {
			kind: "landblock-source",
			landblockId: 0xda55ffff,
			source: "env-cells",
		},
		missingRefs: [],
		portalLinks: [],
		regionRenderProfile: {
			kind: "region-render-profile",
			regionNumber: 1,
		},
		residencySpatial: {
			landblockEnvCellBvhItemCount: includeLandblockBvh ? 1 : 0,
			landblockEnvCellBvhNodeCount: includeLandblockBvh ? 1 : 0,
			landblockEnvCellBvh: {
				items: includeLandblockBvh
					? [
							{
								bounds: {
									max: { x: 1, y: 1, z: -4 },
									min: { x: -1, y: -1, z: -5 },
								},
								identity: {
									envCellId: 0xda550100,
									kind: "env-cell-source",
								},
								memberId: "cell-0",
								source: "env-cell-root",
							},
						]
					: [],
				nodes: includeLandblockBvh
					? [
							{
								bounds: {
									max: { x: 1, y: 1, z: -4 },
									min: { x: -1, y: -1, z: -5 },
								},
								itemIndices: [0],
								kindMask: 1,
								left: null,
								right: null,
							},
						]
					: [],
			},
		},
		visibilityDiagnostics: [],
	};
}

function createPlacement() {
	return {
		orientation: { w: 1, x: 0, y: 0, z: 0 },
		origin: { x: 0, y: 0, z: 0 },
	};
}
