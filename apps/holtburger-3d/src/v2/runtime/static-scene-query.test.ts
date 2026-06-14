import { describe, expect, it } from "vitest";
import type {
	LandblockEnvCellsStaticScopePayload,
	OutdoorStaticObjectsScopePayload,
	TerrainStaticScopePayload,
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
		});
		expect(hit?.distance).toBe(4);
		expect(
			query.queryOutdoorStaticObjectDetails({
				domain: "outdoor-detail",
				instanceId: "outdoor-static-0",
				landblockId: 0xda55ffff,
			}),
		).toMatchObject({
			bvhItemIndex: 0,
			object: {
				source: {
					sourceAssetKind: "setup-model",
					sourceDid: 0x02000010,
				},
			},
		});
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

	it("can ignore targets whose bounds contain the pick ray origin", () => {
		const query = new StaticSceneQuery();
		query.ingestOutdoorStaticObjects(
			createOutdoorStaticObjectsPayload({ includeContainingObject: true }),
		);

		const containingHit = query.pickRay({
			context: { kind: "outdoor" },
			ray: {
				direction: { x: 0, y: 0, z: -1 },
				origin: { x: 0, y: 0, z: 0 },
			},
		});
		const filteredHit = query.pickRay({
			context: { kind: "outdoor" },
			filters: { ignoreContainingOrigin: true },
			ray: {
				direction: { x: 0, y: 0, z: -1 },
				origin: { x: 0, y: 0, z: 0 },
			},
		});

		expect(containingHit).toMatchObject({
			distance: 0,
			instanceId: "outdoor-containing-0",
		});
		expect(filteredHit).toMatchObject({
			distance: 4,
			instanceId: "outdoor-static-0",
		});
	});

	it("prunes farther BVH subtrees after finding a nearer hit", () => {
		const query = new StaticSceneQuery();
		query.ingestOutdoorStaticObjects(
			createOutdoorStaticObjectsPayload({ includeFarInvalidSubtree: true }),
		);

		const hit = query.pickRay({
			context: { kind: "outdoor" },
			ray: {
				direction: { x: 0, y: 0, z: -1 },
				origin: { x: 0, y: 0, z: 0 },
			},
		});

		expect(hit).toMatchObject({
			distance: 4,
			instanceId: "outdoor-static-0",
		});
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

	it("picks terrain quads through terrain source BVH roots", () => {
		const query = new StaticSceneQuery();
		query.ingestTerrain(createTerrainPayload());

		const hit = query.pickRay({
			context: { kind: "outdoor" },
			ray: {
				direction: { x: 0, y: 0, z: -1 },
				origin: { x: 2, y: 2, z: 4 },
			},
		});

		expect(hit).toMatchObject({
			distance: 3,
			domain: "outdoor-terrain",
			itemKind: "terrain-quad",
			landblockId: 0xda55ffff,
			quadIndex: 0,
		});
		expect(
			query.queryTerrainQuadDetails({
				landblockId: 0xda55ffff,
				quadIndex: 0,
			}),
		).toMatchObject({
			bvhItemIndex: 0,
			quad: {
				terrainQuadId: "terrain-quad-0",
			},
		});
		expect(query.createSnapshot()).toMatchObject({
			terrainLandblockCount: 1,
			terrainRecordCount: 1,
		});
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
			envCellId: 0xda550100,
			instanceId: "env-static-0",
			itemKind: "env-cell-static-object",
		});
		expect(
			query.queryEnvCellStaticObjectDetails({
				envCellId: 0xda550100,
				instanceId: "env-static-0",
				landblockId: 0xda55ffff,
			}),
		).toMatchObject({
			bvhItemIndex: 0,
			seed: {
				debug: { sourceAssetId: "setup-model/02000010" },
				source: {
					sourceAssetKind: "setup-model",
					sourceDid: 0x02000010,
				},
			},
		});
		expect(query.createSnapshot()).toEqual({
			envCellLandblockCount: 1,
			envCellRecordCount: 1,
			outdoorRecordCount: 0,
			terrainLandblockCount: 0,
			terrainRecordCount: 0,
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
			terrainLandblockCount: 0,
			terrainRecordCount: 0,
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
	readonly includeContainingObject?: boolean;
	readonly includeFarInvalidSubtree?: boolean;
	readonly includeBvh?: boolean;
	readonly landblockId?: number;
} = {}): OutdoorStaticObjectsScopePayload {
	const landblockId = options.landblockId ?? 0xda55ffff;
	const includeBvh = options.includeBvh ?? true;
	const object = createOutdoorStaticObject({
		instanceBounds: {
			max: { x: 1, y: 1, z: -4 },
			min: { x: -1, y: -1, z: -5 },
		},
		instanceId: "outdoor-static-0",
		landblockId,
		sourceDid: 0x02000010,
		sourceIndex: 0,
	});
	const objects = options.includeContainingObject
		? [
				createOutdoorStaticObject({
					instanceBounds: {
						max: { x: 2, y: 2, z: 2 },
						min: { x: -2, y: -2, z: -2 },
					},
					instanceId: "outdoor-containing-0",
					landblockId,
					sourceDid: 0x02000011,
					sourceIndex: 1,
				}),
				object,
			]
		: [object];
	const outdoorBvh = options.includeFarInvalidSubtree
		? createPruningRegressionOutdoorBvh(objects)
		: createFlatOutdoorBvh(objects);
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
		objects,
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
			outdoorBvh: includeBvh ? outdoorBvh : null,
			outdoorBvhItemCount: includeBvh ? outdoorBvh.items.length : 0,
			outdoorBvhNodeCount: includeBvh ? outdoorBvh.nodes.length : 0,
		},
		textureRefs: [],
	};
}

