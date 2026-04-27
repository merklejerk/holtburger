import type { RuntimeResidencyDto } from "../lib/host/contracts";

export type BrowserPageId = "location-entry" | "destination-preview";

export interface BrowserLocationSelection {
	label: string;
	northSouth: number;
	northSouthHemisphere: "N" | "S";
	eastWest: number;
	eastWestHemisphere: "E" | "W";
	elevation: number;
	source: "manual" | "runtime-residency";
}

export interface BrowserModeState {
	draftInput: string;
	validationMessage: string | null;
	destination: BrowserLocationSelection | null;
	page: BrowserPageId;
}

const LOCATION_INPUT_PATTERN =
	/^\s*(\d+(?:\.\d+)?)\s*([NS])\s*,\s*(\d+(?:\.\d+)?)\s*([EW])\s*,\s*(-?\d+(?:\.\d+)?)\s*Z\s*$/i;

const DEFAULT_BROWSER_DESTINATION = parseBrowserLocationInput(
	"29.90S, 65.90W, 0.0Z",
);

export function createBrowserModeState(): BrowserModeState {
	return {
		draftInput: DEFAULT_BROWSER_DESTINATION?.label ?? "",
		validationMessage: null,
		destination: DEFAULT_BROWSER_DESTINATION,
		page: DEFAULT_BROWSER_DESTINATION ? "destination-preview" : "location-entry",
	};
}

export function formatResidencyDraft(residency: RuntimeResidencyDto): string {
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
		elevation,
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
		page: "destination-preview",
	};
}

export function browserLocationToLandblockId(
	location: BrowserLocationSelection,
): number {
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

	return ((landblockX & 0xff) << 24) | ((landblockY & 0xff) << 16) | 0xffff;
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
