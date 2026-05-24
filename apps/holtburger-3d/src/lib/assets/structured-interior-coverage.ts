import { formatLandblockTopologyAssetId } from "../landblocks";
import type { PreparedAssetRecord } from "./types";

export type StructuredInteriorMembershipPolicy =
	| { kind: "direct"; envCellIds: number[] }
	| { kind: "landblock-closure"; seedEnvCellIds: number[] };

export interface StructuredInteriorCoverage {
	envCellIds: number[];
	truncated: boolean;
}

export function deriveStructuredInteriorCoverage(
	policy: StructuredInteriorMembershipPolicy,
	preparedByAssetId: Record<string, PreparedAssetRecord>,
): StructuredInteriorCoverage {
	if (policy.kind === "direct") {
		return {
			envCellIds: uniqueSorted(policy.envCellIds),
			truncated: false,
		};
	}

	return deriveLandblockClosureCoverage(
		policy.seedEnvCellIds,
		preparedByAssetId,
	);
}

export function deriveBrowserFocusedStructuredInteriorMembershipPolicy(
	focusEnvCellId: number,
): StructuredInteriorMembershipPolicy {
	return {
		kind: "landblock-closure",
		seedEnvCellIds: [focusEnvCellId],
	};
}

function deriveLandblockClosureCoverage(
	seedEnvCellIds: number[],
	preparedByAssetId: Record<string, PreparedAssetRecord>,
): StructuredInteriorCoverage {
	const envCellIds = new Set<number>();
	for (const seedEnvCellId of uniqueSorted(seedEnvCellIds)) {
		envCellIds.add(seedEnvCellId);

		const topologyAsset =
			preparedByAssetId[formatLandblockTopologyAssetId(seedEnvCellId)];
		if (topologyAsset?.payload.kind === "landblock-topology") {
			for (const cell of topologyAsset.payload.envCells) {
				envCellIds.add(cell.envCellId);
			}
			continue;
		}
	}

	return {
		envCellIds: [...envCellIds].sort((left, right) => left - right),
		truncated: false,
	};
}

function uniqueSorted(values: number[]): number[] {
	return [...new Set(values)].sort((left, right) => left - right);
}
