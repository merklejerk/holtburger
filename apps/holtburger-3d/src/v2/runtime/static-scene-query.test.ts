import { describe, expect, it } from "vitest";
import type {
	LandblockEnvCellsStaticScopePayload,
	StaticObjectGeometryStaticDrawUnit,
} from "../static/contracts";
import { StaticSceneQuery } from "./static-scene-query";

describe("V2 static scene query", () => {
	it("picks the nearest outdoor static draw unit by bounds", () => {
		const query = new StaticSceneQuery();
		query.ingestStaticResidencyDelta({
			addedDrawUnitPlacements: [
				{
					drawUnit: createStaticObjectDrawUnit("far", {
						max: { x: 1, y: 1, z: -9 },
						min: { x: -1, y: -1, z: -10 },
					}),
					translation: [0, 0, 0],
				},
				{
					drawUnit: createStaticObjectDrawUnit("near", {
						max: { x: 1, y: 1, z: -4 },
						min: { x: -1, y: -1, z: -5 },
					}),
					translation: [0, 0, 0],
				},
			],
			removedDrawUnitIds: [],
			revision: 1,
		});

		const hit = query.pickRay({
			context: { kind: "outdoor" },
			ray: {
				direction: { x: 0, y: 0, z: -1 },
				origin: { x: 0, y: 0, z: 0 },
			},
		});

		expect(hit).toMatchObject({
			drawUnitId: "near",
			itemKind: "outdoor-static-draw-unit",
			materialIds: [0x08000010],
		});
		expect(hit?.distance).toBe(4);
	});

	it("does not flatten outdoor and env-cell scene contexts", () => {
		const query = new StaticSceneQuery();
		query.ingestStaticResidencyDelta({
			addedDrawUnitPlacements: [
				{
					drawUnit: createStaticObjectDrawUnit("outdoor", {
						max: { x: 1, y: 1, z: -4 },
						min: { x: -1, y: -1, z: -5 },
					}),
					translation: [0, 0, 0],
				},
			],
			removedDrawUnitIds: [],
			revision: 1,
		});

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

	it("removes outdoor query records when draw units are evicted", () => {
		const query = new StaticSceneQuery();
		query.ingestStaticResidencyDelta({
			addedDrawUnitPlacements: [
				{
					drawUnit: createStaticObjectDrawUnit("outdoor", {
						max: { x: 1, y: 1, z: -4 },
						min: { x: -1, y: -1, z: -5 },
					}),
					translation: [0, 0, 0],
				},
			],
			removedDrawUnitIds: [],
			revision: 1,
		});
		query.ingestStaticResidencyDelta({
			addedDrawUnitPlacements: [],
			removedDrawUnitIds: ["outdoor"],
			revision: 2,
		});

		expect(query.createSnapshot().outdoorRecordCount).toBe(0);
	});
});

function createStaticObjectDrawUnit(
	drawUnitId: string,
	bounds: StaticObjectGeometryStaticDrawUnit["sort"]["bounds"],
): StaticObjectGeometryStaticDrawUnit {
	return {
		alphaTest: 0.5,
		coordinateSpace: "landblock-render-local",
		detailTextureTiling: 1,
		detailTextureUseId: null,
		domain: "outdoor-detail",
		drawUnitId,
		indexTextureUseId: null,
		indexType: "uint16",
		indexedTextureFormat: null,
		indices: new Uint16Array([0, 1, 2]),
		kind: "static-object-geometry",
		landblockId: 0xda55ffff,
		materialBucketKey: "bucket",
		materialColor: [1, 1, 1, 1],
		materialEmissiveColor: [0, 0, 0],
		materialEntries: [],
		materialFamily: "texture-rgba",
		materialIds: [0x08000010],
		materialPass: "alpha-test",
		materialSlotIndices: new Float32Array([0, 0, 0]),
		paletteFirstIndex: 0,
		paletteTextureUseId: null,
		positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
		primaryTextureUseId: "texture-use",
		primaryTextureWrapMode: "clamp",
		renderState: {
			blend: {
				dstFactor: null,
				enabled: false,
				mode: "clipmap",
				srcFactor: null,
			},
			depthTest: true,
			depthWrite: true,
		},
		sort: {
			bounds,
			center: [0, 0, 0],
			objectPartKey: "object/0",
			policy: "depth-writing",
		},
		sourceMappingRecords: [
			`${drawUnitId}:source:setup-model/02000010:gfx:gfx-obj/01000010:object:env-static-0`,
		],
		spatialRecord: `${drawUnitId}:bounds:1t`,
		texCoords: new Float32Array([0, 0, 1, 0, 0, 1]),
		textureUseIds: ["texture-use"],
		triangleCount: 1,
		vertexCount: 3,
	};
}

function createLandblockEnvCellsPayload(): LandblockEnvCellsStaticScopePayload {
	return {
		acceptedEnvCellIds: [0xda550100],
		classification: "dungeon",
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
					coordinateSpace: "env-cell-local",
					localBvh: {
						coordinateSpace: "env-cell-local",
						items: [{ instanceId: "env-static-0", kind: "static" }],
						nodes: [],
					},
					localBvhItemCount: 1,
					localBvhNodeCount: 0,
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
			coordinateSpace: "landblock-env-cell-residency",
			envCellResidencyBvhItemCount: 0,
			envCellResidencyBvhNodeCount: 0,
			residencyBvh: {
				coordinateSpace: "landblock-env-cell-residency",
				items: [],
				nodes: [],
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
