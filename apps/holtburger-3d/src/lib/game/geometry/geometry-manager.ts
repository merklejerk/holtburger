import { LeaseRegistry } from "../ownership";
import type {
	GeometryResourceKey,
	RendererResourceManager,
} from "../renderer/resource-manager";
import type { GeometryKey, GeometrySource } from "./types";

/** Owns logical geometry identity, device bindings, and shared owner retention. */
export class GeometryManager<TOwnerId extends string = string> {
	readonly #renderResources: RendererResourceManager;
	readonly #leases = new LeaseRegistry<TOwnerId, GeometryKey>();
	readonly #geometry = new Map<GeometryKey, GeometryResourceKey>();

	constructor(renderResources: RendererResourceManager) {
		this.#renderResources = renderResources;
	}

	/** Reserve logical geometry identities whose CPU payload may be published later. */
	reserveKeys(owner: TOwnerId, keys: readonly GeometryKey[]): void {
		for (const key of keys) this.#leases.addLease(owner, key);
	}

	/**
	 * Materialize complete geometry only while at least one owner reserves its key.
	 * Repeated publication for an idempotent key is a no-op.
	 */
	upsertGeometry(source: GeometrySource): void {
		if (!this.#leases.hasLease(source.key)) return;
		if (this.#geometry.has(source.key)) return;
		this.#geometry.set(
			source.key,
			this.#renderResources.createGeometry(source.geometry),
		);
	}

	getResource(key: GeometryKey): GeometryResourceKey {
		const geometry = this.#geometry.get(key);
		if (!geometry) throw new Error(`Geometry ${key} does not exist.`);
		return geometry;
	}

	hasGeometry(key: GeometryKey): boolean {
		return this.#geometry.has(key);
	}

	/** Number of currently device-backed geometry allocations. */
	getResourceCount(): number {
		return this.#geometry.size;
	}

	/** Drop one owner's geometry retention and release resources with no remaining owner. */
	dropOwner(owner: TOwnerId): void {
		this.#leases.dropOwner(owner);
		for (const key of this.#leases.takeEmptyLeases()) {
			const geometry = this.#geometry.get(key);
			if (!geometry) continue;
			this.#geometry.delete(key);
			if (!this.#renderResources.releaseResource(geometry)) {
				throw new Error(`Geometry ${key} lost its backend resource.`);
			}
		}
	}

	/** Release every geometry resource retained by runtime owners. */
	destroy(): void {
		for (const owner of [...this.#leases.iterOwners()]) this.dropOwner(owner);
	}
}
