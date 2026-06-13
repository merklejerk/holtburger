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
	DEFAULT_ENV_CELL_LOD_RADIUS,
	DEFAULT_TERRAIN_LOD_RADIUS,
	MAX_OUTDOOR_SCENE_LOD_RADIUS,
	MIN_OUTDOOR_SCENE_LOD_RADIUS,
} from "../lib/world-display/outdoor-scene-interest";
import {
	DEFAULT_TRANSITION_PORTAL_MAX_DEPTH,
	MAX_TRANSITION_PORTAL_MAX_DEPTH,
	MIN_TRANSITION_PORTAL_MAX_DEPTH,
	clampTransitionPortalMaxDepth,
} from "../lib/world-display/render-policy";

type BrowserPageId = "location-entry" | "destination-preview";

export type BrowserNavigationFocusMode = "manual" | "follow-camera";
export type BrowserRenderStyle = "solid" | "wireframe" | "no-material";
export type BrowserTextureFilteringMode =
	| "nearest"
	| "linear"
	| "anisotropic-4x";
type BrowserDestinationSource = "manual" | "landblock-pick" | "follow-camera";
export type BrowserLandblockInputMode = "outdoor" | "dungeon";
type NorthSouthHemisphere = "N" | "S";
type EastWestHemisphere = "E" | "W";

export interface BrowserCameraResidencyDestinationInput {
	kind: "outdoor-landblock" | "env-cell" | "unknown";
	landblockId: number | null;
	envCellId: number | null;
}

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

export interface BrowserInteriorCellSelection {
	kind: "interior-cell";
	label: string;
	source: BrowserDestinationSource;
	envCellId: number;
	landblockId: number;
}

export type BrowserLocationSelection =
	| BrowserOutdoorLocationSelection
	| BrowserInteriorCellSelection;

export interface BrowserModeState {
	draftInput: string;
	draftInputEditedByUser: boolean;
	validationMessage: string | null;
	destination: BrowserLocationSelection | null;
	navigationFocusMode: BrowserNavigationFocusMode;
	terrainLodRadius: number;
	buildingLodRadius: number;
	detailLodRadius: number;
	envCellLodRadius: number;
	cameraNearPlane: number;
	cameraFarPlane: number;
	transitionPortalMaxDepth: number;
	landblockInputMode: BrowserLandblockInputMode;
	showPortalPolygons: boolean;
	showCellIndicators: boolean;
	highlightPortalTargets: boolean;
	renderStyle: BrowserRenderStyle;
	textureFilteringMode: BrowserTextureFilteringMode;
	detailTexturesEnabled: boolean;
	page: BrowserPageId;
}

const LOCATION_INPUT_PATTERN =
	/^\s*(\d+(?:\.\d+)?)\s*([NS])\s*,?\s*(\d+(?:\.\d+)?)\s*([EW])(?:\s*,?\s*(-?\d+(?:\.\d+)?)\s*Z?)?\s*$/i;
const CELL_ID_INPUT_PATTERN = /^\s*(?:0x)?([0-9a-f]{8})\s*$/i;
const LANDBLOCK_PREFIX_INPUT_PATTERN = /^\s*(?:0x)?([0-9a-f]{4})\s*$/i;

const DEFAULT_BROWSER_DESTINATION = parseBrowserLocationInput(
	"33.50S, 72.80E, 0.0Z",
);
export const MIN_BROWSER_LOD_RADIUS = MIN_OUTDOOR_SCENE_LOD_RADIUS;
export const MAX_BROWSER_LOD_RADIUS = MAX_OUTDOOR_SCENE_LOD_RADIUS;
const DEFAULT_BROWSER_CAMERA_NEAR_PLANE = 0.1;
const DEFAULT_BROWSER_CAMERA_FAR_PLANE = 3000;
export const MIN_BROWSER_CAMERA_NEAR_PLANE = 0.01;
export const MAX_BROWSER_CAMERA_NEAR_PLANE = 1;
export const MIN_BROWSER_CAMERA_FAR_PLANE = 250;
export const MAX_BROWSER_CAMERA_FAR_PLANE = 5000;
export { MIN_TRANSITION_PORTAL_MAX_DEPTH, MAX_TRANSITION_PORTAL_MAX_DEPTH };

