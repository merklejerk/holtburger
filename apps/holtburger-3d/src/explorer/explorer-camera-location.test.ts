import { describe, expect, it } from "vitest";
import { Vec3 } from "../lib/game/math/types";
import {
	formatExplorerCameraResidency,
	formatExplorerOutdoorCoordinates,
} from "./explorer-camera-location";

describe("Explorer camera location", () => {
	it("formats canonical scene coordinates in AC map notation", () => {
		expect(formatExplorerOutdoorCoordinates(new Vec3(41_940, 0, -16_428))).toBe(
			"33.5S, 72.8E",
		);
		expect(formatExplorerOutdoorCoordinates(new Vec3(24_720, 0, -27_120))).toBe(
			"11.0N, 1.0E",
		);
	});

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
