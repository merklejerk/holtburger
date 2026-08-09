import {
	getLandblockCoordinates,
	OUTDOOR_LANDBLOCK_WORLD_SIZE,
} from "../landblocks";
import { PORTAL_QUERY_EPSILON } from "../scene/planar-aperture";
import type {
	ScenePortalCrossingInput,
	SceneScope,
	SceneTopologyView,
} from "../scene";
import { sameScope } from "../scene/scope";
import {
	type CameraNearClipPrimitiveKind,
	type CameraNearClipPrimitiveMeter,
	type CameraNearClipVolume,
} from "./portal-near-plane";
import {
	preparePortalApertureProjectionInput,
	validatePreparedPortalProjection,
	type PortalWindowPrimitiveKind,
	type PortalWindowPrimitiveMeter,
	type PreparedPortalApertureProjectionInput,
	type PreparedPortalProjection,
} from "./portal-view-window";
import {
	NO_PORTAL_ARENA_WINDOW,
	PortalWindowArena,
	PortalWindowArenaCapacityExceeded,
	type PortalWindowArenaCapacity,
} from "./portal-window-arena";

const NO_CROSSING = -1;

/** Fixed camera-time storage policy; changing it is an explicit capacity event. */
export interface PortalScopeWindowCullerCapacity {
	/** Deepest complete crossing frontier retained by the CPU plan. */
	readonly maximumDepth: number;
	/** Atomic immutable-oracle primitive budget for one camera plan. */
	readonly maximumProjectionPrimitiveCount: number;
	/** Root plus every admitted scope-window delta retained in the work queue. */
	readonly maximumWorkItemCount: number;
	/** Fixed polygon/window backing stores reused across camera updates. */
	readonly windowArena: PortalWindowArenaCapacity;
}

/** Camera-dependent policy shared with the proved immutable scope-window traversal. */
export interface PortalScopeWindowCullInput extends PreparedPortalProjection {
	readonly nearClipVolume: CameraNearClipVolume;
	readonly portalFootprint: {
		readonly drawingBuffer: { readonly height: number; readonly width: number };
		readonly minimumPixelArea: number;
	};
	readonly rootScope: SceneScope;
}

/** Allocation and high-water facts with no timing-derived values. */
interface PortalScopeWindowArenaTrace {
	/** Camera-time backing-store growth; fixed arenas make this structurally zero. */
	readonly arenaGrowthCount: 0;
	/** Typed backing storage allocated at the most recent topology/capacity event. */
	readonly arenaCapacityBytes: number;
	/** Fresh typed error records allocated by this camera plan's exceptional cutoff. */
	readonly exceptionalDiagnosticHeapRecordCreationCount: 0 | 1;
	/** Largest admitted queue population reached by this camera plan. */
	readonly queueHighWaterCount: number;
	/** Immutable projection primitives charged before execution. */
	readonly projectionPrimitiveCount: number;
	/** Number of topology/capacity rebuilds since construction. */
	readonly topologyBuildCount: number;
	/** Normal-path portal-owned records created by one camera update. */
	readonly portalOwnedFrameHeapRecordCreationCount: 0;
	/** Largest committed polygon-fragment tail reached, including declined work. */
	readonly windowFragmentHighWaterCount: number;
	/** Largest committed numeric-window tail reached, including declined work. */
	readonly windowHighWaterCount: number;
	/** Largest reusable builder fragment tail reached by either builder. */
	readonly windowTemporaryFragmentHighWaterCount: number;
	/** Largest reusable builder vertex tail reached by either builder. */
	readonly windowTemporaryVertexHighWaterCount: number;
	/** Largest committed NDC-vertex tail reached, including declined work. */
	readonly windowVertexHighWaterCount: number;
}

