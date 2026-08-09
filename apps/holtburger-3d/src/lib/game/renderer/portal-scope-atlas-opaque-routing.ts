/** Narrow scope-to-tile contract consumed by final opaque submission loops. */
export interface PortalScopeAtlasOpaqueTileLookup {
	/** Resolve one existing renderer scope key without constructing a route record. */
	tileOrdinalForRenderScopeKey(renderScopeKey: string): number;
}

interface PortalScopeAtlasOpaqueRoutingTrace {
	/** Already-formed object draws routed independently without regrouping them. */
	readonly objectSubmissionCount: number;
	/** Normal-path portal-owned records created by routing one frame. */
	readonly portalOwnedFrameHeapRecordCreationCount: 0;
	/** Existing terrain draws sharing the single outdoor tile selected for the pass. */
	readonly terrainSubmissionCount: number;
	/** Scope-to-tile resolutions: one terrain pass plus one per final object draw. */
	readonly tileResolutionCount: number;
}

interface MutablePortalScopeAtlasOpaqueRoutingTrace extends PortalScopeAtlasOpaqueRoutingTrace {
	objectSubmissionCount: number;
	portalOwnedFrameHeapRecordCreationCount: 0;
	terrainSubmissionCount: number;
	tileResolutionCount: number;
}

/** Reused diagnostics for synchronous opaque routing; no submission collection is produced. */
export interface PortalScopeAtlasOpaqueRoutingFrameView {
	readonly trace: PortalScopeAtlasOpaqueRoutingTrace;
}

class MutablePortalScopeAtlasOpaqueRoutingFrameView implements PortalScopeAtlasOpaqueRoutingFrameView {
	readonly trace: MutablePortalScopeAtlasOpaqueRoutingTrace = {
		objectSubmissionCount: 0,
		portalOwnedFrameHeapRecordCreationCount: 0,
		terrainSubmissionCount: 0,
		tileResolutionCount: 0,
	};
}

/**
 * Resolve final scope-homogeneous draws directly to atlas tiles without creating another schedule.
 *
 * Terrain resolves the outdoor tile once for its whole pass. Object routing performs exactly one
 * lookup for each already-formed opaque or alpha-test draw and returns a scalar tile ordinal for
 * immediate uniform application. The API cannot split, reorder, retain, or duplicate a draw.
 */
export class PortalScopeAtlasOpaqueRouter {
	readonly #frame = new MutablePortalScopeAtlasOpaqueRoutingFrameView();
	#lookup: PortalScopeAtlasOpaqueTileLookup | null = null;
	#terrainPassRouted = false;

	/** Start one synchronous route pass and reset only scalar diagnostics. */
	beginFrame(
		lookup: PortalScopeAtlasOpaqueTileLookup,
	): PortalScopeAtlasOpaqueRoutingFrameView {
		this.#lookup = lookup;
		this.#terrainPassRouted = false;
		this.#frame.trace.objectSubmissionCount = 0;
		this.#frame.trace.terrainSubmissionCount = 0;
		this.#frame.trace.tileResolutionCount = 0;
		return this.#frame;
	}

	/** Resolve one shared outdoor tile for every already-formed terrain draw in this frame. */
	routeTerrainPass(submissionCount: number): number | null {
		if (!Number.isSafeInteger(submissionCount) || submissionCount < 0) {
			throw new Error(
				"Portal scope-atlas terrain submission count must be a non-negative safe integer.",
			);
		}
		if (this.#terrainPassRouted) {
			throw new Error(
				"Portal scope-atlas terrain pass was routed more than once.",
			);
		}
		const lookup = this.#requireLookup();
		this.#terrainPassRouted = true;
		this.#frame.trace.terrainSubmissionCount = submissionCount;
		if (submissionCount === 0) return null;
		this.#frame.trace.tileResolutionCount += 1;
		return lookup.tileOrdinalForRenderScopeKey("outdoor");
	}

	/** Resolve one existing final object draw; the caller retains and submits the original record. */
	routeObjectSubmission(renderScopeKey: string): number {
		const lookup = this.#requireLookup();
		this.#frame.trace.objectSubmissionCount += 1;
		this.#frame.trace.tileResolutionCount += 1;
		return lookup.tileOrdinalForRenderScopeKey(renderScopeKey);
	}

	#requireLookup(): PortalScopeAtlasOpaqueTileLookup {
		if (!this.#lookup) {
			throw new Error("Portal scope-atlas opaque routing has no active frame.");
		}
		return this.#lookup;
	}
}
