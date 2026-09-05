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
	/** Record-local or one live emitter frame, preserved through domain routing. */
	readonly frame: ParticleSourceRange["frame"];
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
	/** Revision owning the domain-keyed scratch, or null before the first route. */
	#routingRevision: number | string | null = null;

	/** Release all frame references and revision-owned scratch on particle residency teardown. */
	clear(): void {
		this.#domainRanges.clear();
		this.#rangePool.length = 0;
		this.#rangesUsed = 0;
		this.#routingRevision = null;
	}

	/** Expire a camera's routes while preserving capacity and releasing borrowed emitter frames. */
	reset(): void {
		for (const ranges of this.#domainRanges.values()) ranges.length = 0;
		for (let index = 0; index < this.#rangesUsed; index += 1) {
			this.#rangePool[index].frame = RELEASED_PARTICLE_FRAME;
		}
		this.#rangesUsed = 0;
	}

	/** Assign every source once, omitting owners unavailable to this view's render graph. */
	route(
		routingRevision: number | string,
		sources: readonly ParticleSourceRange[],
		resolveDomain: (owner: ParticleRenderOwner) => string | null,
	): ReadonlyMap<string, readonly ParticleDrawRange[]> {
		this.reset();
		if (this.#routingRevision !== routingRevision) {
			this.#routingRevision = routingRevision;
			this.#domainRanges.clear();
		}

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
				frame: source.frame,
			});
			this.#rangesUsed += 1;
			range.baseSlot = source.baseSlot;
			range.count = source.count;
			range.hwGfxObjId = source.hwGfxObjId;
			range.motionType = source.motionType;
			range.frame = source.frame;
			ranges.push(range);
		}

		return this.#domainRanges;
	}
}

/** Retired pooled ranges cannot keep an unloaded emitter's transform alive. */
const RELEASED_PARTICLE_FRAME = { kind: "record" } as const;
