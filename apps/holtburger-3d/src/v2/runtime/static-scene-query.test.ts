import { describe, expect, it } from "vitest";
import type {
	LandblockEnvCellsStaticScopePayload,
	LandblockPortalLinkFacts,
	OutdoorStaticObjectsScopePayload,
	StaticBounds,
	StaticSourceMappingRecord,
	StaticWorkPeerRecordOwner,
	TerrainStaticScopePayload,
	TransitionApertureBatch,
} from "../static/contracts";
import {
	StaticSceneQuery,
	compareStaticSceneSelectionKeys,
	createEnvCellStaticObjectSelectionKey,
	createOutdoorStaticObjectSelectionKey,
	createTerrainQuadSelectionKey,
	describeStaticSceneSelectionKey,
	traceLandblockGridRayCells,
} from "./static-scene-query";

describe("V2 static scene query", () => {
	it("traces outdoor landblock grid cells in ray order", () => {
		const cells = [
			...traceLandblockGridRayCells(
				{
					direction: { x: 1, y: 0, z: 0 },
					origin: { x: 1, y: 0, z: -4 },
				},
				{
					maxCellX: 2,
					maxCellZ: -1,
					minCellX: 0,
					minCellZ: -1,
				},
			),
		];

		expect(cells).toEqual([
			{ cellX: 0, cellZ: -1, distance: 0 },
			{ cellX: 1, cellZ: -1, distance: 191 },
			{ cellX: 2, cellZ: -1, distance: 383 },
		]);
	});

	it("stops outdoor landblock grid tracing once the next cell is farther than the nearest hit", () => {
		let nearestDistance: number | null = null;
		const cells = [];

		for (const cell of traceLandblockGridRayCells(
			{
				direction: { x: 1, y: 0, z: 0 },
				origin: { x: 1, y: 0, z: -4 },
			},
			{
				maxCellX: 2,
				maxCellZ: -1,
				minCellX: 0,
				minCellZ: -1,
			},
			{ getMaxDistance: () => nearestDistance },
		)) {
			cells.push(cell);
			nearestDistance = 100;
		}

		expect(cells).toEqual([{ cellX: 0, cellZ: -1, distance: 0 }]);
	});

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
			selectionKey: {
				instanceId: "outdoor-static-0",
				itemKind: "outdoor-static-object",
			},
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

	it("retains compact outdoor static source diagnostics without geometry buffers", () => {
		const query = new StaticSceneQuery();
		query.ingestOutdoorStaticObjects(
			createOutdoorStaticObjectsPayload({ includeSourceDiagnostics: true }),
		);

		const diagnostics = query.queryOutdoorStaticObjectSourceDiagnostics({
			domain: "outdoor-detail",
			instanceId: "outdoor-static-0",
			landblockId: 0xda55ffff,
		});

		expect(diagnostics).toMatchObject({
			instanceId: "outdoor-static-0",
			materialSlots: [
				{
					material: {
						identity: {
							materialId: 0x08000010,
						},
					},
				},
			],
			sourceAsset: {
				identity: {
					sourceDid: 0x02000010,
				},
				parts: [
					{
						materialSlotCount: 1,
						partIndex: 0,
					},
				],
			},
			textureRefs: [
				{
					role: "surface-texture",
				},
			],
		});
		expect(diagnostics?.sourceAsset?.parts[0]).not.toHaveProperty("positions");
		expect(diagnostics?.sourceAsset?.parts[0]).not.toHaveProperty("normals");
		expect(diagnostics?.sourceAsset?.parts[0]).not.toHaveProperty("texCoords");
		expect(diagnostics?.sourceAsset?.parts[0]).not.toHaveProperty("triangles");
	});

	it("returns normalized selection keys and resolves selected debug bounds", () => {
		const query = new StaticSceneQuery();
		query.ingestOutdoorStaticObjects(createOutdoorStaticObjectsPayload());
		query.ingestTerrain(createTerrainPayload());
		commitLandblockEnvCells(query, createLandblockEnvCellsPayload());
		commitEnvCellStaticObjectBounds(query);

		const outdoorKey = createOutdoorStaticObjectSelectionKey({
			domain: "outdoor-detail",
			instanceId: "outdoor-static-0",
			landblockId: 0xda55ffff,
		});
		const terrainKey = createTerrainQuadSelectionKey({
			landblockId: 0xda55ffff,
			quadIndex: 0,
		});
		const envCellKey = createEnvCellStaticObjectSelectionKey({
			envCellId: 0xda550100,
			instanceId: "env-static-0",
			landblockId: 0xda55ffff,
		});

		expect(describeStaticSceneSelectionKey(outdoorKey)).toBe(
			"outdoor-static-object:outdoor-detail:da55ffff:outdoor-static-0",
		);
		expect(
			compareStaticSceneSelectionKeys(outdoorKey, terrainKey),
		).toBeLessThan(0);
		expect(query.querySelectionDebugBounds(outdoorKey)?.bounds).toMatchObject({
			max: { x: 1, y: 1, z: -4 },
			min: { x: -1, y: -1, z: -5 },
		});
		expect(query.querySelectionDebugBounds(terrainKey)?.bounds).toMatchObject({
			max: { x: 4, y: 1, z: 0 },
			min: { x: 0, y: 0, z: -4 },
		});
		expect(query.querySelectionDebugBounds(envCellKey)?.bounds).toMatchObject({
			max: { x: 1, y: 1, z: -4 },
			min: { x: -1, y: -1, z: -5 },
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
			selectionKey: {
				instanceId: "outdoor-static-0",
				itemKind: "outdoor-static-object",
			},
		});
		expect(hit?.distance).toBe(4);

		query.setOutdoorAnchorLandblockId(0xdb55ffff);
		const rebasedHit = query.pickRay({
			context: { kind: "outdoor" },
			ray: {
				direction: { x: 0, y: 0, z: -1 },
				origin: { x: 0, y: 0, z: 0 },
			},
		});
		expect(rebasedHit).toMatchObject({
			selectionKey: {
				instanceId: "outdoor-static-0",
				itemKind: "outdoor-static-object",
			},
		});
		expect(rebasedHit?.distance).toBe(4);
	});

	it("uses the outdoor landblock grid to pick anchored neighbor landblocks", () => {
		const query = new StaticSceneQuery();
		query.ingestOutdoorStaticObjects(
			createOutdoorStaticObjectsPayload({ landblockId: 0xdb55ffff }),
			0xda55ffff,
		);
		query.ingestOutdoorStaticObjects(
			createOutdoorStaticObjectsPayload({
				instanceId: "far-outdoor-static-0",
				landblockId: 0xdc55ffff,
			}),
			0xda55ffff,
		);

		const hit = query.pickRay({
			context: { kind: "outdoor" },
			ray: {
				direction: { x: 1, y: 0, z: 0 },
				origin: { x: 0, y: 0, z: -4.5 },
			},
		});

		expect(hit).toMatchObject({
			selectionKey: {
				instanceId: "outdoor-static-0",
				itemKind: "outdoor-static-object",
				landblockId: 0xdb55ffff,
			},
		});
		expect(hit?.distance).toBe(191);
		expect(query.createSnapshot()).toMatchObject({
			landblockBucketCount: 2,
			outdoorRecordCount: 2,
		});
	});

	it("does not prune neighbor roots whose bounds protrude into an earlier landblock grid cell", () => {
		const query = new StaticSceneQuery();
		query.ingestOutdoorStaticObjects(
			createOutdoorStaticObjectsPayload({
				instanceBounds: {
					max: { x: 191.6, y: 1, z: -4 },
					min: { x: 191.5, y: -1, z: -5 },
				},
				instanceId: "local-boundary-static-0",
				landblockId: 0xda55ffff,
			}),
			0xda55ffff,
		);
		query.ingestOutdoorStaticObjects(
			createOutdoorStaticObjectsPayload({ landblockId: 0xdb55ffff }),
			0xda55ffff,
		);

		const hit = query.pickRay({
			context: { kind: "outdoor" },
			ray: {
				direction: { x: 1, y: 0, z: 0 },
				origin: { x: 0, y: 0, z: -4.5 },
			},
		});

		expect(hit).toMatchObject({
			selectionKey: {
				instanceId: "outdoor-static-0",
				landblockId: 0xdb55ffff,
			},
		});
		expect(hit?.distance).toBe(191);
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
			selectionKey: { instanceId: "outdoor-containing-0" },
		});
		expect(filteredHit).toMatchObject({
			distance: 4,
			selectionKey: { instanceId: "outdoor-static-0" },
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
			selectionKey: { instanceId: "outdoor-static-0" },
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
				direction: { x: 0, y: -1, z: 0 },
				origin: { x: 2, y: 4, z: -2 },
			},
		});

		expect(hit).toMatchObject({
			distance: 3,
			selectionKey: {
				domain: "outdoor-terrain",
				itemKind: "terrain-quad",
				landblockId: 0xda55ffff,
				quadIndex: 0,
			},
		});
		expect(hit?.distance).toBe(3);
		expect(
			query.pickRay({
				context: { kind: "outdoor" },
				ray: {
					direction: { x: 1, y: 0, z: 0 },
					origin: { x: -2, y: 3, z: -2 },
				},
			}),
		).toBeNull();
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

	it("exposes committed terrain landblock bounds in the render frame", () => {
		const query = new StaticSceneQuery();
		query.setOutdoorAnchorLandblockId(0xda55ffff);
		query.ingestTerrain(
			createTerrainPayload({ landblockId: 0xdb55ffff }),
			0xda55ffff,
		);

		expect(
			query.queryTerrainLandblockBounds({ landblockId: 0xdb55ffff }),
		).toEqual({
			bounds: {
				max: { x: 196, y: 1, z: 0 },
				min: { x: 192, y: 0, z: -4 },
			},
			landblockId: 0xdb55ffff,
		});
		expect(
			query.queryTerrainLandblockBounds({ landblockId: 0xdc55ffff }),
		).toBeNull();
	});

	it("ingests landblock env-cell static seed facts for object picking", () => {
		const query = new StaticSceneQuery();
		commitLandblockEnvCells(query, createLandblockEnvCellsPayload());
		commitEnvCellStaticObjectBounds(query);

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
			selectionKey: {
				envCellId: 0xda550100,
				instanceId: "env-static-0",
				itemKind: "env-cell-static-object",
			},
		});
		expect(
			query.queryEnvCellStaticObjectDetails({
				envCellId: 0xda550100,
				instanceId: "env-static-0",
				landblockId: 0xda55ffff,
			}),
		).toMatchObject({
			seed: {
				debug: { sourceAssetId: "setup-model/02000010" },
				source: {
					sourceAssetKind: "setup-model",
					sourceDid: 0x02000010,
				},
			},
		});
		expect(query.createSnapshot()).toEqual({
			committedEnvCellLandblockCount: 1,
			committedEnvCellPortalInteriorRecordCount: 1,
			committedEnvCellSourceMappingRecordCount: 0,
			committedEnvCellSpatialRecordCount: 2,
			committedEnvCellVisibilityRecordCount: 1,
			envCellLandblockCount: 1,
			envCellRecordCount: 1,
			landblockBucketCount: 1,
			outdoorRecordCount: 0,
			terrainLandblockCount: 0,
			terrainRecordCount: 0,
		});
	});

	it("picks env-cell static objects from STAB placement without reapplying the env-cell frame", () => {
		const query = new StaticSceneQuery();
		commitLandblockEnvCells(
			query,
			createLandblockEnvCellsPayload({
				envCellPlacement: createPlacement({
					origin: { x: 10, y: 20, z: 30 },
				}),
				landblockBounds: {
					max: { x: 11, y: 31, z: -24 },
					min: { x: -1, y: -1, z: -25 },
				},
			}),
		);
		commitEnvCellStaticObjectBounds(query);

		const hit = query.pickRay({
			context: {
				acceptedEnvCellIds: [0xda550100],
				envCellId: 0xda550100,
				kind: "env-cell",
				landblockId: 0xda55ffff,
			},
			ray: {
				direction: { x: 0, y: 0, z: -1 },
				origin: { x: 0, y: 0, z: -3 },
			},
		});

		expect(hit).toMatchObject({
			distance: 1,
			selectionKey: {
				envCellId: 0xda550100,
				instanceId: "env-static-0",
				itemKind: "env-cell-static-object",
			},
		});
	});

	it("uses baked env-cell static object bounds for picking", () => {
		const query = new StaticSceneQuery();
		commitLandblockEnvCells(query, createLandblockEnvCellsPayload());
		commitEnvCellStaticObjectBounds(query);

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
			distance: 4,
			selectionKey: {
				envCellId: 0xda550100,
				instanceId: "env-static-0",
				itemKind: "env-cell-static-object",
			},
		});
	});

	it("retains work-owned env-cell static bounds when draw-unit resources are removed", () => {
		const query = new StaticSceneQuery();
		commitLandblockEnvCells(query, createLandblockEnvCellsPayload());
		query.applyStaticSpatialRecords({
			records: [
				{
					bounds: {
						max: { x: 1, y: 1, z: -4 },
						min: { x: -1, y: -1, z: -5 },
					},
					envCellId: 0xda550100,
					instanceId: "env-static-0",
					kind: "env-cell-static-object-bounds",
					landblockId: 0xda55ffff,
					owner: createEnvCellWorkOwner("work-env-static-object", 0xda55ffff),
				},
			],
		});

		expect(query.createSnapshot()).toMatchObject({
			committedEnvCellSpatialRecordCount: 2,
		});

		query.removeStaticResources([
			{ drawUnitId: "env-cell-static-draw-unit#fine-1", kind: "draw-unit" },
		]);

		expect(query.createSnapshot()).toMatchObject({
			committedEnvCellSpatialRecordCount: 2,
		});
		expect(
			query.pickRay({
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
			}),
		).toMatchObject({
			selectionKey: {
				envCellId: 0xda550100,
				instanceId: "env-static-0",
				itemKind: "env-cell-static-object",
			},
		});
	});

	it("prunes work-owned env-cell static bounds when retained env-cell scopes are released", () => {
		const query = new StaticSceneQuery();
		commitLandblockEnvCells(query, createLandblockEnvCellsPayload());
		commitEnvCellStaticObjectBounds(query);

		expect(
			query.pickRay({
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
			}),
		).toMatchObject({
			selectionKey: {
				envCellId: 0xda550100,
				instanceId: "env-static-0",
				itemKind: "env-cell-static-object",
			},
		});

		query.retainScopes([]);

		expect(query.createSnapshot()).toMatchObject({
			committedEnvCellSpatialRecordCount: 0,
		});
		expect(
			query.pickRay({
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
			}),
		).toBeNull();
	});

	it("picks env-cell static objects from outdoor context for visible interior debugging", () => {
		const query = new StaticSceneQuery();
		commitLandblockEnvCells(query, createLandblockEnvCellsPayload());
		commitEnvCellStaticObjectBounds(query);

		const hit = query.pickRay({
			context: { kind: "outdoor" },
			ray: {
				direction: { x: 0, y: 0, z: -1 },
				origin: { x: 0, y: 0, z: 0 },
			},
		});

		expect(hit).toMatchObject({
			selectionKey: {
				envCellId: 0xda550100,
				instanceId: "env-static-0",
				itemKind: "env-cell-static-object",
			},
		});
	});

	it("picks env-cell static objects in a neighboring landblock render frame", () => {
		const query = new StaticSceneQuery();
		query.setOutdoorAnchorLandblockId(0xda55ffff);
		commitLandblockEnvCells(
			query,
			createLandblockEnvCellsPayload({
				envCellId: 0xdb550100,
				landblockId: 0xdb55ffff,
			}),
		);
		commitEnvCellStaticObjectBounds(query, {
			envCellId: 0xdb550100,
			landblockId: 0xdb55ffff,
		});

		const hit = query.pickRay({
			context: { kind: "outdoor" },
			ray: {
				direction: { x: 0, y: 0, z: -1 },
				origin: { x: 192, y: 0, z: 0 },
			},
		});

		expect(hit).toMatchObject({
			distance: 4,
			hitPoint: { x: 192, y: 0, z: -4 },
			selectionKey: {
				envCellId: 0xdb550100,
				instanceId: "env-static-0",
				itemKind: "env-cell-static-object",
				landblockId: 0xdb55ffff,
			},
		});
		expect(hit?.bounds).toEqual({
			max: { x: 193, y: 1, z: -4 },
			min: { x: 191, y: -1, z: -5 },
		});
	});

	it("does not query env-cell locals through a flat fallback when the landblock BVH is absent", () => {
		const query = new StaticSceneQuery();
		commitLandblockEnvCells(
			query,
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
			committedEnvCellLandblockCount: 1,
			committedEnvCellPortalInteriorRecordCount: 1,
			committedEnvCellSourceMappingRecordCount: 0,
			committedEnvCellSpatialRecordCount: 1,
			committedEnvCellVisibilityRecordCount: 1,
			envCellLandblockCount: 0,
			envCellRecordCount: 0,
			landblockBucketCount: 0,
			outdoorRecordCount: 0,
			terrainLandblockCount: 0,
			terrainRecordCount: 0,
		});
	});

	it("uses the landblock env-cell BVH for initial residency queries", () => {
		const query = new StaticSceneQuery();
		commitLandblockEnvCells(query, createLandblockEnvCellsPayload());

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

	it("exposes committed env-cell landblock BVH bounds for debug overlays", () => {
		const query = new StaticSceneQuery();
		commitLandblockEnvCells(
			query,
			createLandblockEnvCellsPayload({
				landblockBounds: {
					max: { x: 8, y: 4, z: 2 },
					min: { x: 2, y: -1, z: -6 },
				},
			}),
		);

		expect(query.queryEnvCellAabbDebugBounds()).toEqual([
			{
				bounds: {
					max: { x: 8, y: 4, z: 2 },
					min: { x: 2, y: -1, z: -6 },
				},
				envCellId: 0xda550100,
				landblockId: 0xda55ffff,
				memberId: "cell-0",
				source: "env-cell-root",
			},
		]);
		expect(
			query.queryEnvCellAabbDebugBounds({ landblockId: 0xdb55ffff }),
		).toEqual([]);
	});

	it("translates env-cell debug bounds into the outdoor anchor frame", () => {
		const query = new StaticSceneQuery();
		query.setOutdoorAnchorLandblockId(0xda55ffff);
		commitLandblockEnvCells(
			query,
			createLandblockEnvCellsPayload({
				envCellId: 0xdb550100,
				landblockBounds: {
					max: { x: 8, y: 4, z: 2 },
					min: { x: 2, y: -1, z: -6 },
				},
				landblockId: 0xdb55ffff,
			}),
		);

		expect(
			query.queryEnvCellAabbDebugBounds({ landblockId: 0xdb55ffff }),
		).toEqual([
			expect.objectContaining({
				bounds: {
					max: { x: 200, y: 4, z: 2 },
					min: { x: 194, y: -1, z: -6 },
				},
				envCellId: 0xdb550100,
				landblockId: 0xdb55ffff,
			}),
		]);
	});

	it("exposes committed env-cell bounds in the render frame", () => {
		const query = new StaticSceneQuery();
		query.setOutdoorAnchorLandblockId(0xda55ffff);
		commitLandblockEnvCells(
			query,
			createLandblockEnvCellsPayload({
				envCellId: 0xdb550100,
				landblockBounds: {
					max: { x: 8, y: 4, z: 2 },
					min: { x: 2, y: -1, z: -6 },
				},
				landblockId: 0xdb55ffff,
			}),
		);

		expect(
			query.queryEnvCellBounds({
				envCellId: 0xdb550100,
				landblockId: 0xdb55ffff,
			}),
		).toEqual({
			bounds: {
				max: { x: 200, y: 4, z: 2 },
				min: { x: 194, y: -1, z: -6 },
			},
			envCellId: 0xdb550100,
			landblockId: 0xdb55ffff,
		});
		expect(
			query.queryEnvCellBounds({
				envCellId: 0xdb550101,
				landblockId: 0xdb55ffff,
			}),
		).toBeNull();
	});

	it("exposes all committed env-cell debug bounds by default", () => {
		const query = new StaticSceneQuery();
		query.setOutdoorAnchorLandblockId(0xda55ffff);
		commitLandblockEnvCells(
			query,
			createLandblockEnvCellsPayload({
				envCellId: 0xda550100,
				landblockBounds: {
					max: { x: 8, y: 4, z: 2 },
					min: { x: 2, y: -1, z: -6 },
				},
				landblockId: 0xda55ffff,
			}),
		);
		commitLandblockEnvCells(
			query,
			createLandblockEnvCellsPayload({
				envCellId: 0xdb550100,
				landblockBounds: {
					max: { x: 18, y: 6, z: 12 },
					min: { x: 12, y: 1, z: 4 },
				},
				landblockId: 0xdb55ffff,
			}),
		);

		expect(
			query.queryEnvCellAabbDebugBounds().map((debugBounds) => ({
				bounds: debugBounds.bounds,
				envCellId: debugBounds.envCellId,
				landblockId: debugBounds.landblockId,
			})),
		).toEqual([
			{
				bounds: {
					max: { x: 8, y: 4, z: 2 },
					min: { x: 2, y: -1, z: -6 },
				},
				envCellId: 0xda550100,
				landblockId: 0xda55ffff,
			},
			{
				bounds: {
					max: { x: 210, y: 6, z: 12 },
					min: { x: 204, y: 1, z: 4 },
				},
				envCellId: 0xdb550100,
				landblockId: 0xdb55ffff,
			},
		]);
	});

	it("does not count broad env-cell BVH node hits as residency without item containment", () => {
		const query = new StaticSceneQuery();
		commitLandblockEnvCells(
			query,
			createLandblockEnvCellsPayload({
				landblockNodeBounds: {
					max: { x: 64, y: 8, z: 64 },
					min: { x: -64, y: -8, z: -64 },
				},
			}),
		);

		expect(
			query.queryEnvCellAtPoint({
				acceptedEnvCellIds: [0xda550100],
				landblockId: 0xda55ffff,
				point: { x: 40, y: 0, z: 40 },
			}),
		).toBeNull();
	});

	it("derives camera residency from committed env-cell query data", () => {
		const query = new StaticSceneQuery();
		commitLandblockEnvCells(query, createLandblockEnvCellsPayload());

		expect(
			query.queryCameraResidencyAtPoint({
				outdoorAnchorLandblockId: 0xda55ffff,
				point: { x: 0, y: 0, z: -4.5 },
			}),
		).toEqual({
			envCellId: 0xda550100,
			kind: "env-cell",
			landblockId: 0xda55ffff,
		});
	});

	it("derives camera residency from a dungeon landblock-local point", () => {
		const query = new StaticSceneQuery();
		commitLandblockEnvCells(query, createLandblockEnvCellsPayload());

		expect(
			query.queryCameraResidencyAtLandblockPoint({
				landblockId: 0xda55ffff,
				point: { x: 0, y: 0, z: -4.5 },
			}),
		).toEqual({
			envCellId: 0xda550100,
			kind: "env-cell",
			landblockId: 0xda55ffff,
		});
		expect(
			query.queryCameraResidencyAtLandblockPoint({
				landblockId: 0xda55ffff,
				point: { x: 40, y: 0, z: 40 },
			}),
		).toEqual({
			kind: "unknown",
			landblockId: 0xda55ffff,
		});
	});

	it("derives camera residency in a neighboring landblock render frame", () => {
		const query = new StaticSceneQuery();
		query.setOutdoorAnchorLandblockId(0xda55ffff);
		commitLandblockEnvCells(
			query,
			createLandblockEnvCellsPayload({
				envCellId: 0xdb550100,
				landblockId: 0xdb55ffff,
			}),
		);

		expect(
			query.queryCameraResidencyAtPoint({
				outdoorAnchorLandblockId: 0xda55ffff,
				point: { x: 192, y: 0, z: -4.5 },
			}),
		).toEqual({
			envCellId: 0xdb550100,
			kind: "env-cell",
			landblockId: 0xdb55ffff,
		});
	});

	it("does not infer env-cell camera residency from source BVHs after committed records are gone", () => {
		const query = new StaticSceneQuery();
		commitLandblockEnvCells(query, createLandblockEnvCellsPayload());
		query.retainScopes([]);

		expect(
			query.queryCameraResidencyAtPoint({
				outdoorAnchorLandblockId: 0xda55ffff,
				point: { x: 0, y: 0, z: -4.5 },
			}),
		).toEqual({
			kind: "outdoor-landblock",
			landblockId: 0xda55ffff,
		});
	});

	it("derives outdoor and unknown camera residency candidates", () => {
		const query = new StaticSceneQuery();

		expect(
			query.queryCameraResidencyAtPoint({
				outdoorAnchorLandblockId: 0xda55ffff,
				point: { x: 192, y: 10, z: 0 },
			}),
		).toEqual({
			kind: "outdoor-landblock",
			landblockId: 0xdb55ffff,
		});
		expect(
			query.queryCameraResidencyAtPoint({
				outdoorAnchorLandblockId: 0x0055ffff,
				point: { x: -1, y: 10, z: 0 },
			}),
		).toEqual({
			kind: "unknown",
			landblockId: null,
		});
	});

	it("stores committed env-cell peer records independently from source BVH payloads", () => {
		const query = new StaticSceneQuery();
		const owner = createEnvCellWorkOwner("work-env-a", 0xda55ffff);

		query.applyStaticPeerRecords({
			portalInteriorRecords: [
				{
					envCells: [
						{
							envCellId: 0xda550100,
							localPlacement: createPlacement(),
							portalApertures: [],
							portals: [],
						},
					],
					kind: "env-cell-portal-interior",
					landblockId: 0xda55ffff,
					owner,
					portalLinks: [],
				},
			],
			sourceMappings: [
				{
					cellStructure: {
						cellStructureId: 0x0d000001,
						kind: "cell-structure",
					},
					envCellId: 0xda550100,
					environment: {
						environmentId: 0x0e000001,
						kind: "environment",
					},
					kind: "env-cell-source",
					landblockId: 0xda55ffff,
					memberId: "cell-0",
					owner,
					surfaces: [],
				},
			],
			spatialRecords: [
				{
					cellStructure: {
						cellStructureId: 0x0d000001,
						kind: "cell-structure",
					},
					envCellId: 0xda550100,
					environment: {
						environmentId: 0x0e000001,
						kind: "environment",
					},
					kind: "env-cell-spatial",
					landblockId: 0xda55ffff,
					memberId: "cell-0",
					owner,
					renderBounds: null,
					residencyBvhItemCount: 1,
					residencyBvhNodeCount: 1,
				},
			],
			visibilityRecords: [
				{
					acceptedEnvCellIds: [0xda550100],
					diagnostics: [],
					kind: "env-cell-visibility",
					landblockId: 0xda55ffff,
					owner,
					visibleLinks: [
						{
							sourceEnvCellId: 0xda550100,
							targetEnvCellId: 0xda550101,
						},
					],
				},
			],
		});

		expect(
			query.queryCommittedEnvCellRecords({ landblockId: 0xda55ffff }),
		).toMatchObject({
			landblockId: 0xda55ffff,
			portalInteriorRecords: [{ kind: "env-cell-portal-interior" }],
			sourceMappings: [{ kind: "env-cell-source" }],
			spatialRecords: [{ kind: "env-cell-spatial" }],
			visibilityRecords: [{ kind: "env-cell-visibility" }],
		});
		expect(query.createSnapshot()).toMatchObject({
			committedEnvCellLandblockCount: 1,
			committedEnvCellPortalInteriorRecordCount: 1,
			committedEnvCellSourceMappingRecordCount: 1,
			committedEnvCellSpatialRecordCount: 1,
			committedEnvCellVisibilityRecordCount: 1,
			envCellLandblockCount: 0,
			envCellRecordCount: 0,
		});

		query.retainScopes([]);

		expect(
			query.queryCommittedEnvCellRecords({ landblockId: 0xda55ffff }),
		).toBeNull();
		expect(query.createSnapshot()).toMatchObject({
			committedEnvCellLandblockCount: 0,
			committedEnvCellPortalInteriorRecordCount: 0,
			committedEnvCellSourceMappingRecordCount: 0,
			committedEnvCellSpatialRecordCount: 0,
			committedEnvCellVisibilityRecordCount: 0,
		});
	});

	it("sorts committed records by typed keys without JSON stringification", () => {
		const query = new StaticSceneQuery();
		const owner = createEnvCellWorkOwner("work-env-a", 0xda55ffff);

		query.applyStaticPeerRecords({
			sourceMappings: [
				createThrowingJsonEnvCellSourceMapping({
					envCellId: 0xda550101,
					memberId: "cell-b",
					owner,
				}),
				createThrowingJsonEnvCellSourceMapping({
					envCellId: 0xda550100,
					memberId: "cell-a",
					owner,
				}),
			],
		});

		expect(
			query
				.queryCommittedEnvCellRecords({ landblockId: 0xda55ffff })
				?.sourceMappings.map((record) => record.memberId),
		).toEqual(["cell-a", "cell-b"]);
	});

	it("derives portal traversal from committed portal links rather than visibility links", () => {
		const query = new StaticSceneQuery();
		const owner = createEnvCellWorkOwner("work-env-traversal", 0xda55ffff);

		query.applyStaticPeerRecords({
			portalInteriorRecords: [
				{
					envCells: [
						createPortalSummary(0xda550100),
						createPortalSummary(0xda550101),
						createPortalSummary(0xda550102),
					],
					kind: "env-cell-portal-interior",
					landblockId: 0xda55ffff,
					owner,
					portalLinks: [
						createEnvCellPortalLink({
							linkId: "a-to-b",
							sourceEnvCellId: 0xda550100,
							targetEnvCellId: 0xda550101,
						}),
					],
				},
			],
			visibilityRecords: [
				{
					acceptedEnvCellIds: [0xda550100, 0xda550101, 0xda550102],
					diagnostics: [],
					kind: "env-cell-visibility",
					landblockId: 0xda55ffff,
					owner,
					visibleLinks: [
						{
							sourceEnvCellId: 0xda550100,
							targetEnvCellId: 0xda550102,
						},
					],
				},
			],
		});

		const plan = query.queryPortalTraversal({
			landblockId: 0xda55ffff,
			maxCells: 8,
			maxDepth: 4,
			maxPortalViews: 16,
			startEnvCellId: 0xda550100,
		});

		expect(plan.visibleCells.map((cell) => cell.envCellId)).toEqual([
			0xda550100, 0xda550101,
		]);
		expect(plan.visibleCells.map((cell) => cell.envCellId)).not.toContain(
			0xda550102,
		);
	});

	it("queries committed outdoor building transition aperture batches without env-cell records", () => {
		const query = new StaticSceneQuery();
		const batch: TransitionApertureBatch = {
			apertureBatchId: "transition-apertures:outdoor-buildings:3663069183",
			coordinateSpace: "landblock-render-local",
			frontFace: "indoor-visible",
			indices: [0, 2, 1],
			kind: "transition-aperture-batch",
			landblockId: 0xda55ffff,
			planes: [null],
			ranges: [
				{
					exterior: {
						buildingInstanceId: "building-0",
						buildingPortalId: "building-portal-0",
						kind: "landblock-building",
					},
					firstIndex: 0,
					indexCount: 3,
					portalId:
						"transition-portal:outdoor-buildings:3663069183:building-transition-aperture:building-0:0",
					source: {
						buildingInstanceId: "building-0",
						buildingPortalId: "building-portal-0",
						buildingPortalSourceIndex: 0,
						kind: "building-portal",
						linkedEnvCellIds: [0xda550100],
						otherCellId: 0x0100,
						otherPortalId: 0xffff,
						polyId: 7,
						portalIndex: 0,
						sourceAssetId: "gfx-obj/01001234",
						sourceDid: 0x01001234,
					},
				},
			],
			sourceDomain: "outdoor-buildings",
			vertices: [
				{ x: 0, y: 0, z: 0 },
				{ x: 1, y: 0, z: 0 },
				{ x: 0, y: 1, z: 0 },
			],
		};

		query.applyTransitionApertureBatches([batch]);

		expect(query.queryTransitionApertureBatches()).toEqual([batch]);
		expect(
			query.queryTransitionApertureBatches({ landblockId: 0xdb55ffff }),
		).toEqual([]);
	});

	it("reports committed portal interior scene availability by landblock", () => {
		const query = new StaticSceneQuery();

		expect(
			query.hasCommittedPortalInteriorScene({ landblockId: 0xda55ffff }),
		).toBe(false);

		commitLandblockEnvCells(query, createLandblockEnvCellsPayload());

		expect(
			query.hasCommittedPortalInteriorScene({ landblockId: 0xda55ffff }),
		).toBe(true);
		expect(
			query.hasCommittedPortalInteriorScene({ landblockId: 0xdb55ffff }),
		).toBe(false);

		query.retainScopes([]);

		expect(
			query.hasCommittedPortalInteriorScene({ landblockId: 0xda55ffff }),
		).toBe(false);
	});
});

