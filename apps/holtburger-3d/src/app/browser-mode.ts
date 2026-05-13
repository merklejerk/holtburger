import type { RuntimeResidencyDto } from "../lib/host/contracts";
import {
	formatLandblockLabel,
	getOutdoorLandblockCoords,
	makeOutdoorLandblockId,
	normalizeOutdoorLandblockId,
} from "../lib/landblocks";

type BrowserPageId = "location-entry" | "destination-preview";

export interface BrowserLocationSelection {
	label: string;
	northSouth: number;
	northSouthHemisphere: "N" | "S";
	eastWest: number;
	eastWestHemisphere: "E" | "W";
	elevation: number;
	source: "manual" | "runtime-residency" | "landblock-pick";
	landblockId: number | null;
}

export interface BrowserModeState {
	draftInput: string;
	validationMessage: string | null;
	destination: BrowserLocationSelection | null;
	landblockCoverageRadius: number;
	page: BrowserPageId;
}

const LOCATION_INPUT_PATTERN =
	/^\s*(\d+(?:\.\d+)?)\s*([NS])\s*,?\s*(\d+(?:\.\d+)?)\s*([EW])(?:\s*,?\s*(-?\d+(?:\.\d+)?)\s*Z?)?\s*$/i;

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
	source: BrowserLocationSelection["source"] = "manual",
): BrowserLocationSelection | null {
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
		label: formatBrowserLocationLabel(
			Number(northSouth),
			northSouthHemisphere.toUpperCase() as BrowserLocationSelection["northSouthHemisphere"],
			Number(eastWest),
			eastWestHemisphere.toUpperCase() as BrowserLocationSelection["eastWestHemisphere"],
			Number(elevation),
		),
		northSouth: Number(northSouth),
		northSouthHemisphere:
			northSouthHemisphere.toUpperCase() as BrowserLocationSelection["northSouthHemisphere"],
		eastWest: Number(eastWest),
		eastWestHemisphere:
			eastWestHemisphere.toUpperCase() as BrowserLocationSelection["eastWestHemisphere"],
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

function outdoorLandblockIdToApproximateCenterLocation(
	landblockId: number,
): Omit<BrowserLocationSelection, "source" | "landblockId"> {
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
	northSouthHemisphere: BrowserLocationSelection["northSouthHemisphere"],
	eastWest: number,
	eastWestHemisphere: BrowserLocationSelection["eastWestHemisphere"],
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
