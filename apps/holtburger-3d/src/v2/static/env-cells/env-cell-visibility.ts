import type {
	EnvCellVisibilityDiagnostic,
	EnvCellVisibilitySelection,
	LandblockEnvCellsStaticScopePayload,
	LandblockEnvCellStaticFacts,
} from "../contracts";

export interface EnvCellVisibilitySelectionOptions {
	readonly focusEnvCellId: number;
	readonly maxDepth?: number;
	readonly includeFocus?: boolean;
}

export function selectVisibleEnvCells(
	bundle: Pick<LandblockEnvCellsStaticScopePayload, "envCells" | "portalLinks">,
	options: EnvCellVisibilitySelectionOptions,
): EnvCellVisibilitySelection {
	const maxDepth = normalizeMaxDepth(options.maxDepth);
	const includeFocus = options.includeFocus ?? true;
	const cellById = new Map(
		bundle.envCells.map((cell) => [cell.identity.envCellId, cell]),
	);
	const focus = cellById.get(options.focusEnvCellId);
	if (!focus) {
		return {
			acceptedEnvCellIds: [],
			diagnostics: [
				{ envCellId: options.focusEnvCellId, kind: "missing-focus-cell" },
			],
		};
	}

	const accepted = new Set<number>();
	const visited = new Set<number>();
	const diagnostics: EnvCellVisibilityDiagnostic[] = [];
	const queue: QueuedEnvCell[] = [{ cell: focus, depth: 0 }];

	if (includeFocus) {
		accepted.add(focus.identity.envCellId);
	}

	while (queue.length > 0) {
		const queued = queue.shift();
		if (!queued) {
			break;
		}
		if (visited.has(queued.cell.identity.envCellId)) {
			continue;
		}
		visited.add(queued.cell.identity.envCellId);

		for (const targetEnvCellId of collectVisibleTargetIds(bundle, queued.cell)) {
			const target = cellById.get(targetEnvCellId);
			if (!target) {
				diagnostics.push({
					kind: "missing-visible-cell",
					sourceEnvCellId: queued.cell.identity.envCellId,
					targetEnvCellId,
				});
				continue;
			}

			if (queued.depth >= maxDepth) {
				if (!accepted.has(targetEnvCellId)) {
					diagnostics.push({
						kind: "traversal-cutoff",
						maxDepth,
						sourceEnvCellId: queued.cell.identity.envCellId,
						targetEnvCellId,
					});
				}
				continue;
			}

			accepted.add(targetEnvCellId);
			if (!visited.has(targetEnvCellId)) {
				queue.push({ cell: target, depth: queued.depth + 1 });
			}
		}
	}

	return {
		acceptedEnvCellIds: [...accepted].sort(compareNumeric),
		diagnostics,
	};
}

function collectVisibleTargetIds(
	bundle: Pick<LandblockEnvCellsStaticScopePayload, "portalLinks">,
	cell: LandblockEnvCellStaticFacts,
): readonly number[] {
	const targets = new Set<number>(cell.visibleEnvCellIds);
	for (const link of bundle.portalLinks) {
		const linkedEnvCellId = findLinkedEnvCellId(link, cell.identity.envCellId);
		if (linkedEnvCellId !== null) {
			targets.add(linkedEnvCellId);
		}
	}

	return [...targets].sort(compareNumeric);
}

function findLinkedEnvCellId(
	link: LandblockEnvCellsStaticScopePayload["portalLinks"][number],
	envCellId: number,
): number | null {
	if (
		link.source.kind === "env-cell" &&
		link.target.kind === "env-cell" &&
		link.source.envCellId === envCellId
	) {
		return link.target.envCellId;
	}

	if (
		link.source.kind === "env-cell" &&
		link.target.kind === "env-cell" &&
		link.target.envCellId === envCellId
	) {
		return link.source.envCellId;
	}

	return null;
}

function normalizeMaxDepth(maxDepth: number | undefined): number {
	if (maxDepth === undefined) {
		return 1;
	}
	if (!Number.isFinite(maxDepth)) {
		return 0;
	}

	return Math.max(0, Math.trunc(maxDepth));
}

function compareNumeric(left: number, right: number): number {
	return left - right;
}

interface QueuedEnvCell {
	readonly cell: LandblockEnvCellStaticFacts;
	readonly depth: number;
}
