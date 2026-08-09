import { createLandblockOffset, getLandblockCoordinates } from "../landblocks";
import {
	PORTAL_QUERY_EPSILON,
	signedPlaneDistance,
} from "../scene/planar-aperture";
import type {
	PortalCrossingId,
	ScenePortalCrossingInput,
	SceneScope,
	SceneTopologyScope,
	SceneTopologyView,
} from "../scene";
import { sameScope, scopeKey } from "../scene/scope";
import {
	cameraNearClipPrimitiveCount,
	createEmptyCameraNearClipDiagnostics,
	prepareCameraNearClipAperture,
	preparedApertureIntersectsCameraNearClipVolume,
	type CameraNearClipDiagnostics,
	type CameraNearClipVolume,
	type CameraNearClipPrimitiveKind,
	type PreparedCameraNearClipAperture,
} from "./portal-near-plane";
import {
	createFullPortalViewWindow,
	createEmptyPortalWindowProjectionDiagnostics,
	portalViewWindowNdcArea,
	portalViewWindowBounds,
	portalWindowProjectionPrimitiveCount,
	preparePortalApertureProjectionInput,
	PortalWindowProjector,
	type PortalAperturePreparationTrace,
	type PortalViewWindow,
	type PortalWindowProjectionDiagnostics,
	type PortalWindowPrimitiveKind,
	type PreparedPortalApertureProjectionInput,
	type PreparedPortalProjection,
	validatePreparedPortalProjection,
} from "./portal-view-window";

/** Frame-local identity for one exact crossing path; never a reusable content identity. */
export type PortalPathViewId = `portal-path-view:${string}`;

/** Reusable preparation owner shared by every appearance of the same physical content. */
export type PortalContentDomainId = `portal-content-domain:${string}`;

/** Explicit whole-frontier limits checked before a plan becomes executable. */
interface PortalPathViewBudget {
	/** Maximum summed pair/fragment/vertex primitives consumed by ownership coloring. */
	readonly maximumConflictPrimitiveCount: number;
	/** Maximum simultaneous conflict colors, including the root color. */
	readonly maximumOwnershipLabelCount: number;
	/** Deepest admitted crossing ancestry; the root is depth zero. */
	readonly maximumPathDepth: number;
	/** Maximum cumulative path views through a complete frontier. */
	readonly maximumPathViewCount: number;
	/** Maximum summed continuous-projection primitives consumed while discovering frontiers. */
	readonly maximumProjectionPrimitiveCount: number;
}

/** Drawing-buffer policy for rejecting negligible non-straddling portal footprints. */
interface PortalPathViewFootprintPolicy {
	/** Physical drawing-buffer height in pixels. */
	readonly drawingBufferHeight: number;
	/** Physical drawing-buffer width in pixels. */
	readonly drawingBufferWidth: number;
	/** Strict lower projected pixel-area bound; zero disables this quality cutoff. */
	readonly minimumPixelArea: number;
}

/** Camera and capacity facts consumed by the browser-free production-shaped planner. */
export interface PortalPathViewPlanInput extends PreparedPortalProjection {
	/** Atomic whole-frontier capacity policy. */
	readonly budget: PortalPathViewBudget;
	/** Exact finite near-clip pyramid in the same anchor-relative frame as the projection. */
	readonly nearClipVolume: CameraNearClipVolume;
	/** Projected portal quality cutoff. */
	readonly portalFootprint: PortalPathViewFootprintPolicy;
	/** Authoritative camera scope at the start of traversal. */
	readonly rootScope: SceneScope;
}

/** One exact path appearance, separated from its reusable content preparation owner. */
export interface PortalPathView {
	/** Conservative NDC bounds computed once for coloring and later scissor selection. */
	readonly bounds: ReturnType<typeof portalViewWindowBounds>;
	/** Canonical directed crossing ancestry from the root. */
	readonly crossingIds: readonly PortalCrossingId[];
	/** Reusable physical content owner for this appearance. */
	readonly domainId: PortalContentDomainId;
	/** Crossing depth; root is zero. */
	readonly pathDepth: number;
	/** Stable frame-local path identity. */
	readonly id: PortalPathViewId;
	/** Directed crossing that produced this appearance, or null for the root. */
	readonly incomingCrossingId: PortalCrossingId | null;
	/** Ownership label selected once by canonical conflict coloring. */
	readonly ownershipLabel: number;
	/** Parent path appearance, or null for the root. */
	readonly parentViewId: PortalPathViewId | null;
	/** Whether this topology step creates a new opaque ownership region and mask submission. */
	readonly requiresOwnershipTransition: boolean;
	/** Exact authored visibility scope reached by this path. */
	readonly scope: SceneScope;
	/** Exact continuous parent-constrained NDC coverage. */
	readonly window: PortalViewWindow;
}

