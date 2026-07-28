import type { LandblockId } from "../game-types";
import {
	createLandblockWorldOrigin,
	landblockAtWorldPoint,
} from "../landblocks";
import { Vec3 } from "../math/types";
import type {
	PortalCrossingId,
	ScenePortalCrossingInput,
	SceneResidency,
	SceneScope,
} from ".";
import {
	findEarliestDirectedApertureHits,
	type DirectedApertureCandidate,
} from "./directed-aperture-query";
import { PORTAL_QUERY_EPSILON } from "./planar-aperture";
import { sameScope, scopeFor, scopeKey } from "./scope";

/** Caller-supplied authoritative actor anchor and desired camera endpoint. */
export interface ScenePortalTraceQuery {
	readonly anchor: {
		readonly position: Vec3;
		readonly residency: SceneResidency;
	};
	readonly endpoint: Vec3;
}

/** One topology-derived crossing retained for diagnostics and future camera policy. */
interface ScenePortalTraceStep {
	readonly crossingId: PortalCrossingId;
	readonly point: Vec3;
	readonly source: SceneScope;
	readonly t: number;
	readonly target: SceneScope;
}

/** Directed authoritative-anchor trace result with an explicit safe fallback on uncertainty. */
export type ScenePortalTraceResult =
	| {
			readonly kind: "complete";
			readonly crossings: readonly ScenePortalTraceStep[];
			readonly residency: SceneResidency;
	  }
	| {
			readonly kind: "topology-unavailable";
			readonly blockingIds: readonly string[];
			readonly crossings: readonly ScenePortalTraceStep[];
			/** Authoritative anchor residency callers must preserve on incomplete traces. */
			readonly fallbackResidency: SceneResidency;
			/** Last topology-proven scope, retained only for diagnostics. */
			readonly reachedResidency: SceneResidency;
			readonly reason:
				| "ambiguous-boundary"
				| "crossing-limit"
				| "origin-scope-unavailable"
				| "outside-world"
				| "target-scope-unavailable"
				| "unclaimed-exterior-endpoint";
	  };

/** Finite aperture that blocks traversal because no authored reverse transition was claimed. */
export interface SceneUnavailablePortalBoundary {
	readonly acceptedSide: "positive" | "negative";
	readonly aperture: ScenePortalCrossingInput["sourceAperture"];
	readonly id: string;
	readonly source: SceneScope;
}

/** Read-only topology adapter used by the stateless repeated segment trace. */
export interface ScenePortalTraceTopology {
	readonly maximumCrossingCount: number;
	readonly isScopeAvailable: (scope: SceneScope) => boolean;
	readonly outgoing: (scope: SceneScope) => readonly ScenePortalCrossingInput[];
	readonly unavailableBoundaries: (
		scope: SceneScope,
	) => readonly SceneUnavailablePortalBoundary[];
}

/** Repeatedly trace one fixed world segment through source-scope outgoing apertures. */
export function traceScenePortalSegment(
	query: ScenePortalTraceQuery,
	topology: ScenePortalTraceTopology,
): ScenePortalTraceResult {
	const anchorResidency = copyResidency(query.anchor.residency);
	let currentResidency = copyResidency(anchorResidency);
	let currentScope = scopeFor(
		currentResidency.landblockId,
		currentResidency.envCellId,
	);
	const history: ScenePortalTraceStep[] = [];
	if (!topology.isScopeAvailable(currentScope)) {
		return unavailable(
			"origin-scope-unavailable",
			[],
			history,
			anchorResidency,
			currentResidency,
		);
	}
	const segmentLength = Math.sqrt(
		query.anchor.position.distanceSquaredTo(query.endpoint),
	);
	if (!Number.isFinite(segmentLength)) {
		throw new Error("Portal trace contains a non-finite segment.");
	}
	if (segmentLength === 0) {
		return {
			crossings: history,
			kind: "complete",
			residency: currentResidency,
		};
	}

	let cursor = 0;
	let previousCrossing: ScenePortalCrossingInput | null = null;
	while (cursor < 1) {
		const cursorPoint = pointAt(query.anchor.position, query.endpoint, cursor);
		const candidates: DirectedApertureCandidate<TraceCandidate>[] = [];
		for (const crossing of topology.outgoing(currentScope)) {
			if (
				previousCrossing !== null &&
				(crossing.id === previousCrossing.reciprocalCrossingId ||
					crossing.sourceAperture.id === previousCrossing.sourceAperture.id)
			) {
				continue;
			}
			candidates.push(
				directedCandidate(
					cursorPoint,
					query.endpoint,
					crossing.sourceAperture.landblockId,
					crossing.id,
					crossing.acceptedSide,
					crossing.sourceAperture,
					{ crossing, kind: "crossing" },
				),
			);
		}
		for (const boundary of topology.unavailableBoundaries(currentScope)) {
			candidates.push(
				directedCandidate(
					cursorPoint,
					query.endpoint,
					boundary.aperture.landblockId,
					boundary.id,
					boundary.acceptedSide,
					boundary.aperture,
					{ boundary, kind: "unavailable-boundary" },
				),
			);
		}
		const hits = findEarliestDirectedApertureHits(candidates);
		if (hits.length === 0) {
			return completeAtEndpoint(
				query.endpoint,
				currentScope,
				currentResidency,
				history,
				anchorResidency,
			);
		}
		const blockingHits = hits.filter(
			({ value }) => value.kind === "unavailable-boundary",
		);
		if (blockingHits.length > 0) {
			return unavailable(
				"unclaimed-exterior-endpoint",
				blockingHits.map(({ id }) => id),
				history,
				anchorResidency,
				currentResidency,
			);
		}
		const crossingHits = hits.flatMap((hit) =>
			hit.value.kind === "crossing"
				? [{ ...hit, crossing: hit.value.crossing }]
				: [],
		);
		const targetScopes = new Set(
			crossingHits.map(({ crossing }) => scopeKey(crossing.target)),
		);
		if (targetScopes.size !== 1) {
			return unavailable(
				"ambiguous-boundary",
				crossingHits.map(({ id }) => id),
				history,
				anchorResidency,
				currentResidency,
			);
		}
		if (history.length >= topology.maximumCrossingCount) {
			return unavailable(
				"crossing-limit",
				crossingHits.map(({ id }) => id),
				history,
				anchorResidency,
				currentResidency,
			);
		}
		const selected = crossingHits[0]!;
		if (!sameScope(selected.crossing.source, currentScope)) {
			throw new Error(
				`Portal trace received non-outgoing crossing ${selected.crossing.id}.`,
			);
		}
		if (!topology.isScopeAvailable(selected.crossing.target)) {
			return unavailable(
				"target-scope-unavailable",
				[selected.crossing.id],
				history,
				anchorResidency,
				currentResidency,
			);
		}
		const globalT = cursor + (1 - cursor) * selected.t;
		const worldPoint = pointAt(query.anchor.position, query.endpoint, globalT);
		history.push({
			crossingId: selected.crossing.id,
			point: worldPoint,
			source: copyScope(selected.crossing.source),
			t: globalT,
			target: copyScope(selected.crossing.target),
		});
		currentScope = selected.crossing.target;
		currentResidency = crossingTargetResidency(selected.crossing);
		previousCrossing = selected.crossing;
		cursor = Math.min(1, globalT + PORTAL_QUERY_EPSILON / segmentLength);
	}
	return completeAtEndpoint(
		query.endpoint,
		currentScope,
		currentResidency,
		history,
		anchorResidency,
	);
}

