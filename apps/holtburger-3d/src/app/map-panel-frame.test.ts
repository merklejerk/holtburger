import { describe, expect, it } from "vitest";

import type { MapTerrainSource } from "../lib/game/map/map-renderer";
import type { MapPanelFrame, MapPanelState } from "./map-panel-frame";
import {
	captureMapPanelDrawState,
	sameMapPanelDrawState,
} from "./map-panel-frame";

describe("map panel draw state", () => {
	it("stays current across equivalent imperative reads", () => {
		const source = mapSource();
		const first = captureMapPanelDrawState(frame({ source }), panel());
		const second = captureMapPanelDrawState(frame({ source }), panel());

		expect(sameMapPanelDrawState(first, second)).toBe(true);
	});

	it.each([
		["terrain residency", { terrainRevision: 2 }],
		["map geometry", { geometryRevision: 2 }],
		["entity placement", { presentedEntityRevision: 2 }],
		["anchor position", { worldX: 11 }],
		["anchor height", { worldY: 21 }],
		["anchor residency", { envCellId: "0x01020101" }],
		["anchor heading", { headingRadians: 0.5 }],
		["camera heading", { cameraHeadingRadians: 0.75 }],
		["camera field of view", { cameraFovRadians: 1.25 }],
		["panel size", { size: 240 }],
		["zoom", { viewDiameter: 384 }],
	] as const)("invalidates for changed %s", (_label, change) => {
		const source = mapSource();
		const before = captureMapPanelDrawState(frame({ source }), panel());
		if ("terrainRevision" in change)
			source.terrainInstallationRevision = change.terrainRevision;
		if ("geometryRevision" in change)
			source.mapGeometry.revision = change.geometryRevision;
		const changedFrame = frame({
			cameraFovRadians:
				"cameraFovRadians" in change ? change.cameraFovRadians : undefined,
			cameraHeadingRadians:
				"cameraHeadingRadians" in change
					? change.cameraHeadingRadians
					: undefined,
			envCellId: "envCellId" in change ? change.envCellId : undefined,
			headingRadians:
				"headingRadians" in change ? change.headingRadians : undefined,
			presentedEntityRevision:
				"presentedEntityRevision" in change
					? change.presentedEntityRevision
					: undefined,
			source,
			worldX: "worldX" in change ? change.worldX : undefined,
			worldY: "worldY" in change ? change.worldY : undefined,
		});
		const changedPanel = panel({
			size: "size" in change ? change.size : undefined,
			viewDiameter: "viewDiameter" in change ? change.viewDiameter : undefined,
		});

		expect(
			sameMapPanelDrawState(
				before,
				captureMapPanelDrawState(changedFrame, changedPanel),
			),
		).toBe(false);
	});
});

interface MutableMapSource {
	terrainInstallationRevision: number;
	readonly mapGeometry: { revision: number };
}

function mapSource(): MutableMapSource & MapTerrainSource {
	return {
		terrainInstallationRevision: 1,
		listInstalledTerrain: () => [],
		mapGeometry: { revision: 1 } as MapTerrainSource["mapGeometry"],
		terrainColorPalette: () => null,
	};
}

function frame(
	overrides: {
		readonly source?: MapTerrainSource;
		readonly worldX?: number;
		readonly worldY?: number;
		readonly envCellId?: "0x01020101";
		readonly headingRadians?: number;
		readonly presentedEntityRevision?: number;
		readonly cameraFovRadians?: number;
		readonly cameraHeadingRadians?: number;
	} = {},
): MapPanelFrame {
	return {
		anchor: {
			headingRadians: overrides.headingRadians ?? 0,
			residency: {
				envCellId: overrides.envCellId ?? "0x01020100",
				landblockId: "0x0102ffff",
			},
			worldX: overrides.worldX ?? 10,
			worldY: overrides.worldY ?? 20,
			worldZ: 30,
		},
		cameraFovRadians: overrides.cameraFovRadians ?? 1,
		cameraHeadingRadians: overrides.cameraHeadingRadians ?? 0,
		presentedEntities: () => [],
		presentedEntityRevision: overrides.presentedEntityRevision ?? 1,
		source: overrides.source ?? mapSource(),
	};
}

function panel(
	overrides: {
		readonly size?: number;
		readonly viewDiameter?: number;
	} = {},
): MapPanelState {
	return {
		left: 10,
		size: overrides.size ?? 220,
		top: 20,
		viewDiameter: overrides.viewDiameter ?? 192,
	};
}
