import {
	browserLocationToLandblockId,
	type BrowserLocationSelection,
	type BrowserModeState,
} from "./browser-mode";
import {
	createSceneResourceInterest,
	type SceneResourceInterest,
	type SceneResourceLocation,
} from "../lib/scene-runtime/scene-resource-interest";
import { formatHex32, normalizeOutdoorLandblockId } from "../lib/landblocks";

export function createSceneResourceInterestFromBrowserMode(
	browserMode: BrowserModeState,
): SceneResourceInterest {
	return createSceneResourceInterestFromBrowserDestination({
		destination: browserMode.destination,
		terrainLodRadius: browserMode.terrainLodRadius,
		buildingLodRadius: browserMode.buildingLodRadius,
		detailLodRadius: browserMode.detailLodRadius,
		envCellLodRadius: browserMode.envCellLodRadius,
	});
}

export function createSceneResourceInterestFromBrowserDestination(input: {
	destination: BrowserLocationSelection | null;
	terrainLodRadius: number;
	buildingLodRadius: number;
	detailLodRadius: number;
	envCellLodRadius: number;
}): SceneResourceInterest {
	return createSceneResourceInterest({
		location: createSceneResourceLocationFromBrowserDestination(
			input.destination,
		),
		lod: {
			terrain: input.terrainLodRadius,
			buildings: input.buildingLodRadius,
			detail: input.detailLodRadius,
			envCells: input.envCellLodRadius,
		},
	});
}

export function createBrowserDestinationFromSceneResourceInterest(
	interest: SceneResourceInterest,
): BrowserLocationSelection | null {
	const location = interest.location;
	if (!location) {
		return null;
	}
	if (location.kind === "interior-cell") {
		return {
			kind: "interior-cell",
			label: `Env cell ${formatHex32(location.envCellId)}`,
			source: "manual",
			envCellId: location.envCellId,
			landblockId: location.landblockId,
		};
	}
	return {
		kind: "outdoor-location",
		label: `Landblock ${formatHex32(location.landblockId)}`,
		source: "manual",
		northSouth: 0,
		northSouthHemisphere: "N",
		eastWest: 0,
		eastWestHemisphere: "E",
		elevation: 0,
		landblockId: location.landblockId,
	};
}

function createSceneResourceLocationFromBrowserDestination(
	destination: BrowserLocationSelection | null,
): SceneResourceLocation | null {
	if (!destination) {
		return null;
	}
	if (destination.kind === "interior-cell") {
		return {
			kind: "interior-cell",
			envCellId: destination.envCellId,
			landblockId: normalizeOutdoorLandblockId(destination.landblockId),
		};
	}
	const landblockId = browserLocationToLandblockId(destination);
	return {
		kind: "outdoor-landblock",
		landblockId,
	};
}
