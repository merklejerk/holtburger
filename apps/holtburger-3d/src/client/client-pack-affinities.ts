import type { ClientCharacterSettingsState } from "./client-character-settings-owner";
import type { ClientEntityRead } from "./client-entity-mirror";
import type {
	EquipmentStoragePolicy,
	PackAffinities,
} from "./client-pack-affinity-contract";

/** Learns confirmed containment independently of inventory panels and command intent. */
export class ClientPackAffinities {
	#characterGuid: number | null = null;
	#loadedGeneration: number | null = null;
	#observed: PackAffinities = {};
	#affinities: PackAffinities = {};

	/** Recovery gaps and equipped items never erase remembered containment. */
	observe(read: ClientEntityRead): void {
		if (read.kind !== "current" || read.level.playerGuid === null) return;
		const { playerGuid, entities } = read.level;
		if (this.#characterGuid !== playerGuid) {
			this.reset();
			this.#characterGuid = playerGuid;
		}
		const changes: Record<string, number> = {};
		for (const entity of entities.values()) {
			if (!entity.ownedByPlayer || entity.location.kind !== "contained")
				continue;
			const parent = entity.location.parentGuid;
			if (parent !== playerGuid && entities.get(parent)?.ownedByPlayer !== true)
				continue;
			if (this.#observed[entity.guid] !== parent) changes[entity.guid] = parent;
		}
		if (Object.keys(changes).length === 0) return;
		this.#observed = { ...this.#observed, ...changes };
		this.#affinities = { ...this.#affinities, ...changes };
	}

	/** Live observations win over a late disk load, including items equipped since observation. */
	acceptSettings(state: ClientCharacterSettingsState): PackAffinities | null {
		if (state.kind !== "ready" || state.characterGuid !== this.#characterGuid)
			return null;
		if (this.#loadedGeneration !== state.generation) {
			this.#affinities = {
				...state.settings.packAffinities,
				...this.#observed,
			};
			this.#loadedGeneration = state.generation;
		}
		const saved = state.settings.packAffinities;
		return Object.keys(saved).length === Object.keys(this.#affinities).length &&
			Object.entries(this.#affinities).every(
				([item, parent]) => saved[item] === parent,
			)
			? null
			: this.#affinities;
	}

	/** Snapshot the application's policy once per preview or submission. */
	storage(read: ClientEntityRead): EquipmentStoragePolicy {
		this.observe(read);
		if (read.kind !== "current" || read.level.playerGuid === null) {
			return { preferred: {}, fallback: [] };
		}
		const { playerGuid, entities } = read.level;

		const preferred: Record<string, number> = {};
		const packs: { readonly guid: number; readonly index: number }[] = [];
		for (const entity of entities.values()) {
			if (!entity.ownedByPlayer) continue;
			const location = entity.location;
			const parent = this.#affinities[entity.guid];
			if (location.kind === "equipped" && parent !== undefined)
				preferred[entity.guid] = parent;
			if (
				location.kind === "contained" &&
				location.parentGuid === playerGuid &&
				location.slot.kind === "pack" &&
				location.slot.entryKind === "container"
			) {
				packs.push({ guid: entity.guid, index: location.slot.index });
			}
		}
		packs.sort((a, b) => a.index - b.index || a.guid - b.guid);
		return {
			preferred,
			fallback: [playerGuid, ...packs.map(({ guid }) => guid)],
		};
	}

	/** End the local session's observations; persistence retains the character's history. */
	reset(): void {
		this.#characterGuid = null;
		this.#loadedGeneration = null;
		this.#observed = {};
		this.#affinities = {};
	}
}
