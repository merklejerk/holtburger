import { describe, expect, it } from "vitest";
import { deriveOutdoorCameraLandblockResidency } from "./static-placement";

describe("static placement", () => {
	it("derives outdoor camera landblock residency from anchor-local position", () => {
		expect(
			deriveOutdoorCameraLandblockResidency({
				anchorLandblockId: 0xda55ffff,
				cameraPosition: [0, 10, 0],
			}),
		).toEqual({
			landblockId: 0xda55ffff,
			localCameraPosition: [0, 10, 0],
			rebaseTranslation: [0, 0, 0],
		});

		expect(
			deriveOutdoorCameraLandblockResidency({
				anchorLandblockId: 0xda55ffff,
				cameraPosition: [192, 10, 0],
			}),
		).toEqual({
			landblockId: 0xdb55ffff,
			localCameraPosition: [0, 10, 0],
			rebaseTranslation: [-192, 0, 0],
		});

		expect(
			deriveOutdoorCameraLandblockResidency({
				anchorLandblockId: 0xda55ffff,
				cameraPosition: [-1, 10, 1],
			}),
		).toEqual({
			landblockId: 0xd954ffff,
			localCameraPosition: [191, 10, -191],
			rebaseTranslation: [192, 0, -192],
		});
	});
});