function createOutdoorStaticObjectsPayload(
	options: {
		readonly includeContainingObject?: boolean;
		readonly includeFarInvalidSubtree?: boolean;
		readonly includeBvh?: boolean;
		readonly includeSourceDiagnostics?: boolean;
		readonly instanceBounds?: NonNullable<
			OutdoorStaticObjectsScopePayload["objects"][number]["instanceBounds"]
		>;
		readonly instanceId?: string;
		readonly landblockId?: number;
	} = {},
): OutdoorStaticObjectsScopePayload {
	const landblockId = options.landblockId ?? 0xda55ffff;
	const includeBvh = options.includeBvh ?? true;
	const object = createOutdoorStaticObject({
		instanceBounds: options.instanceBounds ?? {
			max: { x: 1, y: 1, z: -4 },
			min: { x: -1, y: -1, z: -5 },
		},
		instanceId: options.instanceId ?? "outdoor-static-0",
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
	const sourceDiagnostics = options.includeSourceDiagnostics
		? createOutdoorSourceDiagnostics(object)
		: {
				materialSlots: [],
				materialSources: [],
				sourceAssets: [],
				textureRefs: [],
			};
	return {
		domain: "outdoor-detail",
		kind: "outdoor-static-objects",
		landblock: {
			kind: "landblock-source",
			landblockId,
			source: "outdoor",
		},
		materialSlots: sourceDiagnostics.materialSlots,
		materialSources: sourceDiagnostics.materialSources,
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
		sourceAssets: sourceDiagnostics.sourceAssets,
		sourceSpatial: {
			bounds: null,
			coordinateSpace: "landblock-render-local",
			outdoorBvh: includeBvh ? outdoorBvh : null,
			outdoorBvhItemCount: includeBvh ? outdoorBvh.items.length : 0,
			outdoorBvhNodeCount: includeBvh ? outdoorBvh.nodes.length : 0,
		},
		textureRefs: sourceDiagnostics.textureRefs,
	};
}

function createOutdoorSourceDiagnostics(
	object: OutdoorStaticObjectsScopePayload["objects"][number],
): Pick<
	OutdoorStaticObjectsScopePayload,
	"materialSlots" | "materialSources" | "sourceAssets" | "textureRefs"
> {
	const material = {
		diffuse: 0xffffffff,
		identity: {
			kind: "static-material-source" as const,
			materialId: 0x08000010,
		},
		luminosity: 0,
		source: {
			kind: "texture" as const,
			palette: null,
			renderSurfaceDefaultPalettes: [],
			selectedRenderSurface: {
				kind: "render-surface" as const,
				renderSurfaceId: 0x06000010,
			},
			texture: {
				kind: "surface-texture" as const,
				surfaceTextureId: 0x05000010,
			},
		},
		surfaceId: 0,
		surfaceType: 0,
		translucency: 0,
	};
	const partMaterialSlot = {
		geometrySurfaceId: 0,
		material: material.identity,
		materialSurfaceId: 0,
		materialVariantSignature: null,
		paletteOverride: null,
		paletteViews: [],
		slotIndex: 0,
	};
	const materialSlot = {
		...partMaterialSlot,
		gfxObj: {
			kind: "static-object-source" as const,
			sourceAssetKind: "gfx-obj" as const,
			sourceDid: 0x01000020,
		},
		identity: {
			geometrySurfaceId: 0,
			kind: "static-material-slot" as const,
			materialSurfaceId: 0,
			part: {
				kind: "static-object-part" as const,
				object: object.identity,
				partIndex: 0,
			},
			slotIndex: 0,
		},
		object: object.identity,
		source: object.source,
	};

	return {
		materialSlots: [materialSlot],
		materialSources: [material],
		sourceAssets: [
			{
				bounds: object.sourceBounds,
				debug: object.debug,
				identity: object.source,
				invalidPolygonCount: 0,
				materialSlotCount: 1,
				partCount: 1,
				parts: [
					{
						bounds: object.sourceBounds,
						defaultPlacements: [createPlacement()],
						gfxObj: materialSlot.gfxObj,
						invalidPolygonCount: 0,
						materialSlotCount: 1,
						materialSlots: [partMaterialSlot],
						normals: new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]),
						partIndex: 0,
						physicsPolygonCount: 0,
						positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
						renderTriangleCount: 1,
						scale: { x: 1, y: 1, z: 1 },
						skippedPolygonCount: 0,
						source: object.source,
						texCoords: new Float32Array([0, 0, 1, 0, 0, 1]),
						triangles: [
							{
								firstVertex: 0,
								geometrySurfaceId: 0,
								materialVariantSignature: null,
								polygonId: 0,
							},
						],
					},
				],
				physicsPolygonCount: 0,
				renderTriangleCount: 1,
				skippedPolygonCount: 0,
				sourceAssetKind: "setup-model",
			},
		],
		textureRefs: [
			{
				palette: null,
				renderSurface: material.source.selectedRenderSurface,
				role: "surface-texture",
				texture: material.source.texture,
			},
		],
	};
}

