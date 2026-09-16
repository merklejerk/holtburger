import type { ParticleMeshPresentations } from "../../assets/decode-particle-mesh-record";
import type { ParticleMeshSource } from "../../assets/particle-mesh-source";
import type { DatAssetId } from "../game-types";

/**
 * Resolves particle mesh presentations, batching each request and never loading twice.
 *
 * Not a {@link PreparedAssetRepository}: that lifecycle is per-id with acquired handles, and
 * particle meshes are requested in batches and outlive individual emitters. A mesh stays resident
 * once loaded, which is correct here — the archive's emitter meshes are few and shared, so
 * releasing one only to reload it on the next `CreateParticle` would be pure churn.
 */
export class ParticleMeshCache {
	readonly #source: ParticleMeshSource;
	readonly #resident = new Set<DatAssetId>();
	/** Shared readiness includes texture and GPU installation, not only transfer/decode. */
	readonly #install: (batch: ParticleMeshPresentations) => Promise<void>;
	readonly #inFlight = new Map<DatAssetId, Promise<void>>();
	#destroyed = false;

	constructor(
		source: ParticleMeshSource,
		install: (batch: ParticleMeshPresentations) => Promise<void>,
	) {
		this.#source = source;
		this.#install = install;
	}

	/**
	 * Load every named mesh that is not already resident or in flight.
	 *
	 * Every caller awaits the same transfer, decode, and installation promise for shared meshes.
	 */
	async prepare(hwGfxObjIds: readonly DatAssetId[]): Promise<void> {
		if (this.#destroyed)
			throw new Error(
				"Cannot prepare meshes on a destroyed particle mesh cache.",
			);
		const wanted = [
			...new Set(hwGfxObjIds.map((id) => id.toLowerCase())),
		].filter(
			(id) =>
				!this.#resident.has(id as DatAssetId) &&
				!this.#inFlight.has(id as DatAssetId),
		) as DatAssetId[];
		const pending = hwGfxObjIds
			.map((id) => this.#inFlight.get(id.toLowerCase() as DatAssetId))
			.filter((entry): entry is Promise<void> => entry !== undefined);
		if (wanted.length === 0) {
			await Promise.all(pending);
			return;
		}
		const load = this.#source
			.loadParticleMeshes(wanted)
			.then(async (batch) => {
				if (this.#destroyed)
					throw new Error(
						"Particle mesh cache was destroyed during preparation.",
					);
				for (const id of wanted) {
					if (!batch.presentations.has(id))
						throw new Error(
							`Particle mesh batch omitted requested mesh ${id}.`,
						);
				}
				await this.#install(batch);
				if (this.#destroyed)
					throw new Error(
						"Particle mesh cache was destroyed during installation.",
					);
				for (const id of batch.presentations.keys()) this.#resident.add(id);
			})
			.finally(() => {
				for (const id of wanted) this.#inFlight.delete(id);
			});
		for (const id of wanted) this.#inFlight.set(id, load);
		await Promise.all([load, ...pending]);
	}

	getDiagnostics() {
		return {
			inFlightMeshCount: this.#inFlight.size,
			residentMeshCount: this.#resident.size,
		};
	}

	destroy(): void {
		if (this.#destroyed) return;
		this.#destroyed = true;
		this.#resident.clear();
		this.#inFlight.clear();
		this.#source.destroy();
	}
}
