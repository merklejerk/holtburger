import { describe, expect, it } from "vitest";

import type { DecodedStaticPresentation } from "../../assets/decode-static-source-record";
import { AABB3, Mat4, Vec3 } from "../math/types";
import { adaptAuthoredDynamicPresentation } from "../resolution/authored-dynamic-presentation";
import type { AuthoredDynamicSource } from "../resolution/landblock-layer";
import {
	adaptSpawnedDynamicPresentation,
	spawnedDynamicPlacement,
} from "./spawned-dynamic-presentation";
import type { DynamicEntityView } from "./dynamic-entity-feed";

describe("dynamic presentation producer adapters", () => {
	it("adds resident-only membership to authored placement without reinterpreting its facts", () => {
		const visual = fixtureVisual();
		const behavior = {
			animationId: "0x03000001",
			kind: "animation-only",
			motionTableId: null,
			physicsScriptId: null,
			physicsScriptTableId: null,
			soundTableId: "0x20000001",
		} as const;
		const placement = {
			envCellId: null,
			landblockId: "0x0102ffff" as const,
			localTransform: Mat4.identity(),
		};
		const authored: AuthoredDynamicSource = {
			behavior,
			identity: { kind: "authored", sourceId: "resident:1" },
			localBounds: visual.localBounds,
			placement,
			presentation: visual.presentation,
			scale: new Vec3(2, 3, 4),
			setupId: "0x02000001",
		};

		const adapted = adaptAuthoredDynamicPresentation(authored);
		expect(adapted.placement).toMatchObject({
			...placement,
			spatialMembership: { scopes: [{ kind: "outdoor" }] },
		});
		expect(adapted.placement.localTransform).toBe(placement.localTransform);
		expect(adapted.source.presentation).toBe(visual.presentation);
		expect(adapted.source).toMatchObject({
			behavior,
			identity: "resident:1",
			scale: new Vec3(2, 3, 4),
			setupId: "0x02000001",
		});
	});

	it("uses host placement, AC axes, generation identity, scale, and explicit sound override", () => {
		const entity = fixtureEntity();
		const adapted = adaptSpawnedDynamicPresentation(entity, fixtureVisual());

		expect(adapted.source).toMatchObject({
			behavior: { soundTableId: "0x20000002" },
			identity: "dynamic-entity:0x00000007/3",
			scale: new Vec3(2, 2, 2),
			setupId: "0x02000001",
		});
		expect(adapted.placement).toMatchObject({
			envCellId: "0x01020123",
			landblockId: "0x0102ffff",
			localTransform: { m41: 10, m42: 30, m43: -20 },
			spatialMembership: {
				scopes: [
					{
						envCellId: "0x01020123",
						kind: "env-cell",
						landblockId: "0x0102ffff",
					},
				],
			},
		});
		expect(spawnedDynamicPlacement(entity)).toEqual(adapted.placement);
	});

	it("rejects a visual closure for a different setup", () => {
		const visual = { ...fixtureVisual(), setupId: "0x02000002" };
		expect(() =>
			adaptSpawnedDynamicPresentation(fixtureEntity(), visual),
		).toThrow("expected 0x02000001");
	});

	it("preserves outdoor and EnvCell membership for a portal-straddling spawn", () => {
		const entity = fixtureEntity();
		if (entity.placement.kind !== "world") {
			throw new Error("Expected a world-placement fixture.");
		}
		entity.placement.spatialMembership = {
			reachesOutdoors: true,
			reachedEnvCellIds: [0x01020123],
		};

		expect(spawnedDynamicPlacement(entity).spatialMembership.scopes).toEqual([
			{ kind: "outdoor" },
			{
				envCellId: "0x01020123",
				kind: "env-cell",
				landblockId: "0x0102ffff",
			},
		]);
	});

	it("rejects non-EnvCell ids in host spatial membership", () => {
		const entity = fixtureEntity();
		if (entity.placement.kind !== "world") {
			throw new Error("Expected a world-placement fixture.");
		}
		entity.placement.spatialMembership = {
			reachesOutdoors: false,
			reachedEnvCellIds: [0x01020001],
		};

		expect(() => spawnedDynamicPlacement(entity)).toThrow("non-EnvCell");
	});
});

function fixtureVisual(): DecodedStaticPresentation {
	return {
		behavior: {
			animationId: "0x03000001",
			kind: "animation-only",
			motionTableId: null,
			physicsScriptId: null,
			physicsScriptTableId: null,
			soundTableId: "0x20000001",
		},
		localBounds: AABB3.zero(),
		presentation: {
			appearanceKey: "setup:0x02000001|base",
			holdingLocations: new Map(),
			id: "presentation:fixture",
			lights: [],
			parts: [],
			placementPoses: new Map(),
			selectionBounds: null,
			sortingBounds: null,
			sourceAssetId: "setup-model/0x02000001",
		},
		setupId: "0x02000001",
	};
}

function fixtureEntity(): DynamicEntityView {
	return {
		generation: 3,
		identity: { guid: 7, name: "Fixture", wcid: 42 },
		physics: {
			cloaked: false,
			defaultAnimation: false,
			defaultScript: false,
			hidden: false,
			lighting: false,
			noDraw: false,
			participation: "pose-only",
			semanticMask: 0,
		},
		placement: {
			kind: "world",
			spatialMembership: {
				reachesOutdoors: false,
				reachedEnvCellIds: [0x01020123],
			},
			acceleration: { x: 0, y: 0, z: 0 },
			contact: "unknown",
			omega: { x: 0, y: 0, z: 0 },
			pose: {
				coords: { x: 10, y: 20, z: 30 },
				landblockId: 0x01020123,
				rotation: { w: 1, x: 0, y: 0, z: 0 },
			},
			sampleMode: "authoritative-only",
			velocity: { x: 0, y: 0, z: 0 },
		},
		presentation: {
			appearance: {
				paletteDid: null,
				partChanges: [],
				subPalettes: [],
				textureChanges: [],
			},
			content: {
				physicsEffectTableDid: null,
				motionTableDid: null,
				setupDid: 0x02000001,
				soundTableDid: 0x20000002,
			},
			objectScale: 2,
		},
	};
}
