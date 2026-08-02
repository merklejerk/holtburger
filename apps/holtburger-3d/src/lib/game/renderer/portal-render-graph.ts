import { createLandblockOffset, getLandblockCoordinates } from "../landblocks";
import type {
	PortalCrossingId,
	ScenePortalCrossingInput,
	SceneScope,
	SceneTopologyScope,
	SceneTopologyView,
} from "../scene";
import {
	PORTAL_QUERY_EPSILON,
	signedPlaneDistance,
	type PlanarAperture,
} from "../scene/planar-aperture";
import { sameScope, scopeKey } from "../scene/scope";
import {
	apertureIntersectsCameraNearClipVolume,
	type CameraNearClipVolume,
} from "./portal-near-plane";
import {
	admitPortalViewWindow,
	createFullPortalViewWindow,
	PortalWindowProjector,
	type PortalApertureProjectionInput,
	type PortalViewWindow,
	type PortalWindowProjectionResult,
	type PreparedPortalProjection,
	validatePreparedPortalProjection,
} from "./portal-view-window";

/** Unique executable owner for one outdoor domain or proof-backed indoor visibility island. */
type PortalRenderNodeId = `portal-render-node:${string}`;

/** One reached render domain whose scene resources may serve multiple contributions. */
interface PortalRenderNode {
	readonly id: PortalRenderNodeId;
	readonly incomingMaskEdgeIds: readonly PortalCrossingId[];
	readonly kind: "indoor-visibility-island" | "outdoor";
	readonly renderLayer: number;
	readonly scopes: readonly SceneScope[];
}

/** Executable mask representation selected once from the crossing/near-clip relationship. */
type PortalMaskSource =
	| {
			readonly kind: "near-clip-window";
			/** Exact parent-bounded NDC footprint used for straddle ownership. */
			readonly window: PortalViewWindow;
	  }
	| {
			readonly kind: "world-aperture";
			readonly depthPolicy: ScenePortalCrossingInput["maskDepthPolicy"];
			readonly visibilityApertureId: ScenePortalCrossingInput["visibilityAperture"]["id"];
	  };

/** One admitted authored mask transition between unique render nodes. */
interface PortalMaskEdge {
	readonly crossingId: PortalCrossingId;
	readonly maskSource: PortalMaskSource;
	readonly sourceNodeId: PortalRenderNodeId;
	readonly spatialRelationship: ScenePortalCrossingInput["spatialRelationship"];
	readonly targetNodeId: PortalRenderNodeId;
}

/** Mandatory exterior scene-domain operation retained independently from indoor masks. */
interface PortalExteriorTransition {
	readonly crossingId: PortalCrossingId;
	readonly exteriorLandblockId: ScenePortalCrossingInput["visibilityAperture"]["landblockId"];
	readonly sourceNodeId: PortalRenderNodeId;
	readonly targetNodeId: PortalRenderNodeId;
}

/** One classified group submitted through an exterior suffix mask. */
type PortalExteriorSuffixSubmission =
	| {
			/** Nodes omitted from ordinary contributions because the suffix is their only draw. */
			readonly kind: "deferred";
			readonly renderNodeIds: readonly PortalRenderNodeId[];
	  }
	| {
			/** Nodes redrawn after an earlier ordinary contribution was replaced by exterior. */
			readonly kind: "additional";
			readonly renderNodeIds: readonly PortalRenderNodeId[];
	  };

/** Indoor work executed immediately after one masked exterior contribution. */
interface PortalExteriorSuffixOperation {
	/** Internal component masks whose targets are suffix members. */
	readonly maskEdgeIds: readonly PortalCrossingId[];
	/** Complete planner-owned ordinary/deferred classification for suffix members. */
	readonly submissions: readonly PortalExteriorSuffixSubmission[];
	/** Parent-constrained adjacent-label promotion executed for every suffix mask. */
	readonly stencilTransition: {
		readonly from: number;
		readonly kind: "promote-if-equal";
		readonly to: number;
	};
}

/** Planner-authored exterior contribution and its strongly connected component facts. */
interface PortalExteriorRenderContribution {
	/** Every graph edge entering this component from a different component. */
	readonly entryMaskEdgeIds: readonly PortalCrossingId[];
	/** Complete strongly connected component membership retained from layer planning. */
	readonly componentNodeIds: readonly PortalRenderNodeId[];
	readonly kind: "exterior";
	/** Exact masks that establish exterior ownership for this contribution. */
	readonly maskEdgeIds: readonly PortalCrossingId[];
	/** Internal return edges consumed as cycle provenance without redrawing the outdoor base. */
	readonly returnMaskEdgeIds: readonly PortalCrossingId[];
	/** Unique render node owning the reusable outdoor scene-domain contribution. */
	readonly outdoorNodeId: PortalRenderNodeId;
	/** Layer assigned to the outdoor node by the completed graph. */
	readonly renderLayer: number;
	/** Root components execute directly in the main target rather than as a detached suffix. */
	readonly rootContained: boolean;
	/** Stencil label owning this contribution; zero is valid only for the unmasked root. */
	readonly stencilValue: number;
	/** Indoor bounce, classified as deferred and/or additional planner work. */
	readonly suffix: PortalExteriorSuffixOperation | null;
}

/** One ordinary indoor contribution fully classified by the planner. */
interface PortalIndoorRenderContribution {
	readonly kind: "indoor";
	readonly maskEdgeIds: readonly PortalCrossingId[];
	readonly renderNodeIds: readonly PortalRenderNodeId[];
	readonly stencilValue: number;
}

type PortalRenderContribution =
	PortalExteriorRenderContribution | PortalIndoorRenderContribution;

