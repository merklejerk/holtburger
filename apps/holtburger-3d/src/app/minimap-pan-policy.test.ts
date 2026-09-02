import { describe, expect, it } from "vitest";

import type { MinimapSubject } from "./minimap-frame";
import {
	ANCHORED_MINIMAP_PAN_STATE,
	detachMinimapPan,
	minimapPanCenter,
	reanchorMinimapPanAfterSubjectTravel,
} from "./minimap-pan-policy";
import { MINIMAP_AUTOMATIC_REANCHOR_DISTANCE_METERS } from "./minimap-tuning";

describe("map pan policy", () => {
	it("holds a detached centre while the same subject remains nearby", () => {
		const initial = subject({ worldX: 10, worldZ: 20 });
		const state = detachMinimapPan({ worldX: 30, worldZ: 40 }, initial);
		const nearby = subject({
			worldX: 10 + MINIMAP_AUTOMATIC_REANCHOR_DISTANCE_METERS / 2,
			worldZ: 20,
		});

		expect(
			reanchorMinimapPanAfterSubjectTravel(
				state,
				nearby,
				MINIMAP_AUTOMATIC_REANCHOR_DISTANCE_METERS,
			),
		).toBe(state);
		expect(minimapPanCenter(state, nearby)).toEqual({ worldX: 30, worldZ: 40 });
	});

	it("reanchors at the configured subject displacement", () => {
		const state = detachMinimapPan(
			{ worldX: 30, worldZ: 40 },
			subject({ worldX: 10, worldZ: 20 }),
		);

		expect(
			reanchorMinimapPanAfterSubjectTravel(
				state,
				subject({
					worldX: 10 + MINIMAP_AUTOMATIC_REANCHOR_DISTANCE_METERS,
					worldZ: 20,
				}),
				MINIMAP_AUTOMATIC_REANCHOR_DISTANCE_METERS,
			),
		).toBe(ANCHORED_MINIMAP_PAN_STATE);
	});

	it("does not carry a detached view across subject identity or availability", () => {
		const state = detachMinimapPan(
			{ worldX: 30, worldZ: 40 },
			subject({ guid: 1 }),
		);

		expect(
			reanchorMinimapPanAfterSubjectTravel(
				state,
				subject({ guid: 2 }),
				MINIMAP_AUTOMATIC_REANCHOR_DISTANCE_METERS,
			),
		).toBe(ANCHORED_MINIMAP_PAN_STATE);
		expect(
			reanchorMinimapPanAfterSubjectTravel(
				state,
				null,
				MINIMAP_AUTOMATIC_REANCHOR_DISTANCE_METERS,
			),
		).toBe(ANCHORED_MINIMAP_PAN_STATE);
	});
});

function subject(
	overrides: {
		readonly guid?: number;
		readonly worldX?: number;
		readonly worldZ?: number;
	} = {},
): MinimapSubject {
	return {
		anchor: {
			headingRadians: 0,
			residency: null,
			worldX: overrides.worldX ?? 0,
			worldY: 0,
			worldZ: overrides.worldZ ?? 0,
		},
		guid: overrides.guid ?? 1,
		kind: "controlled-entity",
	};
}
