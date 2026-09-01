import { describe, expect, it } from "vitest";

import {
	cellId,
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
		identity: { guid, wcid: 42 },
		display: { name: "Drudge", level: null },
		presentation: {
			entityClass: "other",
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
				landblockId: cellId(0xda550001),
				coords: { x: 1, y: 2, z: 3 },
				rotation: { w: 1, x: 0, y: 0, z: 0 },
			},
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

function ticked(
	value: DynamicEntityView & { placement: DynamicEntityWorldPlacement },
	hostSeconds: number,
): Extract<DynamicEntityEvent, { kind: "ticked" }> {
	return {
		kind: "ticked",
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
			updates: [],
		},
	};
}

function updated(
	value: DynamicEntityView,
	hostSeconds: number,
): Extract<DynamicEntityEvent, { kind: "ticked" }> {
	return {
		kind: "ticked",
		batch: {
			hostTime: { seconds: hostSeconds },
			durationMs: 1000 / 30,
			advances: [],
			updates: [value],
		},
	};
}

function worldPlacement(value: DynamicEntityView): DynamicEntityWorldPlacement {
	if (value.placement.kind !== "world")
		throw new Error("test fixture unexpectedly became attached");
	return value.placement;
}

describe("dynamic-entity view contract", () => {
	it("requires and preserves the producer-resolved presentation class", () => {
		const view = entity(1, 1);
		expect(decodeDynamicEntityView(view).presentation.entityClass).toBe(
			"other",
		);
		expect(() =>
			decodeDynamicEntityView({
				...view,
				presentation: { ...view.presentation, entityClass: "vendor" },
			}),
		).toThrow();
		const { entityClass, ...presentationWithoutClass } = view.presentation;
		expect(entityClass).toBe("other");
		expect(() =>
			decodeDynamicEntityView({
				...view,
				presentation: presentationWithoutClass,
			}),
		).toThrow();
	});

	it("preserves absent and zero display levels and rejects negative levels", () => {
		const view = entity(1, 1);
		expect(decodeDynamicEntityView(view).display.level).toBeNull();
		expect(
			decodeDynamicEntityView({
				...view,
				display: { ...view.display, level: 0 },
			}).display.level,
		).toBe(0);
		expect(() =>
			decodeDynamicEntityView({
				...view,
				display: { ...view.display, level: -1 },
			}),
		).toThrow();
	});

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
		const worldAdvance = ticked(entity(2, 1), 2);
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
			"display",
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
	it("applies path-stable updates and rejects duplicate tick identities", () => {
		const mirror = new DynamicEntityMirror();
		mirror.apply(snapshot(entity(7, 2)));
		const next = entity(7, 2);
		next.placement.contact = "grounded";
		expect(mirror.apply(updated(next, 2))).toBe(true);
		expect(worldPlacement(mirror.entities()[0]!).contact).toBe("grounded");

		const duplicate = ticked(entity(7, 2), 3);
		duplicate.batch.updates.push(entity(7, 2));
		expect(() => decodeDynamicEntityEvent(duplicate)).toThrow("duplicate GUID");
	});

	it("accepts zero-duration correction snaps but not zero-duration integration", () => {
		const value = entity(7, 2);
		const correction = ticked(value, 2);
		correction.batch.durationMs = 0;
		correction.batch.advances[0]!.kind = "correction-snap";
		expect(decodeDynamicEntityEvent(correction)).toEqual(correction);

		const integrated = ticked(value, 3);
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
		expect(mirror.entity(2, 1)).toEqual(entity(2, 1));
		expect(mirror.entity(2, 2)).toBeNull();
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

	it("accepts only newer exact-generation tick batches", () => {
		const mirror = new DynamicEntityMirror();
		mirror.apply(snapshot(entity(7, 2)));
		const stale = entity(7, 1);
		stale.placement.pose.coords.x = 9;
		expect(mirror.apply(ticked(stale, 2))).toBe(false);

		const current = entity(7, 2);
		current.placement.pose.coords.x = 10;
		expect(mirror.apply(ticked(current, 3))).toBe(true);
		expect(worldPlacement(mirror.entities()[0]!).pose.coords.x).toBe(10);

		const late = entity(7, 2);
		late.placement.pose.coords.x = 11;
		expect(mirror.apply(ticked(late, 2.5))).toBe(false);
		expect(worldPlacement(mirror.entities()[0]!).pose.coords.x).toBe(10);
	});
});
