import {
	createLandblockWorldOrigin,
	OUTDOOR_LANDBLOCK_WORLD_SIZE,
} from "../../lib/game/landblocks";
import type { HousingSnapshot } from "./housing-contract";

/** Map placement is H3D policy; apartments and unknown types have no marker. */
export function housingMapPosition(
	housing: HousingSnapshot,
): { readonly x: number; readonly z: number } | null {
	if (housing.home.kind !== "owned") return null;
	const home = housing.home.home;
	if (home.houseType < 1 || home.houseType > 3) return null;
	const origin = createLandblockWorldOrigin(home.position.landblockId);
	return {
		x: origin.x + home.position.coords.x,
		z: origin.z - home.position.coords.y,
	};
}

/** Search results disclose landblock areas, so describe their center as an approximate location. */
export function housingSearchAreaPosition(area: number): {
	readonly x: number;
	readonly z: number;
} {
	const origin = createLandblockWorldOrigin(area);
	return {
		x: origin.x + OUTDOOR_LANDBLOCK_WORLD_SIZE / 2,
		z: origin.z - OUTDOOR_LANDBLOCK_WORLD_SIZE / 2,
	};
}
