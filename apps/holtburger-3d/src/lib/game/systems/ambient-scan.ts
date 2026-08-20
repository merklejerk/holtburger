import {
	acVector3,
	acVectorToRender,
	sceneVector3,
} from "../../assets/ac-frame";
import type { SceneVector3 } from "../../assets/ac-frame";
import {
	AMBIENT_COMPASS_DIRECTIONS,
	AMBIENT_DIRECTION,
	AMBIENT_DIRECTION_ARC,
	AMBIENT_DIRECTION_HEADING,
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
import { clamp } from "../math/vector-utils";

/**
 * The per-cell walk that decides which ambience the listener can hear, and how much of it.
 *
 * Ambience is not a property of a region: it is a property of the ground within earshot. Retail walks
 * the landblock cell grid and treats every cell as a source (acclient.c:338010-338052), so a river to
 * the north is audible from the north because the water cells *are* north.
 *
 * The walk is split by lifetime. What a cell *contributes* depends only on authored terrain and the
 * installed region, so it is baked once per landblock at terrain install (`bakeAmbientBlock`) into
 * flat arrays. How much it contributes *from here* depends on the listener, so it is streamed: the
 * schedule scan (`scanAmbientSources`) runs on cell crossings and the per-slot weight pass
 * (`accumulateAmbientWeights`) runs on the bounded audio-control cadence. Both stay free of clocks
 * and playback so they can be tested as functions of position.
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
	/**
	 * This descriptor's index in the region's slot registry, assigned once at region install.
	 *
	 * The identity used everywhere downstream — baked entries, scan accumulations, and the
	 * schedule — so no consumer rebuilds a composite key from `tableIndex` and `soundType`.
	 */
	readonly slot: number;
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

/**
 * One landblock's sound-authoring ground, baked flat at terrain install.
 *
 * One entry per contributing **cell**, referencing a shared slot list — not one per
 * (cell, descriptor) pair. The distinction is retail's weighting semantics, not storage thrift: a
 * cell is one source however many sounds its table authors, so its weight enters `total_weight`
 * exactly once and then reaches every slot on its list (`Ambient::AddSound`). Flattening to
 * per-descriptor entries once divided every share by the table size and silenced most production
 * ambience.
 *
 * Parallel `Float32Array` lanes rather than objects, because the audio-control weight pass iterates
 * every cell in earshot and must not chase pointers or allocate. Positions are block-local so the
 * arrays stay small-valued; the origin is added during the walk, which also keeps the retained data
 * in the frames the app allows retention in.
 */
export interface BakedAmbientBlock {
	/** Scene-space position of the block's row-0, column-0 vertex. */
	readonly origin: SceneVector3;
	/** Axis-aligned horizontal extent, for rejecting the whole block before touching entries. */
	readonly span: number;
	/** Block-local X per contributing cell (eastward, render axes). */
	readonly cellX: Float32Array;
	/** Block-local Y per contributing cell: its authored height. */
	readonly cellY: Float32Array;
	/** Block-local Z per contributing cell (southward-positive render axes; rows run north as -Z). */
	readonly cellZ: Float32Array;
	/** Per cell, an index into `slotLists`, parallel with the position lanes. */
	readonly cellSlotList: Uint16Array;
	/** The distinct slot lists this block's cells author, deduplicated by table. */
	readonly slotLists: readonly (readonly number[])[];
}

/**
 * Bake one landblock's contribution entries, resolving each cell's classification exactly once.
 *
 * Everything here is listener-independent; nothing baked ever goes stale from camera movement. The
 * bake is invalidated only by the block leaving residency or the region (and so the slot registry)
 * being reinstalled, both of which drop the whole baked block.
 */
export function bakeAmbientBlock(
	block: AmbientTerrainBlock,
	resolve: AmbientTableResolver,
): BakedAmbientBlock {
	const cellsPerSide = block.gridSize - 1;
	const cellX: number[] = [];
	const cellY: number[] = [];
	const cellZ: number[] = [];
	const cellSlotList: number[] = [];
	const slotLists: (readonly number[])[] = [];
	// Every descriptor in a resolved list shares its table, so the table index is the list's
	// identity — robust even if a resolver hands out fresh arrays per call.
	const listIndexByTable = new Map<number, number>();
	for (let row = 0; row < cellsPerSide; row += 1) {
		for (let column = 0; column < cellsPerSide; column += 1) {
			const vertex = row * block.gridSize + column;
			const sample = block.terrainSamples[vertex];
			const height = block.heights[vertex];
			if (sample === undefined || height === undefined) {
				throw new Error(
					`Ambient bake reached vertex ${vertex} outside its terrain block.`,
				);
			}
			const descriptors = resolve(
				terrainCodeOf(sample),
				sceneTypeIndexOf(sample),
			);
			if (!descriptors || descriptors.length === 0) continue;
			const tableIndex = descriptors[0]!.tableIndex;
			let listIndex = listIndexByTable.get(tableIndex);
			if (listIndex === undefined) {
				listIndex = slotLists.length;
				slotLists.push(descriptors.map((descriptor) => descriptor.slot));
				listIndexByTable.set(tableIndex, listIndex);
			}
			// Canonical rows run south to north, which is render-local -Z.
			cellX.push(column * block.tileSize);
			cellY.push(height);
			cellZ.push(-row * block.tileSize);
			cellSlotList.push(listIndex);
		}
	}
	return {
		cellSlotList: Uint16Array.from(cellSlotList),
		cellX: Float32Array.from(cellX),
		cellY: Float32Array.from(cellY),
		cellZ: Float32Array.from(cellZ),
		origin: block.origin,
		slotLists,
		span: cellsPerSide * block.tileSize,
	};
}

/** One landblock's terrain paired with its identity, which the bake registry reconciles by. */
export interface InstalledAmbientTerrain {
	readonly landblockId: string;
	readonly block: AmbientTerrainBlock;
}

/**
 * The baked blocks currently in residency, reconciled lazily against the terrain system.
 *
 * Keyed on the terrain installation revision rather than on install/release events: the revision
 * already bumps on both, so a cheap diff of landblock ids on revision change replaces observer
 * plumbing. Cleared whenever the region reinstalls, because baked slot ids belong to one region's
 * slot registry.
 */
export class AmbientBakeRegistry {
	readonly #blocks = new Map<string, BakedAmbientBlock>();
	#revision: number | null = null;
	#cellSize: number | null = null;

	/**
	 * Bring the baked set up to date with the installed terrain; returns whether anything changed.
	 *
	 * Takes a thunk rather than an iterable so the unchanged-revision path — the every-frame case —
	 * costs one number comparison and builds nothing.
	 */
	reconcile(
		revision: number,
		listTerrain: () => Iterable<InstalledAmbientTerrain>,
		resolve: AmbientTableResolver,
	): boolean {
		if (revision === this.#revision) return false;
		this.#revision = revision;
		const seen = new Set<string>();
		for (const { landblockId, block } of listTerrain()) {
			seen.add(landblockId);
			if (!this.#blocks.has(landblockId)) {
				this.#blocks.set(landblockId, bakeAmbientBlock(block, resolve));
			}
			this.#cellSize ??= block.tileSize;
		}
		for (const landblockId of [...this.#blocks.keys()]) {
			if (!seen.has(landblockId)) this.#blocks.delete(landblockId);
		}
		return true;
	}

	/** Drop every bake; required on region reinstall, whose new slot registry orphans baked slots. */
	clear(): void {
		this.#blocks.clear();
		this.#revision = null;
		this.#cellSize = null;
	}

	blocks(): IterableIterator<BakedAmbientBlock> {
		return this.#blocks.values();
	}

	/** Bake facts for diagnosing silent ambience: how much authoring ground is even known. */
	getDiagnostics(): AmbientBakeDiagnostics {
		let entryCount = 0;
		for (const block of this.#blocks.values()) {
			entryCount += block.cellX.length;
		}
		return { blockCount: this.#blocks.size, entryCount };
	}

	/** The authored terrain cell size, from the installed blocks; `null` until any block installs. */
	get cellSize(): number | null {
		return this.#cellSize;
	}
}

/** How much sound-authoring ground the bake registry currently knows. */
export interface AmbientBakeDiagnostics {
	readonly blockCount: number;
	/** Contributing cells across every baked block; zero explains total ambient silence. */
	readonly entryCount: number;
}

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
	/** One entry per descriptor with any contributor, keyed by descriptor slot. */
	readonly accumulations: ReadonlyMap<number, AmbientAccumulation>;
	/** Summed weight across every contributing cell, which normalizes each descriptor's share. */
	readonly totalWeight: number;
	/** Contribution entries examined, for diagnosing a scan that found nothing. */
	readonly examinedCellCount: number;
}

/** Immutable empty scan result used when ambient sounds are silenced (e.g. inside an EnvCell without SeenOutside). */
export const EMPTY_AMBIENT_SCAN_RESULT: AmbientScanResult = Object.freeze({
	accumulations: new Map(),
	totalWeight: 0,
	examinedCellCount: 0,
});

/**
 * Walk every audible baked cell, visiting each with its weight and geometry; returns the summed
 * weight and the count of cells in range.
 *
 * The single owner of the cell-weighting semantics both consumers share — block rejection, deltas,
 * the weight curve, slot-list resolution, and the retail invariant that one cell is one source: its
 * weight enters the total once, however many sounds its table authors (`Ambient::AddSound`).
 * Getting that invariant wrong in one of two copies once silenced most production ambience, which
 * is why there are no longer two copies.
 *
 * The visitor is a plain call per audible cell — tens of cells at 60 Hz on the frame path — and
 * both call sites pass allocation-free visitors.
 */
function walkAudibleAmbientCells(
	listenerPosition: SceneVector3,
	blocks: Iterable<BakedAmbientBlock>,
	visit: (
		slotList: readonly number[],
		weight: number,
		deltaX: number,
		deltaZ: number,
		distanceSquared: number,
	) => void,
): { totalWeight: number; examinedCellCount: number } {
	let totalWeight = 0;
	let examinedCellCount = 0;
	for (const block of blocks) {
		if (!blockWithinAmbientRange(block, listenerPosition)) continue;
		for (let cell = 0; cell < block.cellX.length; cell += 1) {
			const deltaX = block.origin[0] + block.cellX[cell]! - listenerPosition[0];
			const deltaY = block.origin[1] + block.cellY[cell]! - listenerPosition[1];
			const deltaZ = block.origin[2] + block.cellZ[cell]! - listenerPosition[2];
			const distanceSquared =
				deltaX * deltaX + deltaY * deltaY + deltaZ * deltaZ;
			if (distanceSquared > AMBIENT_MAX_DISTANCE_SQUARED) continue;
			examinedCellCount += 1;
			const weight = ambientWeight(distanceSquared);
			if (weight === 0) continue;
			totalWeight += weight;
			const slotList = block.slotLists[block.cellSlotList[cell]!];
			if (!slotList) {
				throw new Error(
					`Baked ambient cell ${cell} names an unknown slot list.`,
				);
			}
			visit(slotList, weight, deltaX, deltaZ, distanceSquared);
		}
	}
	return { examinedCellCount, totalWeight };
}

/**
 * Accumulate every ambient descriptor audible from `listenerPosition`, for the schedule.
 *
 * Runs on cell crossings, not on the audio-control cadence, so its per-call result allocation is
 * O(descriptors within earshot) — a few dozen small objects at walking pace — and deliberately not
 * pooled. The live path is `accumulateAmbientWeights`, which allocates nothing.
 */
export function scanAmbientSources(
	listenerPosition: SceneVector3,
	blocks: Iterable<BakedAmbientBlock>,
	descriptorsBySlot: readonly AmbientDescriptor[],
): AmbientScanResult {
	const accumulations = new Map<number, AmbientAccumulation>();
	const { examinedCellCount, totalWeight } = walkAudibleAmbientCells(
		listenerPosition,
		blocks,
		(slotList, weight, deltaX, deltaZ, distanceSquared) => {
			// A scene-position difference is a render-axis displacement; compass bucketing compares
			// eastward against northward in AC's plane, which is render +X against render -Z.
			const direction = ambientDirection(deltaX, -deltaZ);
			const distance = Math.sqrt(distanceSquared);
			for (const slot of slotList) {
				const descriptor = descriptorsBySlot[slot];
				if (!descriptor) {
					throw new Error(`Baked ambient entry names unknown slot ${slot}.`);
				}
				accumulate(accumulations, descriptor, weight, direction, distance);
			}
		},
	);
	return { accumulations, examinedCellCount, totalWeight };
}

/**
 * Sum each slot's presence weight from `listenerPosition` into `outWeights`; returns the total.
 *
 * The audio-control half of the split walk: no directions, no bands, no descriptor objects, and
 * no allocation — the caller owns the buffer, sized to the region's slot count.
 */
export function accumulateAmbientWeights(
	listenerPosition: SceneVector3,
	blocks: Iterable<BakedAmbientBlock>,
	outWeights: Float32Array,
): number {
	outWeights.fill(0);
	return walkAudibleAmbientCells(
		listenerPosition,
		blocks,
		(slotList, weight) => {
			for (const slot of slotList) {
				if (slot >= outWeights.length) {
					throw new Error(
						`Baked ambient entry names slot ${slot} beyond the weight buffer.`,
					);
				}
				outWeights[slot]! += weight;
			}
		},
	).totalWeight;
}

/**
 * Place one firing of an intermittent sound within the ground that authored it
 * (`IntermitSound::GetSoundPos`, acclient.c:367457).
 *
 * Rolls a direction among those with contributors, jitters the heading inside that direction's arc,
 * and rolls a distance within the band those contributors span. The result is randomized but bounded
 * by where the terrain actually is, which is what makes a river to the north sound like it is to the
 * north without tracking individual sources.
 *
 * Returns `null` when the descriptor has no directional contributors, which the caller plays centred.
 */
export function placeAmbientSound(
	directions: ReadonlyMap<AmbientDirection, AmbientDistanceBand>,
	listenerPosition: SceneVector3,
	roll: () => number,
): SceneVector3 | null {
	const entries = [...directions.entries()];
	if (entries.length === 0) return null;
	const chosen =
		entries[Math.min(entries.length - 1, Math.floor(roll() * entries.length))];
	if (!chosen) return null;
	const [direction, band] = chosen;
	const heading =
		AMBIENT_DIRECTION_HEADING[direction] +
		roll() * AMBIENT_DIRECTION_ARC -
		AMBIENT_DIRECTION_ARC * 0.5;
	// RETAIL QUIRK: the distance roll is squared (acclient.c:367481), so a uniform roll lands a third
	// of the way across the band on average and a quarter of the way at the median, rather than
	// halfway. It is not merely "missing" an area correction — area-uniform sampling over an annulus
	// takes a square root and biases *outward*, so this leans the opposite way from correct.
	//
	// Two consequences make it load-bearing rather than cosmetic. `AddDir` collapses every contributor
	// in one direction into a single band, so a near-edge bias approximates hearing the *nearest*
	// instance of that terrain rather than a random one. And because gain falls as 1/d², the far end
	// of a wide band is usually under the audible floor: on a 5-125 m band the squared roll puts the
	// median at 35 m where a linear roll would put it at 65 m, which is the difference between
	// ambience that plays and ambience that is mostly culled.
	//
	// Nothing in the decompile shows intent either way. It is bounded — a placement never leaves
	// [minimum, maximum] — and every shipped ambience was mixed against it, so it is transcribed.
	const spread = roll();
	const distance =
		band.minimum + (band.maximum - band.minimum) * spread * spread;
	// Compass bearings live in AC's horizontal plane, so the offset is built there and converted once.
	// Retail leaves the listener's own height alone, making ambience two-dimensional.
	const offset = acVectorToRender(
		acVector3([Math.sin(heading) * distance, Math.cos(heading) * distance, 0]),
	);
	return sceneVector3([
		listenerPosition[0] + offset[0],
		listenerPosition[1] + offset[1],
		listenerPosition[2] + offset[2],
	]);
}

/**
 * Whether any entry of one baked block can lie within the ambient radius.
 *
 * Tests the listener against the block's axis-aligned span, so it rejects only blocks that provably
 * cannot contribute. Height is deliberately ignored here: the per-entry test uses the real vertex
 * height, and a block-level bound would need the terrain's height range to stay conservative.
 */
function blockWithinAmbientRange(
	block: BakedAmbientBlock,
	listenerPosition: SceneVector3,
): boolean {
	// Canonical rows run south to north, which is render-local -Z, so the block spans -span in z.
	const nearestX = clamp(
		listenerPosition[0],
		block.origin[0],
		block.origin[0] + block.span,
	);
	const nearestZ = clamp(
		listenerPosition[2],
		block.origin[2] - block.span,
		block.origin[2],
	);
	const deltaX = nearestX - listenerPosition[0];
	const deltaZ = nearestZ - listenerPosition[2];
	return deltaX * deltaX + deltaZ * deltaZ <= AMBIENT_MAX_DISTANCE_SQUARED;
}

/** Fold one entry's contribution into one descriptor (`Ambient::AddSound` → `AmbientSound::AddTo`). */
function accumulate(
	accumulations: Map<number, AmbientAccumulation>,
	descriptor: AmbientDescriptor,
	weight: number,
	direction: AmbientDirection,
	distance: number,
): void {
	let accumulation = accumulations.get(descriptor.slot);
	if (!accumulation) {
		accumulation = { descriptor, directions: new Map(), soundCount: 0 };
		accumulations.set(descriptor.slot, accumulation);
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
