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
	it("extracts outdoor static scene source assets", () => {
		const response = createJsonResponse("outdoor-static-scene/da55ffff", {
			kind: "outdoor-static-scene",
			residencyKind: "outdoor-landblock",
			sourceAssetKind: "outdoor-static-scene",
			landblockId: 0xda55ffff,
			sceneryInstances: [
				createOutdoorInstance("scenery-0", "gfx-obj/01000001"),
				createOutdoorInstance("scenery-1", "gfx-obj/01000001"),
			],
			buildingInstances: [
				{
					...createOutdoorInstance("building-0", "setup-model/02000002"),
					numLeaves: 0,
					portals: [],
				},
			],
			generatedSceneryInstances: [
				{
					...createOutdoorInstance("generated-0", "setup-model/02000003"),
					terrainIndex: 4,
					sceneId: 9,
					sceneTemplateIndex: 1,
					scale: 1,
				},
			],
			diagnostics: createOutdoorDiagnostics(),
			provenance,
		});

		expect(getAssetResponseDependencies(response)).toEqual([
			{ assetId: "gfx-obj/01000001" },
			{ assetId: "setup-model/02000002" },
			{ assetId: "setup-model/02000003" },
		]);
	});

	it("extracts indoor env cell static object source assets", () => {
		const response = createJsonResponse("indoor-env-cell/da55012e", {
			kind: "indoor-env-cell",
			residencyKind: "indoor-env-cell",
			sourceAssetKind: "env-cell",
			envCellId: 0xda55012e,
			environmentId: 0x0d000355,
			cellStructureId: 1,
			localPlacement,
			visibleCellIds: [],
			landblockEnvCellIds: [],
			seenOutside: true,
			surfaceIds: [],
			portalCount: 0,
			portals: [],
			staticObjectCount: 2,
			staticObjects: [
				createIndoorStaticObject("static-0", "setup-model/02000004"),
				createIndoorStaticObject("static-1", "setup-model/02000004"),
				createIndoorStaticObject("static-2", "gfx-obj/01000005"),
			],
			provenance,
		});

		expect(getAssetResponseDependencies(response)).toEqual([
			{ assetId: "gfx-obj/01000005" },
			{ assetId: "setup-model/02000004" },
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

	it("returns no dependencies for unknown and non-json payloads", () => {
		expect(
			getAssetResponseDependencies(
				createJsonResponse("unknown/synthetic", {
					kind: "unknown-synthetic",
					residencyKind: "unknown",
					provenance,
				}),
			),
		).toEqual([]);
		expect(
			getAssetResponseDependencies({
				requestId: "request-1",
				assetId: "bytes/synthetic",
				payloadKind: "bytes",
				payload: new Uint8Array(),
			}),
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
