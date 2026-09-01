import type {
	ParticleRenderOwner,
	ParticleSourceRange,
} from "../systems/particle-system";
import type { DatAssetId } from "../game-types";

/** Final instanced particle draw after portal-domain ownership has been erased. */
export interface ParticleDrawRange {
	/** Particle mesh shared by every instance in this draw. */
	readonly hwGfxObjId: DatAssetId;
	/** Vertex-stage motion law shared by every instance in this draw. */
	readonly motionType: number;
	/** Record-local or one live emitter origin, preserved through domain routing. */
	readonly origin: ParticleSourceRange["origin"];
	/** First record slot this draw reads. */
	readonly baseSlot: number;
	/** Instances drawn from `baseSlot`. */
	readonly count: number;
}

/** Mutable scratch form of one final draw range. */
type MutableParticleDrawRange = {
	-readonly [K in keyof ParticleDrawRange]: ParticleDrawRange[K];
};

/**
 * Routes owner-local particle sources into render domains.
 *
 * Ownership is intentionally absent from {@link ParticleDrawRange}: it exists only to select a
 * domain, and retaining it afterward would leak scope policy into the draw contract.
 *
 * Deliberately does *not* recoalesce by mesh and motion law, unlike the record-array form this
 * replaced. A range names a contiguous run of record slots owned by one emitter, and two emitters'
 * runs are not adjacent, so there is nothing to merge — a merged draw would have to cover the
 * slots between them. Reducing the draw count is a packing question for the slot allocator rather
 * than a routing one.
 */
export class ParticleRenderBatcher {
	/** Reused output arrays grouped by the final render domain. */
	readonly #domainRanges = new Map<string, ParticleDrawRange[]>();
	/**
	 * Flat pool of range objects the domain arrays hold references into.
	 *
	 * One object per visible emitter per frame would otherwise be allocated here and immediately
	 * discarded, which is the churn the particle path is built to avoid.
	 */
	readonly #rangePool: MutableParticleDrawRange[] = [];
	#rangesUsed = 0;
	/** Reused output for several render nodes sharing one executor contribution. */
	readonly #mergedOutput: ParticleDrawRange[] = [];
	/** Revision owning the domain-keyed scratch, or null before the first route. */
	#routingRevision: number | string | null = null;

	/** Release all frame references and revision-owned scratch on particle residency teardown. */
	clear(): void {
		this.#domainRanges.clear();
		this.#rangePool.length = 0;
		this.#rangesUsed = 0;
		this.#mergedOutput.length = 0;
		this.#routingRevision = null;
	}

	/** Assign every source once, omitting owners unavailable to this view's render graph. */
	route(
		routingRevision: number | string,
		sources: readonly ParticleSourceRange[],
		resolveDomain: (owner: ParticleRenderOwner) => string | null,
	): ReadonlyMap<string, readonly ParticleDrawRange[]> {
		if (this.#routingRevision !== routingRevision) {
			this.#routingRevision = routingRevision;
			this.#domainRanges.clear();
		}
		for (const ranges of this.#domainRanges.values()) ranges.length = 0;
		this.#rangesUsed = 0;

		for (const source of sources) {
			const domainId = resolveDomain(source.renderOwner);
			if (domainId === null) continue;
			let ranges = this.#domainRanges.get(domainId);
			if (!ranges) {
				ranges = [];
				this.#domainRanges.set(domainId, ranges);
			}
			const range = (this.#rangePool[this.#rangesUsed] ??= {
				baseSlot: 0,
				count: 0,
				hwGfxObjId: source.hwGfxObjId,
				motionType: 0,
				origin: source.origin,
			});
			this.#rangesUsed += 1;
			range.baseSlot = source.baseSlot;
			range.count = source.count;
			range.hwGfxObjId = source.hwGfxObjId;
			range.motionType = source.motionType;
			range.origin = source.origin;
			ranges.push(range);
		}

		return this.#domainRanges;
	}

	/**
	 * Concatenate the ranges of several render nodes sharing one executor contribution.
	 *
	 * The result is consumed immediately by the draw callback and remains valid only until the next
	 * call, matching the frame-local ranges it references.
	 */
	mergeContribution(
		rangeGroups: readonly (readonly ParticleDrawRange[])[],
	): readonly ParticleDrawRange[] {
		if (rangeGroups.length === 1) return rangeGroups[0] ?? [];
		this.#mergedOutput.length = 0;
		for (const group of rangeGroups) {
			for (const range of group) this.#mergedOutput.push(range);
		}
		return this.#mergedOutput;
	}
}