export function createBrowserModeState(): BrowserModeState {
	return {
		draftInput: DEFAULT_BROWSER_DESTINATION?.label ?? "",
		draftInputEditedByUser: false,
		validationMessage: null,
		destination: DEFAULT_BROWSER_DESTINATION,
		navigationFocusMode: "manual",
		terrainLodRadius: DEFAULT_TERRAIN_LOD_RADIUS,
		buildingLodRadius: DEFAULT_BUILDING_LOD_RADIUS,
		detailLodRadius: DEFAULT_DETAIL_LOD_RADIUS,
		envCellLodRadius: DEFAULT_ENV_CELL_LOD_RADIUS,
		cameraNearPlane: DEFAULT_BROWSER_CAMERA_NEAR_PLANE,
		cameraFarPlane: DEFAULT_BROWSER_CAMERA_FAR_PLANE,
		transitionPortalMaxDepth: DEFAULT_TRANSITION_PORTAL_MAX_DEPTH,
		landblockInputMode: "dungeon",
		showPortalPolygons: false,
		showCellIndicators: false,
		highlightPortalTargets: false,
		renderStyle: "solid",
		textureFilteringMode: "anisotropic-4x",
		detailTexturesEnabled: true,
		page: DEFAULT_BROWSER_DESTINATION
			? "destination-preview"
			: "location-entry",
	};
}

