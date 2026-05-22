import type { TransitionPortalRenderLevel } from "./render-policy";
import type { TransitionPortalGraphDirection } from "./render-passes";
import type {
	TransitionPortalDirection,
	TransitionPortalScene,
} from "./transition-portal-work-items";

export type TransitionPortalDepthBatchKey =
	`${TransitionPortalGraphDirection}:${number}`;

export interface TransitionPortalDepthCandidate {
	direction: TransitionPortalDirection;
	entryEnvCellId: number;
	requestedInteriorEnvCellIds: readonly number[];
}

export interface TransitionPortalVisiblePools<
	T extends TransitionPortalDepthCandidate,
> {
	outdoorToIndoor: T[];
	indoorToOutdoor: T[];
}

export interface TransitionPortalDepthBatchModel<
	T extends TransitionPortalDepthCandidate,
> {
	batches: Map<TransitionPortalDepthBatchKey, T[]>;
	maskedInteriorCellIds: Set<number>;
}

export function deriveTransitionPortalDepthBatches<
	T extends TransitionPortalDepthCandidate,
>(options: {
	levels: readonly TransitionPortalRenderLevel[];
	baseScene: TransitionPortalScene;
	initialEnvCellId: number | null;
	visiblePools: TransitionPortalVisiblePools<T>;
}): TransitionPortalDepthBatchModel<T> {
	const batches = new Map<TransitionPortalDepthBatchKey, T[]>();
	const maskedInteriorCellIds = new Set<number>();
	let interiorFrontier =
		options.baseScene === "interior" && options.initialEnvCellId !== null
			? new Set([options.initialEnvCellId])
			: null;

	for (const level of options.levels) {
		const pool = visiblePoolForDirection(options.visiblePools, level.direction);
		const batch =
			level.direction === "indoor-to-outdoor"
				? filterIndoorToOutdoorCandidates(pool, interiorFrontier)
				: [...pool];
		if (batch.length === 0) {
			break;
		}

		batches.set(transitionPortalDepthBatchKey(level), batch);
		if (level.direction === "outdoor-to-indoor") {
			interiorFrontier = collectReachedInteriorCells(batch);
		}

		for (const candidate of batch) {
			for (const envCellId of candidate.requestedInteriorEnvCellIds) {
				maskedInteriorCellIds.add(envCellId);
			}
		}
	}

	return { batches, maskedInteriorCellIds };
}

export function transitionPortalDepthBatchKey(
	level: Pick<TransitionPortalRenderLevel, "direction" | "recursionDepth">,
): TransitionPortalDepthBatchKey {
	return `${level.direction}:${level.recursionDepth}`;
}

function visiblePoolForDirection<T extends TransitionPortalDepthCandidate>(
	pools: TransitionPortalVisiblePools<T>,
	direction: TransitionPortalGraphDirection,
): readonly T[] {
	return direction === "outdoor-to-indoor"
		? pools.outdoorToIndoor
		: pools.indoorToOutdoor;
}

function filterIndoorToOutdoorCandidates<
	T extends TransitionPortalDepthCandidate,
>(pool: readonly T[], interiorFrontier: ReadonlySet<number> | null): T[] {
	if (interiorFrontier === null) {
		return [...pool];
	}

	return pool.filter((candidate) =>
		candidateTouchesInteriorFrontier(candidate, interiorFrontier),
	);
}

function collectReachedInteriorCells<T extends TransitionPortalDepthCandidate>(
	candidates: readonly T[],
): Set<number> {
	const reached = new Set<number>();
	for (const candidate of candidates) {
		reached.add(candidate.entryEnvCellId);
		for (const envCellId of candidate.requestedInteriorEnvCellIds) {
			reached.add(envCellId);
		}
	}
	return reached;
}

function candidateTouchesInteriorFrontier(
	candidate: TransitionPortalDepthCandidate,
	interiorFrontier: ReadonlySet<number>,
): boolean {
	if (interiorFrontier.has(candidate.entryEnvCellId)) {
		return true;
	}

	return candidate.requestedInteriorEnvCellIds.some((envCellId) =>
		interiorFrontier.has(envCellId),
	);
}
