import { describe, expect, it } from "vitest";
import type { DatAssetId } from "../game-types";
import { mergeAssetTextureFacts } from "./texture-facts";
import {
	type AssetTextureFact,
	createAssetTextureKey,
	TexturePurpose,
} from "./types";

describe("mergeAssetTextureFacts", () => {
	it("deduplicates compatible facts in stable key order", () => {
		const second = fact("0x00000002");
		const first = fact("0x00000001");

		expect(mergeAssetTextureFacts([second, first, second], "Fixture")).toEqual([
			first,
			second,
		]);
	});

	it("rejects one logical key with incompatible source semantics", () => {
		const first = fact("0x00000001");
		expect(() =>
			mergeAssetTextureFacts(
				[first, { ...first, sourceAssetId: "0x00000002" as DatAssetId }],
				"Fixture",
			),
		).toThrow("incompatible requirements");
	});
});

function fact(sourceId: string): AssetTextureFact {
	const sourceAssetId = sourceId as DatAssetId;
	return {
		kind: "asset",
		key: createAssetTextureKey(TexturePurpose.ObjectDirectColor, sourceAssetId),
		purpose: TexturePurpose.ObjectDirectColor,
		sourceAssetId,
	};
}
