import { describe, expect, it } from "vitest";

import {
	describeBrowserDestinationIdentity,
	parseBrowserLocationInput,
} from "../../app/browser-mode";
import {
	formatEnvCellAssetId,
	formatLandblockTopologyAssetId,
} from "../landblocks";
import {
	createSceneCoverageRequests,
	deriveAllVisibleMaterialAssetIdsForBrowserDestination,
	deriveSceneCoverageAssetIds,
} from "./scene-asset-request-planner";
import type { PreparedAssetRecord } from "./types";

describe("scene asset request planner", () => {
	it("derives outdoor browser coverage from destination and radii", () => {
		const destination = parseBrowserLocationInput("da55", "manual", "outdoor");
		expect(destination).not.toBeNull();

		const requests = createSceneCoverageRequests(
			{
				requestRevision: 7,
				browserDestination: destination,
				preparedByAssetId: {},
				options: {
					terrainRadius: 1,
					buildingRadius: 0,
					detailRadius: 0,
					envCellRadius: 0,
				},
			},
			"streaming",
		);

		expect(requests.map((request) => request.assetId)).toEqual([
			"landblock/d954ffff/outdoor",
			"landblock/d955ffff/outdoor",
			"landblock/d956ffff/outdoor",
			"landblock/da54ffff/outdoor",
			"landblock/da55ffff/outdoor",
			"landblock/da56ffff/outdoor",
			"landblock/db54ffff/outdoor",
			"landblock/db55ffff/outdoor",
			"landblock/db56ffff/outdoor",
			"landblock/da55ffff/topology",
		]);
		expect(requests[0]?.requestId).toBe(
			"streaming-7-outdoor-landblock-da55ffff-outdoor-landblock/d954ffff/outdoor",
		);
	});

	it("keeps destination identity stable across source labels", () => {
		const manualDestination = parseBrowserLocationInput(
			"da55",
			"manual",
			"outdoor",
		);
		const pickedDestination = parseBrowserLocationInput(
			"da55",
			"landblock-pick",
			"outdoor",
		);

		expect(describeBrowserDestinationIdentity(manualDestination)).toBe(
			describeBrowserDestinationIdentity(pickedDestination),
		);
	});

	it("derives dungeon browser coverage from the owning landblock pack", () => {
		const destination = parseBrowserLocationInput("016c0155");
		expect(destination).not.toBeNull();

		const requests = createSceneCoverageRequests(
			{
				requestRevision: 3,
				browserDestination: destination,
				preparedByAssetId: {},
				options: {
					terrainRadius: 2,
					buildingRadius: 1,
					detailRadius: 1,
					envCellRadius: 1,
				},
			},
			"bootstrap",
		);

		expect(requests).toEqual([
			{
				requestId:
					"bootstrap-3-interior-cell-016c0155-landblock-016cffff-topology-landblock/016cffff/topology",
				assetId: "landblock/016cffff/topology",
				priority: "bootstrap",
			},
			{
				requestId:
					"bootstrap-3-interior-cell-016c0155-landblock-016cffff-env-cell-env-cell/016c0155",
				assetId: "env-cell/016c0155",
				priority: "bootstrap",
			},
		]);
		expect(deriveSceneCoverageAssetIds(destination, {})).toEqual([
			"landblock/016cffff/topology",
		]);
	});

	it("requests dungeon static dependencies from prepared pack cells", () => {
		const destination = parseBrowserLocationInput("016c0155");
		expect(destination).not.toBeNull();

		const preparedTopology = createPreparedTopology(0x016cffff, [0x016c0155]);
		const preparedEnvCell = createPreparedEnvCell(
			0x016c0155,
			[],
			["gfx-obj/02000001"],
		);
		const requests = createSceneCoverageRequests(
			{
				requestRevision: 4,
				browserDestination: destination,
				preparedByAssetId: {
					[preparedTopology.request.assetId]: preparedTopology,
					[preparedEnvCell.request.assetId]: preparedEnvCell,
				},
				pendingAssetIds: [],
			},
			"streaming",
		);

		expect(requests).toEqual([
			{
				requestId:
					"streaming-4-interior-cell-016c0155-landblock-016cffff-indoor-static-renderable-gfx-obj/02000001",
				assetId: "gfx-obj/02000001",
				priority: "streaming",
			},
		]);
	});

	it("requests prepared setup-model part gfx dependencies without graph hydration", () => {
		const destination = parseBrowserLocationInput("016c0155");
		expect(destination).not.toBeNull();

		const preparedTopology = createPreparedTopology(0x016cffff, [0x016c0155]);
		const preparedEnvCell = createPreparedEnvCell(
			0x016c0155,
			[],
			["setup-model/02000001"],
		);
		const setupModel = createPreparedSetupModel(
			"setup-model/02000001",
			"gfx-obj/01000002",
		);
		const requests = createSceneCoverageRequests(
			{
				requestRevision: 5,
				browserDestination: destination,
				preparedByAssetId: {
					[preparedTopology.request.assetId]: preparedTopology,
					[preparedEnvCell.request.assetId]: preparedEnvCell,
					[setupModel.request.assetId]: setupModel,
				},
				pendingAssetIds: [],
			},
			"streaming",
		);

		expect(requests.map((request) => request.assetId)).toEqual([
			"gfx-obj/01000002",
		]);
	});

	it("requests outdoor-linked env-cell static dependencies", () => {
		const destination = parseBrowserLocationInput("da55", "manual", "outdoor");
		expect(destination).not.toBeNull();

		const preparedTopology = createPreparedTopology(0xda55ffff, [0xda55010b]);
		const preparedEnvCell = createPreparedEnvCell(
			0xda55010b,
			[],
			["setup-model/020000a7"],
		);
		const setupModel = createPreparedSetupModel(
			"setup-model/020000a7",
			"gfx-obj/010007b7",
		);
		const requests = createSceneCoverageRequests(
			{
				requestRevision: 8,
				browserDestination: destination,
				preparedByAssetId: {
					[preparedTopology.request.assetId]: preparedTopology,
					[preparedEnvCell.request.assetId]: preparedEnvCell,
					[setupModel.request.assetId]: setupModel,
				},
				pendingAssetIds: [],
				options: {
					terrainRadius: 0,
					buildingRadius: 0,
					detailRadius: 0,
					envCellRadius: 0,
				},
			},
			"streaming",
		);

		expect(requests.map((request) => request.assetId)).toContain(
			"gfx-obj/010007b7",
		);
	});

	it("requests material graphs for prepared static gfx dependencies", () => {
		const destination = parseBrowserLocationInput("016c0155");
		expect(destination).not.toBeNull();

		const preparedTopology = createPreparedTopology(0x016cffff, [0x016c0155]);
		const preparedEnvCell = createPreparedEnvCell(
			0x016c0155,
			[],
			["gfx-obj/02000001"],
		);
		const gfxObj = createPreparedGfxObj("gfx-obj/02000001", [
			"material/0800006c",
			"material/0800007e",
		]);
		const requests = createSceneCoverageRequests(
			{
				requestRevision: 6,
				browserDestination: destination,
				preparedByAssetId: {
					[preparedTopology.request.assetId]: preparedTopology,
					[preparedEnvCell.request.assetId]: preparedEnvCell,
					[gfxObj.request.assetId]: gfxObj,
				},
				pendingAssetIds: [],
			},
			"streaming",
		);

		expect(requests).toEqual([
			{
				requestId:
					"streaming-6-interior-cell-016c0155-landblock-016cffff-indoor-static-material-material/0800006c",
				assetId: "material/0800006c",
				priority: "streaming",
			},
			{
				requestId:
					"streaming-6-interior-cell-016c0155-landblock-016cffff-indoor-static-material-material/0800007e",
				assetId: "material/0800007e",
				priority: "streaming",
			},
		]);
		expect(
			deriveAllVisibleMaterialAssetIdsForBrowserDestination({
				browserDestination: destination,
				preparedByAssetId: {
					[preparedTopology.request.assetId]: preparedTopology,
					[preparedEnvCell.request.assetId]: preparedEnvCell,
					[gfxObj.request.assetId]: gfxObj,
				},
			}),
		).toEqual(["material/0800006c", "material/0800007e"]);
	});

	it("requests material graphs for active structured interior cell surfaces", () => {
		const destination = parseBrowserLocationInput("016c0155");
		expect(destination).not.toBeNull();

		const preparedTopology = createPreparedTopology(0x016cffff, [0x016c0155]);
		const preparedEnvCell = createPreparedEnvCell(
			0x016c0155,
			["material/0800006c", "material/0800007e"],
			["gfx-obj/02000001"],
		);
		const requests = createSceneCoverageRequests(
			{
				requestRevision: 7,
				browserDestination: destination,
				preparedByAssetId: {
					[preparedTopology.request.assetId]: preparedTopology,
					[preparedEnvCell.request.assetId]: preparedEnvCell,
				},
				pendingAssetIds: [],
			},
			"streaming",
		);

		expect(requests.map((request) => request.assetId)).toEqual([
			"gfx-obj/02000001",
			"material/0800006c",
			"material/0800007e",
		]);
	});
});