/** Capacity evidence that deliberately stops before enumerating rejected descendants. */
type PortalPathViewTruncation = {
	/** Configured capacity that was exceeded. */
	readonly budget: number;
	/** First crossing depth withheld in its entirety. */
	readonly firstOmittedPathDepth: number;
	/** Capacity dimension that stopped discovery. */
	readonly kind:
		| "maximum-conflict-primitive-count"
		| "maximum-ownership-label-count"
		| "maximum-path-depth"
		| "maximum-path-view-count"
		| "maximum-projection-primitive-count";
	/** Sufficient proved lower bound; never an exact rejected total requirement. */
	readonly observedMinimum: number;
};

/** Unweighted deterministic planner work and peak-live cardinalities. */
interface PortalPathViewTrace {
	/** Unique anchor-relative aperture vertices transformed before near-clip classification. */
	readonly anchorApertureVertexTransformCount: number;
	/** Crossings whose visibility was actually evaluated. */
	readonly attemptedCrossingCount: number;
	/** NDC fragment pairs checked while coloring ownership conflicts. */
	readonly conflictFragmentPairCount: number;
	/** View pairs rejected by their precomputed NDC bounds before polygon work. */
	readonly conflictBoundsRejectedPairCount: number;
	/** Earlier/current view pairs considered by canonical coloring. */
	readonly conflictPairCount: number;
	/** Polygon edge-versus-vertex tests used by exact convex overlap rejection. */
	readonly conflictVertexEdgeTestCount: number;
	/** Sum of pair, fragment-pair, and vertex-edge coloring operations. */
	readonly conflictPrimitiveCount: number;
	/** Candidate path-view records constructed, including a later discarded frontier. */
	readonly constructedPathViewCount: number;
	/** Ancestry elements copied into newly admitted immutable path records. */
	readonly pathAncestryElementCopyCount: number;
	/** Directed-crossing identities compared while enforcing non-repeating paths. */
	readonly pathIdentityTestCount: number;
	/** Maximum candidate frontier records retained simultaneously. */
	readonly peakCandidateFrontierCount: number;
	/** Maximum completed path-view records retained simultaneously. */
	readonly peakRetainedPathViewCount: number;
	/** Checked validation, clipping, and allocation work used by near-clip classification. */
	readonly nearClip: CameraNearClipDiagnostics;
	/** Existing continuous-window counters consumed without wall-clock weighting. */
	readonly projection: PortalWindowProjectionDiagnostics;
	/** Sum of the named projection counters charged by the first-cut checked budget. */
	readonly projectionPrimitiveCount: number;
	/** Canonical outgoing entries visited after immediate-return suppression. */
	readonly topologyWorkItemCount: number;
	/** Topology-revision aperture preparation, reported separately from camera planning. */
	readonly topologyPreparation: PortalPathViewTopologyPreparationTrace;
}

/** Retained immutable aperture work amortized across every camera on one topology revision. */
interface PortalPathViewTopologyPreparationTrace extends PortalAperturePreparationTrace {
	readonly apertureCount: number;
	/** Comparisons performed while canonically ordering outgoing crossings. */
	readonly canonicalOutgoingComparisonCount: number;
	/** Authored directed crossings indexed from the topology revision. */
	readonly crossingCount: number;
	/** Scalar values compared when one aperture id arrives through multiple objects. */
	readonly duplicateApertureScalarComparisonCount: number;
	/** Authored scopes indexed from the topology revision. */
	readonly scopeCount: number;
}

/** Completed immutable planner facts; drawing policy is fully resolved before GPU work. */
export interface PortalPathViewPlan {
	/** Reusable content owners reached by the retained path views. */
	readonly contentDomainIds: readonly PortalContentDomainId[];
	/** Outdoor domain eligible for one cached opaque preparation, or null when reuse cannot win. */
	readonly exteriorCacheDomainId: PortalContentDomainId | null;
	/** Ownership colors consumed by the retained executable prefix. */
	readonly ownershipLabelCount: number;
	/** Retained path appearances in canonical breadth-first order. */
	readonly views: readonly PortalPathView[];
	/** Deterministic unweighted construction trace. */
	readonly trace: PortalPathViewTrace;
	/** First omitted frontier, or null when discovery completed naturally. */
	readonly truncation: PortalPathViewTruncation | null;
	/** Topology revision from which every retained fact was derived. */
	readonly topologyRevision: number;
}

interface IndexedDomain {
	readonly id: PortalContentDomainId;
	readonly kind: "indoor-visibility-island" | "outdoor";
}

interface IndexedTopology {
	readonly apertureById: ReadonlyMap<string, IndexedAperture>;
	readonly canonicalOutgoingByScopeKey: ReadonlyMap<
		string,
		readonly ScenePortalCrossingInput[]
	>;
	readonly domainByScopeKey: ReadonlyMap<string, IndexedDomain>;
	readonly scopeByKey: ReadonlyMap<string, SceneTopologyScope>;
	readonly topology: SceneTopologyView;
	readonly topologyPreparation: PortalPathViewTopologyPreparationTrace;
}

