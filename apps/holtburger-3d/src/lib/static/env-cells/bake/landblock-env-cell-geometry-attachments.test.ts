import { describe, expect, it } from "vitest";
import type { LandblockEnvCellsPayloadDto } from "../../../../lib/host/contracts";
import type {
	HostAssetKey,
	PreparedAsset,
} from "../../../assets/contracts";
import type { ResolverLandblockEnvCellsPayloadDto } from "../../../assets/preparation/env-cell-views";
import { createResolverEnvCellPreparedAssetView } from "../../../assets/preparation/env-cell-views";
import { createHostAssetKey, describeHostAssetKey } from "../../../assets/keys";
import type {
	LandblockEnvCellsStaticScopePayload,
	StaticBakeAttachmentRequest,
} from "../../contracts";
import { LandblockEnvCellGeometryAttachmentProvider } from "./landblock-env-cell-geometry-attachments";

describe("browser landblock env-cell geometry attachments", () => {
	it("attaches full cell-structure geometry from resolved source payloads", async () => {
		const key = createHostAssetKey("landblock-env-cells", 0xda55ffff);
		const fullAsset = createPreparedAsset(
			key,
			createLandblockEnvCellsPayload(),
		);
		const fullPayload = fullAsset.payload as LandblockEnvCellsPayloadDto;
		const provider = new LandblockEnvCellGeometryAttachmentProvider();

		const attachments = await provider.createAttachments(
			createAttachmentRequest(fullPayload),
		);

		expect(attachments.staticObjectSourceGeometry).toEqual([]);
		expect(attachments.envCellCellStructureGeometry).toEqual([
			expect.objectContaining({
				identity: {
					cellStructure: {
						cellStructureId: 0x0d000020,
						kind: "cell-structure",
					},
					envCell: {
						envCellId: 0xda550100,
						kind: "env-cell-source",
					},
					environment: {
						environmentId: 0x0e000010,
						kind: "environment",
					},
					kind: "env-cell-cell-structure-geometry",
					landblockId: 0xda55ffff,
				},
				normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
				positions: new Float32Array([1, 2, 3, 4, 5, 6, 7, 8, 9]),
				sourceId: 0xda550100,
				surfaceIds: [10],
				triangleCount: 1,
				triangles: [
					{
						firstVertex: 0,
						materialVariantSignature: "variant-a",
						polygonId: 17,
						surfaceId: 10,
					},
				],
				uvs: new Float32Array([0, 0, 1, 0, 0, 1]),
				vertexCount: 3,
			}),
		]);
	});

	it("fails if the host-backed asset reader returns resolver-light geometry", async () => {
		const key = createHostAssetKey("landblock-env-cells", 0xda55ffff);
		const fullAsset = createPreparedAsset(
			key,
			createLandblockEnvCellsPayload(),
		);
		const resolverAsset = createResolverEnvCellPreparedAssetView(fullAsset);
		const resolverPayload =
			resolverAsset.payload as ResolverLandblockEnvCellsPayloadDto;
		const provider = new LandblockEnvCellGeometryAttachmentProvider();

		await expect(
			provider.createAttachments(createAttachmentRequest(resolverPayload)),
		).rejects.toThrow(
			"resolved metadata-only render geometry; full positions, normals, and UVs are required for bake attachments",
		);
	});
});

function createAttachmentRequest(
	payload: LandblockEnvCellsPayloadDto | ResolverLandblockEnvCellsPayloadDto,
): StaticBakeAttachmentRequest {
	const domain = "landblock-env-cells";
	const job = {
		domain,
		scope: {
			kind: "landblock" as const,
			landblockId: payload.landblockId,
		},
	};
	const work = {
		job,
		priority: 0,
		revision: 1,
		workId: "work:env-cell-geometry-attachments",
	};

	return {
		domain,
		items: [
			{
				payload: {
					job,
					scope: createScopePayload(payload),
					sourceRevision: 1,
				},
				work,
			},
		],
		revision: 1,
		staticBatchId: "static-batch:env-cell-geometry",
	};
}

