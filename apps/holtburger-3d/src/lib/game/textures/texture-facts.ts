import type { AssetTextureFact, AssetTextureKey } from "./types";

/** Add logical texture facts while rejecting one key with incompatible source semantics. */
export function addAssetTextureFacts(
	target: Map<AssetTextureKey, AssetTextureFact>,
	facts: Iterable<AssetTextureFact>,
	context: string,
): void {
	for (const fact of facts) {
		const existing = target.get(fact.key);
		if (
			existing &&
			(existing.purpose !== fact.purpose ||
				existing.sourceAssetId !== fact.sourceAssetId)
		) {
			throw new Error(
				`${context} texture ${fact.key} has incompatible requirements.`,
			);
		}
		target.set(fact.key, fact);
	}
}

/** Return unique compatible texture facts in stable logical-key order. */
export function mergeAssetTextureFacts(
	facts: Iterable<AssetTextureFact>,
	context: string,
): readonly AssetTextureFact[] {
	const byKey = new Map<AssetTextureKey, AssetTextureFact>();
	addAssetTextureFacts(byKey, facts, context);
	return [...byKey.values()].sort((left, right) =>
		left.key.localeCompare(right.key),
	);
}