function createTerrainPayload(
	options: { readonly landblockId?: number } = {},
): TerrainStaticScopePayload {
	const quad = {
		averageHeight: 0,
		bounds: {
			max: { x: 4, y: 1, z: 0 },
			min: { x: 0, y: 0, z: -4 },
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
			landblockId: options.landblockId ?? 0xda55ffff,
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
				{ x: 0, y: 0, z: -4 },
				{ x: 4, y: 1, z: -4 },
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
				coordinateSpace: "landblock-render-local",
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
): NonNullable<
	OutdoorStaticObjectsScopePayload["sourceSpatial"]["outdoorBvh"]
> {
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
): NonNullable<
	OutdoorStaticObjectsScopePayload["sourceSpatial"]["outdoorBvh"]
> {
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

function createLandblockEnvCellsPayload(
	options: {
		readonly envCellPlacement?: ReturnType<typeof createPlacement>;
		readonly envCellId?: number;
		readonly includeLandblockBvh?: boolean;
		readonly landblockBounds?: LandblockEnvCellsStaticScopePayload["residencySpatial"]["landblockEnvCellBvh"]["items"][number]["bounds"];
		readonly landblockId?: number;
		readonly landblockNodeBounds?: LandblockEnvCellsStaticScopePayload["residencySpatial"]["landblockEnvCellBvh"]["nodes"][number]["bounds"];
		readonly portalApertures?: LandblockEnvCellsStaticScopePayload["envCells"][number]["portalApertures"];
		readonly portalLinks?: LandblockEnvCellsStaticScopePayload["portalLinks"];
		readonly portals?: LandblockEnvCellsStaticScopePayload["envCells"][number]["portals"];
	} = {},
): LandblockEnvCellsStaticScopePayload {
	const includeLandblockBvh = options.includeLandblockBvh ?? true;
	const landblockId = options.landblockId ?? 0xda55ffff;
	const envCellId =
		options.envCellId ?? ((landblockId & 0xffff0000) | 0x0100) >>> 0;
	const envCellPlacement = options.envCellPlacement ?? createPlacement();
	const landblockBounds = options.landblockBounds ?? {
		max: { x: 1, y: 1, z: -4 },
		min: { x: -1, y: -1, z: -5 },
	};
	const landblockNodeBounds = options.landblockNodeBounds ?? landblockBounds;
	return {
		acceptedEnvCellIds: [envCellId],
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
					envCellId,
					kind: "env-cell-source",
				},
				landblockId,
				localPlacement: envCellPlacement,
				memberId: "cell-0",
				portalApertures: options.portalApertures ?? [],
				portals: options.portals ?? [],
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
							landblockId,
							objectKind: "explicit-object",
						},
						localPlacement: createPlacement(),
						source: {
							kind: "static-object-source",
							sourceAssetKind: "setup-model",
							sourceDid: 0x02000010,
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
			landblockId,
			source: "env-cells",
		},
		missingRefs: [],
		portalLinks: options.portalLinks ?? [],
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
								bounds: landblockBounds,
								identity: {
									envCellId,
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
								bounds: landblockNodeBounds,
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

function createPortalSummary(envCellId: number) {
	return {
		envCellId,
		localPlacement: createPlacement(),
		portalApertures: [],
		portals: [],
	};
}

function createEnvCellPortalLink(options: {
	readonly linkId: string;
	readonly sourceEnvCellId: number;
	readonly targetEnvCellId: number;
}): LandblockPortalLinkFacts {
	return {
		flags: 0,
		linkId: options.linkId,
		polygonId: null,
		source: {
			envCellId: options.sourceEnvCellId,
			kind: "env-cell",
			portalId: `${options.linkId}:source`,
		},
		sourceIndex: 0,
		target: {
			envCellId: options.targetEnvCellId,
			kind: "env-cell",
			portalId: `${options.linkId}:target`,
		},
	};
}

function createEnvCellWorkOwner(
	workId: string,
	landblockId: number,
): StaticWorkPeerRecordOwner {
	return {
		domain: "landblock-env-cells",
		kind: "work",
		scope: {
			kind: "landblock",
			landblockId,
		},
		scopeKey: `landblock:${landblockId.toString(16).padStart(8, "0")}`,
		workId,
	};
}

function createThrowingJsonEnvCellSourceMapping(options: {
	readonly envCellId: number;
	readonly landblockId?: number;
	readonly memberId: string;
	readonly owner: StaticWorkPeerRecordOwner;
}): StaticSourceMappingRecord {
	return {
		cellStructure: {
			cellStructureId: 0x0d000001,
			kind: "cell-structure",
		},
		envCellId: options.envCellId,
		environment: {
			environmentId: 0x0e000001,
			kind: "environment",
		},
		kind: "env-cell-source",
		landblockId: options.landblockId ?? 0xda55ffff,
		memberId: options.memberId,
		owner: options.owner,
		surfaces: [],
		toJSON(): never {
			throw new Error("Committed record sorting must not stringify records.");
		},
	} as StaticSourceMappingRecord;
}

function commitLandblockEnvCells(
	query: StaticSceneQuery,
	payload: LandblockEnvCellsStaticScopePayload,
): void {
	const landblockId = payload.landblock.landblockId;
	const owner = createEnvCellWorkOwner("work-env-residency", landblockId);
	query.applyStaticPeerRecords({
		authoredDynamicSeeds: payload.envCells.flatMap((envCell) =>
			envCell.staticObjectSeeds.map((seed) => ({
				envCellId: envCell.identity.envCellId,
				kind: "env-cell-static-object-seed" as const,
				landblockId,
				owner,
				seed,
			})),
		),
		portalInteriorRecords: [
			{
				envCells: payload.envCells.map((envCell) => ({
					envCellId: envCell.identity.envCellId,
					localPlacement: envCell.localPlacement,
					portalApertures: envCell.portalApertures,
					portals: envCell.portals,
				})),
				kind: "env-cell-portal-interior" as const,
				landblockId,
				owner,
				portalLinks: payload.portalLinks,
			},
		],
		spatialRecords: payload.envCells.map((envCell) => ({
			cellStructure: envCell.cellStructure,
			envCellId: envCell.identity.envCellId,
			environment: envCell.environment,
			kind: "env-cell-spatial" as const,
			landblockId,
			memberId: envCell.memberId,
			owner,
			renderBounds: envCell.renderGeometry.bounds,
			residencyBvh: payload.residencySpatial.landblockEnvCellBvh,
			residencyBvhItemCount:
				payload.residencySpatial.landblockEnvCellBvhItemCount,
			residencyBvhNodeCount:
				payload.residencySpatial.landblockEnvCellBvhNodeCount,
		})),
		visibilityRecords: [
			{
				acceptedEnvCellIds: payload.acceptedEnvCellIds,
				diagnostics: payload.visibilityDiagnostics,
				kind: "env-cell-visibility",
				landblockId,
				owner,
				visibleLinks: payload.portalLinks.flatMap((link) =>
					link.source.kind === "env-cell" && link.target.kind === "env-cell"
						? [
								{
									sourceEnvCellId: link.source.envCellId,
									targetEnvCellId: link.target.envCellId,
								},
							]
						: [],
				),
			},
		],
	});
}

function commitEnvCellStaticObjectBounds(
	query: StaticSceneQuery,
	options: {
		readonly bounds?: StaticBounds;
		readonly envCellId?: number;
		readonly instanceId?: string;
		readonly landblockId?: number;
		readonly owner?: StaticWorkPeerRecordOwner;
	} = {},
): void {
	const landblockId = options.landblockId ?? 0xda55ffff;
	query.applyStaticSpatialRecords({
		records: [
			{
				bounds: options.bounds ?? {
					max: { x: 1, y: 1, z: -4 },
					min: { x: -1, y: -1, z: -5 },
				},
				envCellId: options.envCellId ?? 0xda550100,
				instanceId: options.instanceId ?? "env-static-0",
				kind: "env-cell-static-object-bounds",
				landblockId,
				owner:
					options.owner ??
					createEnvCellWorkOwner("work-env-static-object", landblockId),
			},
		],
	});
}

function createPlacement(
	options: {
		readonly origin?: {
			readonly x: number;
			readonly y: number;
			readonly z: number;
		};
	} = {},
) {
	return {
		orientation: { w: 1, x: 0, y: 0, z: 0 },
		origin: options.origin ?? { x: 0, y: 0, z: 0 },
	};
}