interface PendingPathView {
	readonly bounds: ReturnType<typeof portalViewWindowBounds>;
	readonly crossingIds: readonly PortalCrossingId[];
	readonly domainId: PortalContentDomainId;
	readonly id: PortalPathViewId;
	readonly incomingCrossing: ScenePortalCrossingInput | null;
	readonly ownershipLabel: number | null;
	readonly parentViewId: PortalPathViewId | null;
	readonly pathDepth: number;
	readonly requiresOwnershipTransition: boolean;
	readonly scope: SceneScope;
	readonly window: PortalViewWindow;
}

interface MutableTrace {
	anchorApertureVertexTransformCount: number;
	attemptedCrossingCount: number;
	conflictBoundsRejectedPairCount: number;
	conflictFragmentPairCount: number;
	conflictPairCount: number;
	conflictVertexEdgeTestCount: number;
	conflictPrimitiveCount: number;
	constructedPathViewCount: number;
	pathAncestryElementCopyCount: number;
	pathIdentityTestCount: number;
	peakCandidateFrontierCount: number;
	peakRetainedPathViewCount: number;
	nearClip: CameraNearClipDiagnostics;
	projection: PortalWindowProjectionDiagnostics;
	projectionPrimitiveCount: number;
	topologyWorkItemCount: number;
	readonly topologyPreparation: PortalPathViewTopologyPreparationTrace;
}

/** Retains topology-stable canonical facts and streams complete camera-dependent frontiers. */
export class PortalPathViewPlanner {
	#index: IndexedTopology | null = null;

	plan(
		topology: SceneTopologyView,
		input: PortalPathViewPlanInput,
	): PortalPathViewPlan {
		validateInput(input);
		if (
			this.#index?.topology !== topology ||
			this.#index.topology.revision !== topology.revision
		) {
			this.#index = indexTopology(topology);
		}
		return new PlanningContext(this.#index, input).plan();
	}
}

class PlanningContext {
	readonly #anchorApertureById = new Map<
		string,
		PreparedCameraNearClipAperture
	>();
	readonly #index: IndexedTopology;
	readonly #input: PortalPathViewPlanInput;
	readonly #pixelsPerNdcArea: number;
	readonly #projector: PortalWindowProjector;
	readonly #trace: MutableTrace;