export function parseBrowserLocationInput(
	value: string,
	source: BrowserDestinationSource = "manual",
	landblockInputMode: BrowserLandblockInputMode = "dungeon",
): BrowserLocationSelection | null {
	const cellIdSelection = parseBrowserCellIdInput(
		value,
		source,
		landblockInputMode,
	);
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

export function updateBrowserDraft(
	browserMode: BrowserModeState,
	draftInput: string,
): BrowserModeState {
	return {
		...browserMode,
		draftInput,
		draftInputEditedByUser: true,
		validationMessage: null,
		navigationFocusMode: "manual",
	};
}

export function updateNavigationFocusMode(
	browserMode: BrowserModeState,
	navigationFocusMode: BrowserNavigationFocusMode,
): BrowserModeState {
	if (browserMode.navigationFocusMode === navigationFocusMode) {
		return browserMode;
	}

	return {
		...browserMode,
		navigationFocusMode,
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
		envCellLodRadius: Math.min(
			browserMode.envCellLodRadius,
			nextTerrainLodRadius,
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

export function updateEnvCellLodRadius(
	browserMode: BrowserModeState,
	envCellLodRadius: number,
): BrowserModeState {
	return {
		...browserMode,
		envCellLodRadius: Math.min(
			clampOutdoorSceneLodRadius(envCellLodRadius),
			browserMode.terrainLodRadius,
		),
	};
}

export function updateTransitionPortalMaxDepth(
	browserMode: BrowserModeState,
	maxDepth: number,
): BrowserModeState {
	return {
		...browserMode,
		transitionPortalMaxDepth: clampTransitionPortalMaxDepth(maxDepth),
	};
}

export function updateBrowserCameraNearPlane(
	browserMode: BrowserModeState,
	nearPlane: number,
): BrowserModeState {
	const nextNearPlane = clampBrowserCameraNearPlane(nearPlane);

	return {
		...browserMode,
		cameraNearPlane: nextNearPlane,
		cameraFarPlane: Math.max(browserMode.cameraFarPlane, nextNearPlane + 1),
	};
}

export function updateBrowserCameraFarPlane(
	browserMode: BrowserModeState,
	farPlane: number,
): BrowserModeState {
	return {
		...browserMode,
		cameraFarPlane: Math.max(
			clampBrowserCameraFarPlane(farPlane),
			browserMode.cameraNearPlane + 1,
		),
	};
}

export function updateLandblockInputMode(
	browserMode: BrowserModeState,
	landblockInputMode: BrowserLandblockInputMode,
): BrowserModeState {
	return {
		...browserMode,
		landblockInputMode,
		validationMessage: null,
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

export function updateBrowserRenderStyle(
	browserMode: BrowserModeState,
	renderStyle: BrowserRenderStyle,
): BrowserModeState {
	return {
		...browserMode,
		renderStyle,
	};
}

export function updateBrowserTextureFilteringMode(
	browserMode: BrowserModeState,
	textureFilteringMode: BrowserTextureFilteringMode,
): BrowserModeState {
	return {
		...browserMode,
		textureFilteringMode,
	};
}

export function updateBrowserDetailTexturesEnabled(
	browserMode: BrowserModeState,
	detailTexturesEnabled: boolean,
): BrowserModeState {
	return {
		...browserMode,
		detailTexturesEnabled,
	};
}

export function previewBrowserLocation(
	browserMode: BrowserModeState,
): BrowserModeState {
	const parsedLocation = parseBrowserLocationInput(
		browserMode.draftInput,
		"manual",
		browserMode.landblockInputMode,
	);

	if (!parsedLocation) {
		return {
			...browserMode,
			validationMessage: "Use the AC-style location format: 100.40S, 101.55W.",
			destination: null,
			page: "location-entry",
		};
	}

	return {
		draftInput: browserMode.draftInput,
		draftInputEditedByUser: browserMode.draftInputEditedByUser,
		validationMessage: null,
		destination: parsedLocation,
		navigationFocusMode: "manual",
		terrainLodRadius: browserMode.terrainLodRadius,
		buildingLodRadius: browserMode.buildingLodRadius,
		detailLodRadius: browserMode.detailLodRadius,
		envCellLodRadius: browserMode.envCellLodRadius,
		cameraNearPlane: browserMode.cameraNearPlane,
		cameraFarPlane: browserMode.cameraFarPlane,
		transitionPortalMaxDepth: browserMode.transitionPortalMaxDepth,
		landblockInputMode: browserMode.landblockInputMode,
		showPortalPolygons: browserMode.showPortalPolygons,
		showCellIndicators: browserMode.showCellIndicators,
		highlightPortalTargets: browserMode.highlightPortalTargets,
		renderStyle: browserMode.renderStyle,
		textureFilteringMode: browserMode.textureFilteringMode,
		detailTexturesEnabled: browserMode.detailTexturesEnabled,
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
		draftInputEditedByUser: false,
		validationMessage: null,
		destination: {
			...centerLocation,
			kind: "outdoor-location",
			source: "landblock-pick",
			landblockId: normalizedLandblockId,
		},
		navigationFocusMode: "manual",
		terrainLodRadius: browserMode.terrainLodRadius,
		buildingLodRadius: browserMode.buildingLodRadius,
		detailLodRadius: browserMode.detailLodRadius,
		envCellLodRadius: browserMode.envCellLodRadius,
		cameraNearPlane: browserMode.cameraNearPlane,
		cameraFarPlane: browserMode.cameraFarPlane,
		transitionPortalMaxDepth: browserMode.transitionPortalMaxDepth,
		landblockInputMode: browserMode.landblockInputMode,
		showPortalPolygons: browserMode.showPortalPolygons,
		showCellIndicators: browserMode.showCellIndicators,
		highlightPortalTargets: browserMode.highlightPortalTargets,
		renderStyle: browserMode.renderStyle,
		textureFilteringMode: browserMode.textureFilteringMode,
		detailTexturesEnabled: browserMode.detailTexturesEnabled,
		page: "destination-preview",
	};
}

export function applyBrowserCameraResidencyDestination(
	browserMode: BrowserModeState,
	residency: BrowserCameraResidencyDestinationInput,
): BrowserModeState {
	if (browserMode.navigationFocusMode !== "follow-camera") {
		return browserMode;
	}

	const destination = browserCameraResidencyToDestination(
		residency,
		browserMode.destination,
	);
	if (destination === null) {
		return browserMode;
	}

	if (areBrowserDestinationsEquivalent(browserMode.destination, destination)) {
		return browserMode;
	}

	return {
		...browserMode,
		draftInput: destination.label,
		draftInputEditedByUser: false,
		validationMessage: null,
		destination,
		page: "destination-preview",
	};
}

export function browserLocationToLandblockId(
	location: BrowserLocationSelection,
): number {
	if (location.kind === "interior-cell") {
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

export function browserDestinationToInteriorCellId(
	location: BrowserLocationSelection | null,
): number | null {
	return location?.kind === "interior-cell" ? location.envCellId : null;
}

export function describeBrowserDestinationIdentity(
	location: BrowserLocationSelection | null,
): string | null {
	if (!location) {
		return null;
	}

	if (location.kind === "interior-cell") {
		return `interior-cell-${formatHex32(location.envCellId)}-landblock-${formatHex32(
			normalizeOutdoorLandblockId(location.landblockId),
		)}`;
	}

	return `outdoor-landblock-${formatHex32(browserLocationToLandblockId(location))}`;
}

export function isIndoorBrowserDestination(
	location: BrowserLocationSelection | null,
): location is BrowserInteriorCellSelection {
	return location?.kind === "interior-cell";
}

function parseBrowserCellIdInput(
	value: string,
	source: BrowserDestinationSource,
	landblockInputMode: BrowserLandblockInputMode,
): BrowserLocationSelection | null {
	const landblockPrefixMatch = value.match(LANDBLOCK_PREFIX_INPUT_PATTERN);
	if (landblockPrefixMatch) {
		const landblockPrefix = Number.parseInt(landblockPrefixMatch[1], 16) >>> 0;
		const landblockId = ((landblockPrefix << 16) | 0xffff) >>> 0;
		if (landblockInputMode === "dungeon") {
			const envCellId = ((landblockPrefix << 16) | 0x0100) >>> 0;

			return {
				kind: "interior-cell",
				label: `Env cell 0x${formatHex32(envCellId)} (${formatLandblockLabel(landblockId)})`,
				source,
				envCellId,
				landblockId,
			};
		}

		const centerLocation =
			outdoorLandblockIdToApproximateCenterLocation(landblockId);

		return {
			...centerLocation,
			kind: "outdoor-location",
			source,
			landblockId,
		};
	}

	const match = value.match(CELL_ID_INPUT_PATTERN);
	if (!match) {
		return null;
	}

	const cellId = Number.parseInt(match[1], 16) >>> 0;
	const landblockId = normalizeOutdoorLandblockId(cellId);
	if ((cellId & 0xffff) === 0xffff) {
		if (landblockInputMode === "dungeon") {
			const envCellId = ((landblockId & 0xffff0000) | 0x0100) >>> 0;
			return {
				kind: "interior-cell",
				label: `Env cell 0x${formatHex32(envCellId)} (${formatLandblockLabel(landblockId)})`,
				source,
				envCellId,
				landblockId,
			};
		}

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
		kind: "interior-cell",
		label: `Env cell 0x${formatHex32(cellId)} (${formatLandblockLabel(landblockId)})`,
		source,
		envCellId: cellId,
		landblockId,
	};
}

export function isLandblockPrefixInput(value: string): boolean {
	return LANDBLOCK_PREFIX_INPUT_PATTERN.test(value);
}

function browserCameraResidencyToDestination(
	residency: BrowserCameraResidencyDestinationInput,
	currentDestination: BrowserLocationSelection | null,
): BrowserLocationSelection | null {
	if (
		residency.kind === "outdoor-landblock" &&
		residency.landblockId !== null
	) {
		return followOutdoorLandblockDestination(residency.landblockId);
	}

	if (residency.kind === "env-cell" && residency.envCellId !== null) {
		const envCellId = residency.envCellId >>> 0;
		const landblockId = normalizeOutdoorLandblockId(
			residency.landblockId ?? envCellId,
		);

		if (currentDestination?.kind !== "interior-cell") {
			return followOutdoorLandblockDestination(landblockId);
		}

		return {
			kind: "interior-cell",
			label: `Env cell 0x${formatHex32(envCellId)} (${formatLandblockLabel(landblockId)})`,
			source: "follow-camera",
			envCellId,
			landblockId,
		};
	}

	return null;
}

function followOutdoorLandblockDestination(
	landblockId: number,
): BrowserOutdoorLocationSelection {
	const centerLocation = outdoorLandblockIdToApproximateCenterLocation(
		normalizeOutdoorLandblockId(landblockId),
	);

	return {
		...centerLocation,
		kind: "outdoor-location",
		source: "follow-camera",
		landblockId: normalizeOutdoorLandblockId(landblockId),
	};
}

function areBrowserDestinationsEquivalent(
	left: BrowserLocationSelection | null,
	right: BrowserLocationSelection,
): boolean {
	if (left === null || left.kind !== right.kind) {
		return false;
	}

	if (left.source !== right.source) {
		return false;
	}

	if (left.kind === "interior-cell" && right.kind === "interior-cell") {
		return (
			left.envCellId === right.envCellId &&
			normalizeOutdoorLandblockId(left.landblockId) ===
				normalizeOutdoorLandblockId(right.landblockId)
		);
	}

	if (left.kind !== "outdoor-location" || right.kind !== "outdoor-location") {
		return false;
	}

	return (
		normalizeOutdoorLandblockId(browserLocationToLandblockId(left)) ===
		normalizeOutdoorLandblockId(browserLocationToLandblockId(right))
	);
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

function clampBrowserCameraNearPlane(value: number): number {
	if (!Number.isFinite(value)) {
		return DEFAULT_BROWSER_CAMERA_NEAR_PLANE;
	}

	return Math.min(
		MAX_BROWSER_CAMERA_NEAR_PLANE,
		Math.max(MIN_BROWSER_CAMERA_NEAR_PLANE, value),
	);
}

function clampBrowserCameraFarPlane(value: number): number {
	if (!Number.isFinite(value)) {
		return DEFAULT_BROWSER_CAMERA_FAR_PLANE;
	}

	return Math.min(
		MAX_BROWSER_CAMERA_FAR_PLANE,
		Math.max(MIN_BROWSER_CAMERA_FAR_PLANE, value),
	);
}
