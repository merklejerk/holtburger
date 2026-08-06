import type { DecodedStaticPresentation } from "../../assets/decode-static-source-record";
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
	readonly #presentations = new Map<DatAssetId, DecodedStaticPresentation>();
	readonly #inFlight = new Map<DatAssetId, Promise<void>>();
	#destroyed = false;

	constructor(source: ParticleMeshSource) {
		this.#source = source;
	}

	/**
	 * Load every named mesh that is not already resident or in flight.
	 *
	 * Called during staging, so a `CreateParticle` reached at frame time finds its mesh in memory.
	 */
	async prepare(hwGfxObjIds: readonly DatAssetId[]): Promise<void> {
		if (this.#destroyed)
			throw new Error("Cannot prepare meshes on a destroyed particle mesh cache.");
		const wanted = [...new Set(hwGfxObjIds.map((id) => id.toLowerCase()))].filter(
			(id) =>
				!this.#presentations.has(id as DatAssetId) &&
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
			.then((batch) => {
				if (this.#destroyed) return;
				for (const [id, presentation] of batch.presentations) {
					this.#presentations.set(id, presentation);
				}
			})
			.finally(() => {
				for (const id of wanted) this.#inFlight.delete(id);
			});
		for (const id of wanted) this.#inFlight.set(id, load);
		await Promise.all([load, ...pending]);
	}

	/** Read a resident mesh without loading; `null` keeps frame-time IO impossible. */
	get(hwGfxObjId: DatAssetId): DecodedStaticPresentation | null {
		return this.#presentations.get(hwGfxObjId.toLowerCase() as DatAssetId) ?? null;
	}

	getDiagnostics() {
		return {
			inFlightMeshCount: this.#inFlight.size,
			residentMeshCount: this.#presentations.size,
		};
	}

	destroy(): void {
		if (this.#destroyed) return;
		this.#destroyed = true;
		this.#presentations.clear();
		this.#inFlight.clear();
		this.#source.destroy();
	}
}
