import { type LandblockId } from "../game-types";

export enum LandblockLayerKind {
	Terrain = "terrain",
	Buildings = "buildings",
	Objects = "objects",
	Generated = "generated",
	EnvCells = "env-cells",
}

export type SceneInterestMap = Map<LandblockId, Set<LandblockLayerKind>>;

export interface LandblockIdLayer {
	readonly id: LandblockId;
	readonly layer: LandblockLayerKind;
}

export interface SceneInterestDiff {
	newLayers: Set<LandblockIdLayer>;
	evictedLayers: Set<LandblockIdLayer>;
}

export function diffSceneInterest(
	from: SceneInterestMap,
	to: SceneInterestMap,
): SceneInterestDiff {
	return {
		newLayers: subtractSceneInterest(to, from),
		evictedLayers: subtractSceneInterest(from, to),
	};
}

function subtractSceneInterest(
	source: SceneInterestMap,
	other: SceneInterestMap,
): Set<LandblockIdLayer> {
	const difference: LandblockIdLayer[] = [];

	for (const [id, layers] of source) {
		const otherLayers = other.get(id);
		for (const layer of layers) {
			if (!otherLayers?.has(layer)) {
				difference.push({ id, layer });
			}
		}
	}

	return new Set(difference);
}
