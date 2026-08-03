import { describe, expect, it, vi } from "vitest";
import type { LandblockId } from "../lib/game/game-types";
import { Vec3 } from "../lib/game/math/types";
import { FRONTEND_TUNING } from "../lib/frontend-tuning";
import { resolveExplorerOutdoorFocusPose } from "./explorer-camera-framing";

const LAND_BLOCK_ID = "0xda55ffff" as LandblockId;

describe("Explorer camera framing", () => {
	it("resolves the automatic outdoor pose from the offset and center terrain surfaces", () => {
		const queriedPoints: Vec3[] = [];
		const heights = [12, 8];
		const center = new Vec3(41_952, 0, -16_416);
		const focus = FRONTEND_TUNING.explorer.camera.outdoorFocus;
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

		expect(pose?.position).toEqual(
			new Vec3(
				center.x + focus.offset,
				12 + focus.clearance,
				center.z + focus.offset,
			),
		);
		expect(pose?.yawRadians).toBeCloseTo(-Math.PI / 4);
		const verticalDelta = focus.clearance + 12 - 8;
		expect(pose?.pitchRadians).toBeCloseTo(
			Math.asin(
				-verticalDelta /
					Math.hypot(focus.offset, verticalDelta, focus.offset),
			),
		);
		expect(queriedPoints).toEqual([
			new Vec3(center.x + focus.offset, 0, center.z + focus.offset),
			center,
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