type TraceCandidate =
	| {
			readonly crossing: ScenePortalCrossingInput;
			readonly kind: "crossing";
	  }
	| {
			readonly boundary: SceneUnavailablePortalBoundary;
			readonly kind: "unavailable-boundary";
	  };

function directedCandidate(
	start: Vec3,
	end: Vec3,
	landblockId: LandblockId,
	id: string,
	acceptedSide: "positive" | "negative",
	aperture: ScenePortalCrossingInput["sourceAperture"],
	value: TraceCandidate,
): DirectedApertureCandidate<TraceCandidate> {
	return {
		acceptedSide,
		aperture,
		end: worldToLandblock(end, landblockId),
		id,
		start: worldToLandblock(start, landblockId),
		value,
	};
}

function completeAtEndpoint(
	endpoint: Vec3,
	scope: SceneScope,
	currentResidency: SceneResidency,
	history: readonly ScenePortalTraceStep[],
	anchorResidency: SceneResidency,
): ScenePortalTraceResult {
	if (scope.kind === "env-cell") {
		return {
			crossings: history,
			kind: "complete",
			residency: copyResidency(currentResidency),
		};
	}
	const landblockId = landblockAtWorldPoint(endpoint);
	if (landblockId === null) {
		return unavailable(
			"outside-world",
			[],
			history,
			anchorResidency,
			currentResidency,
		);
	}
	return {
		crossings: history,
		kind: "complete",
		residency: { envCellId: null, landblockId },
	};
}

function crossingTargetResidency(
	crossing: ScenePortalCrossingInput,
): SceneResidency {
	if (crossing.target.kind === "env-cell") {
		return {
			envCellId: crossing.target.envCellId,
			landblockId: crossing.target.landblockId,
		};
	}
	if (crossing.spatialRelationship.kind !== "exterior-transition") {
		throw new Error(
			`Portal crossing ${crossing.id} reaches outdoor without an exterior claim.`,
		);
	}
	return {
		envCellId: null,
		landblockId: crossing.spatialRelationship.exteriorLandblockId,
	};
}

function unavailable(
	reason: Extract<
		ScenePortalTraceResult,
		{ readonly kind: "topology-unavailable" }
	>["reason"],
	blockingIds: readonly string[],
	crossings: readonly ScenePortalTraceStep[],
	fallbackResidency: SceneResidency,
	reachedResidency: SceneResidency,
): ScenePortalTraceResult {
	return {
		blockingIds: [...blockingIds].sort(),
		crossings,
		fallbackResidency: copyResidency(fallbackResidency),
		kind: "topology-unavailable",
		reachedResidency: copyResidency(reachedResidency),
		reason,
	};
}

function pointAt(start: Vec3, end: Vec3, t: number): Vec3 {
	return new Vec3(
		start.x + (end.x - start.x) * t,
		start.y + (end.y - start.y) * t,
		start.z + (end.z - start.z) * t,
	);
}

function worldToLandblock(point: Vec3, landblockId: LandblockId): Vec3 {
	const origin = createLandblockWorldOrigin(landblockId);
	return new Vec3(point.x - origin.x, point.y - origin.y, point.z - origin.z);
}

function copyResidency(residency: SceneResidency): SceneResidency {
	return { ...residency };
}

function copyScope(scope: SceneScope): SceneScope {
	return { ...scope };
}
