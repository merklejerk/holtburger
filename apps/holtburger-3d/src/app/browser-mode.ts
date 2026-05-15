import type { RuntimeResidencyDto } from "../lib/host/contracts";
import {
	formatLandblockLabel,
	formatHex32,
	getOutdoorLandblockCoords,
	makeOutdoorLandblockId,
	normalizeOutdoorLandblockId,
} from "../lib/landblocks";
import {
	clampOutdoorSceneLodRadius,
	DEFAULT_BUILDING_LOD_RADIUS,
	DEFAULT_DETAIL_LOD_RADIUS,
	DEFAULT_TERRAIN_LOD_RADIUS,
	MAX_OUTDOOR_SCENE_LOD_RADIUS,
	MIN_OUTDOOR_SCENE_LOD_RADIUS,
} from "../lib/world-display/outdoor-scene-interest";

type BrowserPageId = "location-entry" | "destination-preview";

type BrowserDestinationSource =
	| "manual"
	| "runtime-residency"
	| "landblock-pick";
type NorthSouthHemisphere = "N" | "S";
type EastWestHemisphere = "E" | "W";

interface BrowserOutdoorLocationSelection {
	kind: "outdoor-location";
	label: string;
	northSouth: number;
	northSouthHemisphere: NorthSouthHemisphere;
	eastWest: number;
	eastWestHemisphere: EastWestHemisphere;
	elevation: number;
	source: BrowserDestinationSource;
	landblockId: number | null;
}

export interface BrowserIndoorEnvCellSelection {
	kind: "indoor-env-cell";
	label: string;
	source: BrowserDestinationSource;
	envCellId: number;
	landblockId: number;
}

export type BrowserLocationSelection =
	| BrowserOutdoorLocationSelection
	| BrowserIndoorEnvCellSelection;

export interface BrowserModeState {
	draftInput: string;
	validationMessage: string | null;
	destination: BrowserLocationSelection | null;
	terrainLodRadius: number;
	buildingLodRadius: number;
	detailLodRadius: number;
	structuredInteriorMaxEnvCells: number;
	structuredInteriorMaxVisibleCellDepth: number;
	showPortalPolygons: boolean;
	showCellIndicators: boolean;
	highlightPortalTargets: boolean;
	page: BrowserPageId;
}

const LOCATION_INPUT_PATTERN =
	/^\s*(\d+(?:\.\d+)?)\s*([NS])\s*,?\s*(\d+(?:\.\d+)?)\s*([EW])(?:\s*,?\s*(-?\d+(?:\.\d+)?)\s*Z?)?\s*$/i;
const CELL_ID_INPUT_PATTERN = /^\s*(?:0x)?([0-9a-f]{8})\s*$/i;

const DEFAULT_BROWSER_DESTINATION = parseBrowserLocationInput(
	"33.50S, 72.80E, 0.0Z",
);
const DEFAULT_STRUCTURED_INTERIOR_MAX_ENV_CELLS = 1024;
const DEFAULT_STRUCTURED_INTERIOR_MAX_VISIBLE_CELL_DEPTH = 16;
export const MIN_BROWSER_LOD_RADIUS = MIN_OUTDOOR_SCENE_LOD_RADIUS;
export const MAX_BROWSER_LOD_RADIUS = MAX_OUTDOOR_SCENE_LOD_RADIUS;
export const MIN_STRUCTURED_INTERIOR_MAX_ENV_CELLS = 1;
export const MAX_STRUCTURED_INTERIOR_MAX_ENV_CELLS = 8192;
export const MIN_STRUCTURED_INTERIOR_MAX_VISIBLE_CELL_DEPTH = 0;
export const MAX_STRUCTURED_INTERIOR_MAX_VISIBLE_CELL_DEPTH = 128;

export function createBrowserModeState(): BrowserModeState {
	return {
		draftInput: DEFAULT_BROWSER_DESTINATION?.label ?? "",
		validationMessage: null,
		destination: DEFAULT_BROWSER_DESTINATION,
		terrainLodRadius: DEFAULT_TERRAIN_LOD_RADIUS,
		buildingLodRadius: DEFAULT_BUILDING_LOD_RADIUS,
		detailLodRadius: DEFAULT_DETAIL_LOD_RADIUS,
		structuredInteriorMaxEnvCells: DEFAULT_STRUCTURED_INTERIOR_MAX_ENV_CELLS,
		structuredInteriorMaxVisibleCellDepth:
			DEFAULT_STRUCTURED_INTERIOR_MAX_VISIBLE_CELL_DEPTH,
		showPortalPolygons: false,
		showCellIndicators: true,
		highlightPortalTargets: true,
		page: DEFAULT_BROWSER_DESTINATION
			? "destination-preview"
			: "location-entry",
	};
}

