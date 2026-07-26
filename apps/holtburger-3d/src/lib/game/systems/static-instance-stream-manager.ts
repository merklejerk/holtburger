import { LeaseRegistry } from "../ownership";
import type {
	InstanceStreamResourceKey,
	RendererResourceManager,
} from "../renderer/resource-manager";
import type {
	StaticInstanceStreamKey,
	StaticInstanceStreamSource,
} from "./static-resources";

/** Owns immutable instance cohorts separately from source mesh geometry. */
export class StaticInstanceStreamManager<TOwnerId extends string = string> {
	readonly #resources: RendererResourceManager;
	readonly #leases = new LeaseRegistry<TOwnerId, StaticInstanceStreamKey>();
	readonly #streams = new Map<
		StaticInstanceStreamKey,
		InstanceStreamResourceKey
	>();

	constructor(resources: RendererResourceManager) {
		this.#resources = resources;
	}

	reserveKeys(
		ownerId: TOwnerId,
		keys: readonly StaticInstanceStreamKey[],
	): void {
		for (const key of keys) this.#leases.addLease(ownerId, key);
	}

	publish(source: StaticInstanceStreamSource): void {
		if (!this.#leases.hasLease(source.key) || this.#streams.has(source.key))
			return;
		this.#streams.set(
			source.key,
			this.#resources.createStaticInstanceStream(source.data),
		);
	}

	getResource(key: StaticInstanceStreamKey): InstanceStreamResourceKey {
		const resource = this.#streams.get(key);
		if (!resource)
			throw new Error(`Static instance stream ${key} does not exist.`);
		return resource;
	}

	dropOwner(ownerId: TOwnerId): void {
		this.#leases.dropOwner(ownerId);
		for (const key of this.#leases.takeEmptyLeases()) {
			const resource = this.#streams.get(key);
			if (resource && !this.#resources.releaseResource(resource)) {
				throw new Error(
					`Static instance stream ${key} lost its backend resource.`,
				);
			}
			this.#streams.delete(key);
		}
	}

	destroy(): void {
		for (const owner of [...this.#leases.iterOwners()]) this.dropOwner(owner);
	}
}
