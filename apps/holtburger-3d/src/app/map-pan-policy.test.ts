import { describe, expect, it } from "vitest";

import { MAP_AUTOMATIC_REANCHOR_DISTANCE_METERS } from "../lib/game/map/map-appearance";
import type { MapPanelSubject } from "./map-panel-frame";
import {
	ANCHORED_MAP_PAN_STATE,
	detachMapPan,
	mapPanCenter,
	reanchorMapPanAfterSubjectTravel,
} from "./map-pan-policy";

describe("map pan policy", () => {
	it("holds a detached centre while the same subject remains nearby", () => {
		const initial = subject({ worldX: 10, worldZ: 20 });
		const state = detachMapPan({ worldX: 30, worldZ: 40 }, initial);
		const nearby = subject({
			worldX: 10 + MAP_AUTOMATIC_REANCHOR_DISTANCE_METERS / 2,
			worldZ: 20,
		});

		expect(
			reanchorMapPanAfterSubjectTravel(
				state,
				nearby,
				MAP_AUTOMATIC_REANCHOR_DISTANCE_METERS,
			),
		).toBe(state);
		expect(mapPanCenter(state, nearby)).toEqual({ worldX: 30, worldZ: 40 });
	});

	it("reanchors at the configured subject displacement", () => {
		const state = detachMapPan(
			{ worldX: 30, worldZ: 40 },
			subject({ worldX: 10, worldZ: 20 }),
		);

		expect(
			reanchorMapPanAfterSubjectTravel(
				state,
				subject({
					worldX: 10 + MAP_AUTOMATIC_REANCHOR_DISTANCE_METERS,
					worldZ: 20,
				}),
				MAP_AUTOMATIC_REANCHOR_DISTANCE_METERS,
			),
		).toBe(ANCHORED_MAP_PAN_STATE);
	});

	it("does not carry a detached view across subject identity or availability", () => {
		const state = detachMapPan(
			{ worldX: 30, worldZ: 40 },
			subject({ guid: 1 }),
		);

		expect(
			reanchorMapPanAfterSubjectTravel(
				state,
				subject({ guid: 2 }),
				MAP_AUTOMATIC_REANCHOR_DISTANCE_METERS,
			),
		).toBe(ANCHORED_MAP_PAN_STATE);
		expect(
			reanchorMapPanAfterSubjectTravel(
				state,
				null,
				MAP_AUTOMATIC_REANCHOR_DISTANCE_METERS,
			),
		).toBe(ANCHORED_MAP_PAN_STATE);
	});
});

function subject(
	overrides: {
		readonly guid?: number;
		readonly worldX?: number;
		readonly worldZ?: number;
	} = {},
): MapPanelSubject {
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
