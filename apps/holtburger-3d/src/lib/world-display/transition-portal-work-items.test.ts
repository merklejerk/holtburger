import { describe, expect, it } from "vitest";

import {
	createInitialAssetChannelState,
	type AssetChannelState,
	type PreparedAssetRecord,
} from "../assets/types";
import { formatIndoorEnvCellAssetId } from "../assets/structured-interior-coverage";
import {
	classifyTransitionPortalDirection,
	createTransitionPortalWorkItem,
	deriveTransitionPortalCandidates,
	type TransitionPortalCandidateModel,
} from "./transition-portal-work-items";
import { deriveStructuredCellRenderChunk } from "./render-chunks";
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
			createOutdoorStaticSceneAsset({
				portalId: "outdoor-topology/00",
				linkedEnvCellIds: [0x016c0155],
				stabList: [0x016c0157],
			}),
			createIndoorEnvCellAsset(0x016c0155, [0x016c0156]),
			createIndoorEnvCellAsset(0x016c0156, []),
			createIndoorEnvCellAsset(0x016c0157, []),
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
			requestedInteriorEnvCellIds: [0x016c0155, 0x016c0156, 0x016c0157],
		});
		expect(model.candidates[0]?.aperture.id).toBe("cell-outside/01");
	});

	it("skips topology portals when aperture geometry is not loaded yet", () => {
		const model = deriveModel(
			createAssetState([
				createOutdoorStaticSceneAsset({
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
			createOutdoorStaticSceneAsset({
				portalId: "outdoor-topology/00",
				linkedEnvCellIds: [0x016c0155],
				stabList: [],
			}),
			createIndoorEnvCellAsset(0x016c0155, []),
		]);
		const model = deriveTransitionPortalCandidates({
			assetState,
			structuredInteriorScene: createStructuredInteriorSceneModel([
				createStructuredInteriorCell(0x016c0155),
			]),
			activeLandblockIds: [0x016cffff],
			coverageOptions: {
				maxEnvCells: 16,
				maxVisibleCellDepth: 4,
			},
			source: "runtime",
		});

		expect(model.candidates[0]?.source).toBe("runtime");
	});

	it("rejects malformed outside apertures without treating them as walls", () => {
		const assetState = createAssetState([
			createOutdoorStaticSceneAsset({
				portalId: "outdoor-topology/00",
				linkedEnvCellIds: [0x016c0155],
				stabList: [],
			}),
			createIndoorEnvCellAsset(0x016c0155, []),
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
				createOutdoorStaticSceneAsset({
					portalId: "outdoor-topology/00",
					linkedEnvCellIds: [0x016c0155],
					stabList: [],
				}),
				createIndoorEnvCellAsset(0x016c0155, []),
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
	assetState: AssetChannelState,
	cells: StructuredInteriorCell[],
): TransitionPortalCandidateModel {
	return deriveTransitionPortalCandidates({
		assetState,
		structuredInteriorScene: createStructuredInteriorSceneModel(cells),
		activeLandblockIds: [0x016cffff],
		coverageOptions: {
			maxEnvCells: 16,
			maxVisibleCellDepth: 4,
		},
	});
}

function createAssetState(records: PreparedAssetRecord[]): AssetChannelState {
	const state = createInitialAssetChannelState();
	state.preparedByAssetId = Object.fromEntries(
		records.map((record) => [record.request.assetId, record]),
	);
	return state;
}

function createOutdoorStaticSceneAsset(options: {
	portalId: string;
	linkedEnvCellIds: number[];
	stabList: number[];
}): PreparedAssetRecord {
	return createPreparedAssetRecord("outdoor-static-scene/016cffff", {
		kind: "outdoor-static-scene",
		residencyKind: "outdoor-landblock",
		sourceAssetKind: "outdoor-static-scene",
		provenance: createProvenance(),
		landblockId: 0x016cffff,
		sceneryInstances: [],
		buildingInstances: [
			{
				instanceId: "building/0",
				owningLandblockId: 0x016cffff,
				sourceDid: 0x02000001,
				sourceAssetId: "setup-model/02000001",
				sourceIndex: 0,
				localPlacement: IDENTITY_PLACEMENT,
				numLeaves: 1,
				portals: [
					{
						portalId: options.portalId,
						sourceIndex: 0,
						flags: 0,
						otherCellId: options.linkedEnvCellIds[0] ?? 0,
						otherPortalId: 0,
						stabList: options.stabList,
						linkedEnvCellIds: options.linkedEnvCellIds,
					},
				],
			},
		],
		generatedSceneryInstances: [],
		diagnostics: {
			landblockInfoAvailable: true,
			landblockInfoError: null,
			explicit: createLayerDiagnostics(),
			buildings: createLayerDiagnostics(),
			generated: {
				...createLayerDiagnostics(),
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
		},
	});
}

function createIndoorEnvCellAsset(
	envCellId: number,
	visibleCellIds: number[],
): PreparedAssetRecord {
	return createPreparedAssetRecord(formatIndoorEnvCellAssetId(envCellId), {
		kind: "indoor-env-cell",
		residencyKind: "indoor-env-cell",
		sourceAssetKind: "env-cell",
		provenance: createProvenance(),
		debugPresentation: {
			primitive: "env-cell",
			paletteKey: "test",
		},
		envCellId,
		environmentId: 0x0d000001,
		cellStructureId: 1,
		localPlacement: IDENTITY_PLACEMENT,
		visibleCellIds,
		seenOutside: true,
		surfaceIds: [],
		portalCount: 0,
		portals: [],
		staticObjectCount: 0,
		staticObjects: [],
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
		missingEnvironmentAssetIds: [],
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
			physicsWitness: {
				polygonCount: 0,
				hasBsp: false,
				rootKind: null,
			},
			drawingBsp: null,
			renderGeometry: createRenderGeometry(),
		},
		renderGeometry: createRenderGeometry(),
		debugColorKey: `cell-${envCellId.toString(16)}`,
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

function createLayerDiagnostics(): {
	attempted: number;
	accepted: number;
	rejectedUnsupportedSource: number;
} {
	return {
		attempted: 1,
		accepted: 1,
		rejectedUnsupportedSource: 0,
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
