import { describe, expect, it } from "vitest";

import type { MapTerrainSource } from "../lib/game/map/map-renderer";
import type { MapPanelFrame, MapPanelState } from "./map-panel-frame";
import {
	captureMapPanelGpuDrawState,
	mapPanelViewDiameter,
	sameMapPanelGpuDrawState,
} from "./map-panel-frame";

describe("map panel GPU draw state", () => {
	it("stays current across equivalent imperative reads", () => {
		const source = mapSource();
		const first = captureMapPanelGpuDrawState(frame({ source }), panel());
		const second = captureMapPanelGpuDrawState(frame({ source }), panel());

		expect(sameMapPanelGpuDrawState(first, second)).toBe(true);
	});

	it.each([
		["terrain residency", { terrainRevision: 2 }],
		["map geometry", { geometryRevision: 2 }],
		["anchor position", { worldX: 11 }],
		["anchor height", { worldY: 21 }],
		["anchor residency", { envCellId: "0x01020101" }],
		["anchor heading", { headingRadians: 0.5 }],
		["panel size", { size: 240 }],
		["indoor zoom", { indoorViewDiameter: 384 }],
	] as const)("invalidates for changed %s", (_label, change) => {
		const source = mapSource();
		const before = captureMapPanelGpuDrawState(frame({ source }), panel());
		if ("terrainRevision" in change)
			source.terrainInstallationRevision = change.terrainRevision;
		if ("geometryRevision" in change)
			source.mapGeometry.revision = change.geometryRevision;
		const changedFrame = frame({
			envCellId: "envCellId" in change ? change.envCellId : undefined,
			headingRadians:
				"headingRadians" in change ? change.headingRadians : undefined,
			source,
			worldX: "worldX" in change ? change.worldX : undefined,
			worldY: "worldY" in change ? change.worldY : undefined,
		});
		const changedPanel = panel({
			size: "size" in change ? change.size : undefined,
			indoorViewDiameter:
				"indoorViewDiameter" in change ? change.indoorViewDiameter : undefined,
		});

		expect(
			sameMapPanelGpuDrawState(
				before,
				captureMapPanelGpuDrawState(changedFrame, changedPanel),
			),
		).toBe(false);
	});

	it("ignores changes drawn only by the uncapped overlay", () => {
		const source = mapSource();
		const before = captureMapPanelGpuDrawState(frame({ source }), panel());
		const after = captureMapPanelGpuDrawState(
			frame({
				cameraFovRadians: 1.25,
				cameraHeadingRadians: 0.75,
				presentedEntityRevision: 2,
				source,
			}),
			panel(),
		);

		expect(sameMapPanelGpuDrawState(before, after)).toBe(true);
	});

	it("remembers indoor and outdoor zoom independently", () => {
		const state = panel({ indoorViewDiameter: 48, outdoorViewDiameter: 384 });

		expect(mapPanelViewDiameter(state, frame().anchor)).toBe(48);
		expect(mapPanelViewDiameter(state, frame({ envCellId: null }).anchor)).toBe(
			384,
		);
		expect(mapPanelViewDiameter(state, null)).toBe(384);
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
		readonly envCellId?: "0x01020101" | null;
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
				envCellId:
					overrides.envCellId === undefined
						? "0x01020100"
						: overrides.envCellId,
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
		readonly indoorViewDiameter?: number;
		readonly outdoorViewDiameter?: number;
	} = {},
): MapPanelState {
	return {
		left: 10,
		size: overrides.size ?? 220,
		top: 20,
		viewDiameters: {
			indoor: overrides.indoorViewDiameter ?? 192,
			outdoor: overrides.outdoorViewDiameter ?? 192,
		},
	};
}