/** Ordered executable contributions sharing one completed graph layer. */
interface PortalRenderLayer {
	readonly contributions: readonly PortalRenderContribution[];
	readonly renderLayer: number;
}

/** Complete preflight against the caller's WebGL stencil-value ceiling. */
interface PortalMaskCapacityPreflight {
	readonly maximumAvailableStencilValue: number;
	readonly maximumRenderLayer: number;
	readonly requiredMaximumStencilValue: number;
}

type ProjectionDiagnostics = PortalWindowProjectionResult["diagnostics"];

/** Consumed pure-planner facts for Gate E and later frame diagnostics. */
interface PortalRenderGraphDiagnostics {
	readonly admittedScopeWindowStateCount: number;
	readonly attemptedCrossingCount: number;
	readonly componentCount: number;
	readonly cyclicComponentCount: number;
	readonly duplicateOrSubsumedWindowStateCount: number;
	readonly emptyWindowCount: number;
	readonly maximumRetainedFragmentsPerScope: number;
	readonly nearPlaneSeedCount: number;
	readonly projection: ProjectionDiagnostics;
	readonly rejectedFacingCrossingCount: number;
	/** Authored mask boundaries already contained by one depth-continuous render domain. */
	readonly sameDomainBoundaryCrossingCount: number;
	readonly retainedMaskEdgeCount: number;
	readonly retainedRenderNodeCount: number;
	readonly workItemCount: number;
}

/** Final immutable CPU contract consumed by exterior and internal GPU execution. */
export interface PortalRenderWorkPlan {
	readonly capacity: PortalMaskCapacityPreflight;
	readonly diagnostics: PortalRenderGraphDiagnostics;
	readonly exteriorTransitions: readonly PortalExteriorTransition[];
	readonly maskEdges: readonly PortalMaskEdge[];
	readonly nodes: readonly PortalRenderNode[];
	readonly renderLayers: readonly PortalRenderLayer[];
	readonly rootNodeId: PortalRenderNodeId;
	/** Exact scopes to resolve through the shared SceneGraph culling query. */
	readonly selectedScopes: readonly SceneScope[];
	readonly topologyRevision: number;
}

/** Exact per-view inputs expressed in one anchor-relative render frame. */
export interface PortalRenderGraphPlanInput extends PreparedPortalProjection {
	readonly maximumStencilValue: number;
	readonly nearClipVolume: CameraNearClipVolume;
	readonly rootScope: SceneScope;
	/** Corruption/failed-invariant guard, never the planner's termination algorithm. */
	readonly safetyWorkItemLimit: number;
}

/** Complete plan or typed preflight failure; no partial graph escapes. */
export type PortalRenderGraphPlanResult =
	| { readonly kind: "planned"; readonly plan: PortalRenderWorkPlan }
	| {
			readonly kind: "failed";
			readonly reason: "mask-capacity" | "work-limit";
			readonly requiredMaximumStencilValue: number;
			readonly workItemCount: number;
	  };

interface IndexedPortalDomain {
	readonly id: PortalRenderNodeId;
	readonly kind: PortalRenderNode["kind"];
}

interface IndexedPortalTopology {
	readonly domainByScopeKey: ReadonlyMap<string, IndexedPortalDomain>;
	readonly scopeByKey: ReadonlyMap<string, SceneTopologyScope>;
	readonly view: SceneTopologyView;
}

interface MutablePortalRenderNode {
	readonly domain: IndexedPortalDomain;
	readonly incomingMaskEdgeIds: Set<PortalCrossingId>;
	renderLayer: number | null;
	readonly selectedScopes: Map<string, SceneScope>;
}

interface MutablePortalMaskEdge {
	readonly crossing: ScenePortalCrossingInput;
	maskSource: PortalMaskSource;
	readonly sourceNodeId: PortalRenderNodeId;
	readonly targetNodeId: PortalRenderNodeId;
}

/** Projection input paired with the stable authored aperture resource identity. */
interface IndexedPortalAperture extends PortalApertureProjectionInput {
	readonly id: ScenePortalCrossingInput["visibilityAperture"]["id"];
}

/** Novel window coverage to expand from one exact topology scope. */
interface PortalWindowWorkItem {
	/** Crossing that admitted this window, retained to suppress only its immediate return. */
	readonly incomingCrossing: ScenePortalCrossingInput | null;
	readonly scope: SceneScope;
	readonly window: PortalViewWindow;
}

/** Pure planner retaining only an immutable index for the current topology revision. */
export class PortalRenderGraphPlanner {
	#index: IndexedPortalTopology | null = null;

	plan(
		topology: SceneTopologyView,
		input: PortalRenderGraphPlanInput,
	): PortalRenderGraphPlanResult {
		validatePlanInput(input);
		if (
			this.#index?.view !== topology ||
			this.#index.view.revision !== topology.revision
		) {
			this.#index = indexTopology(topology);
		}
		const context = new PortalPlanningContext(this.#index, input);
		try {
			return { kind: "planned", plan: context.plan() };
		} catch (cause) {
			if (!(cause instanceof PortalPlanningFailure)) throw cause;
			return {
				kind: "failed",
				reason: cause.reason,
				requiredMaximumStencilValue: cause.requiredMaximumStencilValue,
				workItemCount: context.workItemCount,
			};
		}
	}
}

class PortalPlanningContext {
	readonly #anchorApertureById = new Map<string, PlanarAperture>();
	readonly #edges = new Map<PortalCrossingId, MutablePortalMaskEdge>();
	readonly #index: IndexedPortalTopology;
	readonly #input: PortalRenderGraphPlanInput;
	readonly #nodes = new Map<PortalRenderNodeId, MutablePortalRenderNode>();
	readonly #projection = createProjectionDiagnostics();
	readonly #projector: PortalWindowProjector;
	readonly #queue: PortalWindowWorkItem[] = [];
	readonly #selectedScopes = new Map<string, SceneScope>();
	readonly #sameDomainBoundaryCrossingIds = new Set<PortalCrossingId>();
	readonly #scopeCoverage = new Map<string, PortalViewWindow>();
	admittedScopeWindowStateCount = 0;
	attemptedCrossingCount = 0;
	duplicateOrSubsumedWindowStateCount = 0;
	emptyWindowCount = 0;
	rejectedFacingCrossingCount = 0;
	workItemCount = 0;

