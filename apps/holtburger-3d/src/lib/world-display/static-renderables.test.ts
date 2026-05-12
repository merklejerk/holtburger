import { describe, expect, it } from "vitest";

import {
	createInitialAssetChannelState,
	type PreparedAssetRecord,
} from "../assets/types";
import type { FrameDto, RuntimeBatchDto, Vec3Dto } from "../host/contracts";
import { deriveStaticRenderableSceneModel } from "./static-renderables";

const IDENTITY_FRAME: FrameDto = {
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
			"landblock-statics/0102ffff": createPreparedLandblockStaticsAsset(
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
		expect(model.parts[0]?.placementFrames).toEqual([
			createFrame({ x: 1, y: 0, z: 0 }),
		]);
		expect(model.parts[1]?.placementFrames).toEqual([
			createFrame({ x: 1, y: 0, z: 0 }),
			createFrame({ x: 0, y: 2, z: 0 }),
		]);
		expect(model.parts[1]?.scale).toEqual({ x: 2, y: 1, z: 1 });
		expect(model.missingSourceAssetIds).toEqual([]);
		expect(model.missingGfxAssetIds).toEqual([]);
	});

	it("normalizes direct gfx-obj sources through an ephemeral one-part view", () => {
		const assetState = createInitialAssetChannelState();
		assetState.preparedByAssetId = {
			"gfx-obj/01000001": createPreparedGfxObjAsset(
				"gfx-obj/01000001",
				0x01000001,
			),
			"landblock-statics/0102ffff": createPreparedLandblockStaticsAsset(
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
			scale: UNIT_SCALE,
			placementFrames: [],
		});
	});

	it("groups duplicate parts by gfx asset id for shared geometry upload", () => {
		const assetState = createInitialAssetChannelState();
		assetState.preparedByAssetId = {
			"gfx-obj/01000001": createPreparedGfxObjAsset(
				"gfx-obj/01000001",
				0x01000001,
			),
			"landblock-statics/0102ffff": createPreparedLandblockStaticsAsset(
				0x0102ffff,
				["gfx-obj/01000001"],
				["gfx-obj/01000001"],
			),
		};
		const runtimeBatch = createRuntimeBatch();

		const model = deriveStaticRenderableSceneModel(runtimeBatch, assetState);

		expect(model.parts).toHaveLength(2);
		expect(model.partsByGfxAssetId.size).toBe(1);
		expect(model.partsByGfxAssetId.get("gfx-obj/01000001")).toHaveLength(2);
	});

	it("tracks missing prepared assets and filters instances outside active landblock coverage", () => {
		const assetState = createInitialAssetChannelState();
		assetState.preparedByAssetId = {
			"setup-model/02000001": createPreparedSetupModelAsset(),
			"gfx-obj/01000001": createPreparedGfxObjAsset(
				"gfx-obj/01000001",
				0x01000001,
			),
			"landblock-statics/0102ffff": createPreparedLandblockStaticsAsset(
				0x0102ffff,
				["setup-model/02000001", "setup-model/02000002"],
			),
			"landblock-statics/0909ffff": createPreparedLandblockStaticsAsset(
				0x0909ffff,
				["gfx-obj/01000001"],
			),
		};
		const runtimeBatch = createRuntimeBatch();

		const model = deriveStaticRenderableSceneModel(runtimeBatch, assetState);

		expect(
			model.sourceInstances.map((instance) => instance.instanceId),
		).toEqual([
			"landblock-statics/0102ffff/object/0",
			"landblock-statics/0102ffff/object/1",
		]);
		expect(model.parts.map((part) => part.gfxObjAssetId)).toEqual([
			"gfx-obj/01000001",
		]);
		expect(model.missingSourceAssetIds).toEqual(["setup-model/02000002"]);
		expect(model.missingGfxAssetIds).toEqual(["gfx-obj/01000002"]);
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

function createPreparedLandblockStaticsAsset(
	landblockId: number,
	scenerySourceAssetIds: string[],
	buildingSourceAssetIds: string[] = [],
): PreparedAssetRecord {
	const assetId = `landblock-statics/${landblockId.toString(16).padStart(8, "0")}`;
	return createPreparedAsset(assetId, {
		kind: "landblock-statics",
		sourceAssetKind: "landblock-info",
		residencyKind: "outdoor-landblock",
		landblockId,
		sceneryInstances: scenerySourceAssetIds.map((sourceAssetId, index) => ({
			instanceId: `${assetId}/object/${index}`,
			owningLandblockId: landblockId,
			sourceDid: Number.parseInt(sourceAssetId.slice(-8), 16),
			sourceAssetId,
			sourceIndex: index,
			frame: createFrame({ x: 24 + index, y: 48, z: 6 }),
		})),
		buildingInstances: buildingSourceAssetIds.map((sourceAssetId, index) => ({
			instanceId: `${assetId}/building/${index}`,
			owningLandblockId: landblockId,
			sourceDid: Number.parseInt(sourceAssetId.slice(-8), 16),
			sourceAssetId,
			sourceIndex: index,
			frame: createFrame({ x: 25 + index, y: 48, z: 6 }),
			numLeaves: 1,
		})),
		provenance: {
			source: "repo-local-hba",
			sourceAssetKind: "landblock-info",
			errorCode: null,
			detail: "test",
		},
	});
}

function createPreparedSetupModelAsset(): PreparedAssetRecord {
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
		placementFrames: [
			{
				key: 0,
				frames: [
					createFrame({ x: 1, y: 0, z: 0 }),
					createFrame({ x: 0, y: 2, z: 0 }),
				],
				hookCount: 0,
			},
		],
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
			gfxObjId,
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

function createFrame(origin: Vec3Dto): FrameDto {
	return {
		origin,
		orientation: IDENTITY_FRAME.orientation,
	};
}
