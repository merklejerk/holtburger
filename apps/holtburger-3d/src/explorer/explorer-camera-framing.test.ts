import { describe, expect, it, vi } from "vitest";
import type { LandblockId } from "../lib/game/game-types";
import { Vec3 } from "../lib/game/math/types";
import {
	EXPLORER_CAMERA_FRAMING,
	resolveExplorerOutdoorFocusPose,
} from "./explorer-camera-framing";

const LAND_BLOCK_ID = "0xda55ffff" as LandblockId;

describe("Explorer camera framing", () => {
	it("resolves the automatic outdoor pose from the offset and center terrain surfaces", () => {
		const queriedPoints: Vec3[] = [];
		const heights = [12, 8];
		const queryOutdoorTerrainSurface = vi.fn((point: Vec3) => {
			queriedPoints.push(point.clone());
			const height = heights.shift();
			return height === undefined
				? null
				: { height, landblockId: LAND_BLOCK_ID };
		});

		const pose = resolveExplorerOutdoorFocusPose(
			{ queryOutdoorTerrainSurface },
			LAND_BLOCK_ID,
		);

		expect(EXPLORER_CAMERA_FRAMING).toEqual({ far: 2_000, fov: 60, near: 0.5 });
		expect(pose?.position).toEqual(new Vec3(42_000, 60, -16_368));
		expect(pose?.yawRadians).toBeCloseTo(-Math.PI / 4);
		expect(pose?.pitchRadians).toBeCloseTo(
			Math.asin(-52 / Math.hypot(48, 52, 48)),
		);
		expect(queriedPoints).toEqual([
			new Vec3(42_000, 0, -16_368),
			new Vec3(41_952, 0, -16_416),
		]);
	});

	it("waits when the requested landblock terrain is unavailable", () => {
		expect(
			resolveExplorerOutdoorFocusPose(
				{ queryOutdoorTerrainSurface: () => null },
				LAND_BLOCK_ID,
			),
		).toBeNull();
	});
});