	constructor(index: IndexedPortalTopology, input: PortalRenderGraphPlanInput) {
		this.#index = index;
		this.#input = input;
		this.#projector = new PortalWindowProjector(input);
	}

	plan(): PortalRenderWorkPlan {
		const rootDomain = this.#requireDomain(this.#input.rootScope);
		const rootWindow = createFullPortalViewWindow();
		this.#selectScope(rootDomain, this.#input.rootScope);
		this.#scopeCoverage.set(scopeKey(this.#input.rootScope), rootWindow);
		this.#queue.push({
			incomingCrossing: null,
			scope: this.#input.rootScope,
			window: rootWindow,
		});
		this.admittedScopeWindowStateCount += 1;

		for (let cursor = 0; cursor < this.#queue.length; cursor += 1) {
			this.#consumeWorkItem();
			this.#expand(this.#queue[cursor]!);
		}

		const layerFacts = assignRenderLayers(
			this.#nodes,
			this.#edges,
			rootDomain.id,
		);
		const nodes = this.#createNodes();
		const maskEdges = this.#createEdges();
		const exteriorContribution = createExteriorRenderContribution(
			nodes,
			maskEdges,
			layerFacts.components,
			rootDomain.id,
			layerFacts.maximumRenderLayer,
		);
		const renderLayers = createRenderLayers(
			nodes,
			maskEdges,
			exteriorContribution,
		);
		const exteriorStencilValues = exteriorContribution
			? [
					exteriorContribution.stencilValue,
					...(exteriorContribution.suffix
						? [exteriorContribution.suffix.stencilTransition.to]
						: []),
				]
			: [];
		const capacity = this.#createCapacity(
			layerFacts.maximumRenderLayer,
			Math.max(layerFacts.maximumRenderLayer, ...exteriorStencilValues),
		);
		if (
			capacity.requiredMaximumStencilValue >
			capacity.maximumAvailableStencilValue
		) {
			throw new PortalPlanningFailure(
				"mask-capacity",
				capacity.requiredMaximumStencilValue,
			);
		}
		const selectedScopes = [...this.#selectedScopes.values()].sort(
			(left, right) => scopeKey(left).localeCompare(scopeKey(right)),
		);
		return {
			capacity,
			diagnostics: {
				admittedScopeWindowStateCount: this.admittedScopeWindowStateCount,
				attemptedCrossingCount: this.attemptedCrossingCount,
				componentCount: layerFacts.componentCount,
				cyclicComponentCount: layerFacts.cyclicComponentCount,
				duplicateOrSubsumedWindowStateCount:
					this.duplicateOrSubsumedWindowStateCount,
				emptyWindowCount: this.emptyWindowCount,
				maximumRetainedFragmentsPerScope: Math.max(
					...[...this.#scopeCoverage.values()].map(
						(coverage) => coverage.fragments.length,
					),
				),
				nearPlaneSeedCount: maskEdges.filter(
					(edge) => edge.maskSource.kind === "near-clip-window",
				).length,
				projection: finishProjectionDiagnostics(this.#projection),
				rejectedFacingCrossingCount: this.rejectedFacingCrossingCount,
				sameDomainBoundaryCrossingCount:
					this.#sameDomainBoundaryCrossingIds.size,
				retainedMaskEdgeCount: maskEdges.length,
				retainedRenderNodeCount: nodes.length,
				workItemCount: this.workItemCount,
			},
			exteriorTransitions: maskEdges.flatMap((edge) => {
				if (edge.spatialRelationship.kind !== "exterior-transition") return [];
				return [
					{
						crossingId: edge.crossingId,
						exteriorLandblockId: edge.spatialRelationship.exteriorLandblockId,
						sourceNodeId: edge.sourceNodeId,
						targetNodeId: edge.targetNodeId,
					},
				];
			}),
			maskEdges,
			nodes,
			renderLayers,
			rootNodeId: rootDomain.id,
			selectedScopes,
			topologyRevision: this.#index.view.revision,
		};
	}

	#expand(item: PortalWindowWorkItem): void {
		const sourceDomain = this.#requireDomain(item.scope);
		for (const crossing of this.#index.view.outgoing(item.scope)) {
			if (
				item.incomingCrossing &&
				(crossing.id === item.incomingCrossing.reciprocalCrossingId ||
					crossing.sourceAperture.id ===
						item.incomingCrossing.sourceAperture.id)
			) {
				continue;
			}
			this.attemptedCrossingCount += 1;
			this.#consumeWorkItem();
			if (!sameScope(crossing.source, item.scope)) {
				throw new Error(
					`Portal topology returned ${crossing.id} from the wrong source scope.`,
				);
			}
			const targetDomain = this.#requireDomain(crossing.target);
			const sameDomain = sourceDomain.id === targetDomain.id;
			if (
				crossing.spatialRelationship.kind === "indoor-depth-continuous" &&
				!sameDomain
			) {
				throw new Error(
					`Depth-continuous crossing ${crossing.id} spans render domains.`,
				);
			}
			if (
				sameDomain &&
				crossing.spatialRelationship.kind !== "indoor-depth-continuous"
			) {
				// This boundary still constrains which member scope is reached even though
				// its endpoints share ordinary depth and therefore require no stencil mask.
				this.#sameDomainBoundaryCrossingIds.add(crossing.id);
			}
			const apertureInput = createVisibilityApertureInput(crossing);
			const anchorAperture = this.#anchorAperture(apertureInput);
			const nearPlaneStraddle = apertureIntersectsCameraNearClipVolume(
				this.#input.nearClipVolume,
				anchorAperture,
			);
			if (!nearPlaneStraddle && !this.#facesCamera(crossing)) {
				this.rejectedFacingCrossingCount += 1;
				continue;
			}
			const projection = nearPlaneStraddle
				? this.#projector.clipThroughNearClipAperture(
						item.window,
						apertureInput,
					)
				: this.#projector.clipThroughAperture(item.window, apertureInput);
			addProjectionDiagnostics(this.#projection, projection.diagnostics);
			if (projection.kind === "empty") {
				this.emptyWindowCount += 1;
				continue;
			}
			this.#selectScope(targetDomain, crossing.target);
			if (!sameDomain) {
				this.#admitEdge(
					crossing,
					sourceDomain.id,
					targetDomain.id,
					nearPlaneStraddle
						? { kind: "near-clip-window", window: projection.window }
						: {
								depthPolicy: crossing.maskDepthPolicy,
								kind: "world-aperture",
								visibilityApertureId: apertureInput.id,
							},
				);
			}
			const targetScopeKey = scopeKey(crossing.target);
			const admission = admitPortalViewWindow(
				this.#scopeCoverage.get(targetScopeKey) ?? null,
				projection.window,
			);
			if (!admission.delta) {
				this.duplicateOrSubsumedWindowStateCount += 1;
				continue;
			}
			this.#scopeCoverage.set(targetScopeKey, admission.coverage);
			this.admittedScopeWindowStateCount += 1;
			this.#queue.push({
				incomingCrossing: crossing,
				scope: crossing.target,
				window: admission.delta,
			});
		}
	}

	#admitEdge(
		crossing: ScenePortalCrossingInput,
		sourceNodeId: PortalRenderNodeId,
		targetNodeId: PortalRenderNodeId,
		maskSource: PortalMaskSource,
	): void {
		const existing = this.#edges.get(crossing.id);
		if (existing) {
			if (
				existing.sourceNodeId !== sourceNodeId ||
				existing.targetNodeId !== targetNodeId
			) {
				throw new Error(`Portal mask edge ${crossing.id} changed endpoints.`);
			}
			if (existing.maskSource.kind !== maskSource.kind) {
				throw new Error(`Portal mask edge ${crossing.id} changed mask source.`);
			}
			if (
				existing.maskSource.kind === "near-clip-window" &&
				maskSource.kind === "near-clip-window"
			) {
				existing.maskSource = {
					kind: "near-clip-window",
					window: admitPortalViewWindow(
						existing.maskSource.window,
						maskSource.window,
					).coverage,
				};
			}
		} else {
			this.#edges.set(crossing.id, {
				crossing,
				maskSource,
				sourceNodeId,
				targetNodeId,
			});
		}
		this.#requireNode(targetNodeId).incomingMaskEdgeIds.add(crossing.id);
	}

	#anchorAperture(input: IndexedPortalAperture): PlanarAperture {
		const cached = this.#anchorApertureById.get(input.id);
		if (cached) return cached;
		const offset = createLandblockOffset(
			input.landblockCoordinates,
			this.#input.anchorCoordinates,
		);
		const vertices = new Float32Array(input.aperture.vertices.length);
		for (let index = 0; index < input.aperture.vertices.length; index += 3) {
			vertices[index] = input.aperture.vertices[index]! + offset.x;
			vertices[index + 1] = input.aperture.vertices[index + 1]!;
			vertices[index + 2] = input.aperture.vertices[index + 2]! + offset.z;
		}
		const normal = input.aperture.plane.normal;
		const aperture = {
			indices: input.aperture.indices,
			plane: {
				d: input.aperture.plane.d - normal.x * offset.x - normal.z * offset.z,
				normal,
			},
			vertices,
		};
		this.#anchorApertureById.set(input.id, aperture);
		return aperture;
	}

	#facesCamera(crossing: ScenePortalCrossingInput): boolean {
		const aperture = this.#anchorAperture(createSourceApertureInput(crossing));
		const distance = signedPlaneDistance(
			aperture.plane,
			this.#input.nearClipVolume.eye,
		);
		return crossing.acceptedSide === "positive"
			? distance > PORTAL_QUERY_EPSILON
			: distance < -PORTAL_QUERY_EPSILON;
	}

	#ensureNode(domain: IndexedPortalDomain): MutablePortalRenderNode {
		const existing = this.#nodes.get(domain.id);
		if (existing) return existing;
		const node: MutablePortalRenderNode = {
			domain,
			incomingMaskEdgeIds: new Set(),
			renderLayer: null,
			selectedScopes: new Map(),
		};
		this.#nodes.set(domain.id, node);
		return node;
	}

	#selectScope(
		domain: IndexedPortalDomain,
		scope: SceneScope,
	): MutablePortalRenderNode {
		const node = this.#ensureNode(domain);
		const key = scopeKey(scope);
		node.selectedScopes.set(key, scope);
		this.#selectedScopes.set(key, scope);
		return node;
	}

	#requireNode(nodeId: PortalRenderNodeId): MutablePortalRenderNode {
		const node = this.#nodes.get(nodeId);
		if (!node) throw new Error(`Portal render node ${nodeId} is unavailable.`);
		return node;
	}

	#requireDomain(scope: SceneScope): IndexedPortalDomain {
		const topologyScope = this.#index.scopeByKey.get(scopeKey(scope));
		if (!topologyScope || !sameScope(topologyScope.scope, scope)) {
			throw new Error(`Portal render scope ${scopeKey(scope)} is unavailable.`);
		}
		const domain = this.#index.domainByScopeKey.get(scopeKey(scope));
		if (!domain) {
			throw new Error(`Portal render scope ${scopeKey(scope)} has no domain.`);
		}
		return domain;
	}

	#createNodes(): readonly PortalRenderNode[] {
		return [...this.#nodes.values()]
			.sort((left, right) => left.domain.id.localeCompare(right.domain.id))
			.map((node) => {
				if (node.selectedScopes.size === 0 || node.renderLayer === null) {
					throw new Error(
						`Portal render node ${node.domain.id} is incomplete.`,
					);
				}
				return {
					id: node.domain.id,
					incomingMaskEdgeIds: [...node.incomingMaskEdgeIds].sort(),
					kind: node.domain.kind,
					renderLayer: node.renderLayer,
					scopes: [...node.selectedScopes.values()].sort((left, right) =>
						scopeKey(left).localeCompare(scopeKey(right)),
					),
				};
			});
	}

	#createEdges(): readonly PortalMaskEdge[] {
		return [...this.#edges.values()]
			.sort((left, right) => left.crossing.id.localeCompare(right.crossing.id))
			.map((edge) => ({
				crossingId: edge.crossing.id,
				maskSource: edge.maskSource,
				sourceNodeId: edge.sourceNodeId,
				spatialRelationship: edge.crossing.spatialRelationship,
				targetNodeId: edge.targetNodeId,
			}));
	}

	#createCapacity(
		maximumRenderLayer: number,
		requiredMaximumStencilValue: number,
	): PortalMaskCapacityPreflight {
		return {
			maximumAvailableStencilValue: this.#input.maximumStencilValue,
			maximumRenderLayer,
			requiredMaximumStencilValue,
		};
	}

	#consumeWorkItem(): void {
		this.workItemCount += 1;
		if (this.workItemCount > this.#input.safetyWorkItemLimit) {
			throw new PortalPlanningFailure("work-limit", 0);
		}
	}
}

