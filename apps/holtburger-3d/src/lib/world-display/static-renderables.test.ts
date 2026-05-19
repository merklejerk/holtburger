import { describe, expect, it } from "vitest";

import {
	createInitialAssetChannelState,
	type PreparedAssetRecord,
	type PreparedSetupModelPayload,
} from "../assets/types";
import type {
	PlacementTransformDto,
	RuntimeBatchDto,
	Vec3Dto,
} from "../host/contracts";
import { formatOutdoorStaticSceneAssetId } from "../landblocks";
import {
	deriveStaticRenderableSceneModel,
	formatStaticRenderableRenderGroupKey,
} from "./static-renderables";
import { WORLD_RENDER_DOMAIN } from "./render-domains";

const IDENTITY_PLACEMENT: PlacementTransformDto = {
	origin: { x: 0, y: 0, z: 0 },
	orientation: { w: 1, x: 0, y: 0, z: 0 },
};

const UNIT_SCALE: Vec3Dto = { x: 1, y: 1, z: 1 };

describe("static renderable scene model", () => {
	it("normalizes setup-model composites into gfx-backed renderable parts", () => {
		const assetState = createInitialAssetChannelState();
		assetState.preparedByAssetId = {
			"setup-model/02000001": createPreparedSetupModelAsset(),
			"gfx-obj/01000001": createPreparedGfxObjAsset(
				"gfx-obj/01000001",
				0x01000001,
			),
			"gfx-obj/01000002": createPreparedGfxObjAsset(
				"gfx-obj/01000002",
				0x01000002,
			),
			"outdoor-static-scene/0102ffff": createPreparedOutdoorStaticSceneAsset(
				0x0102ffff,
				["setup-model/02000001"],
			),
		};

		const model = deriveStaticRenderableSceneModel(
			createRuntimeBatch(),
			assetState,
		);

		expect(model.parts.map((part) => part.gfxObjAssetId)).toEqual([
			"gfx-obj/01000001",
			"gfx-obj/01000002",
		]);
		expect(model.parts[0]?.partPlacements).toEqual([
			createPlacement({ x: 1, y: 0, z: 0 }),
		]);
		expect(model.parts[1]?.partPlacements).toEqual([
			createPlacement({ x: 0, y: 2, z: 0 }),
		]);
		expect(model.parts[1]?.scale).toEqual({ x: 2, y: 1, z: 1 });
		expect(model.missingSourceAssetIds).toEqual([]);
		expect(model.missingGfxAssetIds).toEqual([]);
	});

	it("prefers the retail default setup placement frame", () => {
		const assetState = createInitialAssetChannelState();
		assetState.preparedByAssetId = {
			"setup-model/02000001": createPreparedSetupModelAsset([
				{
					key: 0,
					localPlacements: [
						createPlacement({ x: 1, y: 0, z: 0 }),
						createPlacement({ x: 0, y: 2, z: 0 }),
					],
					hookCount: 0,
				},
				{
					key: 0x65,
					localPlacements: [
						createPlacement({ x: 3, y: 0, z: 0 }),
						createPlacement({ x: 0, y: 4, z: 0 }),
					],
					hookCount: 0,
				},
			]),
			"gfx-obj/01000001": createPreparedGfxObjAsset(
				"gfx-obj/01000001",
				0x01000001,
			),
			"gfx-obj/01000002": createPreparedGfxObjAsset(
				"gfx-obj/01000002",
				0x01000002,
			),
			"outdoor-static-scene/0102ffff": createPreparedOutdoorStaticSceneAsset(
				0x0102ffff,
				["setup-model/02000001"],
			),
		};

		const model = deriveStaticRenderableSceneModel(
			createRuntimeBatch(),
			assetState,
		);

		expect(model.parts[0]?.partPlacements).toEqual([
			createPlacement({ x: 3, y: 0, z: 0 }),
		]);
		expect(model.parts[1]?.partPlacements).toEqual([
			createPlacement({ x: 0, y: 4, z: 0 }),
		]);
	});

	it("normalizes direct gfx-obj sources through an ephemeral one-part view", () => {
		const assetState = createInitialAssetChannelState();
		assetState.preparedByAssetId = {
			"gfx-obj/01000001": createPreparedGfxObjAsset(
				"gfx-obj/01000001",
				0x01000001,
			),
			"outdoor-static-scene/0102ffff": createPreparedOutdoorStaticSceneAsset(
				0x0102ffff,
				["gfx-obj/01000001"],
			),
		};

		const model = deriveStaticRenderableSceneModel(
			createRuntimeBatch(),
			assetState,
		);

		expect(model.parts).toHaveLength(1);
		expect(model.parts[0]).toMatchObject({
			sourceAssetId: "gfx-obj/01000001",
			partIndex: 0,
			gfxObjAssetId: "gfx-obj/01000001",
			renderChunk: {
				chunkKey: "landblock/0102ffff",
				chunkLandblockId: 0x0102ffff,
			},
			chunkLocalInstancePlacement: createPlacement({ x: 24, y: 48, z: 6 }),
			scale: UNIT_SCALE,
			partPlacements: [],
		});
	});

	it("groups duplicate parts by chunk and gfx asset id for instancing", () => {
		const assetState = createInitialAssetChannelState();
		assetState.preparedByAssetId = {
			"gfx-obj/01000001": createPreparedGfxObjAsset(
				"gfx-obj/01000001",
				0x01000001,
			),
			"outdoor-static-scene/0102ffff": createPreparedOutdoorStaticSceneAsset(
				0x0102ffff,
				["gfx-obj/01000001"],
				["gfx-obj/01000001"],
			),
		};
		const runtimeBatch = createRuntimeBatch();

		const model = deriveStaticRenderableSceneModel(runtimeBatch, assetState);

		expect(model.parts).toHaveLength(2);
		expect(model.partsByRenderDomainChunkAndGfxAssetId.size).toBe(1);
		expect(
			model.partsByRenderDomainChunkAndGfxAssetId.get(
				formatStaticRenderableRenderGroupKey(
					WORLD_RENDER_DOMAIN.exteriorStatic,
					"landblock/0102ffff",
					"gfx-obj/01000001",
				),
			),
		).toHaveLength(2);
	});

	it("includes outdoor-linked indoor static objects in outdoor scenes", () => {
		const assetState = createInitialAssetChannelState();
		assetState.preparedByAssetId = {
			"gfx-obj/01000001": createPreparedGfxObjAsset(
				"gfx-obj/01000001",
				0x01000001,
			),
			"indoor-env-cell/01020155": createPreparedIndoorEnvCellAsset(
				0x01020155,
				IDENTITY_PLACEMENT,
				["gfx-obj/01000001"],
			),
			"outdoor-static-scene/0102ffff":
				createPreparedOutdoorStaticSceneAssetWithBuildingPortal(
					0x0102ffff,
					[0x01020155],
				),
		};

		const model = deriveStaticRenderableSceneModel(
			createRuntimeBatch(),
			assetState,
		);

		expect(model.parts).toContainEqual(
			expect.objectContaining({
				kind: "indoor-static",
				owningEnvCellId: 0x01020155,
				renderChunk: {
					chunkKey: "landblock/0102ffff",
					chunkLandblockId: 0x0102ffff,
				},
				gfxObjAssetId: "gfx-obj/01000001",
			}),
		);
	});

	it("keeps static frames chunk-local across active landblocks", () => {
		const assetState = createInitialAssetChannelState();
		assetState.preparedByAssetId = {
			"gfx-obj/01000001": createPreparedGfxObjAsset(
				"gfx-obj/01000001",
				0x01000001,
			),
			"outdoor-static-scene/0102ffff": createPreparedOutdoorStaticSceneAsset(
				0x0102ffff,
				["gfx-obj/01000001"],
			),
			"outdoor-static-scene/0203ffff": createPreparedOutdoorStaticSceneAsset(
				0x0203ffff,
				["gfx-obj/01000001"],
			),
		};

		const model = deriveStaticRenderableSceneModel(
			createRuntimeBatch(),
			assetState,
			null,
			1,
		);

		expect(
			model.parts.map((part) => ({
				landblockId: part.owningLandblockId,
				chunkKey: part.renderChunk.chunkKey,
				placement: part.chunkLocalInstancePlacement,
			})),
		).toEqual([
			{
				landblockId: 0x0102ffff,
				chunkKey: "landblock/0102ffff",
				placement: createPlacement({ x: 24, y: 48, z: 6 }),
			},
			{
				landblockId: 0x0203ffff,
				chunkKey: "landblock/0203ffff",
				placement: createPlacement({ x: 24, y: 48, z: 6 }),
			},
		]);
		expect(model.partsByRenderDomainChunkAndGfxAssetId.size).toBe(2);
		expect(
			model.partsByRenderDomainChunkAndGfxAssetId.get(
				formatStaticRenderableRenderGroupKey(
					WORLD_RENDER_DOMAIN.exteriorStatic,
					"landblock/0102ffff",
					"gfx-obj/01000001",
				),
			),
		).toHaveLength(1);
		expect(
			model.partsByRenderDomainChunkAndGfxAssetId.get(
				formatStaticRenderableRenderGroupKey(
					WORLD_RENDER_DOMAIN.exteriorStatic,
					"landblock/0203ffff",
					"gfx-obj/01000001",
				),
			),
		).toHaveLength(1);
	});

	it("tracks missing prepared assets and filters instances outside active landblock coverage", () => {
		const assetState = createInitialAssetChannelState();
		assetState.preparedByAssetId = {
			"setup-model/02000001": createPreparedSetupModelAsset(),
			"gfx-obj/01000001": createPreparedGfxObjAsset(
				"gfx-obj/01000001",
				0x01000001,
			),
			"outdoor-static-scene/0102ffff": createPreparedOutdoorStaticSceneAsset(
				0x0102ffff,
				["setup-model/02000001", "setup-model/02000002"],
			),
			"outdoor-static-scene/0909ffff": createPreparedOutdoorStaticSceneAsset(
				0x0909ffff,
				["gfx-obj/01000001"],
			),
		};
		const runtimeBatch = createRuntimeBatch();

		const model = deriveStaticRenderableSceneModel(runtimeBatch, assetState);

		expect(model.parts.map((part) => part.gfxObjAssetId)).toEqual([
			"gfx-obj/01000001",
		]);
		expect(model.missingSourceAssetIds).toEqual(["setup-model/02000002"]);
		expect(model.missingGfxAssetIds).toEqual(["gfx-obj/01000002"]);
	});

	it("normalizes indoor env-cell static objects in chunk-local placement", () => {
		const assetState = createInitialAssetChannelState();
		assetState.preparedByAssetId = {
			"indoor-env-cell/016c0155": createPreparedIndoorEnvCellAsset(
				0x016c0155,
				createPlacement({ x: 10, y: 20, z: 30 }),
				["setup-model/02000001"],
			),
			"setup-model/02000001": createPreparedSetupModelAsset(),
			"gfx-obj/01000001": createPreparedGfxObjAsset(
				"gfx-obj/01000001",
				0x01000001,
			),
			"gfx-obj/01000002": createPreparedGfxObjAsset(
				"gfx-obj/01000002",
				0x01000002,
			),
		};
		const runtimeBatch = createRuntimeBatch();
		runtimeBatch.residency.indoors = true;
		runtimeBatch.residency.focusEnvCellId = 0x016c0155;

		const model = deriveStaticRenderableSceneModel(runtimeBatch, assetState);

		expect(model.parts).toHaveLength(2);
		expect(model.parts[0]).toMatchObject({
			kind: "indoor-static",
			owningEnvCellId: 0x016c0155,
			sourceAssetId: "setup-model/02000001",
			chunkLocalInstancePlacement: createPlacement({ x: 2, y: 4, z: 6 }),
		});
		expect(model.missingSourceAssetIds).toEqual([]);
		expect(model.missingGfxAssetIds).toEqual([]);
	});

	it("keeps indoor and exterior statics in separate render-domain groups", () => {
		const assetState = createInitialAssetChannelState();
		assetState.preparedByAssetId = {
			"gfx-obj/01000001": createPreparedGfxObjAsset(
				"gfx-obj/01000001",
				0x01000001,
			),
			"indoor-env-cell/01020155": createPreparedIndoorEnvCellAsset(
				0x01020155,
				IDENTITY_PLACEMENT,
				["gfx-obj/01000001"],
			),
			"outdoor-static-scene/0102ffff":
				createPreparedOutdoorStaticSceneAssetWithBuildingPortal(
					0x0102ffff,
					[0x01020155],
					["gfx-obj/01000001"],
				),
		};

		const model = deriveStaticRenderableSceneModel(
			createRuntimeBatch(),
			assetState,
		);

		expect(
			model.parts.map((part) => ({
				renderDomain: part.renderDomain,
				renderKey: part.renderKey,
			})),
		).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					renderDomain: WORLD_RENDER_DOMAIN.exteriorStatic,
					renderKey: expect.stringMatching(/^exterior-static\//),
				}),
				expect.objectContaining({
					renderDomain: WORLD_RENDER_DOMAIN.interiorStatic,
					renderKey: expect.stringMatching(/^interior-static\//),
				}),
			]),
		);
		expect(model.partsByRenderDomainChunkAndGfxAssetId.size).toBe(2);
		expect(
			model.partsByRenderDomainChunkAndGfxAssetId.get(
				formatStaticRenderableRenderGroupKey(
					WORLD_RENDER_DOMAIN.exteriorStatic,
					"landblock/0102ffff",
					"gfx-obj/01000001",
				),
			),
		).toHaveLength(1);
		expect(
			model.partsByRenderDomainChunkAndGfxAssetId.get(
				formatStaticRenderableRenderGroupKey(
					WORLD_RENDER_DOMAIN.interiorStatic,
					"landblock/0102ffff",
					"gfx-obj/01000001",
				),
			),
		).toHaveLength(1);
	});
});

