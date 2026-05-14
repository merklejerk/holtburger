import type { RuntimeResidencyDto } from "../lib/host/contracts";
import {
	formatLandblockLabel,
	formatHex32,
	getOutdoorLandblockCoords,
	makeOutdoorLandblockId,
	normalizeOutdoorLandblockId,
} from "../lib/landblocks";

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
	landblockCoverageRadius: number;
	page: BrowserPageId;
}

const LOCATION_INPUT_PATTERN =
	/^\s*(\d+(?:\.\d+)?)\s*([NS])\s*,?\s*(\d+(?:\.\d+)?)\s*([EW])(?:\s*,?\s*(-?\d+(?:\.\d+)?)\s*Z?)?\s*$/i;
const CELL_ID_INPUT_PATTERN = /^\s*(?:0x)?([0-9a-f]{8})\s*$/i;

const DEFAULT_BROWSER_DESTINATION = parseBrowserLocationInput(
	"33.50S, 72.80E, 0.0Z",
);
const DEFAULT_LANDBLOCK_COVERAGE_RADIUS = 1;
export const MIN_LANDBLOCK_COVERAGE_RADIUS = 0;
export const MAX_LANDBLOCK_COVERAGE_RADIUS = 8;

export function createBrowserModeState(): BrowserModeState {
	return {
		draftInput: DEFAULT_BROWSER_DESTINATION?.label ?? "",
		validationMessage: null,
		destination: DEFAULT_BROWSER_DESTINATION,
		landblockCoverageRadius: DEFAULT_LANDBLOCK_COVERAGE_RADIUS,
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

export function updateLandblockCoverageRadius(
	browserMode: BrowserModeState,
	landblockCoverageRadius: number,
): BrowserModeState {
	return {
		...browserMode,
		landblockCoverageRadius: clampLandblockCoverageRadius(
			landblockCoverageRadius,
		),
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
		landblockCoverageRadius: browserMode.landblockCoverageRadius,
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
		landblockCoverageRadius: browserMode.landblockCoverageRadius,
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
		landblockCoverageRadius: browserMode.landblockCoverageRadius,
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

function clampLandblockCoverageRadius(value: number): number {
	if (!Number.isFinite(value)) {
		return DEFAULT_LANDBLOCK_COVERAGE_RADIUS;
	}

	return Math.min(
		Math.max(Math.trunc(value), MIN_LANDBLOCK_COVERAGE_RADIUS),
		MAX_LANDBLOCK_COVERAGE_RADIUS,
	);
}