function createPreparedTopology(
	landblockId: number,
	envCellIds: number[],
): PreparedAssetRecord {
	const assetId = formatLandblockTopologyAssetId(landblockId);
	const request = {
		requestId: `fixture-${assetId}`,
		assetId,
		priority: "streaming" as const,
	};
	const payload = {
		kind: "landblock-topology" as const,
		sourceAssetKind: "landblock-topology" as const,
		residencyKind: "landblock" as const,
		provenance: {
			source: "repo-local-hba" as const,
			sourceAssetKind: "landblock-topology",
			errorCode: null,
			detail: null,
		},
		landblockId,
		landblockInfoId: landblockId & 0xffff_fffe,
		classification: "dungeon" as const,
		envCells: envCellIds.map((envCellId) => ({
			memberId: `env-cell/${envCellId.toString(16).padStart(8, "0")}`,
			envCellId,
			assetId: formatEnvCellAssetId(envCellId),
			localPlacement: {
				origin: { x: 0, y: 0, z: 0 },
				orientation: { w: 1, x: 0, y: 0, z: 0 },
			},
			visibleEnvCellIds: [],
			restrictionObjectId: null,
			seenOutside: null,
		})),
		portalLinks: [],
		envCellResidencyBvh: {
			coordinateSpace: "landblock-topology-residency" as const,
			nodes: [],
			items: [],
		},
		diagnostics: { sourceRecords: [], errors: [], omissions: [] },
	};
	return {
		request,
		response: {
			requestId: request.requestId,
			assetId,
			payloadKind: "json",
			payload,
		},
		payload,
		preparedAt: "2026-05-23T00:00:00.000Z",
	};
}

