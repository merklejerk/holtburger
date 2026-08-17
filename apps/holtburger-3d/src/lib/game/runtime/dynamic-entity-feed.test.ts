import { describe, expect, it } from "vitest";

import {
	DynamicEntityMirror,
	type DynamicEntityEvent,
	type DynamicEntityView,
} from "./dynamic-entity-feed";

function entity(guid: number, generation: number): DynamicEntityView {
	return {
		generation,
		identity: { guid, wcid: 42, name: "Drudge" },
		presentation: {
			content: {
				setupDid: 0x02000001,
				motionTableDid: 0x09000001,
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
		motion: null,
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

describe("DynamicEntityMirror", () => {
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
});