interface MutablePortalScopeWindowArenaTrace {
	arenaGrowthCount: 0;
	arenaCapacityBytes: number;
	exceptionalDiagnosticHeapRecordCreationCount: 0 | 1;
	projectionPrimitiveCount: number;
	queueHighWaterCount: number;
	topologyBuildCount: number;
	portalOwnedFrameHeapRecordCreationCount: 0;
	windowFragmentHighWaterCount: number;
	windowHighWaterCount: number;
	windowTemporaryFragmentHighWaterCount: number;
	windowTemporaryVertexHighWaterCount: number;
	windowVertexHighWaterCount: number;
}

/** Reused, non-retained view over culler-owned storage. */
export interface PortalScopeWindowFrameView {
	/** Deepest whole crossing frontier represented by the selected windows. */
	readonly completedDepth: number;
	/** First frontier declined atomically because a configured budget was exhausted. */
	readonly declinedDepth: number | null;
	readonly selectedScopeCount: number;
	readonly status: "complete" | "truncated";
	readonly topologyRevision: number;
	readonly trace: PortalScopeWindowArenaTrace;
	/** Return the persistent topology scope for one selected ordinal. */
	selectedScope(ordinal: number): SceneScope;
	/** Read one selected arena window without constructing an immutable window record. */
	selectedFragmentCount(ordinal: number): number;
	/** Read one selected fragment's vertex count through the non-retained frame view. */
	selectedFragmentVertexCount(ordinal: number, fragment: number): number;
	/** Read one selected fragment vertex's NDC x component. */
	selectedVertexX(ordinal: number, fragment: number, vertex: number): number;
	/** Read one selected fragment vertex's NDC y component. */
	selectedVertexY(ordinal: number, fragment: number, vertex: number): number;
}

interface IndexedCrossing {
	readonly crossing: ScenePortalCrossingInput;
	readonly sourceScopeId: number;
	readonly targetScopeId: number;
	readonly sourceLandblockX: number;
	readonly sourceLandblockY: number;
	readonly visibilityAperture: PreparedPortalApertureProjectionInput;
}

/** Topology-event allocations and integer adjacency; no camera fact is retained here. */
class PortalScopeWindowTopologyIndex {
	readonly crossings: readonly IndexedCrossing[];
	readonly outgoingCrossingIds: Uint32Array;
	readonly outgoingOffsets: Uint32Array;
	readonly revision: number;
	readonly scopes: readonly SceneScope[];
	readonly view: SceneTopologyView;

	constructor(topology: SceneTopologyView) {
		this.view = topology;
		this.revision = topology.revision;
		this.scopes = Object.freeze(
			[...topology.scopes]
				.sort((left, right) =>
					scopeIdentity(left.scope).localeCompare(scopeIdentity(right.scope)),
				)
				.map(({ scope }) => scope),
		);
		const scopeIdByIdentity = new Map(
			this.scopes.map((scope, scopeId) => [scopeIdentity(scope), scopeId]),
		);
		const crossingInputs = [...topology.crossings].sort((left, right) =>
			left.id.localeCompare(right.id),
		);
		this.crossings = Object.freeze(
			crossingInputs.map((crossing): IndexedCrossing => {
				const sourceScopeId = scopeIdByIdentity.get(
					scopeIdentity(crossing.source),
				);
				const targetScopeId = scopeIdByIdentity.get(
					scopeIdentity(crossing.target),
				);
				if (sourceScopeId === undefined || targetScopeId === undefined) {
					throw new Error(
						`Portal crossing ${crossing.id} references an unavailable scope.`,
					);
				}
				const sourceCoordinates = getLandblockCoordinates(
					crossing.sourceAperture.landblockId,
				);
				return Object.freeze({
					crossing,
					sourceLandblockX: sourceCoordinates.x,
					sourceLandblockY: sourceCoordinates.y,
					sourceScopeId,
					targetScopeId,
					visibilityAperture: prepareAperture(crossing.visibilityAperture),
				});
			}),
		);
		this.outgoingOffsets = new Uint32Array(this.scopes.length + 1);
		for (const { sourceScopeId } of this.crossings) {
			this.outgoingOffsets[sourceScopeId + 1] += 1;
		}
		for (let index = 1; index < this.outgoingOffsets.length; index += 1) {
			this.outgoingOffsets[index] += this.outgoingOffsets[index - 1]!;
		}
		this.outgoingCrossingIds = new Uint32Array(this.crossings.length);
		const cursors = this.outgoingOffsets.slice(0, -1);
		for (
			let crossingId = 0;
			crossingId < this.crossings.length;
			crossingId += 1
		) {
			const sourceScopeId = this.crossings[crossingId]!.sourceScopeId;
			const cursor = cursors[sourceScopeId]!;
			this.outgoingCrossingIds[cursor] = crossingId;
			cursors[sourceScopeId] = cursor + 1;
		}
	}

