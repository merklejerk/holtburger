import { describe, expect, it } from "vitest";

import {
	MAX_TRANSITION_PORTAL_MAX_DEPTH,
	MIN_TRANSITION_PORTAL_MAX_DEPTH,
	browserDestinationToInteriorCellId,
	browserLocationToLandblockId,
	createBrowserModeState,
	isIndoorBrowserDestination,
	isLandblockPrefixInput,
	parseBrowserLocationInput,
	previewBrowserLocation,
	selectBrowserLandblockDestination,
	updateBuildingLodRadius,
	updateBrowserDraft,
	updateCellIndicatorVisibility,
	updateDetailLodRadius,
	updateEnvCellLodRadius,
	updateLandblockInputMode,
	updatePortalPolygonVisibility,
	updatePortalTargetHighlighting,
	updateTerrainLodRadius,
	updateTransitionPortalMaxDepth,
} from "./browser-mode";

describe("browser-mode location policy", () => {
	it("starts with a known non-flat browser destination selected", () => {
		const state = createBrowserModeState();

		expect(state.draftInput).toBe("33.50S, 72.80E, 0.0Z");
		expect(state.draftInputEditedByUser).toBe(false);
		expect(state.destination?.label).toBe("33.50S, 72.80E, 0.0Z");
		expect(state.terrainLodRadius).toBe(2);
		expect(state.buildingLodRadius).toBe(1);
		expect(state.detailLodRadius).toBe(1);
		expect(state.envCellLodRadius).toBe(1);
		expect(state.transitionPortalMaxDepth).toBeGreaterThanOrEqual(
			MIN_TRANSITION_PORTAL_MAX_DEPTH,
		);
		expect(state.transitionPortalMaxDepth).toBeLessThanOrEqual(
			MAX_TRANSITION_PORTAL_MAX_DEPTH,
		);
		expect(state.landblockInputMode).toBe("dungeon");
		expect(state.showPortalPolygons).toBe(false);
		expect(state.showCellIndicators).toBe(false);
		expect(state.highlightPortalTargets).toBe(false);
		expect(state.page).toBe("destination-preview");
	});

	it("keeps portal diagnostic toggles in browser-owned mode state", () => {
		const state = updatePortalTargetHighlighting(
			updateCellIndicatorVisibility(
				updatePortalPolygonVisibility(createBrowserModeState(), true),
				false,
			),
			false,
		);

		expect(state.showPortalPolygons).toBe(true);
		expect(state.showCellIndicators).toBe(false);
		expect(state.highlightPortalTargets).toBe(false);
	});

	it("clamps transition portal recursion depth in browser-owned mode state", () => {
		expect(
			updateTransitionPortalMaxDepth(createBrowserModeState(), -1)
				.transitionPortalMaxDepth,
		).toBe(0);
		expect(
			updateTransitionPortalMaxDepth(createBrowserModeState(), 99)
				.transitionPortalMaxDepth,
		).toBe(MAX_TRANSITION_PORTAL_MAX_DEPTH);
		expect(
			updateTransitionPortalMaxDepth(createBrowserModeState(), 3.8)
				.transitionPortalMaxDepth,
		).toBe(3);
	});

	it("parses AC-style coordinate input into a stable selection label", () => {
		expect(parseBrowserLocationInput("100.4s, 101.55w, 1z")).toEqual({
			kind: "outdoor-location",
			label: "100.40S, 101.55W, 1.0Z",
			northSouth: 100.4,
			northSouthHemisphere: "S",
			eastWest: 101.55,
			eastWestHemisphere: "W",
			elevation: 1,
			source: "manual",
			landblockId: null,
		});
	});

	it("accepts compact coordinate input with omitted commas and elevation", () => {
		expect(parseBrowserLocationInput("100.4s 101.55w")).toEqual({
			kind: "outdoor-location",
			label: "100.40S, 101.55W, 0.0Z",
			northSouth: 100.4,
			northSouthHemisphere: "S",
			eastWest: 101.55,
			eastWestHemisphere: "W",
			elevation: 0,
			source: "manual",
			landblockId: null,
		});
	});

	it("accepts coordinate input with numeric elevation and no Z suffix", () => {
		expect(parseBrowserLocationInput("100.4s 101.55w -2.5")).toEqual({
			kind: "outdoor-location",
			label: "100.40S, 101.55W, -2.5Z",
			northSouth: 100.4,
			northSouthHemisphere: "S",
			eastWest: 101.55,
			eastWestHemisphere: "W",
			elevation: -2.5,
			source: "manual",
			landblockId: null,
		});
	});

	it("returns a validation message for invalid location input", () => {
		const state = previewBrowserLocation(
			updateBrowserDraft(createBrowserModeState(), "holtburg plaza"),
		);

		expect(state.validationMessage).toBe(
			"Use the AC-style location format: 100.40S, 101.55W.",
		);
		expect(state.destination).toBeNull();
		expect(state.page).toBe("location-entry");
	});

	it("can select a browser destination from an exact picked landblock id", () => {
		const state = selectBrowserLandblockDestination(
			createBrowserModeState(),
			0xda550123,
		);

		expect(state.destination?.source).toBe("landblock-pick");
		expect(state.destination?.kind).toBe("outdoor-location");
		expect(state.destination?.landblockId).toBe(0xda55ffff);
		expect(state.destination?.label).toContain("0xda55ffff");
		expect(state.draftInput).toBe(state.destination?.label);
		expect(browserLocationToLandblockId(state.destination!)).toBe(0xda55ffff);
	});

	it("defaults an explicit 32-bit landblock id to dungeon focus", () => {
		const state = previewBrowserLocation(
			updateBrowserDraft(createBrowserModeState(), "0xda55ffff"),
		);

		expect(isIndoorBrowserDestination(state.destination)).toBe(true);
		expect(state.destination?.landblockId).toBe(0xda55ffff);
		expect(state.draftInput).toBe("0xda55ffff");
		expect(browserDestinationToInteriorCellId(state.destination)).toBe(
			0xda550100,
		);
		expect(browserLocationToLandblockId(state.destination!)).toBe(0xda55ffff);
	});

	it("can resolve an explicit 32-bit landblock id to outdoor focus", () => {
		const state = previewBrowserLocation(
			updateLandblockInputMode(
				updateBrowserDraft(createBrowserModeState(), "0xda55ffff"),
				"outdoor",
			),
		);

		expect(state.destination?.kind).toBe("outdoor-location");
		expect(state.destination?.source).toBe("manual");
		expect(state.destination?.landblockId).toBe(0xda55ffff);
		expect(browserLocationToLandblockId(state.destination!)).toBe(0xda55ffff);
	});

	it("keeps the submitted cell id editable after previewing it", () => {
		const state = previewBrowserLocation(
			updateBrowserDraft(createBrowserModeState(), "016c0155"),
		);

		expect(state.draftInput).toBe("016c0155");
		expect(state.destination?.label).toContain("0x016c0155");
	});

	it("detects 16-bit landblock shorthand input", () => {
		expect(isLandblockPrefixInput("da55")).toBe(true);
		expect(isLandblockPrefixInput("0xda55")).toBe(true);
		expect(isLandblockPrefixInput("0xda55ffff")).toBe(false);
		expect(isLandblockPrefixInput("33.50S, 72.80E, 0.0Z")).toBe(false);
	});

	it("defaults 16-bit landblock shorthand to dungeon focus", () => {
		const state = previewBrowserLocation(
			updateBrowserDraft(createBrowserModeState(), "da55"),
		);

		expect(state.draftInput).toBe("da55");
		expect(isIndoorBrowserDestination(state.destination)).toBe(true);
		expect(browserDestinationToInteriorCellId(state.destination)).toBe(
			0xda550100,
		);
		expect(browserLocationToLandblockId(state.destination!)).toBe(0xda55ffff);
	});

	it("can resolve 16-bit landblock shorthand to outdoor focus", () => {
		const state = previewBrowserLocation(
			updateLandblockInputMode(
				updateBrowserDraft(createBrowserModeState(), "da55"),
				"outdoor",
			),
		);

		expect(state.draftInput).toBe("da55");
		expect(state.landblockInputMode).toBe("outdoor");
		expect(state.destination?.kind).toBe("outdoor-location");
		expect(state.destination?.landblockId).toBe(0xda55ffff);
		expect(browserLocationToLandblockId(state.destination!)).toBe(0xda55ffff);
	});

	it("can select an indoor env cell from an explicit 32-bit cell id", () => {
		const state = previewBrowserLocation(
			updateBrowserDraft(createBrowserModeState(), "016c0155"),
		);

		expect(isIndoorBrowserDestination(state.destination)).toBe(true);
		expect(state.destination?.label).toContain("0x016c0155");
		expect(browserDestinationToInteriorCellId(state.destination)).toBe(
			0x016c0155,
		);
		expect(browserLocationToLandblockId(state.destination!)).toBe(0x016cffff);
	});

	it("clamps browser LoD radii to ordered supported values", () => {
		expect(
			updateTerrainLodRadius(createBrowserModeState(), -2).terrainLodRadius,
		).toBe(0);
		expect(
			updateTerrainLodRadius(createBrowserModeState(), 99).terrainLodRadius,
		).toBe(8);

		const state = updateDetailLodRadius(
			updateBuildingLodRadius(
				updateTerrainLodRadius(createBrowserModeState(), 3),
				2,
			),
			8,
		);

		expect(state.terrainLodRadius).toBe(3);
		expect(state.buildingLodRadius).toBe(2);
		expect(state.detailLodRadius).toBe(2);

		const envCellState = updateEnvCellLodRadius(
			updateBuildingLodRadius(createBrowserModeState(), 1),
			8,
		);
		expect(envCellState.envCellLodRadius).toBe(2);
	});

	it("converts browser coordinates into a normalized outdoor landblock id", () => {
		const landblockId = browserLocationToLandblockId({
			kind: "outdoor-location",
			label: "29.90S, 65.90W, 0.0Z",
			northSouth: 29.9,
			northSouthHemisphere: "S",
			eastWest: 65.9,
			eastWestHemisphere: "W",
			elevation: 0,
			source: "manual",
			landblockId: null,
		});

		expect(landblockId).toBe(0x2d5affff);
	});

	it("returns unsigned landblock ids for coordinates in high landblock ranges", () => {
		const landblockId = browserLocationToLandblockId({
			kind: "outdoor-location",
			label: "33.60S, 72.70E, 0.0Z",
			northSouth: 33.6,
			northSouthHemisphere: "S",
			eastWest: 72.7,
			eastWestHemisphere: "E",
			elevation: 0,
			source: "manual",
			landblockId: null,
		});

		expect(landblockId).toBe(0xda55ffff);
		expect(landblockId).toBeGreaterThan(0);
	});
});
