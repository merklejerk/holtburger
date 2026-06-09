import { normalizeOutdoorLandblockId } from "../landblocks";

export type SceneResourceLocation =
	| {
			kind: "outdoor-landblock";
			landblockId: number;
	  }
	| {
			kind: "interior-cell";
			landblockId: number;
			envCellId: number;
	  };

export interface SceneResourceLodRadii {
	terrain: number;
	buildings: number;
	detail: number;
	envCells: number;
}

export interface SceneResourceInterest {
	location: SceneResourceLocation | null;
	lod: SceneResourceLodRadii;
}

export function createSceneResourceInterest(input: {
	location: SceneResourceLocation | null;
	lod: SceneResourceLodRadii;
}): SceneResourceInterest {
	return {
		location: normalizeSceneResourceLocation(input.location),
		lod: { ...input.lod },
	};
}

export function describeSceneResourceInterestKey(
	interest: SceneResourceInterest,
): string {
	return [
		describeSceneResourceLocationIdentity(interest.location) ?? "none",
		`terrain-${interest.lod.terrain}`,
		`buildings-${interest.lod.buildings}`,
		`detail-${interest.lod.detail}`,
		`env-cells-${interest.lod.envCells}`,
	].join(":");
}

export function describeSceneResourceLocationIdentity(
	location: SceneResourceLocation | null,
): string | null {
	if (!location) {
		return null;
	}
	if (location.kind === "interior-cell") {
		return `interior:${formatHex32(location.envCellId)}`;
	}
	return `outdoor:${formatHex32(location.landblockId)}`;
}

function normalizeSceneResourceLocation(
	location: SceneResourceLocation | null,
): SceneResourceLocation | null {
	if (!location) {
		return null;
	}
	if (location.kind === "interior-cell") {
		return {
			kind: "interior-cell",
			envCellId: location.envCellId,
			landblockId: normalizeOutdoorLandblockId(location.landblockId),
		};
	}
	return {
		kind: "outdoor-landblock",
		landblockId: normalizeOutdoorLandblockId(location.landblockId),
	};
}

function formatHex32(value: number): string {
	return `0x${(value >>> 0).toString(16).padStart(8, "0")}`;
}