class PortalPlanningFailure extends Error {
	constructor(
		readonly reason: "mask-capacity" | "work-limit",
		readonly requiredMaximumStencilValue: number,
	) {
		super(`Portal render planning failed: ${reason}.`);
	}
}

function indexTopology(view: SceneTopologyView): IndexedPortalTopology {
	const scopeByKey = new Map<string, SceneTopologyScope>();
	const domainByScopeKey = new Map<string, IndexedPortalDomain>();
	const indoorScopesByIsland = new Map<string, SceneScope[]>();
	for (const topologyScope of view.scopes) {
		const key = scopeKey(topologyScope.scope);
		if (scopeByKey.has(key)) {
			throw new Error(`Portal topology repeats scope ${key}.`);
		}
		scopeByKey.set(key, topologyScope);
		if (topologyScope.scope.kind === "outdoor") {
			if (topologyScope.visibilityIslandId !== null) {
				throw new Error("Outdoor scope cannot belong to a visibility island.");
			}
			const domain = {
				id: "portal-render-node:outdoor",
				kind: "outdoor",
			} as const;
			domainByScopeKey.set(key, domain);
			continue;
		}
		if (topologyScope.visibilityIslandId === null) {
			throw new Error(`EnvCell scope ${key} has no visibility island.`);
		}
		const scopes =
			indoorScopesByIsland.get(topologyScope.visibilityIslandId) ?? [];
		scopes.push(topologyScope.scope);
		indoorScopesByIsland.set(topologyScope.visibilityIslandId, scopes);
	}
	for (const [islandId, scopes] of indoorScopesByIsland) {
		const domain: IndexedPortalDomain = {
			id: `portal-render-node:${islandId}`,
			kind: "indoor-visibility-island",
		};
		for (const scope of scopes) {
			domainByScopeKey.set(scopeKey(scope), domain);
		}
	}
	const crossingById = new Map<PortalCrossingId, ScenePortalCrossingInput>();
	for (const crossing of view.crossings) {
		if (crossingById.has(crossing.id)) {
			throw new Error(`Portal topology repeats crossing ${crossing.id}.`);
		}
		if (
			!scopeByKey.has(scopeKey(crossing.source)) ||
			!scopeByKey.has(scopeKey(crossing.target))
		) {
			throw new Error(
				`Portal crossing ${crossing.id} references an unavailable scope.`,
			);
		}
		crossingById.set(crossing.id, crossing);
	}
	return {
		domainByScopeKey,
		scopeByKey,
		view,
	};
}

