import { LeaseRegistry } from "../ownership";
import { OBJECT_MATERIAL_TEXELS } from "../renderer/object-material-table";
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
	/** Vertex and index payload bytes per device-backed key, for residency accounting. */
	readonly #geometryBytes = new Map<GeometryKey, number>();

	constructor(renderResources: RendererResourceManager) {
		this.#renderResources = renderResources;
	}

	/** Reserve logical geometry identities whose CPU payload may be published later. */
	reserveKeys(owner: TOwnerId, keys: readonly GeometryKey[]): void {
		for (const key of keys) this.#leases.addLease(owner, key);
	}

	/** Replace one owner's exact geometry set without releasing its surviving or replacement keys. */
	replaceOwner(owner: TOwnerId, sources: readonly GeometrySource[]): void {
		const sourceByKey = new Map(sources.map((source) => [source.key, source]));
		const previousKeys = new Set(this.#leases.iterOwnerLeases(owner));
		const addedKeys: GeometryKey[] = [];
		try {
			for (const source of sourceByKey.values()) {
				if (this.#leases.addLease(owner, source.key))
					addedKeys.push(source.key);
				this.upsertGeometry(source);
			}
		} catch (cause) {
			for (const key of addedKeys) this.#leases.dropLease(owner, key);
			this.#releaseUnownedGeometry();
			throw cause;
		}
		for (const key of previousKeys) {
			if (!sourceByKey.has(key)) this.#leases.dropLease(owner, key);
		}
		this.#releaseUnownedGeometry();
	}

	/**
	 * Materialize complete geometry only while at least one owner reserves its key.
	 * Repeated publication for an idempotent key is a no-op.
	 */
	upsertGeometry(source: GeometrySource): void {
		if (!this.#leases.hasLease(source.key)) return;
		if (this.#geometry.has(source.key)) return;
		try {
			this.#geometry.set(
				source.key,
				this.#renderResources.createGeometry(source.geometry),
			);
		} catch (cause) {
			const detail = cause instanceof Error ? cause.message : String(cause);
			throw new Error(`Geometry ${source.key} preparation failed: ${detail}`, {
				cause,
			});
		}
		this.#geometryBytes.set(source.key, geometrySourceBytes(source));
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

	/**
	 * Vertex, index and geometry-owned material-table bytes across device-backed geometry.
	 *
	 * Counts uploaded source payloads and allocated static material rows. Driver-side padding
	 * and resources outside geometry ownership are not visible here.
	 */
	getResourceBytes(): number {
		let bytes = 0;
		for (const value of this.#geometryBytes.values()) bytes += value;
		return bytes;
	}

	/** Drop one owner's geometry retention and release resources with no remaining owner. */
	dropOwner(owner: TOwnerId): void {
		this.#leases.dropOwner(owner);
		this.#releaseUnownedGeometry();
	}

	#releaseUnownedGeometry(): void {
		for (const key of this.#leases.takeEmptyLeases()) {
			const geometry = this.#geometry.get(key);
			if (!geometry) continue;
			this.#geometry.delete(key);
			this.#geometryBytes.delete(key);
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

/** Sum the uploaded payload of one geometry source across its present attribute buffers. */
function geometrySourceBytes(source: GeometrySource): number {
	const geometry = source.geometry;
	// Dynamic index buffers belong to appearance resources, not this shared vertex lease.
	let bytes = geometry.positions.byteLength;
	if (geometry.kind !== "dynamic-parts") bytes += geometry.indices.byteLength;
	if (geometry.kind === "portal-aperture") return bytes;
	bytes += geometry.normals.byteLength + geometry.textureCoordinates.byteLength;
	switch (geometry.kind) {
		case "terrain":
			return bytes + geometry.terrainColorCodes.byteLength;
		case "object":
			return (
				bytes +
				(geometry.bakedLight?.byteLength ?? 0) +
				(geometry.materials
					? geometry.materials.selectors.byteLength +
						geometry.materials.count *
							OBJECT_MATERIAL_TEXELS *
							4 *
							Float32Array.BYTES_PER_ELEMENT
					: 0)
			);
		case "dynamic-parts":
			return (
				bytes +
				geometry.partSelectors.byteLength +
				geometry.materialSelectors.byteLength
			);
	}
}