	findScopeId(scope: SceneScope): number {
		// Real archive traces peak at 32 selected scopes. A linear scan avoids a camera-time Map
		// lookup and makes the topology-owned integer conversion allocation-free.
		for (let scopeId = 0; scopeId < this.scopes.length; scopeId += 1) {
			if (sameScope(this.scopes[scopeId]!, scope)) return scopeId;
		}
		throw new Error(
			`Portal root scope ${scopeIdentity(scope)} is unavailable.`,
		);
	}
}

/** Fixed queue, selection, mutation, and numeric-window storage. */
class PortalScopeWindowArena {
	readonly coverageByScopeId: Uint32Array;
	readonly mutationPreviousCoverage: Uint32Array;
	readonly mutationPreviousSelection: Uint8Array;
	readonly mutationScopeIds: Uint32Array;
	readonly queueCrossingIds: Int32Array;
	readonly queueDepths: Uint16Array;
	readonly queueScopeIds: Uint32Array;
	readonly queueWindows: Uint32Array;
	readonly selectedByScopeId: Uint8Array;
	readonly selectedScopeIds: Uint32Array;
	readonly typedCapacityBytes: number;
	readonly windows: PortalWindowArena;

	constructor(
		scopeCount: number,
		workItemCount: number,
		windowCapacity: PortalWindowArenaCapacity,
	) {
		this.coverageByScopeId = new Uint32Array(scopeCount);
		this.coverageByScopeId.fill(NO_PORTAL_ARENA_WINDOW);
		this.mutationPreviousCoverage = new Uint32Array(workItemCount);
		this.mutationPreviousCoverage.fill(NO_PORTAL_ARENA_WINDOW);
		this.mutationPreviousSelection = new Uint8Array(workItemCount);
		this.mutationScopeIds = new Uint32Array(workItemCount);
		this.queueCrossingIds = new Int32Array(workItemCount);
		this.queueDepths = new Uint16Array(workItemCount);
		this.queueScopeIds = new Uint32Array(workItemCount);
		this.queueWindows = new Uint32Array(workItemCount);
		this.queueWindows.fill(NO_PORTAL_ARENA_WINDOW);
		this.selectedByScopeId = new Uint8Array(scopeCount);
		this.selectedScopeIds = new Uint32Array(scopeCount);
		this.windows = new PortalWindowArena(windowCapacity);
		this.typedCapacityBytes =
			this.coverageByScopeId.byteLength +
			this.mutationPreviousCoverage.byteLength +
			this.mutationPreviousSelection.byteLength +
			this.mutationScopeIds.byteLength +
			this.queueCrossingIds.byteLength +
			this.queueDepths.byteLength +
			this.queueScopeIds.byteLength +
			this.queueWindows.byteLength +
			this.selectedByScopeId.byteLength +
			this.selectedScopeIds.byteLength +
			this.windows.trace.capacityBytes;
	}
}

