import { formatHex32 } from "../landblocks";
import type {
	PreparedAssetRecord,
	PreparedIndoorEnvCellPayload,
} from "./types";

export type StructuredInteriorMembershipPolicy =
	| { kind: "direct"; envCellIds: number[] }
	| { kind: "visible-cell-closure"; seedEnvCellIds: number[] };

export interface StructuredInteriorCoverageOptions {
	maxEnvCells: number;
	maxVisibleCellDepth: number;
}

export interface StructuredInteriorCoverage {
	envCellIds: number[];
	truncated: boolean;
}

export function createDefaultStructuredInteriorCoverageOptions(): StructuredInteriorCoverageOptions {
	return {
		maxEnvCells: 1024,
		maxVisibleCellDepth: 16,
	};
}

export function deriveStructuredInteriorCoverage(
	policy: StructuredInteriorMembershipPolicy,
	preparedByAssetId: Record<string, PreparedAssetRecord>,
	options: StructuredInteriorCoverageOptions,
): StructuredInteriorCoverage {
	const { maxEnvCells, maxVisibleCellDepth } = options;
	if (maxEnvCells < 1) {
		throw new Error("Structured interior coverage requires maxEnvCells >= 1.");
	}
	if (maxVisibleCellDepth < 0) {
		throw new Error(
			"Structured interior coverage requires maxVisibleCellDepth >= 0.",
		);
	}

	if (policy.kind === "direct") {
		const envCellIds = uniqueSorted(policy.envCellIds);
		return {
			envCellIds: envCellIds.slice(0, maxEnvCells),
			truncated: envCellIds.length > maxEnvCells,
		};
	}

	return deriveVisibleCellClosureCoverage(
		policy.seedEnvCellIds,
		preparedByAssetId,
		maxEnvCells,
		maxVisibleCellDepth,
	);
}

export function formatIndoorEnvCellAssetId(envCellId: number): string {
	return `indoor-env-cell/${formatHex32(envCellId)}`;
}

export function formatEnvironmentAssetId(environmentId: number): string {
	return `environment/${formatHex32(environmentId)}`;
}

export function isPreparedIndoorEnvCellAsset(
	asset: PreparedAssetRecord | undefined,
): asset is PreparedAssetRecord & { payload: PreparedIndoorEnvCellPayload } {
	return asset?.payload.kind === "indoor-env-cell";
}

function deriveVisibleCellClosureCoverage(
	seedEnvCellIds: number[],
	preparedByAssetId: Record<string, PreparedAssetRecord>,
	maxEnvCells: number,
	maxVisibleCellDepth: number,
): StructuredInteriorCoverage {
	const envCellIds = new Set<number>();
	const visitedEnvCellIds = new Set<number>();
	const seedQueueEntries = uniqueSorted(seedEnvCellIds).map((envCellId) => ({
		envCellId,
		depth: 0,
	}));
	const queue = seedQueueEntries.slice(0, maxEnvCells);
	let truncated = seedQueueEntries.length > maxEnvCells;

	for (const entry of queue) {
		envCellIds.add(entry.envCellId);
	}

	for (let index = 0; index < queue.length; index += 1) {
		const { envCellId, depth } = queue[index];
		if (visitedEnvCellIds.has(envCellId)) {
			continue;
		}
		visitedEnvCellIds.add(envCellId);

		const asset = preparedByAssetId[formatIndoorEnvCellAssetId(envCellId)];
		if (!isPreparedIndoorEnvCellAsset(asset)) {
			continue;
		}

		for (const visibleCellId of uniqueSorted(asset.payload.visibleCellIds)) {
			if (envCellIds.has(visibleCellId)) {
				continue;
			}
			if (depth >= maxVisibleCellDepth) {
				truncated = true;
				continue;
			}
			if (envCellIds.size >= maxEnvCells) {
				truncated = true;
				continue;
			}

			envCellIds.add(visibleCellId);
			queue.push({
				envCellId: visibleCellId,
				depth: depth + 1,
			});
		}
	}

	return {
		envCellIds: [...envCellIds].sort((left, right) => left - right),
		truncated,
	};
}

function uniqueSorted(values: number[]): number[] {
	return [...new Set(values)].sort((left, right) => left - right);
}