function formatResidencyDraft(residency: RuntimeResidencyDto): string {
	return residency.focusLocationLabel.trim();
}

export function parseBrowserLocationInput(
	value: string,
	source: BrowserDestinationSource = "manual",
): BrowserLocationSelection | null {
	const cellIdSelection = parseBrowserCellIdInput(value, source);
	if (cellIdSelection) {
		return cellIdSelection;
	}

	const match = value.match(LOCATION_INPUT_PATTERN);

	if (!match) {
		return null;
	}

	const [
		,
		northSouth,
		northSouthHemisphere,
		eastWest,
		eastWestHemisphere,
		elevation = "0",
	] = match;

	return {
		kind: "outdoor-location",
		label: formatBrowserLocationLabel(
			Number(northSouth),
			northSouthHemisphere.toUpperCase() as NorthSouthHemisphere,
			Number(eastWest),
			eastWestHemisphere.toUpperCase() as EastWestHemisphere,
			Number(elevation),
		),
		northSouth: Number(northSouth),
		northSouthHemisphere:
			northSouthHemisphere.toUpperCase() as NorthSouthHemisphere,
		eastWest: Number(eastWest),
		eastWestHemisphere: eastWestHemisphere.toUpperCase() as EastWestHemisphere,
		elevation: Number(elevation),
		source,
		landblockId: null,
	};
}

export function seedBrowserDraftFromResidency(
	browserMode: BrowserModeState,
	residency: RuntimeResidencyDto,
): BrowserModeState {
	if (browserMode.draftInput.trim().length > 0) {
		return browserMode;
	}

	return {
		...browserMode,
		draftInput: formatResidencyDraft(residency),
	};
}

export function updateBrowserDraft(
	browserMode: BrowserModeState,
	draftInput: string,
): BrowserModeState {
	return {
		...browserMode,
		draftInput,
		validationMessage: null,
	};
}

export function updateTerrainLodRadius(
	browserMode: BrowserModeState,
	terrainLodRadius: number,
): BrowserModeState {
	const nextTerrainLodRadius = clampOutdoorSceneLodRadius(terrainLodRadius);
	const nextBuildingLodRadius = Math.min(
		browserMode.buildingLodRadius,
		nextTerrainLodRadius,
	);

	return {
		...browserMode,
		terrainLodRadius: nextTerrainLodRadius,
		buildingLodRadius: nextBuildingLodRadius,
		detailLodRadius: Math.min(
			browserMode.detailLodRadius,
			nextBuildingLodRadius,
		),
	};
}

export function updateBuildingLodRadius(
	browserMode: BrowserModeState,
	buildingLodRadius: number,
): BrowserModeState {
	const nextBuildingLodRadius = Math.min(
		clampOutdoorSceneLodRadius(buildingLodRadius),
		browserMode.terrainLodRadius,
	);

	return {
		...browserMode,
		buildingLodRadius: nextBuildingLodRadius,
		detailLodRadius: Math.min(
			browserMode.detailLodRadius,
			nextBuildingLodRadius,
		),
	};
}

export function updateDetailLodRadius(
	browserMode: BrowserModeState,
	detailLodRadius: number,
): BrowserModeState {
	return {
		...browserMode,
		detailLodRadius: Math.min(
			clampOutdoorSceneLodRadius(detailLodRadius),
			browserMode.buildingLodRadius,
		),
	};
}

export function updateStructuredInteriorMaxEnvCells(
	browserMode: BrowserModeState,
	maxEnvCells: number,
): BrowserModeState {
	return {
		...browserMode,
		structuredInteriorMaxEnvCells: clampCoverageSetting(
			maxEnvCells,
			MIN_STRUCTURED_INTERIOR_MAX_ENV_CELLS,
			MAX_STRUCTURED_INTERIOR_MAX_ENV_CELLS,
			DEFAULT_STRUCTURED_INTERIOR_MAX_ENV_CELLS,
		),
	};
}