class MutablePortalScopeWindowFrameView implements PortalScopeWindowFrameView {
	completedDepth = 0;
	declinedDepth: number | null = null;
	index: PortalScopeWindowTopologyIndex | null = null;
	selectedScopeCount = 0;
	status: "complete" | "truncated" = "complete";
	readonly trace: MutablePortalScopeWindowArenaTrace = {
		arenaGrowthCount: 0,
		arenaCapacityBytes: 0,
		exceptionalDiagnosticHeapRecordCreationCount: 0,
		projectionPrimitiveCount: 0,
		queueHighWaterCount: 0,
		topologyBuildCount: 0,
		portalOwnedFrameHeapRecordCreationCount: 0,
		windowFragmentHighWaterCount: 0,
		windowHighWaterCount: 0,
		windowTemporaryFragmentHighWaterCount: 0,
		windowTemporaryVertexHighWaterCount: 0,
		windowVertexHighWaterCount: 0,
	};

	constructor(readonly arenaOf: () => PortalScopeWindowArena | null) {}

	get topologyRevision(): number {
		return this.index?.revision ?? 0;
	}

	selectedScope(ordinal: number): SceneScope {
		const scopeId = this.#selectedScopeId(ordinal);
		return this.index!.scopes[scopeId]!;
	}

	selectedFragmentCount(ordinal: number): number {
		const arena = this.#requireArena();
		return arena.windows.fragmentCount(this.#selectedWindow(arena, ordinal));
	}

	selectedFragmentVertexCount(ordinal: number, fragment: number): number {
		const arena = this.#requireArena();
		return arena.windows.fragmentVertexCount(
			this.#selectedWindow(arena, ordinal),
			fragment,
		);
	}

	selectedVertexX(ordinal: number, fragment: number, vertex: number): number {
		const arena = this.#requireArena();
		return arena.windows.vertexX(
			this.#selectedWindow(arena, ordinal),
			fragment,
			vertex,
		);
	}

	selectedVertexY(ordinal: number, fragment: number, vertex: number): number {
		const arena = this.#requireArena();
		return arena.windows.vertexY(
			this.#selectedWindow(arena, ordinal),
			fragment,
			vertex,
		);
	}

	#requireArena(): PortalScopeWindowArena {
		const arena = this.arenaOf();
		if (!arena || !this.index)
			throw new Error("Portal culler frame is unavailable.");
		return arena;
	}

	#selectedScopeId(ordinal: number): number {
		if (
			!Number.isInteger(ordinal) ||
			ordinal < 0 ||
			ordinal >= this.selectedScopeCount
		) {
			throw new Error(
				`Portal selected-scope ordinal ${ordinal} is unavailable.`,
			);
		}
		return this.#requireArena().selectedScopeIds[ordinal]!;
	}

	#selectedWindow(arena: PortalScopeWindowArena, ordinal: number): number {
		const scopeId = this.#selectedScopeId(ordinal);
		const window = arena.coverageByScopeId[scopeId]!;
		if (window === NO_PORTAL_ARENA_WINDOW) {
			throw new Error(`Selected portal scope ${scopeId} has no coverage.`);
		}
		return window;
	}
}

/** Atomic projection-budget cutoff carrying the exact failing count. */
class ProjectionCapacityExceeded extends Error {
	constructor(
		readonly maximum: number,
		readonly observed: number,
	) {
		super(
			`Portal projection budget ${maximum} was exceeded by count ${observed}.`,
		);
	}
}

/** Fixed work storage cutoff identified by the operation that exhausted it. */
class WorkItemCapacityExceeded extends Error {
	constructor(
		readonly maximum: number,
		readonly operation: "mutation" | "queue",
	) {
		super(
			`Portal ${operation} storage exhausted its ${maximum}-item capacity.`,
		);
	}
}

/**
 * Visibility-only traversal using topology-owned adjacency and camera-owned fixed arenas.
 */
