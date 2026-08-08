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
 * Flatten the region's chain into a direct `(terrainCode, sceneTypeIndex)` lookup.
 *
 * A combination that resolves to no table yields `null` rather than an empty array, so the scan can
 * tell "this ground authors nothing" from "this ground authors a table that happens to be empty".
 */
export function createAmbientTableResolver(
	facts: AmbientRegionFacts,
): AmbientTableResolver {
	const byClassification = new Map<string, readonly AmbientDescriptor[]>();
	const descriptorsForTable = new Map<number, readonly AmbientDescriptor[]>();

	facts.terrainTypes.forEach((terrainType, terrainCode) => {
		terrainType.sceneTypes.forEach((sceneTypeIndex, localIndex) => {
			const sceneType = facts.sceneTypes[sceneTypeIndex];
			if (!sceneType) return;
			const tableIndex = sceneType.soundTableIndex;
			let descriptors = descriptorsForTable.get(tableIndex);
			if (!descriptors) {
				const table = facts.tables[tableIndex];
				if (!table) return;
				descriptors = table.sounds.map((sound) => ({
					baseChance: sound.baseChance,
					isContinuous: sound.isContinuous,
					maxRate: sound.maxRate,
					minRate: sound.minRate,
					soundTableId: table.soundTableId,
					soundType: sound.soundType,
					tableIndex,
					volume: sound.volume,
				}));
				descriptorsForTable.set(tableIndex, descriptors);
			}
			byClassification.set(
				classificationKey(terrainCode, localIndex),
				descriptors,
			);
		});
	});

	return (terrainCode, sceneTypeIndex) =>
		byClassification.get(classificationKey(terrainCode, sceneTypeIndex)) ??
		null;
}

function classificationKey(
	terrainCode: number,
	sceneTypeIndex: number,
): string {
	return `${terrainCode}:${sceneTypeIndex}`;
}

/** Every distinct sound table the region's ambience can reach, for staging them up front. */
export function ambientSoundTableIds(
	facts: AmbientRegionFacts,
): readonly DatAssetId[] {
	return [
		...new Set(facts.tables.map((table) => table.soundTableId)),
	] as DatAssetId[];
}
