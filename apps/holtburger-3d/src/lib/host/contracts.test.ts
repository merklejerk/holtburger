import { describe, expect, it } from "vitest";

import type {
	AssetLookupRequestDto,
	AssetLookupResponseDto,
	CameraHintAckDto,
	CameraHintDto,
	FrontendStateFeedDto,
	HostBoundaryOverviewDto,
	LifecycleStateDto,
	RayPickResponseDto,
	RuntimeBatchDto,
	RuntimeNotificationEnvelopeDto,
	RuntimeResidencyDto,
} from "./contracts";
import {
	environmentPayloadDtoSchema,
	gfxObjPayloadDtoSchema,
	hostBoundaryOverviewDtoSchema,
	outdoorStaticScenePayloadDtoSchema,
	runtimeNotificationEnvelopeDtoSchema,
	setupModelPayloadDtoSchema,
} from "./contracts";

describe("host contracts", () => {
	it("keeps the stable runtime contract fields visible to TypeScript tests", () => {
		const lifecycleState: LifecycleStateDto = {
			phase: "ready",
			activeModeHint: "client",
			sessionState: "disconnected",
		};
		const residency: RuntimeResidencyDto = {
			focusEntityId: 0x01020304,
			focusLandblockId: 0x01020003,
			focusCellId: 3,
			focusEnvCellId: null,
			visibleCellIds: [],
			seenOutside: null,
			environmentId: null,
			cellStructureId: null,
			focusLocationLabel: "100.40S, 101.55W, 1.0Z",
			indoors: false,
			trackedBodyCount: 2,
		};
		const runtimeBatch: RuntimeBatchDto = {
			tick: 1,
			entities: [
				{
					entityId: 0x01020304,
					label: "Browser Scout",
					position: { x: 12, y: -4.5, z: 1 },
					headingRadians: 0,
					appearanceId: "gfx/02000001",
					landblockId: residency.focusLandblockId,
					cellId: residency.focusCellId,
					locationLabel: residency.focusLocationLabel,
					isLocalPlayer: true,
				},
			],
			residency,
		};
		const viewModelFeed: FrontendStateFeedDto = {
			selectedEntityId: 0x01020304,
			interactionMode: "inspect",
			busyState: "idle",
		};
		const notification: RuntimeNotificationEnvelopeDto = {
			channel: "runtime",
			topic: "runtime.batch",
			lifecycleState,
			runtimeBatch,
			viewModelFeed,
		};

		expect(notification.lifecycleState?.phase).toBe("ready");
		expect(notification.runtimeBatch?.residency.focusLocationLabel).toBe(
			"100.40S, 101.55W, 1.0Z",
		);
		expect(notification.viewModelFeed?.interactionMode).toBe("inspect");
	});

	it("parses requestable outdoor static scene fact payloads", () => {
		const payload = outdoorStaticScenePayloadDtoSchema.parse({
			kind: "outdoor-static-scene",
			residencyKind: "outdoor-landblock",
			sourceAssetKind: "outdoor-static-scene",
			landblockId: 0x0102ffff,
			sceneryInstances: [
				{
					instanceId: "outdoor-static-scene/0102ffff/object/0000/02000001",
					owningLandblockId: 0x0102ffff,
					sourceDid: 0x02000001,
					sourceAssetId: "setup-model/02000001",
					sourceIndex: 0,
					localPlacement: {
						origin: { x: 1, y: 2, z: 3 },
						orientation: { w: 1, x: 0, y: 0, z: 0 },
					},
				},
			],
			buildingInstances: [],
			generatedSceneryInstances: [],
			diagnostics: {
				landblockInfoAvailable: true,
				landblockInfoError: null,
				explicit: {
					attempted: 1,
					accepted: 1,
					rejectedUnsupportedSource: 0,
				},
				buildings: {
					attempted: 0,
					accepted: 0,
					rejectedUnsupportedSource: 0,
				},
				generated: {
					attempted: 0,
					accepted: 0,
					rejectedUnsupportedSource: 0,
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
			provenance: {
				source: "repo-local-hba",
				sourceAssetKind: "outdoor-static-scene",
				errorCode: null,
				detail: "test",
			},
		});

		expect(payload.sceneryInstances[0]?.sourceAssetId).toBe(
			"setup-model/02000001",
		);
	});

	it("keeps the asset channel contract distinct from runtime snapshot typing", () => {
		const request: AssetLookupRequestDto = {
			requestId: "bootstrap-asset",
			assetId: "terrain/0102ffff",
			priority: "bootstrap",
		};
		const response: AssetLookupResponseDto = {
			requestId: request.requestId,
			assetId: request.assetId,
			payloadKind: "json",
			payload: {
				kind: "terrain-landblock",
				residencyKind: "outdoor-landblock",
				landblockId: 0x0102ffff,
			},
		};
		const overview: HostBoundaryOverviewDto = {
			assetChannel: "asset",
			runtimeChannel: "runtime",
			runtimeNotificationEvent: "runtime:notification",
			runtimeLifecycleTopic: "lifecycle.state",
			runtimeBatchCommand: "get_runtime_batch",
			assetLookupCommand: "lookup_asset",
			indoorContractBacklog: {
				runtimeFieldIds: [
					"focus-env-cell-id",
					"visible-cell-ids",
					"seen-outside",
					"environment-id",
					"cell-structure-id",
				],
				assetFamilyIds: ["indoor-env-cell", "environment"],
			},
		};

		expect(overview.assetChannel).toBe("asset");
		expect(overview.indoorContractBacklog.runtimeFieldIds).toContain(
			"visible-cell-ids",
		);
		expect(overview.indoorContractBacklog.assetFamilyIds).toContain(
			"environment",
		);
		expect(response.assetId).toBe(request.assetId);
		expect(response.payload).toMatchObject({
			kind: "terrain-landblock",
		});
	});

	it("keeps camera-hint and authority-sensitive pick contracts typed", () => {
		const cameraHint: CameraHintDto = {
			mode: "client",
			source: "world-display",
			position: { x: 12, y: -4.5, z: 1 },
			forward: { x: 0, y: 1, z: 0 },
			viewportNormalizedX: 0.5,
			viewportNormalizedY: 0.5,
			destinationLabel: "100.40S, 101.55W, 1.0Z",
		};
		const cameraAck: CameraHintAckDto = {
			accepted: true,
			sequence: 3,
		};
		const response: RayPickResponseDto = {
			requestId: "pick-1",
			resolved: true,
			cameraHintSequence: cameraAck.sequence,
			hit: {
				entityId: 0x01020304,
				label: "Browser Scout",
				locationLabel: "100.40S, 101.55W, 1.0Z",
				distance: 14.5,
			},
		};

		expect(cameraHint.destinationLabel).toMatch(/Z$/);
		expect(response.cameraHintSequence).toBe(cameraAck.sequence);
		expect(response.hit?.label).toBe("Browser Scout");
	});

	it("parses raw runtime notifications and host overview payloads through zod schemas", () => {
		const notification = runtimeNotificationEnvelopeDtoSchema.parse({
			channel: "runtime",
			topic: "runtime.batch",
			lifecycleState: null,
			runtimeBatch: {
				tick: 1,
				entities: [],
				residency: {
					focusEntityId: null,
					focusLandblockId: 0x0102ffff,
					focusCellId: null,
					focusEnvCellId: null,
					visibleCellIds: [],
					seenOutside: null,
					environmentId: null,
					cellStructureId: null,
					focusLocationLabel: "100.40S, 101.55W, 1.0Z",
					indoors: false,
					trackedBodyCount: 0,
				},
			},
			viewModelFeed: {
				selectedEntityId: null,
				interactionMode: "inspect",
				busyState: "idle",
			},
		});
		const overview = hostBoundaryOverviewDtoSchema.parse({
			assetChannel: "asset",
			runtimeChannel: "runtime",
			runtimeNotificationEvent: "runtime:notification",
			runtimeLifecycleTopic: "lifecycle.state",
			runtimeBatchCommand: "get_runtime_batch",
			assetLookupCommand: "lookup_asset",
			indoorContractBacklog: {
				runtimeFieldIds: ["visible-cell-ids"],
				assetFamilyIds: ["environment"],
			},
		});

		expect(notification.runtimeBatch?.tick).toBe(1);
		expect(overview.indoorContractBacklog.assetFamilyIds).toContain(
			"environment",
		);
	});

	it("rejects malformed runtime notifications instead of trusting invoke generics", () => {
		expect(() =>
			runtimeNotificationEnvelopeDtoSchema.parse({
				channel: "runtime",
				topic: "runtime.batch",
				lifecycleState: null,
				runtimeBatch: {
					tick: "one",
					entities: [],
					residency: null,
				},
				viewModelFeed: null,
			}),
		).toThrow();
	});

	it("parses gfx-obj payloads with drawing data and opaque physics witnesses", () => {
		const payload = gfxObjPayloadDtoSchema.parse({
			kind: "gfx-obj",
			residencyKind: "unknown",
			sourceAssetKind: "gfx-obj",
			gfxObjId: 0x01000001,
			flags: 3,
			surfaceIds: [0x08000001],
			vertexArray: {
				vertexType: 1,
				vertexCount: 1,
				vertices: [
					{
						id: 0,
						origin: { x: 1, y: 2, z: 3 },
						normal: { x: 0, y: 0, z: 1 },
						uvs: [{ u: 0.25, v: 0.75 }],
					},
				],
			},
			drawingPolygons: [
				{
					id: 1,
					numPts: 3,
					stippling: 0,
					sidesType: 1,
					posSurface: 0,
					negSurface: 0,
					vertexIds: [0, 1, 2],
					posUvIndices: [0, 0, 0],
					negUvIndices: [0, 0, 0],
				},
			],
			drawingBsp: {
				kind: "leaf",
				index: 0,
				solid: 0,
				sphere: null,
				polyIds: [1],
			},
			physicsWitness: {
				polygonCount: 4,
				hasBsp: true,
			},
			sortCenter: { x: 4, y: 5, z: 6 },
			didDegrade: null,
			provenance: {
				source: "repo-local-hba",
				sourceAssetKind: "gfx-obj",
				errorCode: null,
				detail: "dats/assets.hba",
			},
		});

		expect(payload.kind).toBe("gfx-obj");
		expect(payload.drawingPolygons).toHaveLength(1);
		expect(payload.physicsWitness).toEqual({
			polygonCount: 4,
			hasBsp: true,
		});
	});

	it("parses decoded environment payloads with environment-scoped cell structures", () => {
		const payload = environmentPayloadDtoSchema.parse({
			kind: "environment",
			residencyKind: "indoor-env-cell",
			sourceAssetKind: "environment",
			environmentId: 0x0d000001,
			cellStructureIds: [1],
			cellStructures: [
				{
					id: 1,
					vertexArray: {
						vertexType: 1,
						vertexCount: 1,
						vertices: [
							{
								id: 0,
								origin: { x: 1, y: 2, z: 3 },
								normal: { x: 0, y: 0, z: 1 },
								uvs: [{ u: 0.25, v: 0.75 }],
							},
						],
					},
					drawingPolygons: [
						{
							id: 1,
							numPts: 3,
							stippling: 0,
							sidesType: 1,
							posSurface: 0,
							negSurface: 0,
							vertexIds: [0, 1, 2],
							posUvIndices: [0, 0, 0],
							negUvIndices: [0, 0, 0],
						},
					],
					portalPolygonIds: [1],
					cellBspWitness: {
						hasBsp: true,
						rootKind: "leaf",
					},
					cellBsp: {
						kind: "leaf",
						index: 0,
						solid: 0,
						sphere: null,
						polyIds: [],
					},
					physicsWitness: {
						polygonCount: 2,
						hasBsp: true,
						rootKind: "internal",
					},
					drawingBsp: null,
				},
			],
			provenance: {
				source: "repo-local-hba",
				sourceAssetKind: "environment",
				errorCode: null,
				detail: "dats/assets.hba",
			},
		});

		expect(payload.cellStructureIds).toEqual([1]);
		expect(payload.cellStructures[0]?.drawingPolygons).toHaveLength(1);
		expect(payload.cellStructures[0]?.cellBspWitness.rootKind).toBe(
			payload.cellStructures[0]?.cellBsp.kind,
		);
	});

	it("parses setup-model payloads with ordered part references", () => {
		const payload = setupModelPayloadDtoSchema.parse({
			kind: "setup-model",
			residencyKind: "unknown",
			sourceAssetKind: "setup-model",
			setupModelId: 0x02000001,
			flags: 3,
			parts: [
				{
					partIndex: 0,
					gfxObjId: 0x01000001,
					gfxObjAssetId: "gfx-obj/01000001",
					parentIndex: null,
					scale: { x: 1, y: 1, z: 1 },
				},
				{
					partIndex: 1,
					gfxObjId: 0x01000002,
					gfxObjAssetId: "gfx-obj/01000002",
					parentIndex: 0,
					scale: null,
				},
			],
			holdingLocations: [],
			connectionPoints: [],
			placementSets: [
				{
					key: 0,
					localPlacements: [
						{
							origin: { x: 0, y: 0, z: 0 },
							orientation: { w: 1, x: 0, y: 0, z: 0 },
						},
					],
					hookCount: 0,
				},
			],
			collisionWitness: {
				cylSphereCount: 1,
				sphereCount: 1,
			},
			height: 2,
			radius: 1,
			stepUp: 0.5,
			stepDown: 0.25,
			sortingSphere: { center: { x: 0, y: 0, z: 0 }, radius: 1 },
			selectionSphere: { center: { x: 0, y: 0, z: 0 }, radius: 1 },
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
				detail: "dats/assets.hba",
			},
		});

		expect(payload.kind).toBe("setup-model");
		expect(payload.parts.map((part) => part.gfxObjAssetId)).toEqual([
			"gfx-obj/01000001",
			"gfx-obj/01000002",
		]);
		expect(payload.placementSets[0]?.localPlacements).toHaveLength(1);
	});
});
