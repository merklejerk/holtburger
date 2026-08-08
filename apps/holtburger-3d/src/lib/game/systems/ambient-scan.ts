import { renderVector3, renderVectorToAc } from "../../assets/ac-frame";
import type { SceneVector3 } from "../../assets/ac-frame";
import {
	AMBIENT_COMPASS_DIRECTIONS,
	AMBIENT_DIRECTION,
	AMBIENT_DISTANCE_BAND_HALF_WIDTH,
	AMBIENT_MAX_DISTANCE_SQUARED,
	AMBIENT_OMNIDIRECTIONAL_MIN_DISTANCE,
	ambientDirection,
	ambientWeight,
	widenDistanceBand,
	type AmbientDirection,
	type AmbientDistanceBand,
} from "./ambient-weighting";
import { sceneTypeIndexOf, terrainCodeOf } from "../terrain/terrain-sample";

/**
 * The per-cell scan that decides which ambience the listener can hear, and how much of it.
 *
 * Ambience is not a property of a region: it is a property of the ground within earshot. Retail walks
 * the landblock cell grid and treats every cell as a source (acclient.c:338010-338052), so a river to
 * the north is audible from the north because the water cells *are* north. This module is that walk,
 * kept free of clocks and playback so it can be tested as a function of position.
 */

/** One installed landblock's authored terrain, in the canonical row-major order. */
export interface AmbientTerrainBlock {
	/** One `u16` per vertex, `row * gridSize + column`, rows running south to north. */
	readonly terrainSamples: Uint16Array;
	/** Resolved world heights in the same order, so distance accounts for elevation as retail's does. */
	readonly heights: Float32Array;
	readonly gridSize: number;
	readonly tileSize: number;
	/** Scene-space position of this block's row-0, column-0 vertex. */
	readonly origin: SceneVector3;
}

/** One authored ambient sound, flattened out of its region table. */
export interface AmbientDescriptor {
	/** Index into the region's ambient tables; a table's identity, since several share an `stbId`. */
	readonly tableIndex: number;
	/** Sound-table DID this descriptor's `soundType` is resolved against. */
	readonly soundTableId: string;
	readonly soundType: number;
	readonly volume: number;
	readonly baseChance: number;
	readonly minRate: number;
	readonly maxRate: number;
	/** Derived at decode; a continuous descriptor plays whenever due instead of rolling a chance. */
	readonly isContinuous: boolean;
}

/** Resolve one cell's classification to the descriptors it authors, or `null` when it authors none. */
export type AmbientTableResolver = (
	terrainCode: number,
	sceneTypeIndex: number,
) => readonly AmbientDescriptor[] | null;

/** One descriptor's accumulated presence in the listener's surroundings. */
interface AmbientAccumulation {
	readonly descriptor: AmbientDescriptor;
	/** Retail's `sound_count`: the summed weight of every cell authoring this descriptor. */
	soundCount: number;
	/**
	 * Per-direction distance bands, for placing an intermittent sound.
	 *
	 * Left empty for a continuous descriptor, which retail plays centred and never positions.
	 */
	readonly directions: Map<AmbientDirection, AmbientDistanceBand>;
}

/** What one scan found around the listener. */
export interface AmbientScanResult {
	/** One entry per descriptor with any contributor, keyed by `${tableIndex}:${soundType}`. */
	readonly accumulations: ReadonlyMap<string, AmbientAccumulation>;
	/** Summed weight across every contributing cell, which normalizes each descriptor's share. */
	readonly totalWeight: number;
	/** Cells examined, for diagnosing a scan that found nothing. */
	readonly examinedCellCount: number;
}

/** Identity of one descriptor within the region; several tables share an `stbId`, so index is the key. */
function ambientDescriptorKey(descriptor: AmbientDescriptor): string {
	return `${descriptor.tableIndex}:${descriptor.soundType}`;
}