function createSourceApertureInput(
	crossing: ScenePortalCrossingInput,
): IndexedPortalAperture {
	return createApertureInput(crossing.sourceAperture);
}

function createVisibilityApertureInput(
	crossing: ScenePortalCrossingInput,
): IndexedPortalAperture {
	return createApertureInput(crossing.visibilityAperture);
}

function createApertureInput(
	source: ScenePortalCrossingInput["sourceAperture"],
): IndexedPortalAperture {
	return {
		aperture: source,
		id: source.id,
		landblockCoordinates: getLandblockCoordinates(source.landblockId),
	};
}

function assignRenderLayers(
	nodes: ReadonlyMap<PortalRenderNodeId, MutablePortalRenderNode>,
	edges: ReadonlyMap<PortalCrossingId, MutablePortalMaskEdge>,
	rootNodeId: PortalRenderNodeId,
): {
	readonly componentCount: number;
	readonly components: readonly (readonly PortalRenderNodeId[])[];
	readonly cyclicComponentCount: number;
	readonly maximumRenderLayer: number;
} {
	const components = createStronglyConnectedComponents(nodes, edges);
	const componentByNode = new Map<PortalRenderNodeId, number>();
	for (const [componentId, component] of components.entries()) {
		for (const nodeId of component) componentByNode.set(nodeId, componentId);
	}
	const rootComponentId = componentByNode.get(rootNodeId);
	if (rootComponentId === undefined) {
		throw new Error("Portal render graph root has no component.");
	}
	assignRootComponentLayers(
		nodes,
		edges,
		components[rootComponentId]!,
		rootNodeId,
	);
	const outgoingComponents = new Map<number, Set<number>>();
	const incomingEdges = new Map<number, MutablePortalMaskEdge[]>();
	const indegree = new Map<number, number>(
		components.map((_, componentId) => [componentId, 0]),
	);
	for (const edge of edges.values()) {
		const sourceComponentId = componentByNode.get(edge.sourceNodeId)!;
		const targetComponentId = componentByNode.get(edge.targetNodeId)!;
		if (sourceComponentId === targetComponentId) continue;
		const outgoing =
			outgoingComponents.get(sourceComponentId) ?? new Set<number>();
		if (!outgoing.has(targetComponentId)) {
			outgoing.add(targetComponentId);
			outgoingComponents.set(sourceComponentId, outgoing);
			indegree.set(targetComponentId, indegree.get(targetComponentId)! + 1);
		}
		const incoming = incomingEdges.get(targetComponentId) ?? [];
		incoming.push(edge);
		incomingEdges.set(targetComponentId, incoming);
	}
	const ready = [...indegree.entries()]
		.filter(([, count]) => count === 0)
		.map(([componentId]) => componentId)
		.sort((left, right) => left - right);
	let visitedComponentCount = 0;
	while (ready.length > 0) {
		const componentId = ready.shift()!;
		visitedComponentCount += 1;
		if (componentId !== rootComponentId) {
			const incoming = incomingEdges.get(componentId) ?? [];
			if (incoming.length === 0) {
				throw new Error(`Portal component ${componentId} is unreachable.`);
			}
			const renderLayer =
				Math.max(
					...incoming.map((edge) => {
						const layer = nodes.get(edge.sourceNodeId)?.renderLayer;
						if (layer === null || layer === undefined) {
							throw new Error(
								`Portal component ${componentId} has an unordered predecessor.`,
							);
						}
						return layer;
					}),
				) + 1;
			for (const nodeId of components[componentId]!) {
				nodes.get(nodeId)!.renderLayer = renderLayer;
			}
		}
		for (const target of outgoingComponents.get(componentId) ?? []) {
			const nextIndegree = indegree.get(target)! - 1;
			indegree.set(target, nextIndegree);
			if (nextIndegree === 0) {
				ready.push(target);
				ready.sort((left, right) => left - right);
			}
		}
	}
	if (visitedComponentCount !== components.length) {
		throw new Error("Portal component condensation graph contains a cycle.");
	}
	const maximumRenderLayer = Math.max(
		...[...nodes.values()].map((node) => {
			if (node.renderLayer === null) {
				throw new Error(`Portal render node ${node.domain.id} has no layer.`);
			}
			return node.renderLayer;
		}),
	);
	return {
		componentCount: components.length,
		components,
		cyclicComponentCount: components.filter(
			(component) =>
				component.length > 1 ||
				[...edges.values()].some(
					(edge) =>
						edge.sourceNodeId === component[0] &&
						edge.targetNodeId === component[0],
				),
		).length,
		maximumRenderLayer,
	};
}

