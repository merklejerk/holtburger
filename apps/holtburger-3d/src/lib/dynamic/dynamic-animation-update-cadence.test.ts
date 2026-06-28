import { describe, expect, it } from "vitest";
import type {
	AnimationPayloadDto,
	PlacementTransformDto,
} from "../host/contracts";
import type {
	StaticObjectSourceAssetFacts,
	StaticObjectSourceIdentity,
} from "../static/contracts";
import type { DynamicEntityRecord } from "./contracts";
import {
	DYNAMIC_ANIMATION_FAR_UPDATE_INTERVAL_SECONDS,
	DYNAMIC_ANIMATION_MID_UPDATE_DISTANCE,
	DYNAMIC_ANIMATION_MID_UPDATE_INTERVAL_SECONDS,
	DYNAMIC_ANIMATION_NEAR_UPDATE_DISTANCE,
	intervalSecondsForDynamicAnimationDistance,
	shouldUpdateDynamicAnimationForCadence,
} from "./dynamic-animation-update-cadence";
import { DynamicEntityController } from "./dynamic-entity-controller";
import { DynamicEntityStore } from "./dynamic-entity-store";

describe("dynamic animation update cadence", () => {
	it("maps distance thresholds to every-frame, 10Hz, and 1Hz intervals", () => {
		expect(
			intervalSecondsForDynamicAnimationDistance(
				DYNAMIC_ANIMATION_NEAR_UPDATE_DISTANCE,
			),
		).toBe(0);
		expect(
			intervalSecondsForDynamicAnimationDistance(
				DYNAMIC_ANIMATION_NEAR_UPDATE_DISTANCE + 0.001,
			),
		).toBe(DYNAMIC_ANIMATION_MID_UPDATE_INTERVAL_SECONDS);
		expect(
			intervalSecondsForDynamicAnimationDistance(
				DYNAMIC_ANIMATION_MID_UPDATE_DISTANCE,
			),
		).toBe(DYNAMIC_ANIMATION_MID_UPDATE_INTERVAL_SECONDS);
		expect(
			intervalSecondsForDynamicAnimationDistance(
				DYNAMIC_ANIMATION_MID_UPDATE_DISTANCE + 0.001,
			),
		).toBe(DYNAMIC_ANIMATION_FAR_UPDATE_INTERVAL_SECONDS);
	});

	it("updates every frame when no camera context is available", () => {
		const record = createReadyDynamicRecord({
			baseOrigin: { x: 512, y: 0, z: 0 },
			frameCount: 60,
		});

		expect(
			shouldUpdateDynamicAnimationForCadence({
				context: null,
				lastUpdatedAtSeconds: 1,
				record,
				timeSeconds: 1.01,
			}),
		).toMatchObject({
			distance: null,
			intervalSeconds: 0,
			shouldUpdate: true,
		});
	});

	it("uses current bounds center before base placement fallback", () => {
		const record = {
			...createReadyDynamicRecord({
				baseOrigin: { x: 256, y: 0, z: 0 },
				frameCount: 60,
			}),
			bounds: {
				currentBounds: {
					bounds: {
						max: { x: 11, y: 0, z: 0 },
						min: { x: 9, y: 0, z: 0 },
					},
					coordinateSpace: "source-landblock-local",
					effectiveOutdoorLandblockIds: [0xda55ffff],
					kind: "outdoor-landblock",
					partBounds: [],
					precision: "current-frame-source-part-bounds-aabb",
					sourceLandblockId: 0xda55ffff,
				},
				indexMembership: {
					kind: "outdoor-landblocks",
					landblockIds: [0xda55ffff],
				},
				indexed: true,
				precision: "current-frame-source-part-bounds-aabb",
			},
		} satisfies DynamicEntityRecord;

		expect(
			shouldUpdateDynamicAnimationForCadence({
				context: {
					cameraPosition: [0, 0, 0],
					renderAnchorLandblockId: 0xda55ffff,
				},
				lastUpdatedAtSeconds: 1,
				record,
				timeSeconds: 1.01,
			}),
		).toMatchObject({
			distance: 10,
			intervalSeconds: 0,
			shouldUpdate: true,
		});
	});

	it("throttles controller animation and placement updates without clearing stale state", () => {
		const skippedTickSeconds =
			DYNAMIC_ANIMATION_FAR_UPDATE_INTERVAL_SECONDS / 2;
		const nextAllowedTickSeconds = DYNAMIC_ANIMATION_FAR_UPDATE_INTERVAL_SECONDS;
		const store = new DynamicEntityStore();
		store.upsert(
			createReadyDynamicRecord({
				baseOrigin: { x: 256, y: 0, z: 0 },
				frameCount: 60,
			}),
		);
		const controller = new DynamicEntityController({ store });

		expect(
			controller.tick(0, {
				animationCadenceContext: {
					cameraPosition: [0, 0, 0],
					renderAnchorLandblockId: 0xda55ffff,
				},
			}),
		).toBe(true);
		const first = controller.createSnapshot().records[0];
		expect(first?.animation.playback).toMatchObject({
			currentFrameIndex: 0,
			status: "playing",
		});
		expect(first?.bounds.indexed).toBe(true);

		expect(
			controller.tick(skippedTickSeconds, {
				animationCadenceContext: {
					cameraPosition: [0, 0, 0],
					renderAnchorLandblockId: 0xda55ffff,
				},
			}),
		).toBe(false);
		const skipped = controller.createSnapshot().records[0];
		expect(skipped?.animation.playback).toMatchObject({
			currentFrameIndex: 0,
			status: "playing",
		});
		expect(skipped?.bounds).toEqual(first?.bounds);

		expect(
			controller.tick(nextAllowedTickSeconds, {
				animationCadenceContext: {
					cameraPosition: [0, 0, 0],
					renderAnchorLandblockId: 0xda55ffff,
				},
			}),
		).toBe(true);
		expect(
			controller.createSnapshot().records[0]?.animation.playback,
		).toMatchObject({
			currentFrameIndex: Math.floor(nextAllowedTickSeconds * 30),
			status: "playing",
		});
	});
});

