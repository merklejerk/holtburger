import type { ClientEntityLevel } from "./client-entity-mirror";

/** Ambient recognition from the local ACE world census, 2026-09-12.
 * Refresh query: SELECT DISTINCT d.value FROM
 * weenie_properties_d_i_d d JOIN weenie v ON v.class_Id=d.object_Id
 * WHERE d.type=57 AND v.type=12;
 * Resolve name and icon from the referenced weenie's string 1 and DID 8.
 */
export const INVENTORY_CURRENCIES = [
	[6621, "Scintillating Gem", 0x06002027],
	[20630, "Trade Note (250,000)", 0x06002761],
	[35383, "Ancient Mhoire Coin", 0x060067bc],
	[35810, "Hero Token", 0x06006635],
	[35942, "Dark Tusker Paw", 0x0600669d],
	[36376, "Small Olthoi Venom Sac", 0x06002c97],
	[36518, "Colosseum Coin", 0x060065e4],
	[37492, "Spectral Ingot", 0x060067e9],
	[37559, "Writ of Apology", 0x060067db],
	[38234, "Celestial Hand Trade Token", 0x06006635],
	[38236, "Radiant Blood Trade Token", 0x06006635],
	[38237, "Eldrytch Web Trade Token", 0x06006635],
	[41713, "Whispering Blade Token", 0x06005a1f],
	[43142, "Ornate Gear Marker", 0x06006e0a],
	[43491, "Pitted Slag", 0x06006eab],
	[43747, "Mutated Olthoi Gland", 0x06002c97],
	[43901, "Promissory Note", 0x06006f64],
	[43919, "Token of Resistance Augmentation Changing", 0x06006f65],
	[44240, "A'nekshay Token", 0x06006ff0],
	[45491, "Quest Weapon Coin", 0x06006635],
	[45493, "Rare Coin", 0x06006635],
	[45494, "Imbue Swap Coin", 0x06006635],
	[46423, "Stipend", 0x060072e8],
	[52797, "Gauntlet Coin", 0x0600754b],
	[87549, "Rossu Morta Token", 0x06005a1f],
] as const satisfies readonly (readonly [
	wcid: number,
	name: string,
	base: number,
])[];

/** Display aggregate; base artwork is retained by the inventory state. */
export interface InventoryCurrencyTotal {
	readonly wcid: number;
	readonly name: string;
	readonly base: number;
	readonly count: number;
}

/** Full carried domain, including descendants omitted by the grid layout. */
export function inventoryCurrencyTotals(level: ClientEntityLevel): {
	readonly pending: boolean;
	readonly totals: readonly InventoryCurrencyTotal[];
} {
	let pending = level.playerGuid === null;
	const counts = new Map<number, number>();
	for (const entity of level.entities.values()) {
		if (entity.guid === level.playerGuid && entity.storage.kind !== "container")
			pending = true;
		if (
			entity.guid !== level.playerGuid &&
			!(entity.ownedByPlayer && entity.location.kind === "contained")
		)
			continue;
		if (
			entity.storage.kind === "container" &&
			entity.storage.roster === "awaiting"
		)
			pending = true;
		const description = entity.description;
		if (description.kind === "pending") {
			pending = true;
			continue;
		}
		if (entity.guid === level.playerGuid) continue;
		if (description.wcid === null) {
			pending = true;
			continue;
		}
		// World stackCount is absent for single items; ACE counts those as one.
		counts.set(
			description.wcid,
			(counts.get(description.wcid) ?? 0) + (description.stackCount ?? 1),
		);
	}
	const totals = [...INVENTORY_CURRENCIES]
		.sort((a, b) => a[1].localeCompare(b[1]))
		.flatMap(([wcid, name, base]) => {
			const count = counts.get(wcid) ?? 0;
			return count > 0 ? [{ wcid, name, base, count }] : [];
		});
	return { pending, totals };
}
