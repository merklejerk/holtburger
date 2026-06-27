import {
	type RenderMat4,
	transformPointByMat4,
} from "../../math/ac-placement-transform";
import type { StaticEnvCellSpatialRecord } from "../../static/contracts";
import { deriveOutdoorCameraLandblockResidency } from "../static-placement";
import type { StaticSceneCameraResidency, Vec3 } from "./contracts";
import {
	boundsCenterDistanceSquared,
	containsPoint,
	negateTranslation,
	translateBounds,
	translatePoint,
	traverseBvhPoint,
} from "./geometry";
import type {
	EnvCellLandblockBvhRoot,
	EnvCellLandblockBvhRuntimeItem,
	EnvCellResidencyCandidate,
	EnvCellResidencyGraphEvidence,
} from "./static-query-state";

export interface EnvCellResidencyRootProvider {
	/** Returns the committed env-cell runtime root for a landblock, if resident. */
	envCellRoot(landblockId: number): EnvCellLandblockBvhRoot | null;
	/** Iterates all committed env-cell runtime roots currently resident. */
	envCellRoots(): Iterable<EnvCellLandblockBvhRoot>;
	/** Returns visibility-accepted env-cell ids derived from committed records. */
	getAcceptedEnvCellIds(landblockId: number): readonly number[] | null;
	/** Reports whether committed env-cell records exist for the landblock. */
	hasCommittedEnvCellRecords(landblockId: number): boolean;
}

export interface EnvCellResidencyQuerySnapshot {
	readonly envCellResidencyBspAcceptedCandidateCount: number;
	readonly envCellResidencyBspFallbackCount: number;
	readonly envCellResidencyBspTestedCandidateCount: number;
	readonly envCellResidencyCoarseCandidateCount: number;
}

/** Owns env-cell residency point tests and the debug counters they update. */
export class EnvCellResidencyQuery {
	#bspAcceptedCandidateCount = 0;
	#bspFallbackCount = 0;
	#bspTestedCandidateCount = 0;
	#coarseCandidateCount = 0;

	clear(): void {
		this.#bspAcceptedCandidateCount = 0;
		this.#bspFallbackCount = 0;
		this.#bspTestedCandidateCount = 0;
		this.#coarseCandidateCount = 0;
	}

	queryCameraResidencyAtLandblockPoint(
		provider: EnvCellResidencyRootProvider,
		options: {
			readonly landblockId: number;
			readonly point: Vec3;
		},
	): StaticSceneCameraResidency {
		const landblockId = options.landblockId >>> 0;
		if (provider.hasCommittedEnvCellRecords(landblockId)) {
			const envCellId = this.queryEnvCellAtPoint(provider, {
				acceptedEnvCellIds:
					provider.getAcceptedEnvCellIds(landblockId) ?? undefined,
				landblockId,
				point: options.point,
			});
			if (envCellId !== null) {
				return {
					envCellId,
					kind: "env-cell",
					landblockId,
				};
			}
		}

		return {
			kind: "unknown",
			landblockId,
		};
	}

	queryCameraResidencyAtPoint(
		provider: EnvCellResidencyRootProvider,
		options: {
			readonly outdoorAnchorLandblockId: number;
			readonly point: Vec3;
		},
	): StaticSceneCameraResidency {
		const envCellResidency = this.#queryEnvCellResidencyFromRenderSpacePoint(
			provider,
			options.point,
		);
		if (envCellResidency) {
			return envCellResidency;
		}

		const outdoorResidency = deriveOutdoorCameraLandblockResidency({
			anchorLandblockId: options.outdoorAnchorLandblockId,
			cameraPosition: [options.point.x, options.point.y, options.point.z],
		});
		if (!outdoorResidency) {
			return {
				kind: "unknown",
				landblockId: null,
			};
		}

		const landblockId = outdoorResidency.landblockId;
		if (provider.hasCommittedEnvCellRecords(landblockId)) {
			const envCellId = this.queryEnvCellAtPoint(provider, {
				acceptedEnvCellIds:
					provider.getAcceptedEnvCellIds(landblockId) ?? undefined,
				landblockId,
				point: {
					x: outdoorResidency.localCameraPosition[0],
					y: outdoorResidency.localCameraPosition[1],
					z: outdoorResidency.localCameraPosition[2],
				},
			});
			if (envCellId !== null) {
				return {
					envCellId,
					kind: "env-cell",
					landblockId,
				};
			}
		}

