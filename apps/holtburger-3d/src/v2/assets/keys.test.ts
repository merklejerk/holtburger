import { describe, expect, it } from "vitest";
import {
	createHostAssetKey,
	createRawHostAssetKey,
	describeHostAssetKey,
	formatHostAssetId,
	parseHostAssetId,
} from "./keys";

describe("V2 host asset keys", () => {
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
		expect(parseHostAssetId("landblock/da55ffff/topology")).toEqual({
			id: "da55ffff",
			kind: "landblock-topology",
		});
		expect(formatHostAssetId(createHostAssetKey("terrain-material", 3))).toBe(
			"terrain-material/3",
		);
	});

	it("preserves unknown routes as raw keys", () => {
		const key = createRawHostAssetKey("experimental/shape");

		expect(formatHostAssetId(key)).toBe("experimental/shape");
		expect(parseHostAssetId("experimental/shape")).toEqual(key);
	});
});
