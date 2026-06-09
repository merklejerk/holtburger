import { PreparedAssetStore } from "../src/lib/assets/prepared-asset-store";
import type { PreparedAssetRecord } from "../src/lib/assets/types";

export function createTestPreparedAssetResolver(
	records: readonly PreparedAssetRecord[] = [],
) {
	const store = new PreparedAssetStore();
	store.applyPreparedAssets(records);
	return store.resolver;
}