/**
 * Accumulate every ambient descriptor audible from `listenerPosition`.
 *
 * The listener-to-cell offset is converted into AC axes once per cell, because direction bucketing
 * compares x against y in AC's compass plane and would bucket into the wrong quadrant otherwise.
 */
export function scanAmbientSources(
	listenerPosition: SceneVector3,
	blocks: Iterable<AmbientTerrainBlock>,
	resolveDescriptors: AmbientTableResolver,
): AmbientScanResult {
	const accumulations = new Map<string, AmbientAccumulation>();
	let totalWeight = 0;
	let examinedCellCount = 0;

	for (const block of blocks) {
		const cellsPerSide = block.gridSize - 1;
		for (let row = 0; row < cellsPerSide; row += 1) {
			for (let column = 0; column < cellsPerSide; column += 1) {
				const vertex = row * block.gridSize + column;
				const sample = block.terrainSamples[vertex];
				const height = block.heights[vertex];
				if (sample === undefined || height === undefined) {
					throw new Error(
						`Ambient scan reached vertex ${vertex} outside its terrain block.`,
					);
				}
				// Canonical rows run south to north, which is render-local -Z.
				const deltaX =
					block.origin[0] + column * block.tileSize - listenerPosition[0];
				const deltaY = block.origin[1] + height - listenerPosition[1];
				const deltaZ =
					block.origin[2] - row * block.tileSize - listenerPosition[2];
				const distanceSquared =
					deltaX * deltaX + deltaY * deltaY + deltaZ * deltaZ;
				if (distanceSquared > AMBIENT_MAX_DISTANCE_SQUARED) continue;

				examinedCellCount += 1;
				const weight = ambientWeight(distanceSquared);
				if (weight === 0) continue;
				const descriptors = resolveDescriptors(
					terrainCodeOf(sample),
					sceneTypeIndexOf(sample),
				);
				if (!descriptors || descriptors.length === 0) continue;

				// A difference of two scene positions is a render-axis displacement, which the
				// anchor's pure translation cannot affect; converting it is the whole reason the
				// compass comparison below lands in the right quadrant.
				const direction = ambientDirection(
					renderVectorToAc(renderVector3([deltaX, deltaY, deltaZ])),
				);
				const distance = Math.sqrt(distanceSquared);
				totalWeight += weight;
				for (const descriptor of descriptors) {
					accumulate(accumulations, descriptor, weight, direction, distance);
				}
			}
		}
	}

	return { accumulations, examinedCellCount, totalWeight };
}

/** Fold one cell's contribution into one descriptor (`Ambient::AddSound` → `AmbientSound::AddTo`). */
function accumulate(
	accumulations: Map<string, AmbientAccumulation>,
	descriptor: AmbientDescriptor,
	weight: number,
	direction: AmbientDirection,
	distance: number,
): void {
	const key = ambientDescriptorKey(descriptor);
	let accumulation = accumulations.get(key);
	if (!accumulation) {
		accumulation = { descriptor, directions: new Map(), soundCount: 0 };
		accumulations.set(key, accumulation);
	}
	accumulation.soundCount += weight;
	// A continuous sound is played centred and never positioned, so retail's `ConstantSound::AddTo`
	// accumulates weight and nothing else.
	if (descriptor.isContinuous) return;

	if (direction === AMBIENT_DIRECTION.inViewerBlock) {
		// Ground the listener is standing on has no direction, so it contributes to all of them.
		for (const compass of AMBIENT_COMPASS_DIRECTIONS) {
			widenDistanceBand(
				accumulation.directions,
				compass,
				AMBIENT_OMNIDIRECTIONAL_MIN_DISTANCE,
				AMBIENT_DISTANCE_BAND_HALF_WIDTH,
			);
		}
		return;
	}
	widenDistanceBand(
		accumulation.directions,
		direction,
		distance - AMBIENT_DISTANCE_BAND_HALF_WIDTH,
		distance + AMBIENT_DISTANCE_BAND_HALF_WIDTH,
	);
}