	constructor(index: IndexedTopology, input: PortalPathViewPlanInput) {
		this.#index = index;
		this.#input = input;
		this.#pixelsPerNdcArea =
			(input.portalFootprint.drawingBufferWidth *
				input.portalFootprint.drawingBufferHeight) /
			4;
		this.#trace = createTrace(index.topologyPreparation);
		this.#projector = new PortalWindowProjector(input, {
			consume: (kind, count) =>
				this.#consumeWindowProjectionPrimitives(kind, count),
		});
	}

	plan(): PortalPathViewPlan {
		const rootWindow = createFullPortalViewWindow();
		const root: PendingPathView = {
			bounds: portalViewWindowBounds(rootWindow),
			crossingIds: Object.freeze([]),
			domainId: this.#requireDomain(this.#input.rootScope).id,
			id: pathViewId([]),
			incomingCrossing: null,
			ownershipLabel: 0,
			parentViewId: null,
			pathDepth: 0,
			requiresOwnershipTransition: false,
			scope: this.#input.rootScope,
			window: rootWindow,
		};
		const retained: PendingPathView[] = [root];
		let frontier: readonly PendingPathView[] = [root];
		let truncation: PortalPathViewTruncation | null = null;
		this.#trace.constructedPathViewCount = 1;
		this.#trace.peakRetainedPathViewCount = 1;

		for (let pathDepth = 1; frontier.length > 0; pathDepth += 1) {
			if (pathDepth > this.#input.budget.maximumPathDepth) {
				truncation = cutoff(
					"maximum-path-depth",
					pathDepth,
					this.#input.budget.maximumPathDepth,
					pathDepth,
				);
				break;
			}
			const candidate: PendingPathView[] = [];
			let exceeded: PortalPathViewTruncation | null = null;
			for (const parent of frontier) {
				for (const crossing of this.#outgoing(parent)) {
					this.#trace.topologyWorkItemCount += 1;
					if (isImmediateReturn(parent.incomingCrossing, crossing)) continue;
					// A camera ray intersects one planar directed aperture at one depth. Repeating that
					// crossing cannot satisfy the model's strictly increasing entry-depth invariant.
					if (this.#pathRepeatsCrossing(parent, crossing.id)) continue;
					this.#trace.attemptedCrossingCount += 1;
					let child: PendingPathView | null;
					try {
						child = this.#projectChild(parent, crossing);
					} catch (cause) {
						if (!(cause instanceof ProjectionBudgetExceeded)) throw cause;
						exceeded = cutoff(
							"maximum-projection-primitive-count",
							pathDepth,
							this.#input.budget.maximumProjectionPrimitiveCount,
							cause.observedMinimum,
						);
						break;
					}
					if (!child) continue;
					candidate.push(child);
					this.#trace.constructedPathViewCount += 1;
					this.#trace.peakCandidateFrontierCount = Math.max(
						this.#trace.peakCandidateFrontierCount,
						candidate.length,
					);
					const observedViewCount = retained.length + candidate.length;
					if (observedViewCount > this.#input.budget.maximumPathViewCount) {
						exceeded = cutoff(
							"maximum-path-view-count",
							pathDepth,
							this.#input.budget.maximumPathViewCount,
							observedViewCount,
						);
						break;
					}
				}
				if (exceeded) break;
			}
			if (exceeded) {
				truncation = exceeded;
				break;
			}
			if (candidate.length === 0) break;
			const colored = this.#colorFrontier(retained, candidate, pathDepth);
			if (colored.truncation) {
				truncation = colored.truncation;
				break;
			}
			frontier = colored.frontier;
			retained.push(...frontier);
			this.#trace.peakRetainedPathViewCount = retained.length;
		}

		const views = retained.map(materializeView);
		const contentDomainIds = [
			...new Set(views.map(({ domainId }) => domainId)),
		].sort();
		const outdoor = "portal-content-domain:outdoor" as PortalContentDomainId;
		const exteriorAppearanceCount = views.filter(
			({ domainId }) => domainId === outdoor,
		).length;
		return Object.freeze({
			contentDomainIds: Object.freeze(contentDomainIds),
			exteriorCacheDomainId: exteriorAppearanceCount > 1 ? outdoor : null,
			ownershipLabelCount:
				Math.max(...views.map(({ ownershipLabel }) => ownershipLabel)) + 1,
			topologyRevision: this.#index.topology.revision,
			trace: finishTrace(this.#trace),
			truncation,
			views: Object.freeze(views),
		});
	}

	#outgoing(view: PendingPathView): readonly ScenePortalCrossingInput[] {
		return (
			this.#index.canonicalOutgoingByScopeKey.get(scopeKey(view.scope)) ?? []
		);
	}

	#projectChild(
		parent: PendingPathView,
		crossing: ScenePortalCrossingInput,
	): PendingPathView | null {
		if (!sameScope(crossing.source, parent.scope)) {
			throw new Error(
				`Portal topology returned ${crossing.id} from the wrong source scope.`,
			);
		}
		this.#requireDomain(crossing.target);
		const visibilityAperture = this.#requireAperture(
			crossing.visibilityAperture.id,
		);
		const anchorAperture = this.#anchorAperture(visibilityAperture);
		const straddlesNear = preparedApertureIntersectsCameraNearClipVolume(
			this.#input.nearClipVolume,
			anchorAperture,
			{
				consume: (kind, count) => this.#consumeNearClipPrimitives(kind, count),
			},
		);
		if (!straddlesNear && !this.#facesCamera(crossing)) return null;
		const result = straddlesNear
			? this.#projector.clipThroughNearClipAperture(
					parent.window,
					visibilityAperture,
				)
			: this.#projector.clipThroughAperture(parent.window, visibilityAperture);
		addProjectionOutcomes(this.#trace.projection, result.diagnostics);
		if (result.kind === "empty") return null;
		if (
			!straddlesNear &&
			portalViewWindowNdcArea(result.window) * this.#pixelsPerNdcArea <
				this.#input.portalFootprint.minimumPixelArea
		) {
			return null;
		}
		const crossingIds = Object.freeze([...parent.crossingIds, crossing.id]);
		this.#trace.pathAncestryElementCopyCount += crossingIds.length;
		const targetDomain = this.#requireDomain(crossing.target);
		if (
			crossing.spatialRelationship.kind === "indoor-depth-continuous" &&
			targetDomain.id !== parent.domainId
		) {
			throw new Error(
				`Depth-continuous crossing ${crossing.id} spans content domains.`,
			);
		}
		return {
			bounds: portalViewWindowBounds(result.window),
			crossingIds,
			domainId: targetDomain.id,
			id: pathViewId(crossingIds),
			incomingCrossing: crossing,
			ownershipLabel: null,
			parentViewId: parent.id,
			pathDepth: parent.pathDepth + 1,
			requiresOwnershipTransition: targetDomain.id !== parent.domainId,
			scope: crossing.target,
			window: result.window,
		};
	}

	#pathRepeatsCrossing(
		parent: PendingPathView,
		crossingId: PortalCrossingId,
	): boolean {
		for (const ancestor of parent.crossingIds) {
			this.#trace.pathIdentityTestCount += 1;
			if (ancestor === crossingId) return true;
		}
		return false;
	}

	#colorFrontier(
		retained: readonly PendingPathView[],
		candidate: readonly PendingPathView[],
		pathDepth: number,
	): {
		readonly frontier: readonly PendingPathView[];
		readonly truncation: PortalPathViewTruncation | null;
	} {
		const colored: PendingPathView[] = [];
		const retainedLabelById = new Map(
			retained.map((view) => [view.id, view.ownershipLabel] as const),
		);
		const conflictGroups = [retained, colored] as const;
		for (const view of candidate) {
			if (!view.requiresOwnershipTransition) {
				const parentLabel =
					(view.parentViewId === null
						? null
						: retainedLabelById.get(view.parentViewId)) ?? null;
				if (parentLabel === null) {
					throw new Error(
						`Depth-continuous view ${view.id} has no colored parent.`,
					);
				}
				colored.push({ ...view, ownershipLabel: parentLabel });
				continue;
			}
			const unavailable = new Set<number>();
			try {
				for (const group of conflictGroups) {
					for (const previous of group) {
						this.#consumeConflictPrimitive("conflictPairCount");
						if (
							!viewsOverlap(previous, view, this.#trace, (kind) =>
								this.#consumeConflictPrimitive(kind),
							)
						) {
							continue;
						}
						if (previous.ownershipLabel === null) {
							throw new Error(
								`Portal path view ${previous.id} was not colored canonically.`,
							);
						}
						unavailable.add(previous.ownershipLabel);
					}
				}
			} catch (cause) {
				if (!(cause instanceof ConflictBudgetExceeded)) throw cause;
				return {
					frontier: Object.freeze([]),
					truncation: cutoff(
						"maximum-conflict-primitive-count",
						pathDepth,
						this.#input.budget.maximumConflictPrimitiveCount,
						cause.observedMinimum,
					),
				};
			}
			let label = 0;
			while (unavailable.has(label)) label += 1;
			const observedMinimum = label + 1;
			if (observedMinimum > this.#input.budget.maximumOwnershipLabelCount) {
				return {
					frontier: Object.freeze([]),
					truncation: cutoff(
						"maximum-ownership-label-count",
						pathDepth,
						this.#input.budget.maximumOwnershipLabelCount,
						observedMinimum,
					),
				};
			}
			colored.push({ ...view, ownershipLabel: label });
		}
		return { frontier: Object.freeze(colored), truncation: null };
	}

	#anchorAperture(input: IndexedAperture): PreparedCameraNearClipAperture {
		const cached = this.#anchorApertureById.get(input.id);
		if (cached) return cached;
		const offset = createLandblockOffset(
			input.landblockCoordinates,
			this.#input.anchorCoordinates,
		);
		const vertexCount = input.aperture.vertices.length / 3;
		this.#consumeAnchorApertureVertexTransforms(vertexCount);
		const vertices = new Float32Array(input.aperture.vertices.length);
		for (let index = 0; index < input.aperture.vertices.length; index += 3) {
			vertices[index] = input.aperture.vertices[index]! + offset.x;
			vertices[index + 1] = input.aperture.vertices[index + 1]!;
			vertices[index + 2] = input.aperture.vertices[index + 2]! + offset.z;
		}
		const normal = input.aperture.plane.normal;
		const aperture = prepareCameraNearClipAperture(
			{
				indices: input.aperture.indices,
				plane: {
					d: input.aperture.plane.d - normal.x * offset.x - normal.z * offset.z,
					normal,
				},
				vertices,
			},
			{
				consume: (kind, count) => this.#consumeNearClipPrimitives(kind, count),
			},
		);
		this.#anchorApertureById.set(input.id, aperture);
		return aperture;
	}

	#facesCamera(crossing: ScenePortalCrossingInput): boolean {
		const aperture = this.#anchorAperture(
			this.#requireAperture(crossing.sourceAperture.id),
		);
		const distance = signedPlaneDistance(
			aperture.plane,
			this.#input.nearClipVolume.eye,
		);
		return crossing.acceptedSide === "positive"
			? distance > PORTAL_QUERY_EPSILON
			: distance < -PORTAL_QUERY_EPSILON;
	}

	#requireDomain(scope: SceneScope): IndexedDomain {
		const key = scopeKey(scope);
		const topologyScope = this.#index.scopeByKey.get(key);
		const domain = this.#index.domainByScopeKey.get(key);
		if (!topologyScope || !sameScope(topologyScope.scope, scope) || !domain) {
			throw new Error(`Portal path-view scope ${key} is unavailable.`);
		}
		return domain;
	}

	#requireAperture(id: string): IndexedAperture {
		const aperture = this.#index.apertureById.get(id);
		if (!aperture) {
			throw new Error(`Portal visibility aperture ${id} is unavailable.`);
		}
		return aperture;
	}

	#consumeWindowProjectionPrimitives(
		kind: PortalWindowPrimitiveKind,
		count: number,
	): void {
		this.#consumeProjectionBudget(count);
		const mutable = this.#trace.projection as {
			-readonly [Key in keyof PortalWindowProjectionDiagnostics]: number;
		};
		mutable[kind] += count;
	}

	#consumeNearClipPrimitives(
		kind: CameraNearClipPrimitiveKind,
		count: number,
	): void {
		this.#consumeProjectionBudget(count);
		const mutable = this.#trace.nearClip as Record<
			CameraNearClipPrimitiveKind,
			number
		>;
		mutable[kind] += count;
	}

	#consumeAnchorApertureVertexTransforms(count: number): void {
		this.#consumeProjectionBudget(count);
		this.#trace.anchorApertureVertexTransformCount += count;
	}

	#consumeProjectionBudget(count: number): void {
		const observedMinimum = this.#trace.projectionPrimitiveCount + count;
		if (observedMinimum > this.#input.budget.maximumProjectionPrimitiveCount) {
			throw new ProjectionBudgetExceeded(observedMinimum);
		}
		this.#trace.projectionPrimitiveCount = observedMinimum;
	}

	#consumeConflictPrimitive(
		kind:
			| "conflictFragmentPairCount"
			| "conflictPairCount"
			| "conflictVertexEdgeTestCount",
	): void {
		const observedMinimum = this.#trace.conflictPrimitiveCount + 1;
		if (observedMinimum > this.#input.budget.maximumConflictPrimitiveCount) {
			throw new ConflictBudgetExceeded(observedMinimum);
		}
		this.#trace.conflictPrimitiveCount = observedMinimum;
		this.#trace[kind] += 1;
	}
}