export function updateStructuredInteriorMaxVisibleCellDepth(
	browserMode: BrowserModeState,
	maxVisibleCellDepth: number,
): BrowserModeState {
	return {
		...browserMode,
		structuredInteriorMaxVisibleCellDepth: clampCoverageSetting(
			maxVisibleCellDepth,
			MIN_STRUCTURED_INTERIOR_MAX_VISIBLE_CELL_DEPTH,
			MAX_STRUCTURED_INTERIOR_MAX_VISIBLE_CELL_DEPTH,
			DEFAULT_STRUCTURED_INTERIOR_MAX_VISIBLE_CELL_DEPTH,
		),
	};
}

export function updatePortalPolygonVisibility(
	browserMode: BrowserModeState,
	showPortalPolygons: boolean,
): BrowserModeState {
	return {
		...browserMode,
		showPortalPolygons,
	};
}

export function updateCellIndicatorVisibility(
	browserMode: BrowserModeState,
	showCellIndicators: boolean,
): BrowserModeState {
	return {
		...browserMode,
		showCellIndicators,
	};
}

export function updatePortalTargetHighlighting(
	browserMode: BrowserModeState,
	highlightPortalTargets: boolean,
): BrowserModeState {
	return {
		...browserMode,
		highlightPortalTargets,
	};
}

export function previewBrowserLocation(
	browserMode: BrowserModeState,
): BrowserModeState {
	const parsedLocation = parseBrowserLocationInput(browserMode.draftInput);

	if (!parsedLocation) {
		return {
			...browserMode,
			validationMessage:
				"Use the AC-style location format: 100.40S, 101.55W, 1.0Z.",
			destination: null,
			page: "location-entry",
		};
	}

	return {
		draftInput: parsedLocation.label,
		validationMessage: null,
		destination: parsedLocation,
		terrainLodRadius: browserMode.terrainLodRadius,
		buildingLodRadius: browserMode.buildingLodRadius,
		detailLodRadius: browserMode.detailLodRadius,
		structuredInteriorMaxEnvCells: browserMode.structuredInteriorMaxEnvCells,
		structuredInteriorMaxVisibleCellDepth:
			browserMode.structuredInteriorMaxVisibleCellDepth,
		showPortalPolygons: browserMode.showPortalPolygons,
		showCellIndicators: browserMode.showCellIndicators,
		highlightPortalTargets: browserMode.highlightPortalTargets,
		page: "destination-preview",
	};
}

export function selectRuntimeResidencyDestination(
	browserMode: BrowserModeState,
	residency: RuntimeResidencyDto,
): BrowserModeState {
	const parsedLocation = parseBrowserLocationInput(
		formatResidencyDraft(residency),
		"runtime-residency",
	);

	if (!parsedLocation) {
		return {
			...browserMode,
			draftInput: formatResidencyDraft(residency),
			validationMessage:
				"The current runtime residency location could not be parsed into the browser-mode destination format.",
			destination: null,
			page: "location-entry",
		};
	}

	return {
		draftInput: parsedLocation.label,
		validationMessage: null,
		destination: parsedLocation,
		terrainLodRadius: browserMode.terrainLodRadius,
		buildingLodRadius: browserMode.buildingLodRadius,
		detailLodRadius: browserMode.detailLodRadius,
		structuredInteriorMaxEnvCells: browserMode.structuredInteriorMaxEnvCells,
		structuredInteriorMaxVisibleCellDepth:
			browserMode.structuredInteriorMaxVisibleCellDepth,
		showPortalPolygons: browserMode.showPortalPolygons,
		showCellIndicators: browserMode.showCellIndicators,
		highlightPortalTargets: browserMode.highlightPortalTargets,
		page: "destination-preview",
	};
}

export function selectBrowserLandblockDestination(
	browserMode: BrowserModeState,
	landblockId: number,
): BrowserModeState {
	const normalizedLandblockId = normalizeOutdoorLandblockId(landblockId);
	const centerLocation = outdoorLandblockIdToApproximateCenterLocation(
		normalizedLandblockId,
	);

	return {
		draftInput: centerLocation.label,
		validationMessage: null,
		destination: {
			...centerLocation,
			kind: "outdoor-location",
			source: "landblock-pick",
			landblockId: normalizedLandblockId,
		},
		terrainLodRadius: browserMode.terrainLodRadius,
		buildingLodRadius: browserMode.buildingLodRadius,
		detailLodRadius: browserMode.detailLodRadius,
		structuredInteriorMaxEnvCells: browserMode.structuredInteriorMaxEnvCells,
		structuredInteriorMaxVisibleCellDepth:
			browserMode.structuredInteriorMaxVisibleCellDepth,
		showPortalPolygons: browserMode.showPortalPolygons,
		showCellIndicators: browserMode.showCellIndicators,
		highlightPortalTargets: browserMode.highlightPortalTargets,
		page: "destination-preview",
	};
}