function createPreparedEnvCell(
	envCellId: number,
	materialAssetIds: string[],
	sourceAssetIds: string[] = [],
): PreparedAssetRecord {
	const assetId = formatEnvCellAssetId(envCellId);
	const request = {
		requestId: `fixture-${assetId}`,
		assetId,
		priority: "streaming" as const,
	};
	const payload = {
		kind: "env-cell" as const,
		sourceAssetKind: "env-cell" as const,
		residencyKind: "interior-cell" as const,
		provenance: {
			source: "repo-local-hba" as const,
			sourceAssetKind: "env-cell",
			errorCode: null,
			detail: null,
		},
		envCellId,
		environmentId: 0x0d000001,
		cellStructureId: 1,
		localPlacement: {
			origin: { x: 0, y: 0, z: 0 },
			orientation: { w: 1, x: 0, y: 0, z: 0 },
		},
		surfaces: materialAssetIds.map((materialAssetId, index) => ({
			slotId: index + 1,
			surfaceId: Number.parseInt(materialAssetId.slice("material/".length), 16),
			materialAssetId,
		})),
		portals: [],
		visibleEnvCellIds: [],
		portalApertures: [],
		statics: sourceAssetIds.map((sourceAssetId, index) => ({
			instanceId: `fixture-indoor-static-${index}`,
			sourceDid: 0x02000001,
			sourceAssetId,
			sourceIndex: index,
			localPlacement: {
				origin: { x: 0, y: 0, z: 0 },
				orientation: { w: 1, x: 0, y: 0, z: 0 },
			},
			sourceScale: { x: 1, y: 1, z: 1 },
			sourceBounds: null,
			instanceBounds: null,
		})),
		renderGeometry: {
			sourceId: 1,
			vertexCount: 0,
			triangleCount: 0,
			positions: [],
			normals: [],
			uvs: [],
			triangles: [],
			surfaceIds: [],
			invalidPolygons: [],
			skippedPolygonCount: 0,
			bounds: null,
		},
		cellBsp: {
			kind: "leaf" as const,
			index: 0,
			solid: 0,
			sphere: null,
			polyIds: [],
		},
		localBvh: {
			coordinateSpace: "env-cell-local" as const,
			nodes: [],
			items: [],
		},
		dependencies: {
			renderableSourceAssetIds: sourceAssetIds,
			materialAssetIds,
		},
	};
	return {
		request,
		response: {
			requestId: request.requestId,
			assetId,
			payloadKind: "json",
			payload,
		},
		payload,
		preparedAt: "2026-05-23T00:00:00.000Z",
	};
}