class ProjectionBudgetExceeded extends Error {
	constructor(readonly observedMinimum: number) {
		super("Portal projection primitive budget exceeded.");
	}
}

class ConflictBudgetExceeded extends Error {
	constructor(readonly observedMinimum: number) {
		super("Portal conflict primitive budget exceeded.");
	}
}

interface IndexedAperture extends PreparedPortalApertureProjectionInput {
	readonly id: ScenePortalCrossingInput["visibilityAperture"]["id"];
	/** Full authored scene facts retained for exact duplicate-id validation. */
	readonly source: ScenePortalCrossingInput["visibilityAperture"];
}

function indexTopology(topology: SceneTopologyView): IndexedTopology {
	const apertureById = new Map<string, IndexedAperture>();
	const topologyPreparation = {
		apertureCount: 0,
		canonicalOutgoingComparisonCount: 0,
		convexityVertexTestCount: 0,
		crossingCount: topology.crossings.length,
		duplicateApertureScalarComparisonCount: 0,
		mergeEdgePairTestCount: 0,
		scopeCount: topology.scopes.length,
		triangleCount: 0,
	};
	const scopeByKey = new Map<string, SceneTopologyScope>();
	const domainByScopeKey = new Map<string, IndexedDomain>();
	for (const topologyScope of topology.scopes) {
		const key = scopeKey(topologyScope.scope);
		if (scopeByKey.has(key))
			throw new Error(`Portal topology repeats scope ${key}.`);
		scopeByKey.set(key, topologyScope);
		if (topologyScope.scope.kind === "outdoor") {
			if (topologyScope.visibilityIslandId !== null) {
				throw new Error(
					"Outdoor scope cannot belong to an indoor visibility island.",
				);
			}
			domainByScopeKey.set(key, {
				id: "portal-content-domain:outdoor",
				kind: "outdoor",
			});
		} else {
			if (topologyScope.visibilityIslandId === null) {
				throw new Error(`EnvCell scope ${key} has no visibility island.`);
			}
			domainByScopeKey.set(key, {
				id: `portal-content-domain:${topologyScope.visibilityIslandId}`,
				kind: "indoor-visibility-island",
			});
		}
	}
	const crossingIds = new Set<PortalCrossingId>();
	const mutableOutgoing = new Map<string, ScenePortalCrossingInput[]>();
	for (const crossing of topology.crossings) {
		if (crossingIds.has(crossing.id))
			throw new Error(`Portal topology repeats crossing ${crossing.id}.`);
		crossingIds.add(crossing.id);
		for (const source of [
			crossing.sourceAperture,
			crossing.visibilityAperture,
		]) {
			const apertureId = source.id;
			const existingAperture = apertureById.get(apertureId);
			if (existingAperture) {
				if (
					!sameAuthoredAperture(
						existingAperture.source,
						source,
						topologyPreparation,
					)
				) {
					throw new Error(
						`Portal aperture ${apertureId} repeats with different geometry.`,
					);
				}
				continue;
			}
			const prepared = preparePortalApertureProjectionInput({
				aperture: source,
				landblockCoordinates: getLandblockCoordinates(source.landblockId),
			});
			apertureById.set(apertureId, {
				...prepared,
				id: apertureId,
				source,
			});
			topologyPreparation.apertureCount += 1;
			topologyPreparation.convexityVertexTestCount +=
				prepared.preparationTrace.convexityVertexTestCount;
			topologyPreparation.mergeEdgePairTestCount +=
				prepared.preparationTrace.mergeEdgePairTestCount;
			topologyPreparation.triangleCount +=
				prepared.preparationTrace.triangleCount;
		}
		const source = scopeKey(crossing.source);
		if (!scopeByKey.has(source) || !scopeByKey.has(scopeKey(crossing.target))) {
			throw new Error(
				`Portal crossing ${crossing.id} references an unavailable scope.`,
			);
		}
		const outgoing = mutableOutgoing.get(source) ?? [];
		outgoing.push(crossing);
		mutableOutgoing.set(source, outgoing);
	}
	const canonicalOutgoingByScopeKey = new Map<
		string,
		readonly ScenePortalCrossingInput[]
	>();
	for (const [key, outgoing] of mutableOutgoing) {
		canonicalOutgoingByScopeKey.set(
			key,
			Object.freeze(
				outgoing.sort((left, right) => {
					topologyPreparation.canonicalOutgoingComparisonCount += 1;
					return left.id.localeCompare(right.id);
				}),
			),
		);
	}
	return {
		apertureById,
		canonicalOutgoingByScopeKey,
		domainByScopeKey,
		scopeByKey,
		topology,
		topologyPreparation: Object.freeze(topologyPreparation),
	};
}

