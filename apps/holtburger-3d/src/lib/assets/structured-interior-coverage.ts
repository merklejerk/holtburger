import { formatHex32, formatLandblockPackAssetId } from "../landblocks";
import type {
	PreparedAssetRecord,
	PreparedIndoorEnvCellPayload,
} from "./types";

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

		const packAsset =
			preparedByAssetId[formatLandblockPackAssetId(seedEnvCellId)];
		if (packAsset?.payload.kind === "landblock-pack") {
			for (const cell of packAsset.payload.prepared.interiorCells) {
				envCellIds.add(cell.envCellId);
			}
			continue;
		}

		const asset = preparedByAssetId[formatIndoorEnvCellAssetId(seedEnvCellId)];
		if (!isPreparedIndoorEnvCellAsset(asset)) {
			continue;
		}

		for (const landblockEnvCellId of asset.payload.landblockEnvCellIds) {
			envCellIds.add(landblockEnvCellId);
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