function createRuntimeBatch(): RuntimeBatchDto {
	return {
		tick: 11,
		entities: [],
		residency: {
			focusEntityId: 0x01020304,
			focusLandblockId: 0x0102ffff,
			focusCellId: 3,
			focusEnvCellId: null,
			visibleCellIds: [],
			seenOutside: null,
			environmentId: null,
			cellStructureId: null,
			focusLocationLabel: "100.40S, 101.55W, 1.0Z",
			indoors: false,
			trackedBodyCount: 1,
		},
	};
}

function createPreparedOutdoorStaticSceneAsset(
	landblockId: number,
	scenerySourceAssetIds: string[],
	buildingSourceAssetIds: string[] = [],
): PreparedAssetRecord {
	const assetId = formatOutdoorStaticSceneAssetId(landblockId);
	return createPreparedAsset(assetId, {
		kind: "outdoor-static-scene",
		sourceAssetKind: "outdoor-static-scene",
		residencyKind: "outdoor-landblock",
		landblockId,
		sceneryInstances: scenerySourceAssetIds.map((sourceAssetId, index) => ({
			instanceId: `${assetId}/object/${index}`,
			owningLandblockId: landblockId,
			sourceDid: Number.parseInt(sourceAssetId.slice(-8), 16),
			sourceAssetId,
			sourceIndex: index,
			localPlacement: createPlacement({ x: 24 + index, y: 48, z: 6 }),
		})),
		buildingInstances: buildingSourceAssetIds.map((sourceAssetId, index) => ({
			instanceId: `${assetId}/building/${index}`,
			owningLandblockId: landblockId,
			sourceDid: Number.parseInt(sourceAssetId.slice(-8), 16),
			sourceAssetId,
			sourceIndex: index,
			localPlacement: createPlacement({ x: 25 + index, y: 48, z: 6 }),
			numLeaves: 1,
			portals: [],
		})),
		generatedSceneryInstances: [],
		diagnostics: createOutdoorStaticSceneDiagnostics(),
		provenance: {
			source: "repo-local-hba",
			sourceAssetKind: "outdoor-static-scene",
			errorCode: null,
			detail: "test",
		},
	});
}