function sameAuthoredAperture(
	left: ScenePortalCrossingInput["sourceAperture"],
	right: ScenePortalCrossingInput["sourceAperture"],
	trace: { duplicateApertureScalarComparisonCount: number },
): boolean {
	const sameScalar = (leftValue: unknown, rightValue: unknown): boolean => {
		trace.duplicateApertureScalarComparisonCount += 1;
		return leftValue === rightValue;
	};
	return (
		sameScalar(left.id, right.id) &&
		sameScalar(left.landblockId, right.landblockId) &&
		sameScalar(left.plane.d, right.plane.d) &&
		sameScalar(left.plane.normal.x, right.plane.normal.x) &&
		sameScalar(left.plane.normal.y, right.plane.normal.y) &&
		sameScalar(left.plane.normal.z, right.plane.normal.z) &&
		sameScalar(left.landblockBounds.min.x, right.landblockBounds.min.x) &&
		sameScalar(left.landblockBounds.min.y, right.landblockBounds.min.y) &&
		sameScalar(left.landblockBounds.min.z, right.landblockBounds.min.z) &&
		sameScalar(left.landblockBounds.max.x, right.landblockBounds.max.x) &&
		sameScalar(left.landblockBounds.max.y, right.landblockBounds.max.y) &&
		sameScalar(left.landblockBounds.max.z, right.landblockBounds.max.z) &&
		typedArraysEqual(left.indices, right.indices, sameScalar) &&
		typedArraysEqual(left.vertices, right.vertices, sameScalar)
	);
}