function assignRootComponentLayers(
	nodes: ReadonlyMap<PortalRenderNodeId, MutablePortalRenderNode>,
	edges: ReadonlyMap<PortalCrossingId, MutablePortalMaskEdge>,
	component: readonly PortalRenderNodeId[],
	rootNodeId: PortalRenderNodeId,
): void {
	const members = new Set(component);
	const outgoing = new Map<PortalRenderNodeId, PortalRenderNodeId[]>();
	for (const edge of edges.values()) {
		if (
			members.has(edge.sourceNodeId) &&
			members.has(edge.targetNodeId) &&
			edge.targetNodeId !== rootNodeId
		) {
			const targets = outgoing.get(edge.sourceNodeId) ?? [];
			targets.push(edge.targetNodeId);
			outgoing.set(edge.sourceNodeId, targets);
		}
	}
	const root = nodes.get(rootNodeId);
	if (!root) throw new Error("Portal root render node is unavailable.");
	root.renderLayer = 0;
	const queue = [rootNodeId];
	for (let cursor = 0; cursor < queue.length; cursor += 1) {
		const sourceNodeId = queue[cursor]!;
		const sourceLayer = nodes.get(sourceNodeId)!.renderLayer!;
		for (const targetNodeId of (outgoing.get(sourceNodeId) ?? []).sort()) {
			const target = nodes.get(targetNodeId)!;
			const candidateLayer = sourceLayer + 1;
			if (target.renderLayer !== null && target.renderLayer <= candidateLayer) {
				continue;
			}
			target.renderLayer = candidateLayer;
			queue.push(targetNodeId);
		}
	}
	for (const nodeId of component) {
		if (nodes.get(nodeId)!.renderLayer === null) {
			throw new Error(
				`Portal root component cannot reach render node ${nodeId}.`,
			);
		}
	}
}

