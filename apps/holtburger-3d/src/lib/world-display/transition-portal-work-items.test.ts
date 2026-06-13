import { describe, expect, it } from "vitest";

import {
	type PreparedAssetRecord,
	type PreparedPolygonSetBspNode,
} from "../assets/types";
import { createTestPreparedAssetResolver } from "../../../test-support/prepared-asset-resolver";
import type { RendererAssetReadModel } from "./renderer-asset-read-model";
import {
	classifyTransitionPortalDirection,
	createTransitionPortalWorkItem,
	deriveTransitionPortalCandidates,
	deriveTransitionPortalCandidatesFromLandblockArtifacts,
	type TransitionPortalCandidateModel,
} from "./transition-portal-work-items";
import type { LandblockRenderProductWorkerResult } from "./landblock-render-product";
import { deriveStructuredCellRenderChunk } from "./render-chunks";
import type { StaticLandblockRenderProductSet } from "./static-landblock-render-artifact-store";
import type {
	StructuredInteriorCell,
	StructuredInteriorSceneModel,
} from "./structured-interior-scene";

const IDENTITY_PLACEMENT = {
	origin: { x: 0, y: 0, z: 0 },
	orientation: { w: 1, x: 0, y: 0, z: 0 },
};

describe("transition portal work items", () => {
	it("joins topology-only outdoor portals to loaded outside-transition env-cell apertures", () => {
		const assetState = createAssetState([
			createLandblockOutdoorAsset({
				portalId: "outdoor-topology/00",
				linkedEnvCellIds: [0x016c0155],
				stabList: [0x016c0157],
				interiorEnvCellIds: [0x016c0155, 0x016c0156, 0x016c0157],
			}),
		]);
		const model = deriveModel(assetState, [
			createStructuredInteriorCell(0x016c0155, {
				portalId: "cell-outside/01",
				flags: 0x4,
				targetEnvCellId: 0x016cffff,
			}),
			createStructuredInteriorCell(0x016c0156),
		]);

		expect(model.diagnostics).toMatchObject({
			topologyPortalCount: 1,
			linkedTopologyPortalCount: 1,
			apertureCandidateCount: 1,
			workItemCandidateCount: 1,
			skippedMissingApertureCount: 0,
			skippedMissingPolygonCount: 0,
		});
		expect(model.candidates[0]).toMatchObject({
			id: "outdoor-topology/00:cell-outside/01",
			source: "browser-free-camera",
			outdoorPortalId: "outdoor-topology/00",
			entryEnvCellId: 0x016c0155,
			insideVisibleSide: "negative",
			outsideVisibleSide: "positive",
			targetStatus: "outside",
			stencilRef: 1,
			requestedInteriorEnvCellIds: [0x016c0155, 0x016c0157],
		});
		expect(model.candidates[0]?.aperture.id).toBe("cell-outside/01");
	});

	it("skips topology portals when aperture geometry is not loaded yet", () => {
		const model = deriveModel(
			createAssetState([
				createLandblockOutdoorAsset({
					portalId: "outdoor-topology/00",
					linkedEnvCellIds: [0x016c0155],
					stabList: [],
				}),
			]),
			[],
		);

		expect(model.candidates).toEqual([]);
		expect(model.diagnostics).toMatchObject({
			topologyPortalCount: 1,
			linkedTopologyPortalCount: 1,
			apertureCandidateCount: 0,
			workItemCandidateCount: 0,
			skippedMissingApertureCount: 1,
		});
	});

	it("keeps the candidate source injectable for future runtime providers", () => {
		const assetState = createAssetState([
			createLandblockOutdoorAsset({
				portalId: "outdoor-topology/00",
				linkedEnvCellIds: [0x016c0155],
				stabList: [],
			}),
		]);
		const model = deriveTransitionPortalCandidates({
			assetReadModel: assetState,
			structuredInteriorScene: createStructuredInteriorSceneModel([
				createStructuredInteriorCell(0x016c0155),
			]),
			activeLandblockIds: [0x016cffff],
			source: "runtime",
		});

		expect(model.candidates[0]?.source).toBe("runtime");
	});

	it("derives transition portals from resident detailed landblock artifacts", () => {
		const model = deriveTransitionPortalCandidatesFromLandblockArtifacts({
			artifacts: createStaticLandblockProductSet([
				createDetailedLandblockProductArtifact(),
			]),
			activeLandblockIds: [0x016cffff],
		});

		expect(model?.diagnostics).toMatchObject({
			loadedEnvCellPortalFactCount: 1,
			topologyPortalCount: 1,
			linkedTopologyPortalCount: 1,
			apertureCandidateCount: 1,
			workItemCandidateCount: 1,
		});
		expect(model?.candidates[0]).toMatchObject({
			id: "outdoor-topology/00:cell-outside/01",
			outdoorPortalId: "outdoor-topology/00",
			entryEnvCellId: 0x016c0155,
			targetStatus: "outside",
			requestedInteriorEnvCellIds: [0x016c0155, 0x016c0156],
		});
		expect(model?.candidates[0]?.aperture.points).toEqual([
			{ x: 0, y: 2, z: -1 },
			{ x: 3, y: 2, z: -1 },
			{ x: 3, y: 5, z: -1 },
		]);
	});

	it("returns null when no resident detailed artifact can feed portal candidates", () => {
		expect(
			deriveTransitionPortalCandidatesFromLandblockArtifacts({
				artifacts: createStaticLandblockProductSet([]),
				activeLandblockIds: [0x016cffff],
			}),
		).toBeNull();
	});

	it("joins outdoor topology to env-cell aperture geometry without legacy scene assets", () => {
		const assetState = createAssetState([
			createLandblockOutdoorAsset({
				portalId: "outdoor-topology/00",
				linkedEnvCellIds: [0x016c0155],
				stabList: [],
				interiorEnvCellIds: [0x016c0155],
			}),
		]);
		const cell = {
			...createStructuredInteriorCell(0x016c0155, {
				portalId: "cell-outside/01",
				flags: 0x4,
				targetEnvCellId: 0x016cffff,
			}),
			cellStructure: null,
			portalApertures: [
				{
					portalId: "cell-outside/01",
					sourceIndex: 0,
					polygonId: 7,
					points: [
						{ x: 0, y: 2, z: -1 },
						{ x: 3, y: 2, z: -1 },
						{ x: 3, y: 5, z: -1 },
					],
					plane: {
						normal: { x: 0, y: 0, z: 1 },
						constant: -1,
						source: "derived-from-render-points" as const,
					},
				},
			],
		};

		const model = deriveModel(assetState, [cell]);

		expect(model.diagnostics).toMatchObject({
			loadedEnvCellPortalFactCount: 1,
			topologyPortalCount: 1,
			apertureCandidateCount: 1,
			workItemCandidateCount: 1,
		});
		expect(model.candidates[0]).toMatchObject({
			id: "outdoor-topology/00:cell-outside/01",
			requestedInteriorEnvCellIds: [0x016c0155],
		});
	});

	it("rejects malformed outside apertures without treating them as walls", () => {
		const assetState = createAssetState([
			createLandblockOutdoorAsset({
				portalId: "outdoor-topology/00",
				linkedEnvCellIds: [0x016c0155],
				stabList: [],
			}),
		]);
		const model = deriveModel(assetState, [
			createStructuredInteriorCell(0x016c0155, {
				portalId: "interior-only",
				flags: 0x4,
				polygonId: 99,
				targetEnvCellId: 0x016cffff,
			}),
		]);

		expect(model.candidates).toEqual([]);
		expect(model.diagnostics).toMatchObject({
			apertureCandidateCount: 1,
			skippedMissingPolygonCount: 1,
		});
	});

	it("classifies the outside side of one transition aperture as outdoor-to-indoor", () => {
		expect(
			classifyTransitionPortalDirection({
				cameraPosition: { x: 0, y: 0, z: 10 },
				worldPlane: {
					normal: { x: 0, y: 0, z: 1 },
					constant: 0,
					source: "drawing-bsp-portal",
				},
				insideVisibleSide: "negative",
			}),
		).toBe("outdoor-to-indoor");
	});

	it("classifies the inside side of one transition aperture as indoor-to-outdoor", () => {
		expect(
			classifyTransitionPortalDirection({
				cameraPosition: { x: 0, y: 0, z: -10 },
				worldPlane: {
					normal: { x: 0, y: 0, z: 1 },
					constant: 0,
					source: "drawing-bsp-portal",
				},
				insideVisibleSide: "negative",
			}),
		).toBe("indoor-to-outdoor");
	});

	it("builds per-frame work items with explicit direction and broad scene targets", () => {
		const model = deriveModel(
			createAssetState([
				createLandblockOutdoorAsset({
					portalId: "outdoor-topology/00",
					linkedEnvCellIds: [0x016c0155],
					stabList: [],
				}),
			]),
			[
				createStructuredInteriorCell(0x016c0155, {
					portalId: "cell-outside/01",
					flags: 0x4,
					targetEnvCellId: 0x016cffff,
				}),
			],
		);
		const candidate = model.candidates[0];
		if (!candidate) {
			throw new Error("test should derive a transition portal candidate");
		}

		const workItem = createTransitionPortalWorkItem({
			candidate,
			cameraPosition: { x: 0, y: 0, z: 10 },
			worldPlane: {
				normal: { x: 0, y: 0, z: 1 },
				constant: 0,
				source: "drawing-bsp-portal",
			},
		});

		expect(workItem).toMatchObject({
			direction: "outdoor-to-indoor",
			baseScene: "exterior",
			compositeScene: "interior",
			visibleSide: "positive",
		});
	});
});

