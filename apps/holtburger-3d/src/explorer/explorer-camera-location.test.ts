import { describe, expect, it } from "vitest";
import { formatExplorerCameraResidency } from "./explorer-camera-location";

describe("Explorer camera location", () => {
	it("distinguishes resident environment cells from outdoor residency", () => {
		expect(
			formatExplorerCameraResidency({
				kind: "resolved",
				residency: {
					envCellId: "0xda550123",
					landblockId: "0xda55ffff",
				},
				source: "cell-containment",
			}),
		).toBe("0xda550123");
		expect(
			formatExplorerCameraResidency({
				kind: "resolved",
				residency: {
					envCellId: null,
					landblockId: "0xda55ffff",
				},
				source: "outdoor",
			}),
		).toBe("Outdoor 0xda55ffff");
	});
});