function typedArraysEqual(
	left: ArrayLike<number>,
	right: ArrayLike<number>,
	sameScalar: (left: unknown, right: unknown) => boolean,
): boolean {
	if (!sameScalar(left.length, right.length)) return false;
	for (let index = 0; index < left.length; index += 1) {
		if (!sameScalar(left[index], right[index])) return false;
	}
	return true;
}

function isImmediateReturn(
	incoming: ScenePortalCrossingInput | null,
	candidate: ScenePortalCrossingInput,
): boolean {
	return (
		incoming !== null &&
		(candidate.id === incoming.reciprocalCrossingId ||
			candidate.sourceAperture.id === incoming.sourceAperture.id)
	);
}

function pathViewId(
	crossingIds: readonly PortalCrossingId[],
): PortalPathViewId {
	return `portal-path-view:${crossingIds.length === 0 ? "root" : crossingIds.join(">")}`;
}

function materializeView(view: PendingPathView): PortalPathView {
	if (view.ownershipLabel === null)
		throw new Error(`Portal path view ${view.id} has no ownership label.`);
	return Object.freeze({
		bounds: view.bounds,
		crossingIds: view.crossingIds,
		domainId: view.domainId,
		id: view.id,
		incomingCrossingId: view.incomingCrossing?.id ?? null,
		ownershipLabel: view.ownershipLabel,
		parentViewId: view.parentViewId,
		pathDepth: view.pathDepth,
		requiresOwnershipTransition: view.requiresOwnershipTransition,
		scope: view.scope,
		window: view.window,
	});
}

function viewsOverlap(
	left: PendingPathView,
	right: PendingPathView,
	trace: MutableTrace,
	consume: (
		kind: "conflictFragmentPairCount" | "conflictVertexEdgeTestCount",
	) => void,
): boolean {
	if (
		left.bounds.max.x < right.bounds.min.x ||
		right.bounds.max.x < left.bounds.min.x ||
		left.bounds.max.y < right.bounds.min.y ||
		right.bounds.max.y < left.bounds.min.y
	) {
		trace.conflictBoundsRejectedPairCount += 1;
		return false;
	}
	for (const leftFragment of left.window.fragments) {
		for (const rightFragment of right.window.fragments) {
			consume("conflictFragmentPairCount");
			if (
				!hasSeparatingEdge(
					leftFragment.vertices,
					rightFragment.vertices,
					consume,
				) &&
				!hasSeparatingEdge(
					rightFragment.vertices,
					leftFragment.vertices,
					consume,
				)
			) {
				return true;
			}
		}
	}
	return false;
}