function createReadyDynamicRecord(options: {
	readonly baseOrigin: PlacementTransformDto["origin"];
	readonly frameCount: number;
}): DynamicEntityRecord {
	const source = createSourceIdentity(0x020003e5);
	const entityId = "runtime-spawn:cadence-test";
	const visualResourceId = `dynamic-visual-resource:${entityId}`;
	return {
		animation: {
			defaultAnimationId: 0x0300061b,
			playback: {
				status: "pending-resource",
			},
			status: "ready",
		},
		baseTransform: {
			baseLocalPlacement: createPlacement(options.baseOrigin),
			sourceScale: { x: 1, y: 1, z: 1 },
		},
		bounds: {
			currentBounds: null,
			indexMembership: { kind: "none" },
			indexed: false,
			precision: "none",
		},
		effectiveResidence: {
			kind: "outdoor-landblock",
			landblockId: 0xda55ffff,
		},
		id: entityId,
		presentation: {
			diagnostics: {
				kind: "runtime-spawn",
				serverInstanceIdMetadata: null,
				sourceKind: "browser-authored-server-shaped",
			},
			policy: {
				diagnosticsBucket: "runtime-authored-dynamic",
				materialDetailRolePolicy: {
					kind: "runtime-authored-none",
				},
				materialPlanningDomain: "runtime-authored-dynamic-object-material",
				materialPlanningIdentity: {
					kind: "setup-backed-visual",
					visualObject: {
						entityId,
						kind: "dynamic-visual-object",
						resourceId: visualResourceId,
					},
				},
				ownershipPolicy: {
					kind: "dynamic-visual-resource",
					resourceId: visualResourceId,
				},
				resourceFamily: "runtime-authored-dynamic-object-material",
				retentionPolicy: {
					kind: "explicit-runtime-lifetime",
				},
				textureBatchId: `runtime-dynamic:${entityId}`,
				textureDomain: "runtime-object-material",
			},
			visualSource: {
				animationSelection: { animationId: 0x0300061b, kind: "explicit" },
				effectiveResidence: {
					kind: "outdoor-landblock",
					landblockId: 0xda55ffff,
				},
				modelData: null,
				setupModelId: 0x020003e5,
				sourceAssetIds: ["setup-model/020003e5"],
			},
		},
		provenance: {
			kind: "runtime-spawn",
			sourceKind: "browser-authored-server-shaped",
		},
		renderability: {
			reasons: [],
			status: "renderable",
		},
		resources: {
			required: [
				"setup-model",
				"animation",
				"setup-appearance",
				"gfx",
				"material",
				"palette",
				"render-surface",
				"prepared-texture",
			],
			setupAnimation: {
				animation: {
					assetId: "animation/0300061b",
					payload: createAnimationPayload(options.frameCount),
				},
				animationKey: { id: 0x0300061b, kind: "animation" },
				setupModelKey: { id: 0x020003e5, kind: "setup-model" },
				status: "ready",
			},
			status: "ready",
			visual: {
				materialSlots: [],
				materialSources: [],
				paletteSources: [],
				renderParts: [],
				sourceAssets: [createSourceAsset(source)],
				status: "ready",
				textureRefs: [],
				textureRequirements: [],
			},
		},
		sourceResidence: {
			kind: "outdoor-landblock",
			landblockId: 0xda55ffff,
		},
		source: {
			animationSelection: { animationId: 0x0300061b, kind: "explicit" },
			kind: "runtime-spawn",
			modelData: null,
			runtimeEntityId: entityId,
			serverInstanceIdMetadata: null,
			setupModelId: 0x020003e5,
			sourceKind: "browser-authored-server-shaped",
		},
	};
}