function createPreparedOutdoorStaticSceneAssetWithBuildingPortal(
	landblockId: number,
	linkedEnvCellIds: number[],
	scenerySourceAssetIds: string[] = [],
): PreparedAssetRecord {
	const assetId = formatOutdoorStaticSceneAssetId(landblockId);
	return createPreparedAsset(assetId, {
		kind: "outdoor-static-scene",
		sourceAssetKind: "outdoor-static-scene",
		residencyKind: "outdoor-landblock",
		landblockId,
		sceneryInstances: scenerySourceAssetIds.map((sourceAssetId, index) => ({
			instanceId: `${assetId}/object/${index}`,
			owningLandblockId: landblockId,
			sourceDid: Number.parseInt(sourceAssetId.slice(-8), 16),
			sourceAssetId,
			sourceIndex: index,
			localPlacement: createPlacement({ x: 24 + index, y: 48, z: 6 }),
		})),
		buildingInstances: [
			{
				instanceId: `${assetId}/building/0`,
				owningLandblockId: landblockId,
				sourceDid: 0x02000001,
				sourceAssetId: "setup-model/02000001",
				sourceIndex: 0,
				localPlacement: createPlacement({ x: 24, y: 48, z: 6 }),
				numLeaves: linkedEnvCellIds.length,
				portals: [
					{
						portalId: `${assetId}/building/0/portal/0000`,
						sourceIndex: 0,
						flags: 0,
						otherCellId: 0,
						otherPortalId: 0,
						stabList: linkedEnvCellIds.map((id) => id & 0xffff),
						linkedEnvCellIds,
					},
				],
			},
		],
		generatedSceneryInstances: [],
		diagnostics: createOutdoorStaticSceneDiagnostics(),
		provenance: {
			source: "repo-local-hba",
			sourceAssetKind: "outdoor-static-scene",
			errorCode: null,
			detail: "test",
		},
	});
}

