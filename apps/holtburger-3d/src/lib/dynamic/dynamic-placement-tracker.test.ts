import { describe, expect, it, vi } from "vitest";
import { makeOutdoorLandblockId } from "../../lib/landblocks";
import type { PlacementTransformDto } from "../host/contracts";
import type {
	StaticObjectInstanceIdentity,
	StaticObjectSourceAssetFacts,
	StaticObjectSourceIdentity,
} from "../static/contracts";
import type { DynamicEntityRecord } from "./contracts";
import { DynamicEntityController } from "./dynamic-entity-controller";
import { DynamicEntityStore } from "./dynamic-entity-store";
import { DynamicPlacementTracker } from "./dynamic-placement-tracker";
import { OutdoorDynamicSpatialIndex } from "./outdoor-dynamic-spatial-index";

describe("dynamic placement tracker", () => {
	it("derives current-frame bounds and cross-landblock index membership from animated part poses", () => {
		const sourceLandblockId = makeOutdoorLandblockId(0xda, 0x55);
		const eastLandblockId = makeOutdoorLandblockId(0xdb, 0x55);
		const index = new OutdoorDynamicSpatialIndex();
		const tracker = new DynamicPlacementTracker({ outdoorIndex: index });

		const update = tracker.update(
			createReadyRecord({
				partPose: createPlacement({ x: 190, y: 0, z: 0 }),
				sourceLandblockId,
			}),
		);

		expect(update.record.bounds).toMatchObject({
			currentBounds: {
				effectiveOutdoorLandblockIds: [sourceLandblockId, eastLandblockId],
				precision: "current-frame-source-part-bounds-aabb",
				sourceLandblockId,
			},
			indexMembership: {
				kind: "outdoor-landblocks",
				landblockIds: [sourceLandblockId, eastLandblockId],
			},
			indexed: true,
			precision: "current-frame-source-part-bounds-aabb",
		});
		expect(update.record.effectiveResidence).toEqual({
			kind: "outdoor-landblock",
			landblockId: sourceLandblockId,
		});
		expect(index.landblockIdsForEntity(update.record.id)).toEqual([
			sourceLandblockId,
			eastLandblockId,
		]);
	});

	it("updates current-frame bounds when active omega rotates object-root state", () => {
		const tracker = new DynamicPlacementTracker();
		const withoutOmega = tracker.update(
			createReadyRecord({
				partPose: createPlacement({ x: 20, y: 0, z: 0 }),
			}),
		).record.bounds.currentBounds?.bounds;
		const withOmega = tracker.update(
			createReadyRecord({
				activeOmegaRotation: {
					w: Math.SQRT1_2,
					x: 0,
					y: 0,
					z: Math.SQRT1_2,
				},
				partPose: createPlacement({ x: 20, y: 0, z: 0 }),
			}),
		).record.bounds.currentBounds?.bounds;

		expect(withoutOmega).toBeDefined();
		expect(withOmega).toBeDefined();
		expect(withOmega).not.toEqual(withoutOmega);
	});

	it("indexes env-cell dynamic records through env-cell membership without using the outdoor index", () => {
		const index = new OutdoorDynamicSpatialIndex();
		const tracker = new DynamicPlacementTracker({ outdoorIndex: index });

		const update = tracker.update(
			createReadyRecord({
				sourceResidence: {
					envCellId: 0xda550100,
					kind: "env-cell",
					landblockId: 0xda55ffff,
				},
			}),
		);

		expect(update.record.bounds).toMatchObject({
			currentBounds: {
				coordinateSpace: "env-cell-landblock-render-local",
				envCellId: 0xda550100,
				kind: "env-cell",
				landblockId: 0xda55ffff,
				precision: "current-frame-source-part-bounds-aabb",
			},
			indexMembership: {
				envCellIds: [0xda550100],
				kind: "env-cells",
				landblockId: 0xda55ffff,
			},
			indexed: true,
			precision: "current-frame-source-part-bounds-aabb",
		});
		expect(
			tracker.queryEnvCellBounds({
				envCellIds: [0xda550100],
				landblockId: 0xda55ffff,
			}),
		).toMatchObject([
			{
				entityId: update.record.id,
				envCellId: 0xda550100,
				landblockId: 0xda55ffff,
				precision: "current-frame-source-part-bounds-aabb",
			},
		]);
		expect(index.records()).toEqual([]);
	});
});