function createScopePayload(
	payload: LandblockEnvCellsPayloadDto | ResolverLandblockEnvCellsPayloadDto,
): LandblockEnvCellsStaticScopePayload {
	return {
		acceptedEnvCellIds: payload.envCells.map((cell) => cell.envCellId),
		envCells: payload.envCells.map((cell) => ({
			cellBsp: cell.cellBsp,
			cellStructure: {
				cellStructureId: cell.cellStructureId,
				kind: "cell-structure",
			},
			environment: {
				environmentId: cell.environmentId,
				kind: "environment",
			},
			identity: {
				envCellId: cell.envCellId,
				kind: "env-cell-source",
			},
			landblockId: payload.landblockId,
			localPlacement: cell.localPlacement,
			memberId: cell.memberId,
			portalApertures: cell.portalApertures,
			portals: cell.portals,
			renderGeometry: cell.renderGeometry,
			restrictionObjectId: cell.restrictionObjectId,
			seenOutside: cell.seenOutside,
			staticObjectSeeds: [],
			surfaces: cell.surfaces.map((surface) => ({
				material: {
					kind: "static-material-source",
					materialId: 0x08000010,
				},
				slotId: surface.slotId,
				surfaceId: surface.surfaceId,
			})),
			visibleEnvCellIds: cell.visibleEnvCellIds,
		})),
		kind: "landblock-env-cells",
		landblock: {
			kind: "landblock-source",
			landblockId: payload.landblockId,
			source: "env-cells",
		},
		missingRefs: [],
		portalLinks: [],
		regionRenderProfile: {
			detailRoles: [],
			identity: {
				kind: "region-render-profile",
				regionNumber: payload.regionNumber,
			},
		},
		residencySpatial: {
			landblockEnvCellBvh: {
				items: payload.landblockEnvCellBvh.items.map((item) => ({
					bounds: item.bounds,
					identity: {
						envCellId: item.envCellId,
						kind: "env-cell-source",
					},
					memberId: item.memberId,
					source: item.source,
				})),
				nodes: payload.landblockEnvCellBvh.nodes,
			},
			landblockEnvCellBvhItemCount: payload.landblockEnvCellBvh.items.length,
			landblockEnvCellBvhNodeCount: payload.landblockEnvCellBvh.nodes.length,
		},
		visibilityDiagnostics: [],
	};
}

function createPreparedAsset(
	key: HostAssetKey,
	payload: LandblockEnvCellsPayloadDto,
): PreparedAsset {
	return {
		key,
		payload,
		preparedAt: "2026-06-15T00:00:00.000Z",
		revision: 1,
		sourceAssetId: describeHostAssetKey(key),
	};
}

function createLandblockEnvCellsPayload(): LandblockEnvCellsPayloadDto {
	return {
		diagnostics: createDiagnostics(),
		envCells: [createEnvCellPayload()],
		kind: "landblock-env-cells",
		landblockEnvCellBvh: {
			items: [
				{
					bounds: createBounds(),
					envCellId: 0xda550100,
					memberId: "cell-0",
					source: "env-cell-root",
				},
			],
			nodes: [],
		},
		landblockId: 0xda55ffff,
		landblockInfoId: 0xda55fffe,
		portalLinks: [],
		provenance: createProvenance(),
		regionId: 1,
		regionNumber: 1,
		residencyKind: "landblock",
		sourceAssetKind: "landblock-env-cells",
	};
}

function createEnvCellPayload(): LandblockEnvCellsPayloadDto["envCells"][number] {
	return {
		cellBsp: {
			kind: "leaf",
			polyIds: [],
			solid: 0,
			sphere: null,
		},
		cellStructureId: 0x0d000020,
		diagnostics: createDiagnostics(),
		environmentId: 0x0e000010,
		envCellId: 0xda550100,
		localPlacement: createPlacement(),
		memberId: "cell-0",
		portalApertures: [],
		portals: [],
		renderGeometry: {
			bounds: createBounds(),
			invalidPolygons: [],
			normals: [0, 0, 1, 0, 0, 1, 0, 0, 1],
			positions: [1, 2, 3, 4, 5, 6, 7, 8, 9],
			skippedPolygonCount: 0,
			sourceId: 0xda550100,
			surfaceIds: [10],
			triangleCount: 1,
			triangles: [
				{
					firstVertex: 0,
					materialVariantSignature: "variant-a",
					polygonId: 17,
					surfaceId: 10,
				},
			],
			uvs: [0, 0, 1, 0, 0, 1],
			vertexCount: 3,
		},
		restrictionObjectId: null,
		seenOutside: null,
		statics: [],
		surfaces: [
			{
				materialAssetId: "material/08000010",
				slotId: 0,
				surfaceId: 10,
			},
		],
		visibleEnvCellIds: [],
	};
}

function createPlacement() {
	return {
		orientation: { w: 1, x: 0, y: 0, z: 0 },
		origin: { x: 0, y: 0, z: 0 },
	};
}

function createBounds() {
	return {
		max: { x: 1, y: 1, z: 1 },
		min: { x: 0, y: 0, z: 0 },
	};
}

function createDiagnostics() {
	return {
		errors: [],
		omissions: [],
		sourceRecords: [],
	};
}

function createProvenance() {
	return {
		detail: null,
		errorCode: null,
		source: "repo-local-hba" as const,
		sourceAssetKind: "landblock-env-cells",
	};
}