function createTerrainPayload(): TerrainStaticScopePayload {
	const quad = {
		averageHeight: 0,
		bounds: {
			max: { x: 4, y: 4, z: 1 },
			min: { x: 0, y: 0, z: 0 },
		},
		col: 0,
		cornerTerrainCodes: [1, 1, 1, 1] as const,
		diagonal: "southwest-northeast" as const,
		pcode: 1,
		quadIndex: 0,
		row: 0,
		sourceTerrainIndices: [0, 1, 2, 3] as const,
		terrainQuadId: "terrain-quad-0",
		triangleIndices: [0, 1] as const,
		vertexIndices: [0, 1, 2, 3] as const,
	};
	return {
		kind: "terrain",
		landblock: {
			kind: "landblock-source",
			landblockId: 0xda55ffff,
			source: "outdoor",
		},
		mesh: {
			bounds: quad.bounds,
			gridSize: 2,
			maxHeight: 1,
			minHeight: 0,
			quadCount: 1,
			quads: [quad],
			tileSize: 4,
			triangleCount: 2,
			triangles: [
				{
					averageHeight: 0,
					bounds: quad.bounds,
					quadIndex: 0,
					terrainTriangleId: "terrain-triangle-0",
					triangleInQuad: 0,
					vertexIndices: [0, 1, 2],
				},
				{
					averageHeight: 0,
					bounds: quad.bounds,
					quadIndex: 0,
					terrainTriangleId: "terrain-triangle-1",
					triangleInQuad: 1,
					vertexIndices: [1, 3, 2],
				},
			],
			vertexCount: 4,
			vertices: [
				{ x: 0, y: 0, z: 0 },
				{ x: 4, y: 0, z: 0 },
				{ x: 0, y: 4, z: 0 },
				{ x: 4, y: 4, z: 1 },
			],
		},
		missingRefs: [],
		regionRenderProfile: {
			detailRoles: [],
			identity: {
				kind: "region-render-profile",
				regionNumber: 1,
			},
		},
		sourceSpatial: {
			bounds: quad.bounds,
			coordinateSpace: "landblock-render-local",
			terrainBvh: {
				coordinateSpace: "landblock-outdoor-terrain-local",
				items: [
					{
						col: 0,
						quadIndex: 0,
						row: 0,
						triangleIndices: [0, 1],
					},
				],
				nodes: [
					{
						bounds: quad.bounds,
						itemIndices: [0],
						kindMask: {
							domain: "outdoor-terrain",
							terrainQuad: true,
						},
						left: null,
						right: null,
					},
				],
			},
			terrainBvhItemCount: 1,
			terrainBvhNodeCount: 1,
		},
		terrainMaterial: {
			alphaMapCount: 0,
			identity: {
				kind: "terrain-material",
				regionNumber: 1,
			},
			materialKind: "tex-merge-table",
			pcodeEncoding: {
				roadCodeBits: 2,
				sizeBitMask: 1 << 28,
				terrainCodeBits: 5,
			},
			roadAlphaMapCount: 0,
			roadAlphaMaps: [],
			terrainAlphaMaps: [],
			terrainTypeCount: 0,
			terrainTypes: [],
		},
		textureUses: [],
	};
}