function createPreparedIndoorEnvCellAsset(
	envCellId: number,
	localPlacement: PlacementTransformDto,
	staticSourceAssetIds: string[],
): PreparedAssetRecord {
	const assetId = `indoor-env-cell/${envCellId.toString(16).padStart(8, "0")}`;
	return createPreparedAsset(assetId, {
		kind: "indoor-env-cell",
		sourceAssetKind: "env-cell",
		residencyKind: "indoor-env-cell",
		provenance: {
			source: "repo-local-hba",
			sourceAssetKind: "env-cell",
			errorCode: null,
			detail: "test",
		},
		debugPresentation: {
			primitive: "indoor-env-cell-metadata",
			paletteKey: assetId,
		},
		envCellId,
		environmentId: 0x0d000001,
		cellStructureId: 1,
		localPlacement,
		visibleCellIds: [],
		landblockEnvCellIds: [],
		seenOutside: false,
		surfaceIds: [],
		portalCount: 0,
		portals: [],
		staticObjectCount: staticSourceAssetIds.length,
		staticObjects: staticSourceAssetIds.map((sourceAssetId, index) => ({
			instanceId: `${assetId}/static/${index}`,
			owningEnvCellId: envCellId,
			sourceDid: Number.parseInt(sourceAssetId.slice(-8), 16),
			sourceAssetId,
			sourceIndex: index,
			localPlacement: createPlacement({ x: 2 + index, y: 4, z: 6 }),
		})),
	});
}

