import type { LandblockOwnerId } from "../game-types";
import type {
	EntityGroundingSelection,
	OutdoorDirectionalShadowSelection,
} from "./entity-grounding";
import { ParticleRenderBatcher } from "./particle-render-routing";

/** Reusable outputs retained until every pass of one prepared camera has executed. */
export interface ViewSubmissionStorage {
	/** Particle routes must not borrow another camera's mutable range records. */
	readonly particles: ParticleRenderBatcher;
	/** Selected indoor receiver records consumed by object shading. */
	readonly indoorByScopeKey: Map<string, EntityGroundingSelection>;
	/** Selected outdoor receiver records consumed by terrain shading. */
	readonly outdoorByLandblockId: Map<
		LandblockOwnerId,
		OutdoorDirectionalShadowSelection
	>;
	/** High-water indoor record capacity, independent of other prepared cameras. */
	readonly indoorSelections: EntityGroundingSelection[];
	/** High-water outdoor record capacity, independent of other prepared cameras. */
	readonly outdoorSelections: OutdoorDirectionalShadowSelection[];
}

/** Renderer-owned view slots; growing camera count grows CPU outputs, not GPU targets. */
export class ViewSubmissionStoragePool {
	/** Slots are reused by preparation ordinal after an explicit frame boundary. */
	readonly #views: ViewSubmissionStorage[] = [];
	/** Next slot that cannot still belong to a prepared view in this frame. */
	#nextView = 0;

	/** Invalidate old output lookups without discarding their backing record capacity. */
	beginFrame(): void {
		for (const view of this.#views) {
			view.indoorByScopeKey.clear();
			view.outdoorByLandblockId.clear();
			view.particles.reset();
		}
		this.#nextView = 0;
	}

	/** Acquire one independent output owner for all passes of a newly prepared camera. */
	acquire(): ViewSubmissionStorage {
		let view = this.#views[this.#nextView];
		if (view === undefined) {
			view = {
				particles: new ParticleRenderBatcher(),
				indoorByScopeKey: new Map(),
				outdoorByLandblockId: new Map(),
				indoorSelections: [],
				outdoorSelections: [],
			};
			this.#views.push(view);
		}
		this.#nextView += 1;
		return view;
	}

	/** Particle residency teardown releases all retained emitter-frame references and ranges. */
	clearParticles(): void {
		for (const view of this.#views) view.particles.clear();
	}
}
