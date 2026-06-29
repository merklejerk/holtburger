import { describe, expect, it } from "vitest";
import {
	createHostAssetKey,
	createRawHostAssetKey,
	describeHostAssetKey,
	formatHostAssetId,
	parseHostAssetId,
} from "./keys";

describe("host asset keys", () => {
	it("formats typed landblock keys through existing host routes", () => {
		const key = createHostAssetKey("landblock-outdoor", 0xda550123);

		expect(key).toEqual({
			id: "da55ffff",
			kind: "landblock-outdoor",
		});
		expect(describeHostAssetKey(key)).toBe("landblock-outdoor:da55ffff");
		expect(formatHostAssetId(key)).toBe("landblock/da55ffff/outdoor");
	});

	it("round-trips known host route ids without exposing legacy route strings as the key", () => {
		expect(parseHostAssetId("env-cell/da550100")).toEqual({
			id: "da550100",
			kind: "env-cell",
		});
		expect(parseHostAssetId("landblock/da55ffff/env-cells")).toEqual({
			id: "da55ffff",
			kind: "landblock-env-cells",
		});
		expect(
			formatHostAssetId(createHostAssetKey("landblock-env-cells", 0xda550123)),
		).toBe("landblock/da55ffff/env-cells");
		expect(formatHostAssetId(createHostAssetKey("terrain-material", 3))).toBe(
			"terrain-material/3",
		);
		expect(parseHostAssetId("animation/0300061b")).toEqual({
			id: "0300061b",
			kind: "animation",
		});
		expect(formatHostAssetId(createHostAssetKey("animation", 0x0300061b))).toBe(
			"animation/0300061b",
		);
	});

	it("preserves unknown routes as raw keys", () => {
		const key = createRawHostAssetKey("experimental/shape");

		expect(formatHostAssetId(key)).toBe("experimental/shape");
		expect(parseHostAssetId("experimental/shape")).toEqual(key);
	});

	it("round-trips setup appearance query routes as typed keys", () => {
		const key = createHostAssetKey(
			"setup-appearance",
			"020003e5?palette=0400007e&sub=0:192:040004a0",
		);

		expect(describeHostAssetKey(key)).toBe(
			"setup-appearance:020003e5?palette=0400007e&sub=0:192:040004a0",
		);
		expect(formatHostAssetId(key)).toBe(
			"setup-appearance/020003e5?palette=0400007e&sub=0:192:040004a0",
		);
		expect(
			parseHostAssetId(
				"setup-appearance/020003e5?palette=0400007e&sub=0:192:040004a0",
			),
		).toEqual(key);
	});
});
