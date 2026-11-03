import { describe, expect, it } from "vitest";

import {
	DynamicEntityMirror,
	type DynamicEntitySnapshot,
	type DynamicEntityView,
} from "./dynamic-entity-feed";

const OBSERVED_ENTITY_COUNT = 308;
const STRESS_ENTITY_COUNT = 600;

describe("dynamic entity snapshot generations", () => {
	it("reconciles 308 then 600 entities while stale generations remain refused", () => {
		const mirror = new DynamicEntityMirror(() => 1);
		mirror.apply({
			kind: "snapshot",
			snapshot: snapshot(OBSERVED_ENTITY_COUNT, 1),
		});
		expect(mirror.entities()).toHaveLength(OBSERVED_ENTITY_COUNT);

		const stale = view(1, 0);
		expect(mirror.apply({ kind: "upserted", entity: stale })).toBe(false);
		mirror.awaitSnapshot();
		expect(mirror.apply({ kind: "upserted", entity: view(700, 2) })).toBe(
			false,
		);
		mirror.apply({
			kind: "snapshot",
			snapshot: snapshot(STRESS_ENTITY_COUNT, 2),
		});
		expect(mirror.entities()).toHaveLength(STRESS_ENTITY_COUNT);
	});
});

function snapshot(count: number, hostSeconds: number): DynamicEntitySnapshot {
	return {
		hostTime: { seconds: hostSeconds },
		entities: Array.from({ length: count }, (_, index) => view(index + 1, 1)),
	};
}

function view(guid: number, generation: number): DynamicEntityView {
	return {
		generation,
		identity: { guid, wcid: 42 },
		display: { name: `Entity ${guid}`, level: null },
		presentation: {
			placementFrame: 0,
			entityClass: "other",
			content: {
				motionTableDid: null,
				setupDid: 0x0200_0001,
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
				behavior: null,
				category: "other",
				obviousRange: null,
			},
		},
		physics: {
			semanticMask: 0,
			participation: "pose-only",
			noDraw: false,
			hidden: false,
			cloaked: false,
			translucency: 0,
			lighting: true,
			defaultAnimation: false,
			defaultScript: false,
		},
		placement: {
			kind: "attached",
			parent: 0,
			parentLocation: "none",
			placement: "default",
		},
		motion: null,
	};
}
