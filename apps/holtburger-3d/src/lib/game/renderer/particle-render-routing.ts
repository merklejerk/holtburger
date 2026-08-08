import type { ParticleInstanceRecord } from "./particle-instance-stream";
import type {
	ParticleRenderOwner,
	ParticleSourceCohort,
} from "../systems/particle-system";
import type { DatAssetId } from "../game-types";

/** Final instanced particle batch after portal-domain ownership has been erased. */
export interface ParticleDrawBatch {
	/** Particle mesh shared by every instance in this draw. */
	readonly hwGfxObjId: DatAssetId;
	/** Vertex-stage motion law shared by every instance in this draw. */
	readonly motionType: number;
	/** Spawn records uploaded by one instanced draw. */
	readonly particles: readonly ParticleInstanceRecord[];
}

/** Mutable scratch form of one final draw batch. */
interface MutableParticleDrawBatch extends ParticleDrawBatch {
	readonly particles: ParticleInstanceRecord[];
}

/**
 * Routes owner-local particle sources into render domains, then recoalesces their GPU batches.
 *
 * Scratch persists across frames. Ownership is intentionally absent from {@link ParticleDrawBatch}:
 * it exists only to select a domain, and retaining it afterward would manufacture one draw per
 * owner instead of one draw per compatible mesh and motion law in the final contribution.
 */
export class ParticleRenderBatcher {
	/** Reused output arrays grouped by the final render domain. */
	readonly #domainBatches = new Map<string, ParticleDrawBatch[]>();
	/** Reused route batches keyed by domain, mesh, and motion law. */
	readonly #domainScratch = new Map<string, MutableParticleDrawBatch>();
	/** Reused output for several render nodes sharing one executor contribution. */
	readonly #mergedOutput: ParticleDrawBatch[] = [];
	/** Reused contribution batches keyed only by the final GPU compatibility facts. */
	readonly #mergeScratch = new Map<string, MutableParticleDrawBatch>();
	/** Revision owning the domain-keyed scratch, or null before the first route. */
	#routingRevision: number | string | null = null;

	/** Release all frame references and revision-owned scratch on particle residency teardown. */
	clear(): void {
		this.#domainBatches.clear();
		this.#domainScratch.clear();
		this.#mergedOutput.length = 0;
		this.#mergeScratch.clear();
		this.#routingRevision = null;
	}

	/** Assign every source once, omitting owners unavailable to this view's render graph. */
	route(
		routingRevision: number | string,
		sources: readonly ParticleSourceCohort[],
		resolveDomain: (owner: ParticleRenderOwner) => string | null,
	): ReadonlyMap<string, readonly ParticleDrawBatch[]> {
		if (this.#routingRevision !== routingRevision) {
			this.#routingRevision = routingRevision;
			this.#domainBatches.clear();
			this.#domainScratch.clear();
			this.#mergedOutput.length = 0;
			this.#mergeScratch.clear();
		}
		for (const batch of this.#domainScratch.values())
			batch.particles.length = 0;
		for (const batches of this.#domainBatches.values()) batches.length = 0;

		for (const source of sources) {
			const domainId = resolveDomain(source.renderOwner);
			if (domainId === null) continue;
			const batchKey = `${domainId}\0${source.hwGfxObjId}\0${source.motionType}`;
			let batch = this.#domainScratch.get(batchKey);
			if (!batch) {
				batch = {
					hwGfxObjId: source.hwGfxObjId,
					motionType: source.motionType,
					particles: [],
				};
				this.#domainScratch.set(batchKey, batch);
			}
			if (batch.particles.length === 0) {
				const batches = this.#domainBatches.get(domainId) ?? [];
				batches.push(batch);
				this.#domainBatches.set(domainId, batches);
			}
			for (const particle of source.particles) batch.particles.push(particle);
		}

		return this.#domainBatches;
	}

	/**
	 * Merge nodes submitted under one executor contribution without restoring owner boundaries.
	 *
	 * The result is consumed immediately by the draw callback and remains valid only until the next
	 * call, matching the frame-local source records it references.
	 */
	mergeContribution(
		batchGroups: readonly (readonly ParticleDrawBatch[])[],
	): readonly ParticleDrawBatch[] {
		if (batchGroups.length === 1) return batchGroups[0] ?? [];
		for (const batch of this.#mergeScratch.values()) batch.particles.length = 0;
		this.#mergedOutput.length = 0;
		for (const group of batchGroups) {
			for (const source of group) {
				const batchKey = `${source.hwGfxObjId}\0${source.motionType}`;
				let batch = this.#mergeScratch.get(batchKey);
				if (!batch) {
					batch = {
						hwGfxObjId: source.hwGfxObjId,
						motionType: source.motionType,
						particles: [],
					};
					this.#mergeScratch.set(batchKey, batch);
				}
				if (batch.particles.length === 0) this.#mergedOutput.push(batch);
				for (const particle of source.particles) batch.particles.push(particle);
			}
		}
		return this.#mergedOutput;
	}
}
