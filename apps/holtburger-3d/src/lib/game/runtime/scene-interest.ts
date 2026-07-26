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

/** Outdoor static layers realized through the common geometry and atlas path. */
export type OutdoorStaticLayerKind =
	| LandblockLayerKind.Buildings
	| LandblockLayerKind.Objects
	| LandblockLayerKind.Generated;

/** Narrow a landblock layer to the shared outdoor-static realization domain. */
export function isOutdoorStaticLayer(
	layer: LandblockLayerKind,
): layer is OutdoorStaticLayerKind {
	return (
		layer === LandblockLayerKind.Buildings ||
		layer === LandblockLayerKind.Objects ||
		layer === LandblockLayerKind.Generated
	);
}

export type SceneInterestMap = Map<LandblockId, Set<LandblockLayerKind>>;

export interface LandblockIdLayer {
	readonly id: LandblockId;
	readonly layer: LandblockLayerKind;
}

/** Group layer requests by their one shared cumulative-content acquisition identity. */
export function groupLandblockLayers(
	layers: ReadonlySet<LandblockIdLayer>,
): ReadonlyMap<LandblockId, LandblockIdLayer[]> {
	const grouped = new Map<LandblockId, LandblockIdLayer[]>();
	for (const layer of layers) {
		const group = grouped.get(layer.id);
		if (group) group.push(layer);
		else grouped.set(layer.id, [layer]);
	}
	return grouped;
}

export interface SceneInterestDiff {
	newLayers: Set<LandblockIdLayer>;
	evictedLayers: Set<LandblockIdLayer>;
}

/** Explicit frontend request for static content around one outdoor anchor. */
export interface SceneInterestRequest {
	/** Outdoor landblock around which requested layers are retained. */
	readonly anchorLandblockId: LandblockId;
	/** Complete enabled-layer and radius policy for this request. */
	readonly lod: LoDConfig;
}

/** Reject a scene-interest radius configuration that cannot produce coherent layers. */
export function validateLoDConfigOrThrow(cfg: LoDConfig): void {
	const optionalRadii = [
		cfg.buildingRadius,
		cfg.explicitObjectRadius,
		cfg.generatedObjectRadius,
		cfg.envCellRadius,
	];
	if (
		!isValidRadius(cfg.terrainRadius) ||
		optionalRadii.some(
			(radius) =>
				radius !== null &&
				(!isValidRadius(radius) || radius > cfg.terrainRadius),
		)
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
		let y = anchor.y - config.terrainRadius;
		y <= anchor.y + config.terrainRadius;
		y += 1
	) {
		for (
			let x = anchor.x - config.terrainRadius;
			x <= anchor.x + config.terrainRadius;
			x += 1
		) {
			if (x < 0 || x > 0xff || y < 0 || y > 0xff) continue;
			const distance = Math.max(Math.abs(x - anchor.x), Math.abs(y - anchor.y));
			const layers = new Set<LandblockLayerKind>([LandblockLayerKind.Terrain]);
			if (config.buildingRadius !== null && distance <= config.buildingRadius)
				layers.add(LandblockLayerKind.Buildings);
			if (
				config.explicitObjectRadius !== null &&
				distance <= config.explicitObjectRadius
			)
				layers.add(LandblockLayerKind.Objects);
			if (
				config.generatedObjectRadius !== null &&
				distance <= config.generatedObjectRadius
			)
				layers.add(LandblockLayerKind.Generated);
			if (config.envCellRadius !== null && distance <= config.envCellRadius)
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

function isValidRadius(radius: number): boolean {
	return Number.isInteger(radius) && radius >= 0;
}

function landblockIdSuffix(landblockId: LandblockId): string {
	const match = /^(?:0x)?[0-9a-fA-F]{4}([0-9a-fA-F]{4})$/.exec(landblockId);
	if (!match) throw new Error(`Invalid landblock id ${landblockId}.`);
	return match[1]!;
}

function createLandblockId(x: number, y: number, suffix: string): LandblockId {
	return `0x${x.toString(16).padStart(2, "0")}${y.toString(16).padStart(2, "0")}${suffix}`;
}
