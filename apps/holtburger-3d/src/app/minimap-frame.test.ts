import { describe, expect, it } from "vitest";
import type { ResizeEdges } from "./resize-edges";

import type { MapTerrainSource } from "../lib/game/map/map-renderer";
import { scenePointFromPrintedCoordinates } from "../lib/game/map/map-coordinates";
import type {
	MinimapFrame,
	MinimapGpuDrawState,
	MinimapState,
} from "./minimap-frame";
import {
	captureMinimapGpuDrawState,
	minimapViewDiameter,
	resizeMinimapBounds,
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

	it("keeps terrain current when a navigation target changes", () => {
		const source = mapSource();
		const initial = frame({ source });
		const next: MinimapFrame = {
			...initial,
			waypoint: {
				kind: "paused",
				reason: "Waypoint · paused indoors",
				target: {
					label: "0.0N, 0.0E",
					position: scenePointFromPrintedCoordinates({
						latitude: { magnitude: 0, hemisphere: "N" },
						longitude: { magnitude: 0, hemisphere: "E" },
					}),
				},
			},
		};
		expect(
			sameMinimapGpuDrawState(
				gpuDrawState(initial, minimapState()),
				gpuDrawState(next, minimapState()),
			),
		).toBe(true);
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
		waypoint: null,
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

describe("minimap border resizing", () => {
	const start = { ...minimapState(), left: 100, top: 120, size: 200 };
	const minimum = 80;
	const cases: {
		edges: ResizeEdges;
		dx: number;
		dy: number;
		left: number;
		top: number;
	}[] = [
		{ edges: { horizontal: "left" }, dx: -30, dy: 99, left: 70, top: 120 },
		{ edges: { horizontal: "right" }, dx: 30, dy: 99, left: 100, top: 120 },
		{ edges: { vertical: "top" }, dx: 99, dy: -30, left: 100, top: 90 },
		{ edges: { vertical: "bottom" }, dx: 99, dy: 30, left: 100, top: 120 },
		{
			edges: { horizontal: "left", vertical: "top" },
			dx: -20,
			dy: -30,
			left: 70,
			top: 90,
		},
		{
			edges: { horizontal: "right", vertical: "top" },
			dx: 20,
			dy: -30,
			left: 100,
			top: 90,
		},
		{
			edges: { horizontal: "left", vertical: "bottom" },
			dx: -30,
			dy: 20,
			left: 70,
			top: 120,
		},
		{
			edges: { horizontal: "right", vertical: "bottom" },
			dx: 30,
			dy: 20,
			left: 100,
			top: 120,
		},
	];
	it.each(cases)(
		"resizes from $edges with the opposite borders stationary",
		({ edges, dx, dy, left, top }) => {
			expect(resizeMinimapBounds(start, minimum, dx, dy, edges, null)).toEqual({
				left,
				top,
				size: 230,
			});
		},
	);
	it("shrinks with the dominant corner axis even when the other axis moves outward", () => {
		expect(
			resizeMinimapBounds(
				start,
				minimum,
				-60,
				10,
				{
					horizontal: "right",
					vertical: "bottom",
				},
				null,
			),
		).toEqual({ left: 100, top: 120, size: 140 });
	});
	it("stops top-left shrinkage at the minimum without shifting opposite borders", () => {
		const result = resizeMinimapBounds(
			start,
			minimum,
			start.size,
			start.size,
			{
				horizontal: "left",
				vertical: "top",
			},
			null,
		);
		expect(result.size).toBe(minimum);
		expect(result.left + result.size).toBe(start.left + start.size);
		expect(result.top + result.size).toBe(start.top + start.size);
	});
	it("stops horizontal growth at the bottom of the usable viewport", () => {
		expect(
			resizeMinimapBounds(
				start,
				minimum,
				-500,
				0,
				{ horizontal: "left" },
				{ width: 800, height: 400, footerWidth: 100 },
			),
		).toEqual({ left: 20, top: 120, size: 280 });
	});
	it("stops top-left growth at the fixed right border's distance to the viewport edge", () => {
		expect(
			resizeMinimapBounds(
				start,
				minimum,
				-500,
				-500,
				{ horizontal: "left", vertical: "top" },
				{ width: 800, height: 600, footerWidth: 100 },
			),
		).toEqual({ left: 0, top: 20, size: 300 });
	});
	it("keeps an overhanging footer inside the viewport without moving the opposite border", () => {
		const small = { left: 30, top: 20, size: 100 };
		expect(
			resizeMinimapBounds(
				small,
				minimum,
				-100,
				0,
				{ horizontal: "left" },
				{ width: 800, height: 600, footerWidth: 140 },
			),
		).toEqual({ left: 10, top: 20, size: 120 });
	});
	it("relaxes the minimum when the viewport cannot fit it", () => {
		const small = { left: 0, top: 0, size: 50 };
		expect(
			resizeMinimapBounds(
				small,
				minimum,
				100,
				100,
				{ horizontal: "right", vertical: "bottom" },
				{ width: 60, height: 50, footerWidth: 100 },
			),
		).toEqual({ left: 0, top: 0, size: 50 });
	});
	it("stops shrinking before the footer overhangs the stationary viewport edge", () => {
		const atRight = { left: 580, top: 20, size: 220 };
		expect(
			resizeMinimapBounds(
				atRight,
				minimum,
				200,
				0,
				{ horizontal: "left" },
				{ width: 800, height: 600, footerWidth: 140 },
			),
		).toEqual({ left: 660, top: 20, size: 140 });
	});
});