export class PortalScopeWindowCuller {
	readonly #capacity: PortalScopeWindowCullerCapacity;
	readonly #frame: MutablePortalScopeWindowFrameView;
	readonly #projectionMeter: PortalWindowPrimitiveMeter &
		CameraNearClipPrimitiveMeter;
	#arena: PortalScopeWindowArena | null = null;
	#index: PortalScopeWindowTopologyIndex | null = null;
	#mutationCount = 0;
	#projectionPrimitiveCount = 0;
	#queueCount = 0;
	#queueHighWaterCount = 0;
	#selectedScopeCount = 0;
	#topologyBuildCount = 0;

	constructor(capacity: PortalScopeWindowCullerCapacity) {
		validateCapacity(capacity);
		this.#capacity = capacity;
		this.#frame = new MutablePortalScopeWindowFrameView(() => this.#arena);
		this.#projectionMeter = {
			consume: (
				_kind: PortalWindowPrimitiveKind | CameraNearClipPrimitiveKind,
				count: number,
			): void => {
				const observed = this.#projectionPrimitiveCount + count;
				this.#projectionPrimitiveCount = observed;
				if (observed > this.#capacity.maximumProjectionPrimitiveCount) {
					throw new ProjectionCapacityExceeded(
						this.#capacity.maximumProjectionPrimitiveCount,
						observed,
					);
				}
			},
		};
	}

	cull(
		topology: SceneTopologyView,
		input: PortalScopeWindowCullInput,
	): PortalScopeWindowFrameView {
		validateCullInput(input);
		validatePreparedPortalProjection(input);
		this.#ensureTopology(topology);
		const index = this.#index!;
		const arena = this.#arena!;
		const rootWindow = this.#beginFrame(arena);
		const rootScopeId = index.findScopeId(input.rootScope);
		this.#select(arena, rootScopeId, rootWindow, false);
		this.#push(arena, rootScopeId, NO_CROSSING, 0, rootWindow);
		let cursor = 0;
		let completedDepth = 0;
		let declinedDepth: number | null = null;
		while (cursor < this.#queueCount) {
			const depth = arena.queueDepths[cursor]!;
			if (depth >= this.#capacity.maximumDepth) {
				completedDepth = Math.max(completedDepth, depth);
				break;
			}
			const frontierEnd = this.#frontierEnd(arena, cursor, depth);
			const queueCheckpoint = this.#queueCount;
			const mutationCheckpoint = this.#mutationCount;
			const windowCheckpoint = arena.windows.checkpoint();
			try {
				while (cursor < frontierEnd) {
					this.#expand(arena, index, input, cursor);
					cursor += 1;
				}
				completedDepth = depth + 1;
			} catch (cause) {
				if (
					!(cause instanceof ProjectionCapacityExceeded) &&
					!(cause instanceof WorkItemCapacityExceeded) &&
					!(cause instanceof PortalWindowArenaCapacityExceeded)
				) {
					throw cause;
				}
				this.#rollback(
					arena,
					mutationCheckpoint,
					queueCheckpoint,
					windowCheckpoint,
				);
				this.#frame.trace.exceptionalDiagnosticHeapRecordCreationCount = 1;
				declinedDepth = depth + 1;
				break;
			}
		}
		this.#frame.completedDepth = completedDepth;
		this.#frame.declinedDepth = declinedDepth;
		this.#frame.index = index;
		this.#frame.selectedScopeCount = this.#selectedScopeCount;
		this.#frame.status = declinedDepth === null ? "complete" : "truncated";
		this.#frame.trace.arenaCapacityBytes =
			arena.typedCapacityBytes +
			index.outgoingCrossingIds.byteLength +
			index.outgoingOffsets.byteLength;
		this.#frame.trace.projectionPrimitiveCount = this.#projectionPrimitiveCount;
		this.#frame.trace.queueHighWaterCount = this.#queueHighWaterCount;
		this.#frame.trace.topologyBuildCount = this.#topologyBuildCount;
		this.#frame.trace.windowFragmentHighWaterCount =
			arena.windows.trace.fragmentHighWaterCount;
		this.#frame.trace.windowHighWaterCount =
			arena.windows.trace.windowHighWaterCount;
		this.#frame.trace.windowTemporaryFragmentHighWaterCount =
			arena.windows.trace.temporaryFragmentHighWaterCount;
		this.#frame.trace.windowTemporaryVertexHighWaterCount =
			arena.windows.trace.temporaryVertexHighWaterCount;
		this.#frame.trace.windowVertexHighWaterCount =
			arena.windows.trace.vertexHighWaterCount;
		return this.#frame;
	}

	#beginFrame(arena: PortalScopeWindowArena): number {
		for (let index = 0; index < this.#queueCount; index += 1) {
			arena.queueWindows[index] = NO_PORTAL_ARENA_WINDOW;
		}
		for (let index = 0; index < this.#mutationCount; index += 1) {
			arena.mutationPreviousCoverage[index] = NO_PORTAL_ARENA_WINDOW;
		}
		for (let index = 0; index < this.#selectedScopeCount; index += 1) {
			const scopeId = arena.selectedScopeIds[index]!;
			arena.selectedByScopeId[scopeId] = 0;
			arena.coverageByScopeId[scopeId] = NO_PORTAL_ARENA_WINDOW;
		}
		this.#mutationCount = 0;
		this.#projectionPrimitiveCount = 0;
		this.#queueCount = 0;
		this.#queueHighWaterCount = 0;
		this.#selectedScopeCount = 0;
		this.#frame.trace.exceptionalDiagnosticHeapRecordCreationCount = 0;
		return arena.windows.reset();
	}

	#ensureTopology(topology: SceneTopologyView): void {
		if (
			this.#index?.view === topology &&
			this.#index.revision === topology.revision
		) {
			return;
		}
		const index = new PortalScopeWindowTopologyIndex(topology);
		this.#index = index;
		this.#arena = new PortalScopeWindowArena(
			index.scopes.length,
			this.#capacity.maximumWorkItemCount,
			this.#capacity.windowArena,
		);
		this.#topologyBuildCount += 1;
	}

	#expand(
		arena: PortalScopeWindowArena,
		index: PortalScopeWindowTopologyIndex,
		input: PortalScopeWindowCullInput,
		queueIndex: number,
	): void {
		const sourceScopeId = arena.queueScopeIds[queueIndex]!;
		const inherited = arena.queueWindows[queueIndex]!;
		if (inherited === NO_PORTAL_ARENA_WINDOW)
			throw new Error(`Portal work item ${queueIndex} lost its window.`);
		const incomingCrossingId = arena.queueCrossingIds[queueIndex]!;
		const start = index.outgoingOffsets[sourceScopeId]!;
		const end = index.outgoingOffsets[sourceScopeId + 1]!;
		for (let offset = start; offset < end; offset += 1) {
			const crossingId = index.outgoingCrossingIds[offset]!;
			const indexed = index.crossings[crossingId]!;
			if (this.#isImmediateReturn(index, incomingCrossingId, crossingId))
				continue;
			const crossing = indexed.crossing;
			if (!sameScope(crossing.source, index.scopes[sourceScopeId]!)) {
				throw new Error(
					`Portal crossing ${crossing.id} has the wrong indexed source.`,
				);
			}
			const nearPlaneStraddle = arena.windows.apertureIntersectsNearClip(
				input.nearClipVolume,
				indexed.visibilityAperture,
				input,
				this.#projectionMeter,
			);
			if (!nearPlaneStraddle && !facesCamera(indexed, input)) continue;
			const minimumNdcArea = nearPlaneStraddle
				? 0
				: input.portalFootprint.minimumPixelArea /
					((input.portalFootprint.drawingBuffer.width *
						input.portalFootprint.drawingBuffer.height) /
						4);
			const coverage = arena.coverageByScopeId[indexed.targetScopeId]!;
			if (
				!arena.windows.projectAndAdmit(
					inherited,
					coverage,
					input,
					indexed.visibilityAperture,
					nearPlaneStraddle,
					minimumNdcArea,
					this.#projectionMeter,
				)
			) {
				continue;
			}
			this.#select(
				arena,
				indexed.targetScopeId,
				arena.windows.admittedCoverage,
				true,
			);
			this.#push(
				arena,
				indexed.targetScopeId,
				crossingId,
				arena.queueDepths[queueIndex]! + 1,
				arena.windows.admittedDelta,
			);
		}
	}

	#frontierEnd(
		arena: PortalScopeWindowArena,
		start: number,
		depth: number,
	): number {
		let end = start;
		while (end < this.#queueCount && arena.queueDepths[end] === depth) end += 1;
		return end;
	}

	#isImmediateReturn(
		index: PortalScopeWindowTopologyIndex,
		incomingCrossingId: number,
		candidateCrossingId: number,
	): boolean {
		if (incomingCrossingId === NO_CROSSING) return false;
		const incoming = index.crossings[incomingCrossingId]!.crossing;
		const candidate = index.crossings[candidateCrossingId]!.crossing;
		return (
			candidate.id === incoming.reciprocalCrossingId ||
			candidate.sourceAperture.id === incoming.sourceAperture.id
		);
	}

	#push(
		arena: PortalScopeWindowArena,
		scopeId: number,
		crossingId: number,
		depth: number,
		window: number,
	): void {
		if (this.#queueCount >= arena.queueScopeIds.length) {
			throw new WorkItemCapacityExceeded(arena.queueScopeIds.length, "queue");
		}
		if (depth > 0xffff)
			throw new Error(`Portal culler depth ${depth} exceeds storage.`);
		const index = this.#queueCount;
		arena.queueScopeIds[index] = scopeId;
		arena.queueCrossingIds[index] = crossingId;
		arena.queueDepths[index] = depth;
		arena.queueWindows[index] = window;
		this.#queueCount += 1;
		this.#queueHighWaterCount = Math.max(
			this.#queueHighWaterCount,
			this.#queueCount,
		);
	}

	#select(
		arena: PortalScopeWindowArena,
		scopeId: number,
		coverage: number,
		recordMutation: boolean,
	): void {
		const wasSelected = arena.selectedByScopeId[scopeId];
		if (recordMutation) {
			if (this.#mutationCount >= arena.mutationScopeIds.length) {
				throw new WorkItemCapacityExceeded(
					arena.mutationScopeIds.length,
					"mutation",
				);
			}
			arena.mutationScopeIds[this.#mutationCount] = scopeId;
			arena.mutationPreviousSelection[this.#mutationCount] = wasSelected;
			arena.mutationPreviousCoverage[this.#mutationCount] =
				arena.coverageByScopeId[scopeId];
			this.#mutationCount += 1;
		}
		if (wasSelected === 0) {
			arena.selectedByScopeId[scopeId] = 1;
			arena.selectedScopeIds[this.#selectedScopeCount] = scopeId;
			this.#selectedScopeCount += 1;
		}
		arena.coverageByScopeId[scopeId] = coverage;
	}

	#rollback(
		arena: PortalScopeWindowArena,
		mutationCheckpoint: number,
		queueCheckpoint: number,
		windowCheckpoint: number,
	): void {
		for (
			let index = this.#mutationCount - 1;
			index >= mutationCheckpoint;
			index -= 1
		) {
			const scopeId = arena.mutationScopeIds[index]!;
			arena.coverageByScopeId[scopeId] = arena.mutationPreviousCoverage[index];
			arena.mutationPreviousCoverage[index] = NO_PORTAL_ARENA_WINDOW;
			if (arena.mutationPreviousSelection[index] === 0) {
				const selectedIndex = this.#selectedScopeCount - 1;
				if (arena.selectedScopeIds[selectedIndex] !== scopeId) {
					throw new Error("Portal frontier rollback lost selection order.");
				}
				arena.selectedByScopeId[scopeId] = 0;
				this.#selectedScopeCount = selectedIndex;
			}
		}
		this.#mutationCount = mutationCheckpoint;
		for (let index = queueCheckpoint; index < this.#queueCount; index += 1) {
			arena.queueWindows[index] = NO_PORTAL_ARENA_WINDOW;
		}
		this.#queueCount = queueCheckpoint;
		arena.windows.rollback(windowCheckpoint);
	}
}

function prepareAperture(
	aperture: ScenePortalCrossingInput["visibilityAperture"],
): PreparedPortalApertureProjectionInput {
	return preparePortalApertureProjectionInput({
		aperture,
		landblockCoordinates: getLandblockCoordinates(aperture.landblockId),
	});
}

function scopeIdentity(scope: SceneScope): string {
	return scope.kind === "outdoor"
		? "outdoor"
		: `${scope.landblockId}/${scope.envCellId}`;
}

function facesCamera(
	indexed: IndexedCrossing,
	input: PortalScopeWindowCullInput,
): boolean {
	const crossing = indexed.crossing;
	const aperture = crossing.sourceAperture;
	const offsetX =
		(indexed.sourceLandblockX - input.anchorCoordinates.x) *
		OUTDOOR_LANDBLOCK_WORLD_SIZE;
	const offsetZ =
		-(indexed.sourceLandblockY - input.anchorCoordinates.y) *
		OUTDOOR_LANDBLOCK_WORLD_SIZE;
	const normal = aperture.plane.normal;
	const eye = input.nearClipVolume.eye;
	const distance =
		normal.x * eye.x +
		normal.y * eye.y +
		normal.z * eye.z +
		aperture.plane.d -
		normal.x * offsetX -
		normal.z * offsetZ;
	return crossing.acceptedSide === "positive"
		? distance > PORTAL_QUERY_EPSILON
		: distance < -PORTAL_QUERY_EPSILON;
}

function validateCapacity(capacity: PortalScopeWindowCullerCapacity): void {
	for (const [name, value, minimum] of [
		["maximumDepth", capacity.maximumDepth, 0],
		[
			"maximumProjectionPrimitiveCount",
			capacity.maximumProjectionPrimitiveCount,
			1,
		],
		["maximumWorkItemCount", capacity.maximumWorkItemCount, 1],
	] as const) {
		if (!Number.isSafeInteger(value) || value < minimum) {
			throw new Error(
				`Portal culler ${name} must be an integer at least ${minimum}.`,
			);
		}
	}
	if (capacity.maximumDepth > 0xffff) {
		throw new Error("Portal culler maximumDepth exceeds Uint16 storage.");
	}
	const requiredWindowCount = Math.max(
		1,
		capacity.maximumWorkItemCount * 2 - 2,
	);
	if (capacity.windowArena.maximumWindowCount < requiredWindowCount) {
		throw new Error(
			`Portal window arena requires at least ${requiredWindowCount} windows for the work-item budget.`,
		);
	}
}

function validateCullInput(input: PortalScopeWindowCullInput): void {
	const { height, width } = input.portalFootprint.drawingBuffer;
	if (
		!Number.isInteger(width) ||
		width <= 0 ||
		!Number.isInteger(height) ||
		height <= 0
	) {
		throw new Error(
			"Portal culler drawing buffer must have positive integer dimensions.",
		);
	}
	if (
		!Number.isFinite(input.portalFootprint.minimumPixelArea) ||
		input.portalFootprint.minimumPixelArea < 0
	) {
		throw new Error(
			"Portal culler footprint minimum must be finite and non-negative.",
		);
	}
}
