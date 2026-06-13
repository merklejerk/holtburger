import { describe, expect, it } from "vitest";

import {
	collectEnvCellMaterialAssetIds,
	collectEnvCellRenderableSourceAssetIds,
	collectLandblockOutdoorRenderableSourceAssetIds,
	collectLandblockOutdoorRenderableSourceAssetIdsForDomain,
} from "./structured-asset-dependencies";

describe("structured asset dependency derivation", () => {
	it("derives outdoor static source roots from member facts", () => {
		const payload = {
			statics: [
				createOutdoorMember("building", "setup-model/02000010"),
				createOutdoorMember("generated-scenery", "setup-model/02000020"),
				createOutdoorMember("explicit-object", "gfx-obj/01000030"),
				createOutdoorMember("building", "setup-model/02000010"),
			],
		};

		expect(collectLandblockOutdoorRenderableSourceAssetIds(payload)).toEqual([
			"gfx-obj/01000030",
			"setup-model/02000010",
			"setup-model/02000020",
		]);
		expect(
			collectLandblockOutdoorRenderableSourceAssetIdsForDomain(
				payload,
				"outdoor-buildings",
			),
		).toEqual(["setup-model/02000010"]);
		expect(
			collectLandblockOutdoorRenderableSourceAssetIdsForDomain(
				payload,
				"outdoor-detail",
			),
		).toEqual(["gfx-obj/01000030", "setup-model/02000020"]);
	});

	it("derives env-cell static and material roots from member facts", () => {
		const payload = {
			statics: [
				{ sourceAssetId: "setup-model/02000020" },
				{ sourceAssetId: "setup-model/02000020" },
				{ sourceAssetId: "gfx-obj/01000030" },
			],
			surfaces: [
				{ materialAssetId: "material/08000020" },
				{ materialAssetId: "material/08000010" },
				{ materialAssetId: "material/08000020" },
			],
		};

		expect(collectEnvCellRenderableSourceAssetIds(payload)).toEqual([
			"gfx-obj/01000030",
			"setup-model/02000020",
		]);
		expect(collectEnvCellMaterialAssetIds(payload)).toEqual([
			"material/08000010",
			"material/08000020",
		]);
	});
});

function createOutdoorMember(
	kind: "explicit-object" | "building" | "generated-scenery",
	sourceAssetId: string,
): {
	kind: "explicit-object" | "building" | "generated-scenery";
	sourceAssetId: string;
} {
	return { kind, sourceAssetId };
}
