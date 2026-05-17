import type {
	PreparedAssetKind,
	PreparedAssetKindCounts,
	PreparedAssetRecord,
} from "./types";

export function countPreparedAssetsByKind(
	preparedByAssetId: Record<string, PreparedAssetRecord>,
): PreparedAssetKindCounts {
	const byKind: Partial<Record<PreparedAssetKind, number>> = {};
	let total = 0;

	for (const asset of Object.values(preparedByAssetId)) {
		total += 1;
		byKind[asset.payload.kind] = (byKind[asset.payload.kind] ?? 0) + 1;
	}

	return { total, byKind };
}

export function formatPreparedAssetKindCounts(
	counts: PreparedAssetKindCounts,
): string {
	const entries = Object.entries(counts.byKind)
		.filter(([, count]) => count !== undefined && count > 0)
		.sort(([left], [right]) => left.localeCompare(right));

	if (entries.length === 0) {
		return "none";
	}

	return entries.map(([kind, count]) => `${kind} ${count}`).join(", ");
}