describe("dynamic entity controller tick", () => {
	it("updates animation playback, placement, bounds, and index membership coherently", () => {
		const store = new DynamicEntityStore();
		store.upsert(
			createReadyRecord({
				partPose: createPlacement({ x: 190, y: 0, z: 0 }),
			}),
		);
		const controller = new DynamicEntityController({ store });

		const changed = controller.tick(0);

		expect(changed).toBe(true);
		expect(controller.createSnapshot().records[0]?.bounds).toMatchObject({
			currentBounds: {
				precision: "current-frame-source-part-bounds-aabb",
			},
			indexed: true,
			precision: "current-frame-source-part-bounds-aabb",
		});
	});

	it("does not stringify placement state while detecting unchanged bounds", () => {
		const store = new DynamicEntityStore();
		store.upsert(
			createReadyRecord({
				partPose: createPlacement({ x: 20, y: 0, z: -20 }),
			}),
		);
		const controller = new DynamicEntityController({ store });

		controller.tick(0);
		const stringify = vi.spyOn(JSON, "stringify").mockImplementation(() => {
			throw new Error("Placement hot-path equality must not stringify.");
		});
		try {
			const changed = controller.tick(0);
			expect(changed).toBe(false);
		} finally {
			stringify.mockRestore();
		}
	});

	it("exposes indexed outdoor dynamic bounds through a narrow query surface", () => {
		const store = new DynamicEntityStore();
		const sourceLandblockId = makeOutdoorLandblockId(0xda, 0x55);
		store.upsert(
			createReadyRecord({
				partPose: createPlacement({ x: 20, y: 0, z: -20 }),
				sourceLandblockId,
			}),
		);
		const controller = new DynamicEntityController({ store });

		controller.tick(0);

		expect(controller.queryOutdoorDynamicLandblockIds()).toEqual([
			sourceLandblockId,
		]);
		expect(
			controller.queryOutdoorDynamicBounds({
				bounds: {
					max: { x: 45, y: 10, z: -95 },
					min: { x: 15, y: -10, z: -125 },
				},
				landblockId: sourceLandblockId,
			}),
		).toMatchObject([
			{
				entityId: "dynamic-test-entity",
				landblockId: sourceLandblockId,
				precision: "current-frame-source-part-bounds-aabb",
			},
		]);
	});
});