function createAnimationPayload(frameCount: number): AnimationPayloadDto {
	return {
		animationAssetId: "animation/0300061b",
		animationId: 0x0300061b,
		dependencies: {},
		flags: 0,
		frameCount,
		kind: "animation",
		objectPositionFrames: [],
		partCount: 1,
		partFrames: Array.from({ length: frameCount }, (_, frameIndex) => ({
			frameIndex,
			hooks: [],
			localPlacements: [createPlacement({ x: frameIndex, y: 0, z: 0 })],
		})),
		provenance: {
			detail: null,
			errorCode: null,
			source: "repo-local-hba",
			sourceAssetKind: "animation",
		},
		residencyKind: "unknown",
		sourceAssetKind: "animation",
	};
}

function createSourceAsset(
	source: StaticObjectSourceIdentity,
): StaticObjectSourceAssetFacts {
	const gfxObj = createSourceIdentity(0x01000020);
	return {
		bounds: {
			max: { x: 1, y: 1, z: 1 },
			min: { x: -1, y: -1, z: -1 },
		},
		debug: { sourceAssetId: "setup-model/020003e5" },
		defaultAnimation: 0x0300061b,
		identity: source,
		invalidPolygonCount: 0,
		materialSlotCount: 0,
		partCount: 1,
		parts: [
			{
				bounds: {
					max: { x: 1, y: 1, z: 1 },
					min: { x: -1, y: -1, z: -1 },
				},
				defaultPlacements: [],
				geometry: {
					gfxObj,
					kind: "static-object-source-geometry",
					partIndex: 0,
					source,
				},
				gfxObj,
				invalidPolygonCount: 0,
				materialSlotCount: 0,
				materialSlots: [],
				partIndex: 0,
				physicsPolygonCount: 0,
				renderTriangleCount: 1,
				scale: { x: 1, y: 1, z: 1 },
				skippedPolygonCount: 0,
				source,
				triangles: [],
			},
		],
		physicsPolygonCount: 0,
		renderTriangleCount: 1,
		skippedPolygonCount: 0,
		sourceAssetKind: "setup-model",
	};
}

function createSourceIdentity(sourceDid: number): StaticObjectSourceIdentity {
	return {
		kind: "static-object-source",
		sourceAssetKind: sourceDid >>> 24 === 0x01 ? "gfx-obj" : "setup-model",
		sourceDid,
	};
}

function createPlacement(
	origin: PlacementTransformDto["origin"],
): PlacementTransformDto {
	return {
		orientation: { w: 1, x: 0, y: 0, z: 0 },
		origin,
	};
}