function createOutdoorStaticSceneDiagnostics() {
	const emptyLayer = {
		attempted: 0,
		accepted: 0,
		rejectedUnsupportedSource: 0,
	};

	return {
		landblockInfoAvailable: true,
		landblockInfoError: null,
		explicit: emptyLayer,
		buildings: emptyLayer,
		generated: {
			...emptyLayer,
			skippedWeenieObj: 0,
			rejectedFrequency: 0,
			rejectedBounds: 0,
			rejectedBuildingOccupancy: 0,
			rejectedObjectBounds: 0,
			objectBoundsUnavailable: 0,
			rejectedRoad: 0,
			rejectedSlope: 0,
			rejectedOverlap: 0,
		},
	};
}

function createPreparedSetupModelAsset(
	placementSets: PreparedSetupModelPayload["placementSets"] = [
		{
			key: 0,
			localPlacements: [
				createPlacement({ x: 1, y: 0, z: 0 }),
				createPlacement({ x: 0, y: 2, z: 0 }),
			],
			hookCount: 0,
		},
	],
): PreparedAssetRecord {
	return createPreparedAsset("setup-model/02000001", {
		kind: "setup-model",
		sourceAssetKind: "setup-model",
		residencyKind: "unknown",
		setupModelId: 0x02000001,
		flags: null,
		parts: [
			{
				partIndex: 0,
				gfxObjId: 0x01000001,
				gfxObjAssetId: "gfx-obj/01000001",
				parentIndex: null,
				scale: UNIT_SCALE,
			},
			{
				partIndex: 1,
				gfxObjId: 0x01000002,
				gfxObjAssetId: "gfx-obj/01000002",
				parentIndex: 0,
				scale: { x: 2, y: 1, z: 1 },
			},
		],
		holdingLocations: [],
		connectionPoints: [],
		placementSets,
		collisionWitness: {
			cylSphereCount: 0,
			sphereCount: 0,
		},
		height: null,
		radius: null,
		stepUp: null,
		stepDown: null,
		sortingSphere: null,
		selectionSphere: null,
		lights: [],
		defaultAnimation: null,
		defaultScript: null,
		defaultMotionTable: null,
		defaultSoundTable: null,
		defaultScriptTable: null,
		provenance: {
			source: "repo-local-hba",
			sourceAssetKind: "setup-model",
			errorCode: null,
			detail: "test",
		},
	});
}