function createStronglyConnectedComponents(
	nodes: ReadonlyMap<PortalRenderNodeId, MutablePortalRenderNode>,
	edges: ReadonlyMap<PortalCrossingId, MutablePortalMaskEdge>,
): readonly (readonly PortalRenderNodeId[])[] {
	const adjacency = new Map<PortalRenderNodeId, PortalRenderNodeId[]>();
	for (const edge of edges.values()) {
		const targets = adjacency.get(edge.sourceNodeId) ?? [];
		targets.push(edge.targetNodeId);
		adjacency.set(edge.sourceNodeId, targets);
	}
	for (const targets of adjacency.values()) targets.sort();
	const indices = new Map<PortalRenderNodeId, number>();
	const lowLinks = new Map<PortalRenderNodeId, number>();
	const onStack = new Set<PortalRenderNodeId>();
	const stack: PortalRenderNodeId[] = [];
	const components: PortalRenderNodeId[][] = [];
	let nextIndex = 0;

	const visit = (nodeId: PortalRenderNodeId): void => {
		indices.set(nodeId, nextIndex);
		lowLinks.set(nodeId, nextIndex);
		nextIndex += 1;
		stack.push(nodeId);
		onStack.add(nodeId);
		for (const targetNodeId of adjacency.get(nodeId) ?? []) {
			if (!indices.has(targetNodeId)) {
				visit(targetNodeId);
				lowLinks.set(
					nodeId,
					Math.min(lowLinks.get(nodeId)!, lowLinks.get(targetNodeId)!),
				);
			} else if (onStack.has(targetNodeId)) {
				lowLinks.set(
					nodeId,
					Math.min(lowLinks.get(nodeId)!, indices.get(targetNodeId)!),
				);
			}
		}
		if (lowLinks.get(nodeId) !== indices.get(nodeId)) return;
		const component: PortalRenderNodeId[] = [];
		for (;;) {
			const member = stack.pop();
			if (!member) throw new Error("Portal component stack underflow.");
			onStack.delete(member);
			component.push(member);
			if (member === nodeId) break;
		}
		components.push(component.sort());
	};

	for (const nodeId of [...nodes.keys()].sort()) {
		if (!indices.has(nodeId)) visit(nodeId);
	}
	return components.sort((left, right) => left[0]!.localeCompare(right[0]!));
}

function createRenderLayers(
	nodes: readonly PortalRenderNode[],
	edges: readonly PortalMaskEdge[],
	exterior: PortalExteriorRenderContribution | null,
): readonly PortalRenderLayer[] {
	const nodesByLayer = new Map<number, PortalRenderNodeId[]>();
	const deferredNodeIds = new Set(
		exterior?.suffix?.submissions.flatMap((submission) =>
			submission.kind === "deferred" ? submission.renderNodeIds : [],
		) ?? [],
	);
	for (const node of nodes) {
		if (node.kind === "outdoor" || deferredNodeIds.has(node.id)) continue;
		const layer = nodesByLayer.get(node.renderLayer) ?? [];
		layer.push(node.id);
		nodesByLayer.set(node.renderLayer, layer);
	}
	if (exterior) {
		const layer = nodesByLayer.get(exterior.renderLayer) ?? [];
		nodesByLayer.set(exterior.renderLayer, layer);
	}
	return [...nodesByLayer.keys()]
		.sort((left, right) => left - right)
		.map((renderLayer) => {
			const renderNodeIds = (nodesByLayer.get(renderLayer) ?? []).sort();
			const contributions: PortalRenderContribution[] = [];
			if (exterior?.renderLayer === renderLayer) contributions.push(exterior);
			if (renderNodeIds.length > 0) {
				const members = new Set(renderNodeIds);
				contributions.push({
					kind: "indoor",
					maskEdgeIds:
						renderLayer === 0
							? []
							: edges
									.filter((edge) => members.has(edge.targetNodeId))
									.map((edge) => edge.crossingId)
									.sort(),
					renderNodeIds,
					stencilValue: renderLayer,
				});
			}
			if (contributions.length === 0) {
				throw new Error(
					`Portal render layer ${renderLayer} has no contribution.`,
				);
			}
			return { contributions, renderLayer };
		});
}

