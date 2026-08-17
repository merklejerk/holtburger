import type { DatAssetId } from "../game-types";
import type { AmbientDescriptor, AmbientTableResolver } from "./ambient-scan";

/**
 * The region-side half of ambient selection: which sounds a classified cell authors.
 *
 * A cell's terrain word gives a terrain type and a scene type, and retail chains them through the
 * region to a sound table (`CTerrainDesc::GetSTBDesc`, acclient.c:292631):
 *
 * ```
 * terrainTypes[terrainCode].sceneTypes[sceneTypeIndex] -> sceneTypes[..].soundTableIndex -> tables[..]
 * ```
 *
 * Resolved once into a lookup rather than per cell, because the scan walks thousands of cells and
 * every one of them would otherwise re-walk three indirections to reach the same answer.
 */

/** One ambient table as the region authors it. */
interface AmbientRegionTable {
	readonly soundTableId: string;
	readonly sounds: readonly {
		readonly soundType: number;
		readonly volume: number;
		readonly baseChance: number;
		readonly minRate: number;
		readonly maxRate: number;
		readonly isContinuous: boolean;
	}[];
}

/** Exactly the region facts ambient selection needs, and nothing else the region carries. */
export interface AmbientRegionFacts {
	readonly tables: readonly AmbientRegionTable[];
	/** Scene types, each naming the ambient table its cells author. */
	readonly sceneTypes: readonly { readonly soundTableIndex: number }[];
	/** Terrain types, each listing the scene types it can select. */
	readonly terrainTypes: readonly { readonly sceneTypes: readonly number[] }[];
}

/**
 * The region's ambient facts resolved for runtime use: the classification lookup plus the slot
 * registry the bake and every weight buffer are sized against.
 */
export interface AmbientRegionResolution {
	/** Resolve one cell's classification to the descriptors it authors, or `null` for none. */
	readonly resolve: AmbientTableResolver;
	/** Every descriptor, indexed by its `slot`; the region's complete slot registry. */
	readonly descriptorsBySlot: readonly AmbientDescriptor[];
}

/**
 * Flatten the region's chain into a direct `(terrainCode, sceneTypeIndex)` lookup, assigning each
 * distinct descriptor its integer slot.
 *
 * Slots are the descriptor identity everywhere downstream — baked terrain entries, scan
 * accumulations, the schedule — so they are assigned exactly once, here, where the descriptor set
 * is fixed for the region's lifetime.
 *
 * A combination that resolves to no table yields `null` rather than an empty array, so the scan can
 * tell "this ground authors nothing" from "this ground authors a table that happens to be empty".
 */
export function createAmbientRegionResolution(
	facts: AmbientRegionFacts,
): AmbientRegionResolution {
	const byClassification = new Map<number, readonly AmbientDescriptor[]>();
	const descriptorsForTable = new Map<number, readonly AmbientDescriptor[]>();
	const descriptorsBySlot: AmbientDescriptor[] = [];

	facts.terrainTypes.forEach((terrainType, terrainCode) => {
		terrainType.sceneTypes.forEach((sceneTypeIndex, localIndex) => {
			const sceneType = facts.sceneTypes[sceneTypeIndex];
			if (!sceneType) return;
			const tableIndex = sceneType.soundTableIndex;
			let descriptors = descriptorsForTable.get(tableIndex);
			if (!descriptors) {
				const table = facts.tables[tableIndex];
				if (!table) return;
				descriptors = table.sounds.map((sound) => {
					const descriptor: AmbientDescriptor = {
						baseChance: sound.baseChance,
						isContinuous: sound.isContinuous,
						maxRate: sound.maxRate,
						minRate: sound.minRate,
						slot: descriptorsBySlot.length,
						soundTableId: table.soundTableId,
						soundType: sound.soundType,
						tableIndex,
						volume: sound.volume,
					};
					descriptorsBySlot.push(descriptor);
					return descriptor;
				});
				descriptorsForTable.set(tableIndex, descriptors);
			}
			byClassification.set(
				classificationKey(terrainCode, localIndex),
				descriptors,
			);
		});
	});
	// Slots ride a Uint16Array through the bake; the retail region authors ~383, so this is a
	// contract assertion rather than a live concern.
	if (descriptorsBySlot.length > 0xffff) {
		throw new Error(
			`Region authors ${descriptorsBySlot.length} ambient descriptors, beyond the u16 slot space.`,
		);
	}

	return {
		descriptorsBySlot,
		resolve: (terrainCode, sceneTypeIndex) =>
			byClassification.get(classificationKey(terrainCode, sceneTypeIndex)) ??
			null,
	};
}

/**
 * Pack one classification into an integer key.
 *
 * Terrain codes are 5 bits and scene-type indexes are 3 in the terrain word; 16 bits of headroom
 * each is comfortable, and an integer key keeps this map allocation-free to probe.
 */
function classificationKey(
	terrainCode: number,
	sceneTypeIndex: number,
): number {
	return terrainCode * 0x10000 + sceneTypeIndex;
}

/** Every distinct sound table the region's ambience can reach, for staging them up front. */
export function ambientSoundTableIds(
	facts: AmbientRegionFacts,
): readonly DatAssetId[] {
	return [
		...new Set(facts.tables.map((table) => table.soundTableId)),
	] as DatAssetId[];
}
