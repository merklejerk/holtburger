import { Vector3 } from "three";
import { describe, expect, it } from "vitest";

import type { BrowserLocationSelection } from "../../app/browser-mode";
import {
	createInitialAssetChannelState,
	type AssetChannelState,
	type PreparedAssetProvenance,
	type PreparedAssetRecord,
	type PreparedEnvCellPayload,
	type PreparedGfxObjPayload,
	type PreparedLandblockOutdoorPayload,
	type PreparedPolygonSetRenderGeometry,
	type PreparedSetupModelPayload,
} from "../assets/types";
import { formatEnvCellAssetId, formatLandblockOutdoorAssetId } from "../landblocks";
import { buildStaticRenderablePartMatrix } from "./static-renderable-geometry";
import { deriveStaticRenderableSceneModel } from "./static-renderables";

describe("static renderables", () => {
	it("places indoor static objects from their STAB frame without reapplying the env-cell frame", () => {
		const envCellId = 0x00070100;
		const sourceDid = 0x01000001;
		const assetState = createAssetState([
			createEnvCellRecord({
				envCellId,
				localPlacement: createPlacement({ x: 80, y: 90, z: 10 }),
				staticPlacement: createPlacement({ x: 12, y: 34, z: 6 }),
				sourceDid,
			}),
			createGfxObjRecord(sourceDid),
		]);
		const scene = deriveStaticRenderableSceneModel(
			assetState,
			createInteriorDestination(envCellId),
		);
		const part = scene.parts[0];

		expect(part?.parentPlacements).toEqual([]);

		const position = new Vector3().setFromMatrixPosition(
			buildStaticRenderablePartMatrix(part!),
		);
		expect(position).toEqual(new Vector3(12, 6, -34));
	});

	it("applies setup-model default placement frames to static parts", () => {
		const envCellId = 0x00070100;
		const setupDid = 0x02000001;
		const gfxObjId = 0x01000001;
		const assetState = createAssetState([
			createEnvCellRecord({
				envCellId,
				localPlacement: createPlacement({ x: 0, y: 0, z: 0 }),
				staticPlacement: createPlacement({ x: 10, y: 20, z: 2 }),
				sourceDid: setupDid,
			}),
			createSetupModelRecord({
				setupModelId: setupDid,
				gfxObjId,
				partPlacement: createPlacement({ x: 3, y: 4, z: 5 }),
			}),
			createGfxObjRecord(gfxObjId),
		]);
		const scene = deriveStaticRenderableSceneModel(
			assetState,
			createInteriorDestination(envCellId),
		);
		const part = scene.parts[0];

		expect(part?.partPlacements).toEqual([
			createPlacement({ x: 3, y: 4, z: 5 }),
		]);

		const position = new Vector3().setFromMatrixPosition(
			buildStaticRenderablePartMatrix(part!),
		);
		expect(position).toEqual(new Vector3(13, 7, -24));
	});

	it("normalizes outdoor static placements that cross landblock edges", () => {
		const landblockId = 0x0203ffff;
		const sourceDid = 0x01000001;
		const assetState = createAssetState([
			createLandblockOutdoorRecord({
				landblockId,
				localPlacement: createPlacement({ x: 200, y: -5, z: 2 }),
				sourceDid,
			}),
			createGfxObjRecord(sourceDid),
		]);
		const scene = deriveStaticRenderableSceneModel(
			assetState,
			createOutdoorDestination(landblockId),
			1,
		);
		const part = scene.parts[0];

		expect(part?.owningLandblockId).toBe(0x0302ffff);
		expect(part?.chunkLocalInstancePlacement.origin).toEqual({
			x: 8,
			y: 187,
			z: 2,
		});

		const position = new Vector3().setFromMatrixPosition(
			buildStaticRenderablePartMatrix(part!),
		);
		expect(position).toEqual(new Vector3(8, 2, -187));
	});
});

const PROVENANCE: PreparedAssetProvenance = {
	source: "repo-local-hba",
	sourceAssetKind: null,
	errorCode: null,
	detail: null,
};

function createAssetState(records: PreparedAssetRecord[]): AssetChannelState {
	const state = createInitialAssetChannelState();
	state.preparedByAssetId = Object.fromEntries(
		records.map((record) => [record.request.assetId, record]),
	);
	return state;
}

function createInteriorDestination(envCellId: number): BrowserLocationSelection {
	return {
		kind: "interior-cell",
		label: `0x${envCellId.toString(16).padStart(8, "0")}`,
		source: "manual",
		envCellId,
		landblockId: envCellId & 0xffff0000,
	};
}

function createOutdoorDestination(landblockId: number): BrowserLocationSelection {
	return {
		kind: "outdoor-location",
		label: "24.00N, 36.00E, 0.0Z",
		source: "manual",
		northSouth: 24,
		northSouthHemisphere: "N",
		eastWest: 36,
		eastWestHemisphere: "E",
		elevation: 0,
		landblockId,
	};
}