/** Retain the exterior SCC split so the mechanical executor never reconstructs graph ownership. */
function createExteriorRenderContribution(
	nodes: readonly PortalRenderNode[],
	edges: readonly PortalMaskEdge[],
	components: readonly (readonly PortalRenderNodeId[])[],
	rootNodeId: PortalRenderNodeId,
	maximumRenderLayer: number,
): PortalExteriorRenderContribution | null {
	const outdoorNodes = nodes.filter((node) => node.kind === "outdoor");
	if (outdoorNodes.length === 0) return null;
	if (outdoorNodes.length !== 1) {
		throw new Error("Portal render graph contains more than one outdoor node.");
	}
	const outdoor = outdoorNodes[0]!;
	const component = components.find((candidate) =>
		candidate.includes(outdoor.id),
	);
	if (!component) {
		throw new Error("Portal outdoor node has no strongly connected component.");
	}
	const componentMembers = new Set(component);
	const nodeById = new Map(nodes.map((node) => [node.id, node]));
	const indoorNodeIds = component
		.filter((nodeId) => nodeId !== outdoor.id)
		.map((nodeId) => {
			const node = nodeById.get(nodeId);
			if (!node || node.kind !== "indoor-visibility-island") {
				throw new Error(
					`Portal exterior component member ${nodeId} is not an indoor node.`,
				);
			}
			return nodeId;
		});
	const entryMaskEdgeIds: PortalCrossingId[] = [];
	const internalIndoorMaskEdgeIds: PortalCrossingId[] = [];
	const returnMaskEdgeIds: PortalCrossingId[] = [];
	for (const edge of edges) {
		const sourceIsMember = componentMembers.has(edge.sourceNodeId);
		const targetIsMember = componentMembers.has(edge.targetNodeId);
		if (!sourceIsMember && targetIsMember) {
			entryMaskEdgeIds.push(edge.crossingId);
			continue;
		}
		if (!sourceIsMember || !targetIsMember) continue;
		if (edge.targetNodeId === outdoor.id) {
			returnMaskEdgeIds.push(edge.crossingId);
		} else {
			internalIndoorMaskEdgeIds.push(edge.crossingId);
		}
	}
	const rootContained = componentMembers.has(rootNodeId);
	const outdoorIsRoot = outdoor.id === rootNodeId;
	const sharesLayerWithAnotherContribution = nodes.some(
		(node) =>
			node.renderLayer === outdoor.renderLayer &&
			!componentMembers.has(node.id),
	);
	const hasSuffix = indoorNodeIds.length > 0 && !outdoorIsRoot;
	const stencilValue =
		hasSuffix || sharesLayerWithAnotherContribution
			? maximumRenderLayer + 1
			: outdoor.renderLayer;
	// The outdoor root owns the unmasked target. Indoor members of its SCC remain
	// ordinary forward-layer work; return edges only record cycle provenance.
	const maskEdgeIds = outdoorIsRoot
		? []
		: (rootContained ? returnMaskEdgeIds : entryMaskEdgeIds).sort();
	const contribution: PortalExteriorRenderContribution = {
		componentNodeIds: [...component],
		entryMaskEdgeIds: entryMaskEdgeIds.sort(),
		kind: "exterior",
		maskEdgeIds,
		outdoorNodeId: outdoor.id,
		renderLayer: outdoor.renderLayer,
		returnMaskEdgeIds: returnMaskEdgeIds.sort(),
		rootContained,
		stencilValue,
		suffix: hasSuffix
			? {
					maskEdgeIds: internalIndoorMaskEdgeIds.sort(),
					submissions: createExteriorSuffixSubmissions(
						indoorNodeIds,
						nodeById,
						outdoor.renderLayer,
					),
					stencilTransition: {
						from: stencilValue,
						kind: "promote-if-equal",
						to: stencilValue + 1,
					},
				}
			: null,
	};
	if (
		outdoor.renderLayer === 0 &&
		(contribution.maskEdgeIds.length > 0 || contribution.suffix)
	) {
		throw new Error("Portal outdoor root has masked component work.");
	}
	return contribution;
}

function createExteriorSuffixSubmissions(
	indoorNodeIds: readonly PortalRenderNodeId[],
	nodeById: ReadonlyMap<PortalRenderNodeId, PortalRenderNode>,
	exteriorRenderLayer: number,
): readonly PortalExteriorSuffixSubmission[] {
	const additional: PortalRenderNodeId[] = [];
	const deferred: PortalRenderNodeId[] = [];
	for (const nodeId of indoorNodeIds) {
		const node = nodeById.get(nodeId);
		if (!node) throw new Error(`Portal suffix node ${nodeId} is unavailable.`);
		(node.renderLayer < exteriorRenderLayer ? additional : deferred).push(
			nodeId,
		);
	}
	return [
		...(additional.length > 0
			? [{ kind: "additional" as const, renderNodeIds: additional.sort() }]
			: []),
		...(deferred.length > 0
			? [{ kind: "deferred" as const, renderNodeIds: deferred.sort() }]
			: []),
	];
}

function validatePlanInput(input: PortalRenderGraphPlanInput): void {
	validatePreparedPortalProjection(input);
	if (
		!Number.isInteger(input.safetyWorkItemLimit) ||
		input.safetyWorkItemLimit <= 0
	) {
		throw new Error(
			"Portal graph safety work limit must be a positive integer.",
		);
	}
	if (
		!Number.isInteger(input.maximumStencilValue) ||
		input.maximumStencilValue < 1 ||
		input.maximumStencilValue > 0xff
	) {
		throw new Error("Portal graph stencil ceiling must be from 1 through 255.");
	}
	if (
		!Number.isFinite(input.nearClipVolume.eye.x) ||
		!Number.isFinite(input.nearClipVolume.eye.y) ||
		!Number.isFinite(input.nearClipVolume.eye.z)
	) {
		throw new Error("Portal graph camera position must be finite.");
	}
}

function createProjectionDiagnostics(): ProjectionDiagnostics {
	return {
		broadPhaseRejectedPairCount: 0,
		createdClipVertexCount: 0,
		createdNdcVertexCount: 0,
		createdPolygonCount: 0,
		emptyExactIntersectionCount: 0,
		exactIntersectionPairCount: 0,
		homogeneousClippedPolygonCount: 0,
		homogeneousRejectedTriangleCount: 0,
		inputTriangleCount: 0,
		outputFragmentCount: 0,
		outputVertexCount: 0,
	};
}

function addProjectionDiagnostics(
	target: ProjectionDiagnostics,
	source: ProjectionDiagnostics,
): void {
	const mutable = target as {
		-readonly [Key in keyof ProjectionDiagnostics]: number;
	};
	for (const key of Object.keys(source) as (keyof ProjectionDiagnostics)[]) {
		mutable[key] += source[key];
	}
}

function finishProjectionDiagnostics(
	diagnostics: ProjectionDiagnostics,
): ProjectionDiagnostics {
	return { ...diagnostics };
}
