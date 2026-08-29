import { describe, expect, it } from "vitest";

import { MAX_PENDING_REQUESTS } from "../host/host-limits";
import { HostRequestGate } from "../host/host-request-gate";
import { MAX_SETUP_VISUAL_REQUESTS } from "./setup-visual-host-source";
import {
	DynamicEntityMirror,
	type DynamicEntitySnapshot,
	type DynamicEntityView,
} from "../game/runtime/dynamic-entity-feed";

const OBSERVED_ENTITY_COUNT = 308;
const STRESS_ENTITY_COUNT = 600;

describe("setup visual request gate", () => {
	it("keeps the observed and stress snapshots below the sidecar pending cap", async () => {
		const gate = new HostRequestGate(MAX_SETUP_VISUAL_REQUESTS);
		let completed = 0;
		const requests = Array.from({ length: STRESS_ENTITY_COUNT }, () =>
			gate.schedule(async () => {
				await new Promise((resolve) => setTimeout(resolve, 0));
				completed += 1;
			}),
		);

		await Promise.all(requests);

		expect(completed).toBe(STRESS_ENTITY_COUNT);
		expect(gate.peakActiveCount).toBe(MAX_SETUP_VISUAL_REQUESTS);
		expect(gate.peakActiveCount).toBeLessThan(MAX_PENDING_REQUESTS);
	});

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
		identity: { guid, wcid: 42, name: `Entity ${guid}` },
		presentation: {
			category: "other",
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
			radar: { blipColor: "Default", behavior: null, obviousRange: null },
		},
		physics: {
			semanticMask: 0,
			participation: "pose-only",
			noDraw: false,
			hidden: false,
			cloaked: false,
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
		playingClip: null,
	};
}
