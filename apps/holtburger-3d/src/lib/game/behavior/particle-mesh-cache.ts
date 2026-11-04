import type { ParticleMeshPresentations } from "../../assets/decode-particle-mesh-record";
import type { ParticleMeshSource } from "../../assets/particle-mesh-source";
import type { DatAssetId } from "../game-types";
import { isContentFailure } from "../../host/host-command-result";

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
	/** Failed source loads stay cached until explicit retry; no repeated transfers at effect time. */
	readonly #failures = new Map<DatAssetId, unknown>();
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
		const ids = [...new Set(hwGfxObjIds.map((id) => id.toLowerCase()))];
		for (const id of ids) {
			if (this.#failures.has(id)) throw this.#failures.get(id);
		}
		const wanted = ids.filter(
			(id) => !this.#resident.has(id) && !this.#inFlight.has(id),
		);
		const pending = ids
			.map((id) => this.#inFlight.get(id))
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
			.catch((cause: unknown) => {
				if (isContentFailure(cause) && !this.#destroyed) {
					for (const id of wanted) this.#failures.set(id, cause);
				}
				throw cause;
			})
			.finally(() => {
				for (const id of wanted) this.#inFlight.delete(id);
			});
		for (const id of wanted) this.#inFlight.set(id, load);
		await Promise.all([load, ...pending]);
	}

	/** Readiness includes renderer installation, so omitted meshes cannot create live emitters. */
	isReady(id: DatAssetId): boolean {
		return this.#resident.has(id.toLowerCase());
	}

	/** Only an explicit presentation retry clears cached source failures. */
	retryFailed(): void {
		this.#failures.clear();
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
		this.#failures.clear();
		this.#source.destroy();
	}
}