function createReadyRecord(
	options: {
		readonly activeOmegaRotation?: PlacementTransformDto["orientation"];
		readonly partPose?: PlacementTransformDto;
		readonly sourceLandblockId?: number;
		readonly sourceResidence?: DynamicEntityRecord["sourceResidence"];
	} = {},
): DynamicEntityRecord {
	const sourceLandblockId =
		options.sourceLandblockId ??
		(options.sourceResidence?.kind === "outdoor-landblock"
			? options.sourceResidence.landblockId
			: makeOutdoorLandblockId(0xda, 0x55));
	const sourceResidence =
		options.sourceResidence ??
		({
			kind: "outdoor-landblock",
			landblockId: sourceLandblockId,
		} satisfies DynamicEntityRecord["sourceResidence"]);
	const source = createSourceIdentity(0x020003e5);
	const object: StaticObjectInstanceIdentity = {
		instanceId: "dynamic-test-object",
		kind: "static-object-instance",
		landblockId: sourceLandblockId,
		objectKind: "building",
	};
	const partPose = options.partPose ?? createPlacement({ x: 0, y: 0, z: 0 });

	return {
		animation: {
			defaultAnimationId: 0x0300061b,
			playback: {
				animationAssetId: "animation/0300061b",
				animationId: 0x0300061b,
				currentFrameIndex: 0,
				elapsedSeconds: 0,
				frameCount: 1,
				frameNumber: 0,
				frameRateFps: 30,
				lastDispatchedHookFrame: null,
				loopIteration: 0,
				objectRootPose: createPlacement({ x: 0, y: 0, z: 0 }),
				partCount: 1,
				partPoses: [{ localPlacement: partPose, partIndex: 0 }],
				startedAtSeconds: 0,
				status: "playing",
				transformEffects: {
					activeOmega: options.activeOmegaRotation
						? {
								animationAssetId: "animation/03000751",
								animationId: 0x03000751,
								entityId: "dynamic-test-entity",
								hookName: "SetOmega",
								hookType: 22,
								lastAppliedFrameIndex: 0,
								lastAppliedLoopIteration: 0,
								lastIntegratedAtSeconds: 0,
								objectRootRotation: options.activeOmegaRotation,
								omega: { x: 0, y: 0, z: -0.03836006671190262 },
								rawPayloadBytes: [
									0, 0, 0, 0, 0, 0, 0, 0, 0x72, 0x20, 0x1d, 0xbd,
								],
							}
						: null,
				},
			},
			status: "ready",
		},
		baseTransform: {
			baseLocalPlacement: createPlacement({ x: 0, y: 0, z: 0 }),
			sourceScale: { x: 1, y: 1, z: 1 },
		},
		bounds: {
			currentBounds: null,
			indexMembership: { kind: "none" },
			indexed: false,
			precision: "none",
		},
		effectiveResidence: sourceResidence,
		id: "dynamic-test-entity",
		provenance: {
			kind:
				sourceResidence.kind === "env-cell"
					? "static-authored-env-cell"
					: "static-authored-outdoor",
			owner: {
				domain:
					sourceResidence.kind === "env-cell"
						? "landblock-env-cells"
						: "outdoor-buildings",
				kind: "work",
				scope: { kind: "landblock", landblockId: sourceLandblockId },
				scopeKey: `landblock:${sourceLandblockId.toString(16)}`,
				workId: "1:dynamic-test",
			},
			sourceScopeKey: "dynamic-test-scope",
		},
		renderability: {
			reasons: [],
			status: "non-renderable",
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
					payload: {
						animationAssetId: "animation/0300061b",
						animationId: 0x0300061b,
						dependencies: {},
						flags: 0,
						frameCount: 1,
						kind: "animation",
						objectPositionFrames: [],
						partCount: 1,
						partFrames: [
							{
								frameIndex: 0,
								hooks: [],
								localPlacements: [partPose],
							},
						],
						provenance: {
							detail: null,
							errorCode: null,
							source: "repo-local-hba",
							sourceAssetKind: "animation",
						},
						residencyKind: "unknown",
						sourceAssetKind: "animation",
					},
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
				sourceAssets: [createSourceAsset(source)],
				status: "ready",
				textureRefs: [],
				textureRequirements: [],
			},
		},
		sourceResidence,
		sourceSeed: {
			classificationReason: "setup-default-animation",
			defaultAnimationId: 0x0300061b,
			domain: "outdoor-buildings",
			landblockId: sourceLandblockId,
			localPlacement: createPlacement({ x: 0, y: 0, z: 0 }),
			object,
			setupModelId: 0x020003e5,
			source,
			sourceAssetId: "setup-model/020003e5",
			sourceResidence: {
				kind: "landblock-source",
				landblockId: sourceLandblockId,
				source: sourceResidence.kind === "env-cell" ? "env-cells" : "outdoor",
			},
			sourceScale: { x: 1, y: 1, z: 1 },
		},
	};
}

function createSourceAsset(
	source: StaticObjectSourceIdentity,
): StaticObjectSourceAssetFacts {
	const gfxObj = createSourceIdentity(0x01000020);
	return {
		bounds: {
			max: { x: 20, y: 1, z: -80 },
			min: { x: 0, y: 0, z: -100 },
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
					max: { x: 20, y: 1, z: -80 },
					min: { x: 0, y: 0, z: -100 },
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

function createPlacement(origin: {
	readonly x: number;
	readonly y: number;
	readonly z: number;
}): PlacementTransformDto {
	return {
		orientation: { w: 1, x: 0, y: 0, z: 0 },
		origin,
	};
}