function deriveModel(
	assetReadModel: RendererAssetReadModel,
	cells: StructuredInteriorCell[],
): TransitionPortalCandidateModel {
	return deriveTransitionPortalCandidates({
		assetReadModel,
		structuredInteriorScene: createStructuredInteriorSceneModel(cells),
		activeLandblockIds: [0x016cffff],
	});
}

function createStaticLandblockProductSet(
	artifacts: readonly LandblockRenderProductWorkerResult[],
): StaticLandblockRenderProductSet {
	return {
		artifacts,
		desiredCount: artifacts.length,
		residentCount: artifacts.length,
		inFlightCount: 0,
		staleResultCount: 0,
		committedResultCount: artifacts.length,
		evictedResultCount: 0,
		errorCount: 0,
		latestDesiredIdentityKeys: [],
	};
}

function createDetailedLandblockProductArtifact(): LandblockRenderProductWorkerResult {
	const landblockId = 0x016cffff;
	const envCellId = 0x016c0155;
	const renderChunk = deriveStructuredCellRenderChunk(envCellId);
	return {
		type: "landblock-render-product-built",
		jobId: "job:016cffff:outdoor-env-cells",
		landblockId,
		product: "outdoor-env-cells",
		requestId: "request",
		buildPolicyRevision: "build:v1",
		texturePagePolicyRevision: "pages:v1",
		artifacts: [
			{
				artifactKind: "detailed-landblock",
				key: "detailed:016cffff:outdoor-env-cells",
				landblockId,
				product: "outdoor-env-cells",
				requestId: "request",
				buildPolicyRevision: "build:v1",
				texturePagePolicyRevision: "pages:v1",
				selectedEnvCellIds: [envCellId, 0x016c0156],
				structuredInteriorMaterialRecords: [],
				structuredInteriorTexturePageRefs: [],
				structuredInteriorTexturePages: [],
				structuredInteriorCells: [
					{
						key: "structured-interior-cell:016c0155",
						envCellId,
						landblockId,
						regionNumber: 1,
						environmentId: 0x0d000001,
						cellStructureId: 1,
						renderChunk,
						localPlacement: IDENTITY_PLACEMENT,
						surfaceIds: [],
						materialSlices: [],
						portals: [
							{
								key: "env-cell-portal:016c0155:cell-outside/01",
								envCellId,
								portalId: "cell-outside/01",
								sourceIndex: 0,
								flags: 0x4,
								polygonId: 7,
								otherCellId: 0xffff,
								otherPortalId: 0xffff,
								targetEnvCellId: 0x016cffff,
								isOutsideTransition: true,
							},
						],
						portalApertureKeys: ["portal-aperture:016c0155:cell-outside/01"],
						staticObjectCount: 0,
						cellBsp: createLeafBspNode(),
						renderGeometry: createRenderGeometry(),
					},
				],
				cellStructureMetadata: [],
				portalLinks: [
					{
						key: "portal-link:outdoor-topology/00:016c0155",
						landblockId,
						source: {
							kind: "landblock-building",
							instanceId: "building/0",
							portalId: "outdoor-topology/00",
						},
						target: {
							kind: "env-cell",
							envCellId,
							portalId: "cell-outside/01",
						},
						flags: 0,
						otherCellId: envCellId,
						otherPortalId: 0,
						polygonId: 7,
						sourceIndex: 0,
					},
				],
				portalApertures: [
					{
						key: "portal-aperture:016c0155:cell-outside/01",
						envCellId,
						portalId: "cell-outside/01",
						sourceIndex: 0,
						polygonId: 7,
						points: [
							{ x: 0, y: 2, z: -1 },
							{ x: 3, y: 2, z: -1 },
							{ x: 3, y: 5, z: -1 },
						],
						plane: {
							normal: { x: 0, y: 0, z: 1 },
							constant: -1,
							source: "derived-from-render-points",
						},
					},
				],
				visibility: {
					objectVisibilityRecords: [],
					cellVisibilityRecords: [],
				},
				spatial: {
					envCellResidencyBvh: {
						coordinateSpace: "landblock-topology-residency",
						nodes: [],
						items: [],
					},
					envCellLocalBvhs: [],
				},
			},
		],
		diagnostics: {
			status: "ready",
			messages: [],
		},
	};
}

