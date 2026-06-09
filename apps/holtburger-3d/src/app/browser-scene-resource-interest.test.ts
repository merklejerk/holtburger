import { describe, expect, it } from "vitest";

import {
	createBrowserDestinationFromSceneResourceInterest,
	createSceneResourceInterestFromBrowserDestination,
	createSceneResourceInterestFromBrowserMode,
} from "./browser-scene-resource-interest";
import { createBrowserModeState, parseBrowserLocationInput } from "./browser-mode";
import { describeSceneResourceInterestKey } from "../lib/scene-runtime/scene-resource-interest";

describe("browser scene resource interest adapter", () => {
	it("adapts browser state into neutral scene interest", () => {
		const destination = parseBrowserLocationInput("da55", "manual", "outdoor");
		expect(destination).not.toBeNull();
		const interest = createSceneResourceInterestFromBrowserDestination({
			destination,
			terrainLodRadius: 2,
			buildingLodRadius: 1,
			detailLodRadius: 1,
			envCellLodRadius: 0,
		});

		expect(describeSceneResourceInterestKey(interest)).toBe(
			"outdoor:0xda55ffff:terrain-2:buildings-1:detail-1:env-cells-0",
		);

		const browserMode = {
			...createBrowserModeState(),
			destination,
			terrainLodRadius: 0,
			buildingLodRadius: -1,
			detailLodRadius: -1,
			envCellLodRadius: -1,
		};
		expect(
			describeSceneResourceInterestKey(
				createSceneResourceInterestFromBrowserMode(browserMode),
			),
		).toBe(
			"outdoor:0xda55ffff:terrain-0:buildings--1:detail--1:env-cells--1",
		);
	});

	it("adapts neutral scene interest back to browser destination shape for legacy planners", () => {
		const destination = parseBrowserLocationInput(
			"da550155",
			"manual",
			"dungeon",
		);
		expect(destination).not.toBeNull();
		const interest = createSceneResourceInterestFromBrowserDestination({
			destination,
			terrainLodRadius: 0,
			buildingLodRadius: 0,
			detailLodRadius: 0,
			envCellLodRadius: 0,
		});

		expect(createBrowserDestinationFromSceneResourceInterest(interest)).toEqual({
			kind: "interior-cell",
			label: "Env cell da550155",
			source: "manual",
			envCellId: 0xda550155,
			landblockId: 0xda55ffff,
		});
	});
});
