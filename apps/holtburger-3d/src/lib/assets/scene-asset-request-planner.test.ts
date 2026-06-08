import { describe, expect, it } from "vitest";

import {
	describeBrowserDestinationIdentity,
	parseBrowserLocationInput,
} from "../../app/browser-mode";
import {
	formatEnvCellAssetId,
	formatLandblockOutdoorAssetId,
	formatLandblockTopologyAssetId,
} from "../landblocks";
import {
	createSceneCoverageRequests,
	deriveAllVisibleMaterialAssetIdsForBrowserDestination,
	deriveSceneCoverageAssetIds,
} from "./scene-asset-request-planner";
import { NORMALIZED_MATERIAL_TEXTURE_PREPARATION_POLICY } from "./material-texture-preparation-policy";
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
					"streaming-4-interior-cell-016c0155-landblock-016cffff-indoor-region-render-profile-region-render-profile/1",
				assetId: "region-render-profile/1",
				priority: "streaming",
			},
			{
				requestId:
					"streaming-4-interior-cell-016c0155-landblock-016cffff-indoor-static-renderable-gfx-obj/02000001",
				assetId: "gfx-obj/02000001",
				priority: "streaming",
			},
		]);
	});

	it("requests prepared setup-model part gfx dependencies and base setup appearance without graph hydration", () => {
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
			"region-render-profile/1",
			"gfx-obj/01000002",
			"setup-appearance/02000001",
		]);
	});

	it("requests setup appearance selected part gfx and material dependencies when prepared", () => {
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
		const setupAppearance = createPreparedSetupAppearance(
			"setup-appearance/02000001",
			"gfx-obj/01000003",
			["material/08000099"],
		);
		const requests = createSceneCoverageRequests(
			{
				requestRevision: 6,
				browserDestination: destination,
				preparedByAssetId: {
					[preparedTopology.request.assetId]: preparedTopology,
					[preparedEnvCell.request.assetId]: preparedEnvCell,
					[setupModel.request.assetId]: setupModel,
					[setupAppearance.request.assetId]: setupAppearance,
				},
				pendingAssetIds: [],
			},
			"streaming",
		);

		expect(requests.map((request) => request.assetId)).toEqual([
			"region-render-profile/1",
			"gfx-obj/01000003",
			"material/08000099",
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

	it("requests terrain material tables for prepared outdoor landblocks", () => {
		const destination = parseBrowserLocationInput("da55", "manual", "outdoor");
		expect(destination).not.toBeNull();

		const preparedOutdoor = createPreparedOutdoorLandblock(0xda55ffff, 1);
		const requests = createSceneCoverageRequests(
			{
				requestRevision: 9,
				browserDestination: destination,
				preparedByAssetId: {
					[preparedOutdoor.request.assetId]: preparedOutdoor,
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

		expect(requests).toContainEqual({
			requestId:
				"streaming-9-outdoor-landblock-da55ffff-terrain-material-terrain-material/1",
			assetId: "terrain-material/1",
			priority: "streaming",
		});
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
					"streaming-6-interior-cell-016c0155-landblock-016cffff-indoor-region-render-profile-region-render-profile/1",
				assetId: "region-render-profile/1",
				priority: "streaming",
			},
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
			"region-render-profile/1",
			"gfx-obj/02000001",
			"material/0800006c",
			"material/0800007e",
		]);
	});

	it("requests prepared compressed textures only for visible loaded render surfaces", () => {
		const destination = parseBrowserLocationInput("016c0155");
		expect(destination).not.toBeNull();

		const preparedTopology = createPreparedTopology(0x016cffff, [0x016c0155]);
		const preparedEnvCell = createPreparedEnvCell(0x016c0155, [
			"material/0800006c",
		]);
		const material = createPreparedMaterialRecipe(
			"material/0800006c",
			0x0800006c,
			"render-surface/0600006c",
		);
		const visibleRenderSurface = createPreparedRenderSurface(
			"render-surface/0600006c",
			0x0600006c,
			0x3154_5844,
			"Dxt1",
		);
		const unrelatedRenderSurface = createPreparedRenderSurface(
			"render-surface/0600007e",
			0x0600007e,
			0x3154_5844,
			"Dxt1",
		);

		const requests = createSceneCoverageRequests(
			{
				requestRevision: 10,
				browserDestination: destination,
				preparedByAssetId: {
					[preparedTopology.request.assetId]: preparedTopology,
					[preparedEnvCell.request.assetId]: preparedEnvCell,
					[material.request.assetId]: material,
					[visibleRenderSurface.request.assetId]: visibleRenderSurface,
					[unrelatedRenderSurface.request.assetId]: unrelatedRenderSurface,
				},
				pendingAssetIds: [],
			},
			"streaming",
		);

		expect(requests.map((request) => request.assetId)).toContain(
			"prepared-texture/0600006c?usage=raw&out=dxt1&mips=retail4&cs=source",
		);
		expect(requests.map((request) => request.assetId)).not.toContain(
			"prepared-texture/0600007e?usage=raw&out=dxt1&mips=retail4&cs=source",
		);
	});

	it("requests atlas-ready decompressed textures for staged world atlas candidates only", () => {
		const destination = parseBrowserLocationInput("016c0155");
		expect(destination).not.toBeNull();

		const preparedTopology = createPreparedTopology(0x016cffff, [0x016c0155]);
		const preparedEnvCell = createPreparedEnvCell(0x016c0155, [
			"material/0800006c",
		]);
		const material = createPreparedMaterialRecipe(
			"material/0800006c",
			0x0800006c,
			"render-surface/0600006c",
		);
		const visibleRenderSurface = createPreparedRenderSurface(
			"render-surface/0600006c",
			0x0600006c,
			0x3154_5844,
			"Dxt1",
		);

		const requests = createSceneCoverageRequests(
			{
				requestRevision: 10,
				browserDestination: destination,
				preparedByAssetId: {
					[preparedTopology.request.assetId]: preparedTopology,
					[preparedEnvCell.request.assetId]: preparedEnvCell,
					[material.request.assetId]: material,
					[visibleRenderSurface.request.assetId]: visibleRenderSurface,
				},
				pendingAssetIds: [],
				options: {
					terrainRadius: 2,
					buildingRadius: 1,
					detailRadius: 1,
					envCellRadius: 1,
					materialTexturePreparationPolicy:
						NORMALIZED_MATERIAL_TEXTURE_PREPARATION_POLICY,
				},
			},
			"streaming",
		);

		expect(requests.map((request) => request.assetId)).toContain(
			"prepared-texture/0600006c?usage=raw&out=rgba8&mips=none&cs=linear",
		);
		expect(requests.map((request) => request.assetId)).not.toContain(
			"prepared-texture/0600006c?usage=raw&out=dxt1&mips=retail4&cs=source",
		);
	});

	it("requests normalized rgba8 textures for direct-color material surfaces", () => {
		const destination = parseBrowserLocationInput("016c0155");
		expect(destination).not.toBeNull();

		const preparedTopology = createPreparedTopology(0x016cffff, [0x016c0155]);
		const preparedEnvCell = createPreparedEnvCell(0x016c0155, [
			"material/0800006c",
		]);
		const material = createPreparedMaterialRecipe(
			"material/0800006c",
			0x0800006c,
			"render-surface/0600006c",
		);
		const visibleRenderSurface = createPreparedRenderSurface(
			"render-surface/0600006c",
			0x0600006c,
			0x15,
			"A8R8G8B8",
		);

		const requests = createSceneCoverageRequests(
			{
				requestRevision: 11,
				browserDestination: destination,
				preparedByAssetId: {
					[preparedTopology.request.assetId]: preparedTopology,
					[preparedEnvCell.request.assetId]: preparedEnvCell,
					[material.request.assetId]: material,
					[visibleRenderSurface.request.assetId]: visibleRenderSurface,
				},
				pendingAssetIds: [],
				options: {
					terrainRadius: 2,
					buildingRadius: 1,
					detailRadius: 1,
					envCellRadius: 1,
					materialTexturePreparationPolicy:
						NORMALIZED_MATERIAL_TEXTURE_PREPARATION_POLICY,
				},
			},
			"streaming",
		);

		expect(requests.map((request) => request.assetId)).toContain(
			"prepared-texture/0600006c?usage=raw&out=rgba8&mips=none&cs=linear",
		);
	});

	it("requests normalized rgba8 textures for visible terrain material surfaces", () => {
		const destination = parseBrowserLocationInput("da55", "manual", "outdoor");
		expect(destination).not.toBeNull();

		const preparedOutdoor = createPreparedOutdoorLandblock(0xda55ffff, 1);
		const terrainMaterial = createPreparedTerrainMaterial(
			"terrain-material/1",
			"surface-texture/05006d06",
		);
		const terrainSurfaceTexture = createPreparedSurfaceTexture(
			"surface-texture/05006d06",
			"render-surface/06006d06",
		);
		const terrainRenderSurface = createPreparedRenderSurface(
			"render-surface/06006d06",
			0x06006d06,
			0x15,
			"A8R8G8B8",
		);

		const requests = createSceneCoverageRequests(
			{
				requestRevision: 12,
				browserDestination: destination,
				preparedByAssetId: {
					[preparedOutdoor.request.assetId]: preparedOutdoor,
					[terrainMaterial.request.assetId]: terrainMaterial,
					[terrainSurfaceTexture.request.assetId]: terrainSurfaceTexture,
					[terrainRenderSurface.request.assetId]: terrainRenderSurface,
				},
				pendingAssetIds: [],
				options: {
					terrainRadius: 0,
					buildingRadius: 0,
					detailRadius: 0,
					envCellRadius: 0,
					materialTexturePreparationPolicy:
						NORMALIZED_MATERIAL_TEXTURE_PREPARATION_POLICY,
				},
			},
			"streaming",
		);

		expect(requests.map((request) => request.assetId)).toContain(
			"prepared-texture/06006d06?usage=raw&out=rgba8&mips=none&cs=linear",
		);
	});

	it("retains visible prepared compressed textures as active coverage", () => {
		const destination = parseBrowserLocationInput("016c0155");
		expect(destination).not.toBeNull();

		const preparedTopology = createPreparedTopology(0x016cffff, [0x016c0155]);
		const preparedEnvCell = createPreparedEnvCell(0x016c0155, [
			"material/0800006c",
		]);
		const material = createPreparedMaterialRecipe(
			"material/0800006c",
			0x0800006c,
			"render-surface/0600006c",
		);
		const renderSurface = createPreparedRenderSurface(
			"render-surface/0600006c",
			0x0600006c,
			0x3554_5844,
			"Dxt5",
		);

		expect(
			deriveSceneCoverageAssetIds(destination, {
				[preparedTopology.request.assetId]: preparedTopology,
				[preparedEnvCell.request.assetId]: preparedEnvCell,
				[material.request.assetId]: material,
				[renderSurface.request.assetId]: renderSurface,
			}),
		).toContain(
			"prepared-texture/0600006c?usage=raw&out=dxt5&mips=retail4&cs=source",
		);
	});

	it("retains staged world atlas-ready decompressed textures as active coverage when requested", () => {
		const destination = parseBrowserLocationInput("016c0155");
		expect(destination).not.toBeNull();

		const preparedTopology = createPreparedTopology(0x016cffff, [0x016c0155]);
		const preparedEnvCell = createPreparedEnvCell(0x016c0155, [
			"material/0800006c",
		]);
		const material = createPreparedMaterialRecipe(
			"material/0800006c",
			0x0800006c,
			"render-surface/0600006c",
		);
		const renderSurface = createPreparedRenderSurface(
			"render-surface/0600006c",
			0x0600006c,
			0x3554_5844,
			"Dxt5",
		);

		const assetIds = deriveSceneCoverageAssetIds(
			destination,
			{
				[preparedTopology.request.assetId]: preparedTopology,
				[preparedEnvCell.request.assetId]: preparedEnvCell,
				[material.request.assetId]: material,
				[renderSurface.request.assetId]: renderSurface,
			},
			{
				terrainRadius: 2,
				buildingRadius: 1,
				detailRadius: 1,
				envCellRadius: 1,
				materialTexturePreparationPolicy:
					NORMALIZED_MATERIAL_TEXTURE_PREPARATION_POLICY,
			},
		);

		expect(assetIds).toContain(
			"prepared-texture/0600006c?usage=raw&out=rgba8&mips=none&cs=linear",
		);
		expect(assetIds).not.toContain(
			"prepared-texture/0600006c?usage=raw&out=dxt5&mips=retail4&cs=source",
		);
	});
});

function createPreparedOutdoorLandblock(
	landblockId: number,
	regionNumber: number,
): PreparedAssetRecord {
	const assetId = formatLandblockOutdoorAssetId(landblockId);
	const request = {
		requestId: `fixture-${assetId}`,
		assetId,
		priority: "streaming" as const,
	};
	const payload = {
		kind: "landblock-outdoor" as const,
		sourceAssetKind: "landblock-outdoor" as const,
		residencyKind: "outdoor-landblock" as const,
		provenance: {
			source: "repo-local-hba" as const,
			sourceAssetKind: "landblock-outdoor",
			errorCode: null,
			detail: null,
		},
		landblockId,
		regionId: 0x13000000,
		regionNumber,
		classification: "outdoor" as const,
		terrain: {
			gridSize: 0,
			tileSize: 24,
			vertices: [],
			triangles: [],
			quads: [],
			terrainBvh: {
				coordinateSpace: "landblock-outdoor-terrain-local" as const,
				nodes: [],
				items: [],
			},
			minHeight: 0,
			maxHeight: 0,
			bounds: null,
		},
		statics: [],
		outdoorBvh: null,
		dependencies: {
			renderableSourceAssetIds: [],
			materialAssetIds: [],
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
		regionId: 0x13000000,
		regionNumber: 1,
		environmentId: 0x0d000001,
		cellStructureId: 1,
		localPlacement: {
			origin: { x: 0, y: 0, z: 0 },
			orientation: { w: 1, x: 0, y: 0, z: 0 },
		},
		surfaces: materialAssetIds.map((materialAssetId, index) => ({
			slotId: index,
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

function createPreparedSetupAppearance(
	assetId: string,
	gfxObjAssetId: string,
	materialAssetIds: string[],
): PreparedAssetRecord {
	const request = {
		requestId: `fixture-${assetId}`,
		assetId,
		priority: "streaming" as const,
	};
	const payload = {
		kind: "setup-appearance" as const,
		sourceAssetKind: "setup-appearance" as const,
		residencyKind: "unknown" as const,
		provenance: {
			source: "repo-local-hba" as const,
			sourceAssetKind: "setup-appearance",
			errorCode: null,
			detail: null,
		},
		setupModelId: 0x02000001,
		appearanceKey: "setup-appearance/02000001",
		parts: [
			{
				partIndex: 0,
				gfxObjId: 0x01000003,
				gfxObjAssetId,
				materialSlots: materialAssetIds.map((materialAssetId, slotIndex) => ({
					slotIndex,
					surfaceId: Number.parseInt(
						materialAssetId.slice("material/".length),
						16,
					),
					materialAssetId,
				})),
			},
		],
		textureChanges: [],
		animPartChanges: [],
		paletteId: null,
		subPalettes: [],
		dependencies: {
			materialAssetIds,
			paletteAssetIds: [],
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

function createPreparedMaterialRecipe(
	assetId: string,
	surfaceId: number,
	renderSurfaceAssetId: string,
): PreparedAssetRecord {
	const request = {
		requestId: `fixture-${assetId}`,
		assetId,
		priority: "streaming" as const,
	};
	const renderSurfaceId = Number.parseInt(
		renderSurfaceAssetId.slice("render-surface/".length),
		16,
	);
	const payload = {
		kind: "material-recipe" as const,
		sourceAssetKind: "material-recipe" as const,
		residencyKind: "unknown" as const,
		provenance: {
			source: "repo-local-hba" as const,
			sourceAssetKind: "material-recipe",
			errorCode: null,
			detail: null,
		},
		surfaceId,
		surfaceType: 2,
		source: {
			kind: "texture" as const,
			surfaceTextureId: 0x05000001,
			selectedRenderSurfaceId: renderSurfaceId,
			paletteId: null,
			renderSurfaceDefaultPaletteIds: [],
		},
		translucency: 1,
		luminosity: 0,
		diffuse: 1,
		dependencies: {
			surfaceTextureAssetIds: [],
			renderSurfaceAssetIds: [renderSurfaceAssetId],
			paletteAssetIds: [],
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

function createPreparedTerrainMaterial(
	assetId: string,
	textureAssetId: string,
): PreparedAssetRecord {
	const request = {
		requestId: `fixture-${assetId}`,
		assetId,
		priority: "streaming" as const,
	};
	const textureId = Number.parseInt(
		textureAssetId.slice("surface-texture/".length),
		16,
	);
	const payload = {
		kind: "terrain-material" as const,
		sourceAssetKind: "terrain-material" as const,
		residencyKind: "unknown" as const,
		provenance: {
			source: "repo-local-hba" as const,
			sourceAssetKind: "terrain-material",
			errorCode: null,
			detail: null,
		},
		regionNumber: 1,
		materialKind: "tex-merge-table" as const,
		terrainTypes: [
			{
				terrainType: 1,
				textureAssetId,
				textureDid: textureId,
				tiling: 4,
				colorVariation: null,
			},
		],
		terrainAlphaMaps: [],
		roadAlphaMaps: [],
		pcodeEncoding: {
			terrainCodeBits: 5 as const,
			roadCodeBits: 2 as const,
			sizeBitMask: 1 << 28,
		},
		dependencies: {
			surfaceTextureAssetIds: [textureAssetId],
			renderSurfaceAssetIds: [],
			paletteAssetIds: [],
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

function createPreparedSurfaceTexture(
	assetId: string,
	renderSurfaceAssetId: string,
): PreparedAssetRecord {
	const request = {
		requestId: `fixture-${assetId}`,
		assetId,
		priority: "streaming" as const,
	};
	const textureId = Number.parseInt(
		assetId.slice("surface-texture/".length),
		16,
	);
	const renderSurfaceId = Number.parseInt(
		renderSurfaceAssetId.slice("render-surface/".length),
		16,
	);
	const payload = {
		kind: "surface-texture" as const,
		sourceAssetKind: "surface-texture" as const,
		residencyKind: "unknown" as const,
		provenance: {
			source: "repo-local-hba" as const,
			sourceAssetKind: "surface-texture",
			errorCode: null,
			detail: null,
		},
		surfaceTextureId: textureId,
		textureType: 0,
		unknown: 0,
		selectedRenderSurfaceId: renderSurfaceId,
		renderSurfaceIds: [renderSurfaceId],
		dependencies: {
			renderSurfaceAssetIds: [renderSurfaceAssetId],
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

function createPreparedRenderSurface(
	assetId: string,
	renderSurfaceId: number,
	formatRaw: number,
	format: string,
): PreparedAssetRecord {
	const request = {
		requestId: `fixture-${assetId}`,
		assetId,
		priority: "streaming" as const,
	};
	const payload = {
		kind: "render-surface" as const,
		sourceAssetKind: "render-surface" as const,
		residencyKind: "unknown" as const,
		provenance: {
			source: "repo-local-hba" as const,
			sourceAssetKind: "render-surface",
			errorCode: null,
			detail: null,
		},
		renderSurfaceId,
		unknown: 0,
		width: 128,
		height: 128,
		formatRaw,
		format,
		sourceByteLength: 8192,
		sourceBytes: new Uint8Array(8192),
		defaultPaletteId: null,
		dependencies: {
			paletteAssetIds: [],
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