		return {
			kind: "outdoor-landblock",
			landblockId,
		};
	}

	queryEnvCellAtPoint(
		provider: EnvCellResidencyRootProvider,
		options: {
			readonly acceptedEnvCellIds?: readonly number[];
			readonly landblockId: number;
			readonly point: Vec3;
		},
	): number | null {
		const root = provider.envCellRoot(options.landblockId);
		if (!root) {
			return null;
		}

		const acceptedEnvCellIds = createAcceptedEnvCellSet(
			options.acceptedEnvCellIds ?? root.acceptedEnvCellIds,
		);
		const candidates = traverseBvhPoint(root.nodes, options.point)
			.flatMap((candidate) =>
				candidate.itemIndices.map((itemIndex) => ({
					item: root.items[itemIndex],
					nodeIndex: candidate.nodeIndex,
				})),
			)
			.filter(
				(candidate): candidate is EnvCellResidencyCandidate =>
					candidate.item !== null &&
					containsPoint(candidate.item.bounds, options.point) &&
					isAcceptedEnvCellId(acceptedEnvCellIds, candidate.item.envCellId),
			);

		this.#coarseCandidateCount += candidates.length;
		if (candidates.length === 0) {
			return null;
		}

		const bspCandidates = candidates.filter((candidate) =>
			pointInsideEnvCellResidencyBsp(candidate.item, options.point),
		);
		this.#bspTestedCandidateCount += candidates.length;
		this.#bspAcceptedCandidateCount += bspCandidates.length;
		if (bspCandidates.length > 0) {
			return (
				selectEnvCellResidencyCandidate(bspCandidates, options.point)?.item
					.envCellId ?? null
			);
		}

		this.#bspFallbackCount += 1;
		return null;
	}

	snapshot(): EnvCellResidencyQuerySnapshot {
		return {
			envCellResidencyBspAcceptedCandidateCount:
				this.#bspAcceptedCandidateCount,
			envCellResidencyBspFallbackCount: this.#bspFallbackCount,
			envCellResidencyBspTestedCandidateCount: this.#bspTestedCandidateCount,
			envCellResidencyCoarseCandidateCount: this.#coarseCandidateCount,
		};
	}

	#queryEnvCellResidencyFromRenderSpacePoint(
		provider: EnvCellResidencyRootProvider,
		renderPoint: Vec3,
	): StaticSceneCameraResidency | null {
		const candidates: {
			readonly distance: number;
			readonly envCellId: number;
			readonly landblockId: number;
		}[] = [];

		for (const root of provider.envCellRoots()) {
			const rootBounds = root.nodes[0]?.bounds;
			if (!rootBounds) {
				continue;
			}

			// Env-cell roots remain landblock-local; only the query point and
			// coarse root bounds are moved through the current render-anchor
			// translation.
			const renderBounds = translateBounds(rootBounds, root.translation);
			if (!containsPoint(renderBounds, renderPoint)) {
				continue;
			}

			const envCellId = this.queryEnvCellAtPoint(provider, {
				acceptedEnvCellIds:
					provider.getAcceptedEnvCellIds(root.landblockId) ?? undefined,
				landblockId: root.landblockId,
				point: translatePoint(renderPoint, negateTranslation(root.translation)),
			});
			if (envCellId === null) {
				continue;
			}

			candidates.push({
				distance: boundsCenterDistanceSquared(renderBounds, renderPoint),
				envCellId,
				landblockId: root.landblockId,
			});
		}

		const selected = candidates.sort(
			(left, right) =>
				compareNumbers(left.distance, right.distance) ||
				compareNumbers(left.landblockId, right.landblockId) ||
				compareNumbers(left.envCellId, right.envCellId),
		)[0];
		return selected
			? {
					envCellId: selected.envCellId,
					kind: "env-cell",
					landblockId: selected.landblockId,
				}
			: null;
	}
}

