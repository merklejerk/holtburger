import type { LandblockId } from "../game-types";
import { getLandblockCoordinates } from "../landblocks";
import type { LoDConfig } from "./types";

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

/** Reject a scene-interest radius configuration that cannot produce coherent layers. */
export function validateLoDConfigOrThrow(cfg: LoDConfig): void {
	const { landblockRadius } = cfg;
	if (
		landblockRadius <= 0 ||
		cfg.buildingRadius > landblockRadius ||
		cfg.explicitObjectRadius > landblockRadius ||
		cfg.generatedObjectRadius > landblockRadius ||
		cfg.envCellRadius > landblockRadius
	) {
		throw new Error("Invalid scene config.");
	}
}

/** Derive every static layer required around one anchor landblock. */
export function computeSceneInterest(
	anchorLandblockId: LandblockId,
	config: LoDConfig,
): SceneInterestMap {
	const anchor = getLandblockCoordinates(anchorLandblockId);
	const suffix = landblockIdSuffix(anchorLandblockId);
	const interest: SceneInterestMap = new Map();
	for (
		let y = anchor.y - config.landblockRadius;
		y <= anchor.y + config.landblockRadius;
		y += 1
	) {
		for (
			let x = anchor.x - config.landblockRadius;
			x <= anchor.x + config.landblockRadius;
			x += 1
		) {
			if (x < 0 || x > 0xff || y < 0 || y > 0xff) continue;
			const distance = Math.max(Math.abs(x - anchor.x), Math.abs(y - anchor.y));
			const layers = new Set<LandblockLayerKind>([LandblockLayerKind.Terrain]);
			if (distance <= config.buildingRadius)
				layers.add(LandblockLayerKind.Buildings);
			if (distance <= config.explicitObjectRadius)
				layers.add(LandblockLayerKind.Objects);
			if (distance <= config.generatedObjectRadius)
				layers.add(LandblockLayerKind.Generated);
			if (distance <= config.envCellRadius)
				layers.add(LandblockLayerKind.EnvCells);
			interest.set(createLandblockId(x, y, suffix), layers);
		}
	}
	return interest;
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

function landblockIdSuffix(landblockId: LandblockId): string {
	const match = /^(?:0x)?[0-9a-fA-F]{4}([0-9a-fA-F]{4})$/.exec(landblockId);
	if (!match) throw new Error(`Invalid landblock id ${landblockId}.`);
	return match[1]!;
}

function createLandblockId(x: number, y: number, suffix: string): LandblockId {
	return `0x${x.toString(16).padStart(2, "0")}${y.toString(16).padStart(2, "0")}${suffix}`;
}
