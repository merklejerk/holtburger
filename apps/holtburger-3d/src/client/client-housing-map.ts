import {
	createLandblockWorldOrigin,
	OUTDOOR_LANDBLOCK_WORLD_SIZE,
} from "../lib/game/landblocks";
import type { HousingSnapshot } from "./client-housing-contract";

/** Map placement is H3D policy; apartments and unknown types have no marker. */
export function housingMapPosition(
	housing: HousingSnapshot,
): { readonly x: number; readonly z: number } | null {
	if (housing.home.kind !== "owned") return null;
	const home = housing.home.home;
	if (home.houseType < 1 || home.houseType > 3) return null;
	const cell = home.position.landblockId;
	const origin = createLandblockWorldOrigin({
		x: (cell >>> 24) & 0xff,
		y: (cell >>> 16) & 0xff,
	});
	return {
		x: origin.x + home.position.coords.x,
		z: origin.z - home.position.coords.y,
	};
}

/** ACE search discloses landblock areas, so describe their center as an approximate location. */
export function housingSearchAreaPosition(area: number): {
	readonly x: number;
	readonly z: number;
} {
	const origin = createLandblockWorldOrigin({
		x: (area >>> 24) & 0xff,
		y: (area >>> 16) & 0xff,
	});
	return {
		x: origin.x + OUTDOOR_LANDBLOCK_WORLD_SIZE / 2,
		z: origin.z - OUTDOOR_LANDBLOCK_WORLD_SIZE / 2,
	};
}
