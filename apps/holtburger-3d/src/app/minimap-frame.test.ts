import { describe, expect, it } from "vitest";

import type { MapTerrainSource } from "../lib/game/map/map-renderer";
import type {
	MinimapFrame,
	MinimapGpuDrawState,
	MinimapState,
} from "./minimap-frame";
import {
	captureMinimapGpuDrawState,
	minimapViewDiameter,
	sameMinimapGpuDrawState,
} from "./minimap-frame";

describe("minimap GPU draw state", () => {
	it("stays current across equivalent imperative reads", () => {
		const source = mapSource();
		const first = gpuDrawState(frame({ source }), minimapState());
		const second = gpuDrawState(frame({ source }), minimapState());

		expect(sameMinimapGpuDrawState(first, second)).toBe(true);
	});

	it.each([
		["terrain residency", { terrainRevision: 2 }],
		["map geometry", { geometryRevision: 2 }],
		["anchor position", { worldX: 11 }],
		["anchor height", { worldY: 21 }],
		["anchor residency", { envCellId: "0x01020101" }],
		["anchor heading", { headingRadians: 0.5 }],
		["minimap size", { size: 240 }],
		["indoor zoom", { indoorViewDiameter: 384 }],
	] as const)("invalidates for changed %s", (_label, change) => {
		const source = mapSource();
		const before = gpuDrawState(frame({ source }), minimapState());
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
		const changedMinimap = minimapState({
			size: "size" in change ? change.size : undefined,
			indoorViewDiameter:
				"indoorViewDiameter" in change ? change.indoorViewDiameter : undefined,
		});

		expect(
			sameMinimapGpuDrawState(
				before,
				gpuDrawState(changedFrame, changedMinimap),
			),
		).toBe(false);
	});

	it("ignores changes drawn only by the uncapped overlay", () => {
		const source = mapSource();
		const before = gpuDrawState(frame({ source }), minimapState());
		const after = gpuDrawState(
			frame({
				cameraFovRadians: 1.25,
				cameraHeadingRadians: 0.75,
				controlledGuid: 7,
				source,
			}),
			minimapState(),
		);

		expect(sameMinimapGpuDrawState(before, after)).toBe(true);
	});

	it("does not redraw detached terrain for subject translation alone", () => {
		const source = mapSource();
		const center = { worldX: 50, worldZ: 60 };
		const before = gpuDrawStateAtCenter(
			frame({ source, worldX: 10 }),
			minimapState(),
			center,
		);
		const after = gpuDrawStateAtCenter(
			frame({ source, worldX: 11 }),
			minimapState(),
			center,
		);

		expect(sameMinimapGpuDrawState(before, after)).toBe(true);
	});

	it("remembers indoor and outdoor zoom independently", () => {
		const state = minimapState({
			indoorViewDiameter: 48,
			outdoorViewDiameter: 384,
		});

		expect(minimapViewDiameter(state, frame().subject?.anchor ?? null)).toBe(
			48,
		);
		expect(
			minimapViewDiameter(
				state,
				frame({ envCellId: null }).subject?.anchor ?? null,
			),
		).toBe(384);
		expect(minimapViewDiameter(state, null)).toBe(384);
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
): MinimapFrame {
	return {
		cameraFovRadians: overrides.cameraFovRadians ?? 1,
		cameraHeadingRadians: overrides.cameraHeadingRadians ?? 0,
		presentedEntities: () => [],
		selectedGuid: null,
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

function minimapState(
	overrides: {
		readonly size?: number;
		readonly indoorViewDiameter?: number;
		readonly outdoorViewDiameter?: number;
	} = {},
): MinimapState {
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
	frameValue: MinimapFrame,
	minimapStateValue: MinimapState,
): MinimapGpuDrawState {
	const anchor = frameValue.subject?.anchor ?? null;
	return gpuDrawStateAtCenter(
		frameValue,
		minimapStateValue,
		anchor === null ? null : { worldX: anchor.worldX, worldZ: anchor.worldZ },
	);
}

function gpuDrawStateAtCenter(
	frameValue: MinimapFrame,
	minimapStateValue: MinimapState,
	center: { readonly worldX: number; readonly worldZ: number } | null,
): MinimapGpuDrawState {
	const anchor = frameValue.subject?.anchor ?? null;
	return captureMinimapGpuDrawState(
		frameValue,
		minimapStateValue,
		anchor === null || center === null
			? null
			: {
					anchor,
					center,
					viewDiameter: minimapViewDiameter(minimapStateValue, anchor),
				},
	);
}
