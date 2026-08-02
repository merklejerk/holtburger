import { LeaseRegistry } from "../ownership";
import type {
	StaticInstanceStreamData,
	StaticInstanceStreamKey,
	StaticInstanceStreamSource,
} from "./static-resources";

/** Owns immutable generated-scenery fragments separately from source mesh geometry. */
export class StaticInstanceStreamManager<TOwnerId extends string = string> {
	readonly #leases = new LeaseRegistry<TOwnerId, StaticInstanceStreamKey>();
	readonly #streams = new Map<
		StaticInstanceStreamKey,
		StaticInstanceStreamData
	>();

	reserveKeys(
		ownerId: TOwnerId,
		keys: readonly StaticInstanceStreamKey[],
	): void {
		for (const key of keys) this.#leases.addLease(ownerId, key);
	}

	publish(source: StaticInstanceStreamSource): void {
		if (!this.#leases.hasLease(source.key) || this.#streams.has(source.key))
			return;
		this.#streams.set(source.key, source.data);
	}

	getData(key: StaticInstanceStreamKey): StaticInstanceStreamData {
		const data = this.#streams.get(key);
		if (!data) throw new Error(`Static instance stream ${key} does not exist.`);
		return data;
	}

	dropOwner(ownerId: TOwnerId): void {
		this.#leases.dropOwner(ownerId);
		for (const key of this.#leases.takeEmptyLeases()) {
			this.#streams.delete(key);
		}
	}

	destroy(): void {
		for (const owner of [...this.#leases.iterOwners()]) this.dropOwner(owner);
	}
}