export function browserLocationToLandblockId(
	location: BrowserLocationSelection,
): number {
	if (location.kind === "indoor-env-cell") {
		return normalizeOutdoorLandblockId(location.landblockId);
	}

	if (location.landblockId !== null) {
		return normalizeOutdoorLandblockId(location.landblockId);
	}

	const signedLatitude =
		location.northSouthHemisphere === "N"
			? location.northSouth
			: -location.northSouth;
	const signedLongitude =
		location.eastWestHemisphere === "E"
			? location.eastWest
			: -location.eastWest;
	const landblockX = clampLandblockAxis(
		Math.floor(((signedLongitude + 102) * 240) / 192),
	);
	const landblockY = clampLandblockAxis(
		Math.floor(((signedLatitude + 102) * 240) / 192),
	);

	return makeOutdoorLandblockId(landblockX, landblockY);
}

export function browserDestinationToIndoorEnvCellId(
	location: BrowserLocationSelection | null,
): number | null {
	return location?.kind === "indoor-env-cell" ? location.envCellId : null;
}

export function isIndoorBrowserDestination(
	location: BrowserLocationSelection | null,
): location is BrowserIndoorEnvCellSelection {
	return location?.kind === "indoor-env-cell";
}

function parseBrowserCellIdInput(
	value: string,
	source: BrowserDestinationSource,
): BrowserLocationSelection | null {
	const match = value.match(CELL_ID_INPUT_PATTERN);
	if (!match) {
		return null;
	}

	const cellId = Number.parseInt(match[1], 16) >>> 0;
	const landblockId = normalizeOutdoorLandblockId(cellId);
	if ((cellId & 0xffff) === 0xffff) {
		const centerLocation =
			outdoorLandblockIdToApproximateCenterLocation(landblockId);

		return {
			...centerLocation,
			kind: "outdoor-location",
			source,
			landblockId,
		};
	}

	return {
		kind: "indoor-env-cell",
		label: `Env cell 0x${formatHex32(cellId)} (${formatLandblockLabel(landblockId)})`,
		source,
		envCellId: cellId,
		landblockId,
	};
}

function outdoorLandblockIdToApproximateCenterLocation(
	landblockId: number,
): Omit<BrowserOutdoorLocationSelection, "kind" | "source" | "landblockId"> {
	const coords = getOutdoorLandblockCoords(landblockId);
	const signedLongitude = ((coords.x + 0.5) * 192) / 240 - 102;
	const signedLatitude = ((coords.y + 0.5) * 192) / 240 - 102;
	const northSouth = Math.abs(signedLatitude);
	const eastWest = Math.abs(signedLongitude);
	const northSouthHemisphere = signedLatitude >= 0 ? "N" : "S";
	const eastWestHemisphere = signedLongitude >= 0 ? "E" : "W";

	return {
		label: `${formatBrowserLocationLabel(
			northSouth,
			northSouthHemisphere,
			eastWest,
			eastWestHemisphere,
			0,
		)} (${formatLandblockLabel(landblockId)})`,
		northSouth,
		northSouthHemisphere,
		eastWest,
		eastWestHemisphere,
		elevation: 0,
	};
}

function formatBrowserLocationLabel(
	northSouth: number,
	northSouthHemisphere: NorthSouthHemisphere,
	eastWest: number,
	eastWestHemisphere: EastWestHemisphere,
	elevation: number,
): string {
	return `${northSouth.toFixed(2)}${northSouthHemisphere}, ${eastWest.toFixed(2)}${eastWestHemisphere}, ${elevation.toFixed(1)}Z`;
}

function clampLandblockAxis(value: number): number {
	return Math.min(Math.max(value, 0), 0xfe);
}

function clampCoverageSetting(
	value: number,
	min: number,
	max: number,
	defaultValue: number,
): number {
	if (!Number.isFinite(value)) {
		return defaultValue;
	}

	return Math.min(Math.max(Math.trunc(value), min), max);
}