function createAssetState(records: PreparedAssetRecord[]) {
	return createTestPreparedAssetResolver(records);
}

function createLandblockOutdoorAsset(options: {
	portalId: string;
	linkedEnvCellIds: number[];
	stabList: number[];
	interiorEnvCellIds?: number[];
}): PreparedAssetRecord {
	return createPreparedAssetRecord("landblock/016cffff/outdoor", {
		kind: "landblock-outdoor",
		residencyKind: "outdoor-landblock",
		sourceAssetKind: "landblock-outdoor",
		provenance: createProvenance(),
		landblockId: 0x016cffff,
		regionId: 0x13000000,
		regionNumber: 1,
		classification: "outdoor",
		terrain: {
			gridSize: 9,
			tileSize: 24,
			vertices: [],
			triangles: [],
			quads: [],
			terrainBvh: {
				coordinateSpace: "landblock-outdoor-terrain-local",
				nodes: [],
				items: [],
			},
			minHeight: 0,
			maxHeight: 0,
			bounds: null,
		},
		statics: [
			{
				kind: "building",
				instanceId: "building/0",
				sourceDid: 0x02000001,
				sourceAssetId: "setup-model/02000001",
				sourceIndex: 0,
				localPlacement: IDENTITY_PLACEMENT,
				sourceScale: { x: 1, y: 1, z: 1 },
				sourceBounds: null,
				instanceBounds: null,
				building: {
					numLeaves: 1,
					portals: [
						{
							portalId: options.portalId,
							sourceIndex: 0,
							flags: 0,
							otherCellId: options.linkedEnvCellIds[0] ?? 0,
							otherPortalId: 0,
							stabLocalCellIds: options.stabList,
							linkedEnvCellIds: options.linkedEnvCellIds,
						},
					],
				},
				generated: null,
			},
		],
		outdoorBvh: null,
		diagnostics: {
			sourceRecords: [],
			errors: [],
		},
	});
}