function createLandblockOutdoorRecord(options: {
	landblockId: number;
	localPlacement: PreparedLandblockOutdoorPayload["statics"][number]["localPlacement"];
	sourceDid: number;
}): PreparedAssetRecord {
	const assetId = formatLandblockOutdoorAssetId(options.landblockId);
	return {
		request: { requestId: assetId, assetId, priority: "bootstrap" },
		response: {
			requestId: assetId,
			assetId,
			payloadKind: "json",
			payload: null,
		},
		preparedAt: "test",
		payload: {
			kind: "landblock-outdoor",
			sourceAssetKind: "landblock-outdoor",
			residencyKind: "outdoor-landblock",
			provenance: PROVENANCE,
			landblockId: options.landblockId,
			regionId: 0,
			regionNumber: 0,
			classification: "outdoor",
			terrain: {
				gridSize: 0,
				tileSize: 24,
				vertices: [],
				triangles: [],
				quads: [],
				terrainBvh: { coordinateSpace: "landblock-render-local", nodes: [], items: [] },
				minHeight: 0,
				maxHeight: 0,
				bounds: null,
			},
			statics: [
				{
					kind: "explicit-object",
					instanceId: "outdoor-static",
					sourceDid: options.sourceDid,
					sourceAssetId: formatStaticSourceAssetId(options.sourceDid),
					sourceIndex: 0,
					localPlacement: options.localPlacement,
					sourceScale: { x: 1, y: 1, z: 1 },
					sourceBounds: null,
					instanceBounds: null,
					building: null,
					generated: null,
				},
			],
			outdoorBvh: null,
			diagnostics: {
				sourceRecords: [],
				omissions: [],
				errors: [],
			},
		},
	};
}

function createEnvCellRecord(options: {
	envCellId: number;
	localPlacement: PreparedEnvCellPayload["localPlacement"];
	staticPlacement: PreparedEnvCellPayload["localPlacement"];
	sourceDid: number;
}): PreparedAssetRecord {
	const assetId = formatEnvCellAssetId(options.envCellId);
	return {
		request: { requestId: assetId, assetId, priority: "bootstrap" },
		response: {
			requestId: assetId,
			assetId,
			payloadKind: "json",
			payload: null,
		},
		preparedAt: "test",
		payload: {
			kind: "env-cell",
			sourceAssetKind: "env-cell",
			residencyKind: "interior-cell",
			provenance: PROVENANCE,
			envCellId: options.envCellId,
			environmentId: 0x0d000001,
			cellStructureId: 0x0001,
			localPlacement: options.localPlacement,
			surfaces: [],
			portals: [],
			visibleEnvCellIds: [],
			portalApertures: [],
			statics: [
				{
					instanceId: "indoor-static",
					sourceDid: options.sourceDid,
					sourceAssetId: formatStaticSourceAssetId(options.sourceDid),
					sourceIndex: 0,
					localPlacement: options.staticPlacement,
					sourceScale: { x: 1, y: 1, z: 1 },
					sourceBounds: null,
					instanceBounds: null,
				},
			],
			renderGeometry: createEmptyRenderGeometry(),
			cellBsp: null,
			localBvh: {
				coordinateSpace: "env-cell-local",
				nodes: [],
				items: [],
			},
		},
	};
}

function createGfxObjRecord(gfxObjId: number): PreparedAssetRecord {
	const assetId = formatGfxObjAssetId(gfxObjId);
	return {
		request: { requestId: assetId, assetId, priority: "bootstrap" },
		response: {
			requestId: assetId,
			assetId,
			payloadKind: "json",
			payload: null,
		},
		preparedAt: "test",
		payload: {
			kind: "gfx-obj",
			sourceAssetKind: "gfx-obj",
			residencyKind: "unknown",
			provenance: PROVENANCE,
			gfxObjId,
			flags: null,
			surfaceIds: [],
			vertexArray: { vertexType: null, vertexCount: 0, vertices: [] },
			drawingPolygons: [],
			drawingBsp: null,
			physicsWitness: { polygonCount: 0, hasBsp: false },
			renderGeometry: createEmptyRenderGeometry(),
			sortCenter: null,
			didDegrade: null,
		},
	};
}

function createSetupModelRecord(options: {
	setupModelId: number;
	gfxObjId: number;
	partPlacement: PreparedSetupModelPayload["placementSets"][number]["localPlacements"][number];
}): PreparedAssetRecord {
	const assetId = formatSetupModelAssetId(options.setupModelId);
	return {
		request: { requestId: assetId, assetId, priority: "bootstrap" },
		response: {
			requestId: assetId,
			assetId,
			payloadKind: "json",
			payload: null,
		},
		preparedAt: "test",
		payload: {
			kind: "setup-model",
			sourceAssetKind: "setup-model",
			residencyKind: "unknown",
			provenance: PROVENANCE,
			setupModelId: options.setupModelId,
			flags: null,
			parts: [
				{
					partIndex: 0,
					gfxObjId: options.gfxObjId,
					gfxObjAssetId: formatGfxObjAssetId(options.gfxObjId),
					parentIndex: null,
					scale: null,
				},
			],
			holdingLocations: [],
			connectionPoints: [],
			placementSets: [
				{
					key: 0x65,
					localPlacements: [options.partPlacement],
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
			dependencies: {
				gfxObjAssetIds: [formatGfxObjAssetId(options.gfxObjId)],
			},
		},
	};
}

function createEmptyRenderGeometry(): PreparedPolygonSetRenderGeometry {
	return {
		sourceId: 0,
		vertexCount: 0,
		triangleCount: 0,
		positions: new Float32Array(),
		normals: new Float32Array(),
		uvs: new Float32Array(),
		triangles: [],
		surfaceIds: [],
		invalidPolygons: [],
		skippedPolygonCount: 0,
		bounds: null,
	};
}

function formatGfxObjAssetId(gfxObjId: number): string {
	return `gfx-obj/${gfxObjId.toString(16).padStart(8, "0")}`;
}

function formatSetupModelAssetId(setupModelId: number): string {
	return `setup-model/${setupModelId.toString(16).padStart(8, "0")}`;
}

function formatStaticSourceAssetId(sourceDid: number): string {
	return sourceDid >>> 24 === 0x02
		? formatSetupModelAssetId(sourceDid)
		: formatGfxObjAssetId(sourceDid);
}

function createPlacement(origin: { x: number; y: number; z: number }) {
	return {
		origin,
		orientation: { w: 1, x: 0, y: 0, z: 0 },
	};
}
