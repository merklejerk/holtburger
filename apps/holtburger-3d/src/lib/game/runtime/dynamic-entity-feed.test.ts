import { describe, expect, it } from "vitest";

import {
	decodeDynamicEntityEvent,
	decodeDynamicEntityView,
	DynamicEntityMirror,
	type DynamicEntityEvent,
	type DynamicEntityView,
	type DynamicEntityWorldPlacement,
} from "./dynamic-entity-feed";

function entity(
	guid: number,
	generation: number,
): DynamicEntityView & { placement: DynamicEntityWorldPlacement } {
	return {
		generation,
		playingClip: null,
		identity: { guid, wcid: 42, name: "Drudge" },
		presentation: {
			content: {
				motionTableDid: null,
				setupDid: 0x02000001,
				soundTableDid: null,
				physicsEffectTableDid: null,
			},
			appearance: {
				paletteDid: null,
				subPalettes: [],
				textureChanges: [],
				partChanges: [],
			},
			objectScale: 1,
			radar: {
				blipColor: "Default",
				behavior: null,
				obviousRange: null,
			},
		},
		physics: {
			semanticMask: 0,
			participation: "pose-only",
			noDraw: false,
			hidden: false,
			cloaked: false,
			lighting: false,
			defaultAnimation: false,
			defaultScript: false,
		},
		placement: {
			kind: "world",
			spatialMembership: {
				reachesOutdoors: true,
				reachedEnvCellIds: [],
			},
			pose: {
				landblockId: 0xda550001,
				coords: { x: 1, y: 2, z: 3 },
				rotation: { w: 1, x: 0, y: 0, z: 0 },
			},
			velocity: { x: 0, y: 0, z: 0 },
			acceleration: { x: 0, y: 0, z: 0 },
			omega: { x: 0, y: 0, z: 0 },
			contact: "unknown",
			sampleMode: "authoritative-only",
		},
	};
}

function snapshot(...entities: DynamicEntityView[]): DynamicEntityEvent {
	return {
		kind: "snapshot",
		snapshot: { hostTime: { seconds: 1 }, entities },
	};
}

function upserted(value: DynamicEntityView): DynamicEntityEvent {
	return {
		kind: "upserted",
		entity: value,
	};
}

function advanced(
	value: DynamicEntityView & { placement: DynamicEntityWorldPlacement },
	hostSeconds: number,
): Extract<DynamicEntityEvent, { kind: "advanced" }> {
	return {
		kind: "advanced",
		batch: {
			hostTime: { seconds: hostSeconds },
			durationMs: 1000 / 30,
			advances: [
				{
					// The host always sends this field; `null` means "keep playing whatever you have".
					entity: value,
					kind: "integrated",
					path: {
						initial: {
							pose: value.placement.pose,
							spatialMembership: value.placement.spatialMembership,
						},
						legs: [
							{
								endFraction: 1,
								end: {
									pose: value.placement.pose,
									spatialMembership: value.placement.spatialMembership,
								},
							},
						],
					},
				},
			],
		},
	};
}

function worldPlacement(value: DynamicEntityView): DynamicEntityWorldPlacement {
	if (value.placement.kind !== "world")
		throw new Error("test fixture unexpectedly became attached");
	return value.placement;
}

describe("dynamic-entity view contract", () => {
	it("decodes the attached arm and rejects mixed world-motion facts", () => {
		const attached = {
			...entity(2, 1),
			placement: {
				kind: "attached" as const,
				parent: 1,
				parentLocation: "right-hand" as const,
				placement: "right-hand-combat" as const,
			},
		};
		expect(decodeDynamicEntityView(attached).placement).toEqual(
			attached.placement,
		);
		expect(() =>
			decodeDynamicEntityView({
				...attached,
				placement: {
					...attached.placement,
					pose: entity(1, 1).placement.pose,
				},
			}),
		).toThrow();
	});

	it("rejects path advances for an attached entity", () => {
		const worldAdvance = advanced(entity(2, 1), 2);
		const attached = {
			...entity(2, 1),
			placement: {
				kind: "attached" as const,
				parent: 1,
				parentLocation: "right-hand" as const,
				placement: "right-hand-combat" as const,
			},
		};
		expect(() =>
			decodeDynamicEntityEvent({
				...worldAdvance,
				batch: {
					...worldAdvance.batch,
					advances: worldAdvance.batch.advances.map((advance) => ({
						...advance,
						entity: attached,
					})),
				},
			}),
		).toThrow("advance targets attached GUID");
	});

	it("carries the motion table and still drops fields the contract does not declare", () => {
		// The motion-table identity is now part of the contract: an entity names the table it
		// animates from, and the frontend stages that table's closure before activation. The
		// capability boundary that used to strip it was removed with possession.
		//
		// What has not changed is that this is a contract, not a passthrough. A host that emits a
		// field this schema does not declare cannot deliver it past this boundary.
		const view = entity(1, 1);
		const decoded = decodeDynamicEntityView({
			...view,
			motion: { forwardCommand: 3 },
			presentation: {
				...view.presentation,
				content: { ...view.presentation.content, motionTableDid: 0x09000001 },
			},
		});
		expect(Object.keys(decoded).sort()).toEqual([
			"generation",
			"identity",
			"physics",
			"placement",
			"playingClip",
			"presentation",
		]);
		expect(decoded.presentation.content.motionTableDid).toBe(0x09000001);
		expect(Object.keys(decoded.presentation.content).sort()).toEqual([
			"motionTableDid",
			"physicsEffectTableDid",
			"setupDid",
			"soundTableDid",
		]);
	});
});