function hasSeparatingEdge(
	edges: PortalViewWindow["fragments"][number]["vertices"],
	vertices: PortalViewWindow["fragments"][number]["vertices"],
	consume: (kind: "conflictVertexEdgeTestCount") => void,
): boolean {
	for (let edgeIndex = 0; edgeIndex < edges.length; edgeIndex += 1) {
		const start = edges[edgeIndex]!;
		const end = edges[(edgeIndex + 1) % edges.length]!;
		let separated = true;
		for (const vertex of vertices) {
			consume("conflictVertexEdgeTestCount");
			const distance =
				(end.x - start.x) * (vertex.y - start.y) -
				(end.y - start.y) * (vertex.x - start.x);
			if (distance >= -0.000_001) {
				separated = false;
				break;
			}
		}
		if (separated) return true;
	}
	return false;
}

function cutoff(
	kind: PortalPathViewTruncation["kind"],
	firstOmittedPathDepth: number,
	budget: number,
	observedMinimum: number,
): PortalPathViewTruncation {
	return Object.freeze({
		budget,
		firstOmittedPathDepth,
		kind,
		observedMinimum,
	});
}

function createTrace(
	topologyPreparation: PortalPathViewTopologyPreparationTrace,
): MutableTrace {
	return {
		anchorApertureVertexTransformCount: 0,
		attemptedCrossingCount: 0,
		conflictBoundsRejectedPairCount: 0,
		conflictFragmentPairCount: 0,
		conflictPairCount: 0,
		conflictVertexEdgeTestCount: 0,
		conflictPrimitiveCount: 0,
		constructedPathViewCount: 0,
		nearClip: { ...createEmptyCameraNearClipDiagnostics() },
		pathAncestryElementCopyCount: 0,
		pathIdentityTestCount: 0,
		peakCandidateFrontierCount: 0,
		peakRetainedPathViewCount: 0,
		projection: createProjectionDiagnostics(),
		projectionPrimitiveCount: 0,
		topologyWorkItemCount: 0,
		topologyPreparation,
	};
}

function finishTrace(trace: MutableTrace): PortalPathViewTrace {
	const derivedConflictPrimitiveCount =
		trace.conflictPairCount +
		trace.conflictFragmentPairCount +
		trace.conflictVertexEdgeTestCount;
	if (derivedConflictPrimitiveCount !== trace.conflictPrimitiveCount) {
		throw new Error(
			`Portal conflict trace sums to ${derivedConflictPrimitiveCount}, expected ${trace.conflictPrimitiveCount}.`,
		);
	}
	const derivedProjectionPrimitiveCount =
		trace.anchorApertureVertexTransformCount +
		cameraNearClipPrimitiveCount(trace.nearClip) +
		portalWindowProjectionPrimitiveCount(trace.projection);
	if (derivedProjectionPrimitiveCount !== trace.projectionPrimitiveCount) {
		throw new Error(
			`Portal projection trace sums to ${derivedProjectionPrimitiveCount}, expected ${trace.projectionPrimitiveCount}.`,
		);
	}
	return Object.freeze({
		...trace,
		nearClip: Object.freeze({ ...trace.nearClip }),
		projection: Object.freeze({ ...trace.projection }),
	});
}

function createProjectionDiagnostics(): PortalWindowProjectionDiagnostics {
	return createEmptyPortalWindowProjectionDiagnostics();
}

function addProjectionOutcomes(
	target: PortalWindowProjectionDiagnostics,
	source: PortalWindowProjectionDiagnostics,
): void {
	const mutable = target as {
		-readonly [Key in keyof PortalWindowProjectionDiagnostics]: number;
	};
	for (const key of [
		"broadPhaseRejectedPairCount",
		"emptyExactIntersectionCount",
		"homogeneousClippedPolygonCount",
		"homogeneousRejectedTriangleCount",
		"inputTriangleCount",
		"outputFragmentCount",
		"outputVertexCount",
	] as const) {
		mutable[key] += source[key];
	}
}

function validateInput(input: PortalPathViewPlanInput): void {
	validatePreparedPortalProjection(input);
	const budget = input.budget;
	for (const [name, value, minimum, maximum] of [
		[
			"conflict-primitive",
			budget.maximumConflictPrimitiveCount,
			1,
			Number.MAX_SAFE_INTEGER,
		],
		["ownership-label", budget.maximumOwnershipLabelCount, 1, 0x100],
		["path-depth", budget.maximumPathDepth, 0, Number.MAX_SAFE_INTEGER],
		["path-view", budget.maximumPathViewCount, 1, Number.MAX_SAFE_INTEGER],
		[
			"projection-primitive",
			budget.maximumProjectionPrimitiveCount,
			1,
			Number.MAX_SAFE_INTEGER,
		],
	] as const) {
		if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
			throw new Error(
				`Portal ${name} budget must be an integer from ${minimum} through ${maximum}.`,
			);
		}
	}
	const footprint = input.portalFootprint;
	if (
		!Number.isSafeInteger(footprint.drawingBufferHeight) ||
		footprint.drawingBufferHeight <= 0 ||
		!Number.isSafeInteger(footprint.drawingBufferWidth) ||
		footprint.drawingBufferWidth <= 0 ||
		!Number.isFinite(footprint.minimumPixelArea) ||
		footprint.minimumPixelArea < 0
	) {
		throw new Error("Portal path-view footprint policy is invalid.");
	}
}