function createStructuredInteriorSceneModel(
	cells: StructuredInteriorCell[],
): StructuredInteriorSceneModel {
	return {
		focusEnvCellId: null,
		activeEnvCellIds: cells.map((cell) => cell.envCellId),
		cells,
		missingEnvCellAssetIds: [],
		missingInteriorGeometryAssetIds: [],
		missingCellStructureKeys: [],
		statusText: "test",
		cacheText: "test",
	};
}

function createStructuredInteriorCell(
	envCellId: number,
	portalOptions: {
		portalId?: string;
		flags?: number;
		polygonId?: number;
		targetEnvCellId?: number;
	} = {},
): StructuredInteriorCell {
	const renderChunk = deriveStructuredCellRenderChunk(envCellId);
	const targetEnvCellId =
		portalOptions.targetEnvCellId ?? (envCellId & 0xffff0000) | 0xffff;
	return {
		renderKey: `cell-${envCellId.toString(16)}`,
		envCellId,
		renderChunk,
		environmentId: 0x0d000001,
		cellStructureId: 1,
		isFocus: false,
		chunkLocalPlacement: IDENTITY_PLACEMENT,
		surfaceIds: [],
		portalCount: 1,
		portals: [
			{
				portalId: portalOptions.portalId ?? `portal-${envCellId.toString(16)}`,
				sourceIndex: 0,
				flags: portalOptions.flags ?? 0x4,
				polygonId: portalOptions.polygonId ?? 7,
				otherCellId: 0xffff,
				otherPortalId: 0xffff,
				targetEnvCellId,
			},
		],
		portalApertures: [],
		staticObjectCount: 0,
		cellStructure: {
			id: 1,
			vertexArray: {
				vertexType: null,
				vertexCount: 3,
				vertices: [
					{
						id: 1,
						origin: { x: 0, y: 1, z: 2 },
						normal: { x: 0, y: 0, z: 1 },
						uvs: [],
					},
					{
						id: 2,
						origin: { x: 3, y: 1, z: 2 },
						normal: { x: 0, y: 0, z: 1 },
						uvs: [],
					},
					{
						id: 3,
						origin: { x: 3, y: 1, z: 5 },
						normal: { x: 0, y: 0, z: 1 },
						uvs: [],
					},
				],
			},
			drawingPolygons: [
				{
					id: 7,
					numPts: 3,
					stippling: 0,
					sidesType: 0,
					posSurface: 0,
					negSurface: 0,
					vertexIds: [1, 2, 3],
					posUvIndices: [],
					negUvIndices: [],
				},
			],
			portalPolygonIds: [7],
			cellBspWitness: {
				hasBsp: true,
				rootKind: "port",
			},
			cellBsp: createLeafBspNode(),
			physicsWitness: {
				polygonCount: 0,
				hasBsp: false,
				rootKind: null,
			},
			drawingBsp: null,
			renderGeometry: createRenderGeometry(),
		},
		cellBsp: createLeafBspNode(),
		renderGeometry: createRenderGeometry(),
		debugColorKey: `cell-${envCellId.toString(16)}`,
	};
}

function createLeafBspNode(): PreparedPolygonSetBspNode {
	return {
		kind: "leaf",
		index: 0,
		solid: 0,
		sphere: null,
		polyIds: [],
	};
}

function createPreparedAssetRecord(
	assetId: string,
	payload: PreparedAssetRecord["payload"],
): PreparedAssetRecord {
	return {
		request: {
			requestId: `request/${assetId}`,
			assetId,
			priority: "streaming",
		},
		response: {
			requestId: `request/${assetId}`,
			assetId,
			payloadKind: "json",
			payload,
		},
		payload,
		preparedAt: "2026-05-17T00:00:00.000Z",
	};
}

function createProvenance(): PreparedAssetRecord["payload"]["provenance"] {
	return {
		source: "unknown",
		sourceAssetKind: null,
		errorCode: null,
		detail: null,
	};
}

function createRenderGeometry(): StructuredInteriorCell["renderGeometry"] {
	return {
		sourceId: 1,
		vertexCount: 3,
		triangleCount: 1,
		positions: [],
		normals: [],
		uvs: [],
		triangles: [],
		surfaceIds: [],
		bounds: {
			min: { x: 0, y: 0, z: 0 },
			max: { x: 3, y: 5, z: 1 },
		},
	};
}