function createPreparedGfxObjAsset(
	assetId: string,
	gfxObjId: number,
): PreparedAssetRecord {
	return createPreparedAsset(assetId, {
		kind: "gfx-obj",
		sourceAssetKind: "gfx-obj",
		residencyKind: "unknown",
		gfxObjId,
		flags: null,
		surfaceIds: [],
		vertexArray: {
			vertexType: null,
			vertexCount: 3,
			vertices: [],
		},
		drawingPolygons: [],
		drawingBsp: null,
		physicsWitness: {
			polygonCount: 0,
			hasBsp: false,
		},
		renderGeometry: {
			sourceId: gfxObjId,
			vertexCount: 3,
			triangleCount: 1,
			positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
			normals: [0, 0, 1, 0, 0, 1, 0, 0, 1],
			uvs: [0, 0, 1, 0, 0, 1],
			triangles: [{ polygonId: 1, surfaceId: null, firstVertex: 0 }],
			surfaceIds: [],
			bounds: {
				min: { x: 0, y: 0, z: 0 },
				max: { x: 1, y: 1, z: 0 },
			},
		},
		sortCenter: null,
		didDegrade: null,
		provenance: {
			source: "repo-local-hba",
			sourceAssetKind: "gfx-obj",
			errorCode: null,
			detail: "test",
		},
	});
}

function createPreparedAsset(
	assetId: string,
	payload: PreparedAssetRecord["payload"],
): PreparedAssetRecord {
	return {
		request: {
			requestId: `test-${assetId}`,
			assetId,
			priority: "streaming",
		},
		response: {
			requestId: `test-${assetId}`,
			assetId,
			payloadKind: "json",
			payload: {},
		},
		payload,
		preparedAt: "2026-05-12T00:00:00.000Z",
	};
}

function createPlacement(origin: Vec3Dto): PlacementTransformDto {
	return {
		origin,
		orientation: IDENTITY_PLACEMENT.orientation,
	};
}
