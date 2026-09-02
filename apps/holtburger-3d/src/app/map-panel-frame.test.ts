import { describe, expect, it } from "vitest";

import type { MapTerrainSource } from "../lib/game/map/map-renderer";
import type {
	MapPanelFrame,
	MapPanelGpuDrawState,
	MapPanelState,
} from "./map-panel-frame";
import {
	captureMapPanelGpuDrawState,
	mapPanelViewDiameter,
	sameMapPanelGpuDrawState,
} from "./map-panel-frame";

describe("map panel GPU draw state", () => {
	it("stays current across equivalent imperative reads", () => {
		const source = mapSource();
		const first = gpuDrawState(frame({ source }), panel());
		const second = gpuDrawState(frame({ source }), panel());

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
		const before = gpuDrawState(frame({ source }), panel());
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
				gpuDrawState(changedFrame, changedPanel),
			),
		).toBe(false);
	});

	it("ignores changes drawn only by the uncapped overlay", () => {
		const source = mapSource();
		const before = gpuDrawState(frame({ source }), panel());
		const after = gpuDrawState(
			frame({
				cameraFovRadians: 1.25,
				cameraHeadingRadians: 0.75,
				controlledGuid: 7,
				source,
			}),
			panel(),
		);

		expect(sameMapPanelGpuDrawState(before, after)).toBe(true);
	});

	it("does not redraw detached terrain for subject translation alone", () => {
		const source = mapSource();
		const center = { worldX: 50, worldZ: 60 };
		const before = gpuDrawStateAtCenter(
			frame({ source, worldX: 10 }),
			panel(),
			center,
		);
		const after = gpuDrawStateAtCenter(
			frame({ source, worldX: 11 }),
			panel(),
			center,
		);

		expect(sameMapPanelGpuDrawState(before, after)).toBe(true);
	});

	it("remembers indoor and outdoor zoom independently", () => {
		const state = panel({ indoorViewDiameter: 48, outdoorViewDiameter: 384 });

		expect(mapPanelViewDiameter(state, frame().subject?.anchor ?? null)).toBe(
			48,
		);
		expect(
			mapPanelViewDiameter(
				state,
				frame({ envCellId: null }).subject?.anchor ?? null,
			),
		).toBe(384);
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
		readonly cameraFovRadians?: number;
		readonly cameraHeadingRadians?: number;
		readonly controlledGuid?: number;
	} = {},
): MapPanelFrame {
	return {
		cameraFovRadians: overrides.cameraFovRadians ?? 1,
		cameraHeadingRadians: overrides.cameraHeadingRadians ?? 0,
		presentedEntities: () => [],
		source: overrides.source ?? mapSource(),
		subject: {
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
			...(overrides.controlledGuid === undefined
				? { kind: "free-camera" as const }
				: {
						guid: overrides.controlledGuid,
						kind: "controlled-entity" as const,
					}),
		},
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

function gpuDrawState(
	frameValue: MapPanelFrame,
	panelValue: MapPanelState,
): MapPanelGpuDrawState {
	const anchor = frameValue.subject?.anchor ?? null;
	return gpuDrawStateAtCenter(
		frameValue,
		panelValue,
		anchor === null ? null : { worldX: anchor.worldX, worldZ: anchor.worldZ },
	);
}

function gpuDrawStateAtCenter(
	frameValue: MapPanelFrame,
	panelValue: MapPanelState,
	center: { readonly worldX: number; readonly worldZ: number } | null,
): MapPanelGpuDrawState {
	const anchor = frameValue.subject?.anchor ?? null;
	return captureMapPanelGpuDrawState(
		frameValue,
		panelValue,
		anchor === null || center === null
			? null
			: {
					anchor,
					center,
					viewDiameter: mapPanelViewDiameter(panelValue, anchor),
				},
	);
}