export function createAcceptedEnvCellSet(
	acceptedEnvCellIds: readonly number[],
): ReadonlySet<number> {
	return new Set(acceptedEnvCellIds);
}

export function isAcceptedEnvCellId(
	acceptedEnvCellIds: ReadonlySet<number>,
	envCellId: number,
): boolean {
	return acceptedEnvCellIds.size === 0 || acceptedEnvCellIds.has(envCellId);
}

function selectEnvCellResidencyCandidate(
	candidates: readonly EnvCellResidencyCandidate[],
	point: Vec3,
): EnvCellResidencyCandidate | null {
	let selected: EnvCellResidencyCandidate | null = null;
	for (const candidate of candidates) {
		if (
			!selected ||
			compareEnvCellResidencyCandidates(candidate, selected, point) < 0
		) {
			selected = candidate;
		}
	}
	return selected;
}

function compareEnvCellResidencyCandidates(
	left: EnvCellResidencyCandidate,
	right: EnvCellResidencyCandidate,
	point: Vec3,
): number {
	const leftDistanceSq = boundsCenterDistanceSquared(left.item.bounds, point);
	const rightDistanceSq = boundsCenterDistanceSquared(right.item.bounds, point);

	return (
		compareNumbers(
			hasEnvCellResidencyGraphSupport(right.item.graphEvidence) ? 1 : 0,
			hasEnvCellResidencyGraphSupport(left.item.graphEvidence) ? 1 : 0,
		) ||
		compareNumbers(
			right.item.graphEvidence.reciprocalEnvCellPortalRefs,
			left.item.graphEvidence.reciprocalEnvCellPortalRefs,
		) ||
		compareNumbers(
			right.item.graphEvidence.incomingEnvCellPortalRefs,
			left.item.graphEvidence.incomingEnvCellPortalRefs,
		) ||
		compareNumbers(
			right.item.graphEvidence.visibleListRefs,
			left.item.graphEvidence.visibleListRefs,
		) ||
		compareNumbers(leftDistanceSq, rightDistanceSq) ||
		compareNumbers(left.item.envCellId, right.item.envCellId) ||
		compareNumbers(left.nodeIndex, right.nodeIndex)
	);
}

function hasEnvCellResidencyGraphSupport(
	graphEvidence: EnvCellResidencyGraphEvidence,
): boolean {
	return (
		graphEvidence.reciprocalEnvCellPortalRefs > 0 ||
		graphEvidence.incomingEnvCellPortalRefs > 0 ||
		graphEvidence.visibleListRefs > 0
	);
}

function pointInsideEnvCellResidencyBsp(
	item: EnvCellLandblockBvhRuntimeItem,
	point: Vec3,
): boolean {
	const cellAcLocalPoint = landblockRenderPointToCellAcLocalPoint(
		point,
		item.inverseCellRenderMatrix,
	);
	return pointInsideCellBsp(item.cellBsp, cellAcLocalPoint);
}

function landblockRenderPointToCellAcLocalPoint(
	point: Vec3,
	inverseCellRenderMatrix: RenderMat4,
): Vec3 {
	return renderLocalPointToAcLocalPoint(
		transformPointByMat4(point, inverseCellRenderMatrix),
	);
}

function renderLocalPointToAcLocalPoint(point: Vec3): Vec3 {
	return {
		x: point.x,
		y: -point.z,
		z: point.y,
	};
}

function pointInsideCellBsp(
	node: StaticEnvCellSpatialRecord["cellBsp"],
	point: Vec3,
): boolean {
	let current: StaticEnvCellSpatialRecord["cellBsp"] | null = node;
	while (current) {
		if (current.kind === "leaf") {
			return true;
		}

		const signedDistance =
			current.plane.normal.x * point.x +
			current.plane.normal.y * point.y +
			current.plane.normal.z * point.z +
			current.plane.d;
		if (signedDistance < -CELL_BSP_PLANE_EPSILON) {
			return false;
		}

		current = current.pos;
	}

	return true;
}

function compareNumbers(left: number, right: number): number {
	return left - right;
}

const CELL_BSP_PLANE_EPSILON = 0.0002;
