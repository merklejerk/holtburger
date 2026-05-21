import { describe, expect, it } from "vitest";

import type {
	AssetLookupResponseDto,
	PlacementTransformDto,
} from "../host/contracts";
import { getAssetResponseDependencies } from "./dependencies";

const localPlacement: PlacementTransformDto = {
	origin: { x: 0, y: 0, z: 0 },
	orientation: { w: 1, x: 0, y: 0, z: 0 },
};

const provenance = {
	source: "repo-local-hba" as const,
	sourceAssetKind: "synthetic",
	errorCode: null,
	detail: null,
};

describe("asset response dependencies", () => {
	it("extracts landblock pack shared renderable references", () => {
		const response = createJsonResponse("landblock-pack/da55ffff", {
			kind: "landblock-pack",
			residencyKind: "landblock",
			sourceAssetKind: "landblock-pack",
			landblockId: 0xda55ffff,
			landblockInfoId: 0xda55fffe,
			classification: "outdoor",
			sourceFacts: {
				buildings: [],
			},
			prepared: {
				terrainMesh: null,
				outdoorStaticInstances: [],
				interiorCells: [],
				staticMeshes: [],
				spatialItems: [],
				staticLandblockBvh: null,
			},
			dependencies: {
				cellDatIds: [0xda55ffff, 0xda55fffe],
				portalDatIds: [],
				renderableAssetIds: [
					"setup-model/02000001",
					"gfx-obj/01000001",
					"setup-model/02000001",
				],
				missing: [],
				unsupported: [],
			},
			diagnostics: {
				sourceRecords: [],
				omissions: [],
				errors: [],
			},
			provenance,
		});

		expect(getAssetResponseDependencies(response)).toEqual([
			{ assetId: "gfx-obj/01000001" },
			{ assetId: "setup-model/02000001" },
		]);
	});

	it("extracts setup-model part gfx objects without worker preparation", () => {
		const response = createJsonResponse("setup-model/02000010", {
			kind: "setup-model",
			residencyKind: "unknown",
			sourceAssetKind: "setup-model",
			setupModelId: 0x02000010,
			flags: null,
			parts: [
				createSetupPart(0, "gfx-obj/01000010"),
				createSetupPart(1, "gfx-obj/01000011"),
				createSetupPart(2, "gfx-obj/01000010"),
			],
			holdingLocations: [],
			connectionPoints: [],
			placementSets: [],
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
			provenance,
		});

		expect(getAssetResponseDependencies(response)).toEqual([
			{ assetId: "gfx-obj/01000010" },
			{ assetId: "gfx-obj/01000011" },
		]);
	});

	it("extracts dependency manifest asset ids", () => {
		const response = createJsonResponse("dependency-manifest/synthetic", {
			kind: "dependency-manifest",
			residencyKind: "unknown",
			dependencyAssetIds: [
				"gfx-obj/01000020",
				"setup-model/02000020",
				"gfx-obj/01000020",
			],
			provenance,
		});

		expect(getAssetResponseDependencies(response)).toEqual([
			{ assetId: "gfx-obj/01000020" },
			{ assetId: "setup-model/02000020" },
		]);
	});

	it("returns no dependencies for unknown payloads", () => {
		expect(
			getAssetResponseDependencies(
				createJsonResponse("unknown/synthetic", {
					kind: "unknown-synthetic",
					residencyKind: "unknown",
					provenance,
				}),
			),
		).toEqual([]);
	});
});

function createJsonResponse(
	assetId: string,
	payload: unknown,
): AssetLookupResponseDto {
	return {
		requestId: `request-${assetId}`,
		assetId,
		payloadKind: "json",
		payload,
	};
}

function createOutdoorInstance(instanceId: string, sourceAssetId: string) {
	return {
		instanceId,
		owningLandblockId: 0xda55ffff,
		sourceDid: 1,
		sourceAssetId,
		sourceIndex: 0,
		localPlacement,
	};
}

function createIndoorStaticObject(instanceId: string, sourceAssetId: string) {
	return {
		instanceId,
		owningEnvCellId: 0xda55012e,
		sourceDid: 1,
		sourceAssetId,
		sourceIndex: 0,
		localPlacement,
	};
}

function createSetupPart(partIndex: number, gfxObjAssetId: string) {
	return {
		partIndex,
		gfxObjId: 0x01000010 + partIndex,
		gfxObjAssetId,
		parentIndex: null,
		scale: null,
	};
}

function createOutdoorDiagnostics() {
	const layer = {
		attempted: 0,
		accepted: 0,
		rejectedUnsupportedSource: 0,
	};

	return {
		landblockInfoAvailable: true,
		landblockInfoError: null,
		explicit: layer,
		buildings: layer,
		generated: {
			...layer,
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