function createFlatOutdoorBvh(
	objects: readonly OutdoorStaticObjectsScopePayload["objects"][number][],
): NonNullable<OutdoorStaticObjectsScopePayload["sourceSpatial"]["outdoorBvh"]> {
	return {
		coordinateSpace: "landblock-render-local",
		items: objects.map((object, bvhItemIndex) => ({
			bvhItemIndex,
			instanceId: object.identity.instanceId,
			kind: "static",
			object,
		})),
		nodes: [
			{
				bounds: unionObjectBounds(objects),
				itemIndices: objects.map((_object, index) => index),
				kindMask: outdoorStaticKindMask(),
				left: null,
				right: null,
			},
		],
	};
}

function createPruningRegressionOutdoorBvh(
	objects: readonly OutdoorStaticObjectsScopePayload["objects"][number][],
): NonNullable<OutdoorStaticObjectsScopePayload["sourceSpatial"]["outdoorBvh"]> {
	return {
		coordinateSpace: "landblock-render-local",
		items: [
			{
				bvhItemIndex: 0,
				instanceId: objects[0]?.identity.instanceId ?? "missing-near",
				kind: "static",
				object: objects[0] ?? null,
			},
		],
		nodes: [
			{
				bounds: {
					max: { x: 1, y: 1, z: -4 },
					min: { x: -1, y: -1, z: -20 },
				},
				itemIndices: [],
				kindMask: outdoorStaticKindMask(),
				left: 1,
				right: 2,
			},
			{
				bounds: {
					max: { x: 1, y: 1, z: -4 },
					min: { x: -1, y: -1, z: -5 },
				},
				itemIndices: [0],
				kindMask: outdoorStaticKindMask(),
				left: null,
				right: null,
			},
			{
				bounds: {
					max: { x: 1, y: 1, z: -10 },
					min: { x: -1, y: -1, z: -20 },
				},
				itemIndices: [99],
				kindMask: outdoorStaticKindMask(),
				left: null,
				right: null,
			},
		],
	};
}

function outdoorStaticKindMask() {
	return {
		building: false,
		domain: "outdoor-static" as const,
		static: true,
	};
}

function unionObjectBounds(
	objects: readonly OutdoorStaticObjectsScopePayload["objects"][number][],
) {
	return {
		max: {
			x: Math.max(...objects.map((entry) => entry.instanceBounds?.max.x ?? 0)),
			y: Math.max(...objects.map((entry) => entry.instanceBounds?.max.y ?? 0)),
			z: Math.max(...objects.map((entry) => entry.instanceBounds?.max.z ?? 0)),
		},
		min: {
			x: Math.min(...objects.map((entry) => entry.instanceBounds?.min.x ?? 0)),
			y: Math.min(...objects.map((entry) => entry.instanceBounds?.min.y ?? 0)),
			z: Math.min(...objects.map((entry) => entry.instanceBounds?.min.z ?? 0)),
		},
	};
}

function createOutdoorStaticObject(input: {
	readonly instanceBounds: NonNullable<
		OutdoorStaticObjectsScopePayload["objects"][number]["instanceBounds"]
	>;
	readonly instanceId: string;
	readonly landblockId: number;
	readonly sourceDid: number;
	readonly sourceIndex: number;
}): OutdoorStaticObjectsScopePayload["objects"][number] {
	const sourceAssetId = `setup-model/${input.sourceDid.toString(16).padStart(8, "0")}`;
	return {
		debug: { sourceAssetId },
		generated: null,
		identity: {
			instanceId: input.instanceId,
			kind: "static-object-instance",
			landblockId: input.landblockId,
			objectKind: "explicit-object",
		},
		instanceBounds: input.instanceBounds,
		localPlacement: createPlacement(),
		portalCount: 0,
		source: {
			kind: "static-object-source",
			sourceAssetKind: "setup-model",
			sourceDid: input.sourceDid,
		},
		sourceBounds: {
			max: { x: 1, y: 1, z: 1 },
			min: { x: -1, y: -1, z: -1 },
		},
		sourceIndex: input.sourceIndex,
		sourceScale: { x: 1, y: 1, z: 1 },
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
								kindMask: {
									cellStructureGeometry: false,
									domain: "env-cell-local",
									portal: false,
									static: true,
								},
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
								kindMask: {
									domain: "landblock-env-cells",
									envCellRoot: true,
								},
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