describe("DynamicEntityMirror", () => {
	it("accepts zero-duration correction snaps but not zero-duration integration", () => {
		const value = entity(7, 2);
		const correction = advanced(value, 2);
		correction.batch.durationMs = 0;
		correction.batch.advances[0]!.kind = "reset";
		expect(decodeDynamicEntityEvent(correction)).toEqual(correction);

		const integrated = advanced(value, 3);
		integrated.batch.durationMs = 0;
		expect(() => decodeDynamicEntityEvent(integrated)).toThrow(
			"duration must be positive",
		);
	});

	it("reconstructs atomically and ignores deltas while awaiting a snapshot", () => {
		const mirror = new DynamicEntityMirror(() => 10);
		mirror.apply(upserted(entity(1, 1)));
		expect(mirror.entities()).toEqual([]);

		mirror.apply(snapshot(entity(2, 1), entity(1, 1)));
		expect(mirror.entities().map((value) => value.identity.guid)).toEqual([
			1, 2,
		]);
		expect(mirror.isAwaitingSnapshot()).toBe(false);
		expect(mirror.hostTimeSeconds(12)).toBe(3);

		mirror.awaitSnapshot();
		expect(mirror.hostTimeSeconds()).toBeNull();
		mirror.apply(upserted(entity(3, 1)));
		expect(mirror.entities().map((value) => value.identity.guid)).toEqual([
			1, 2,
		]);
		mirror.apply(snapshot(entity(4, 1)));
		expect(mirror.entities()).toEqual([entity(4, 1)]);
	});

	it("uses instance generation to reject late upserts and removals", () => {
		const mirror = new DynamicEntityMirror();
		mirror.apply(snapshot(entity(7, 2)));
		mirror.apply(upserted(entity(7, 1)));
		mirror.apply({
			kind: "removed",
			guid: 7,
			generation: 1,
		});
		expect(mirror.entities()).toEqual([entity(7, 2)]);

		mirror.apply({
			kind: "removed",
			guid: 7,
			generation: 2,
		});
		expect(mirror.entities()).toEqual([]);
	});

	it("rejects duplicate identities before replacing the current population", () => {
		const mirror = new DynamicEntityMirror();
		mirror.apply(snapshot(entity(1, 1)));
		expect(() => mirror.apply(snapshot(entity(2, 1), entity(2, 2)))).toThrow(
			"duplicate GUID",
		);
		expect(mirror.entities()).toEqual([entity(1, 1)]);
	});

	it("accepts only newer exact-generation advance batches", () => {
		const mirror = new DynamicEntityMirror();
		mirror.apply(snapshot(entity(7, 2)));
		const stale = entity(7, 1);
		stale.placement.pose.coords.x = 9;
		expect(mirror.apply(advanced(stale, 2))).toBe(false);

		const current = entity(7, 2);
		current.placement.pose.coords.x = 10;
		expect(mirror.apply(advanced(current, 3))).toBe(true);
		expect(worldPlacement(mirror.entities()[0]!).pose.coords.x).toBe(10);

		const late = entity(7, 2);
		late.placement.pose.coords.x = 11;
		expect(mirror.apply(advanced(late, 2.5))).toBe(false);
		expect(worldPlacement(mirror.entities()[0]!).pose.coords.x).toBe(10);
	});
});