function createPreparedSetupModel(
	assetId: string,
	gfxObjAssetId: string,
): PreparedAssetRecord {
	const request = {
		requestId: `fixture-${assetId}`,
		assetId,
		priority: "streaming" as const,
	};
	const payload = {
		kind: "setup-model" as const,
		sourceAssetKind: "setup-model" as const,
		residencyKind: "unknown" as const,
		provenance: {
			source: "repo-local-hba" as const,
			sourceAssetKind: "setup-model",
			errorCode: null,
			detail: null,
		},
		setupModelId: 0x02000001,
		flags: null,
		parts: [
			{
				partIndex: 0,
				gfxObjId: 0x01000002,
				gfxObjAssetId,
				parentIndex: null,
				scale: null,
			},
		],
		holdingLocations: [],
		connectionPoints: [],
		placementSets: [],
		collisionWitness: { cylSphereCount: 0, sphereCount: 0 },
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
			gfxObjAssetIds: [gfxObjAssetId],
		},
	};
	return {
		request,
		response: {
			requestId: request.requestId,
			assetId,
			payloadKind: "json",
			payload,
		},
		payload,
		preparedAt: "2026-05-23T00:00:00.000Z",
	};
}

function createPreparedGfxObj(
	assetId: string,
	materialAssetIds: string[],
): PreparedAssetRecord {
	const request = {
		requestId: `fixture-${assetId}`,
		assetId,
		priority: "streaming" as const,
	};
	const payload = {
		kind: "gfx-obj" as const,
		sourceAssetKind: "gfx-obj" as const,
		residencyKind: "unknown" as const,
		provenance: {
			source: "repo-local-hba" as const,
			sourceAssetKind: "gfx-obj",
			errorCode: null,
			detail: null,
		},
		gfxObjId: 0x02000001,
		flags: null,
		surfaceIds: materialAssetIds.map((assetId) =>
			Number.parseInt(assetId.slice("material/".length), 16),
		),
		vertexArray: {
			vertexType: 0,
			vertexCount: 0,
			vertices: [],
		},
		drawingPolygons: [],
		drawingBsp: null,
		dependencies: {
			materialAssetIds,
		},
		physicsWitness: {
			polygonCount: 0,
			hasBsp: false,
			rootKind: null,
		},
		renderGeometry: {
			sourceId: 0x02000001,
			vertexCount: 0,
			triangleCount: 0,
			positions: [],
			normals: [],
			uvs: [],
			triangles: [],
			surfaceIds: [],
			bounds: null,
		},
		sortCenter: null,
		didDegrade: null,
	};
	return {
		request,
		response: {
			requestId: request.requestId,
			assetId,
			payloadKind: "json",
			payload,
		},
		payload,
		preparedAt: "2026-05-23T00:00:00.000Z",
	};
}
