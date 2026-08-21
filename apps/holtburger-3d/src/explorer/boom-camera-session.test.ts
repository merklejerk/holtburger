import { describe, expect, it, vi } from "vitest";
import { Vec3 } from "../lib/game/math/types";
import type { LandblockId } from "../lib/game/game-types";
import type { ResolvedSceneOrigin } from "../lib/game/scene";
import {
	IDLE_BOOM_INPUT,
	type BoomCameraOrientation,
	type BoomCameraTuning,
} from "./boom-camera-controller";
import {
	BoomCameraSession,
	boomAnchor,
	type BoomFollowTarget,
} from "./boom-camera-session";
import type { BoomSweepRequest, BoomSweepSource } from "./boom-sweep-source";

const TUNING: BoomCameraTuning = {
	easeOutSeconds: 0.35,
	maximumDistance: 8,
	minimumDistance: 1.2,
};

const LOOKING_NORTH: BoomCameraOrientation = {
	pitchRadians: 0,
	yawRadians: 0,
};

/** 0x0102ffff sits two landblocks east and one south of the scene origin. */
function target(localX = 10, localY = 20, localZ = 5): BoomFollowTarget {
	return {
		anchorHeight: 1.5,
		origin: {
			envCellId: null,
			landblockId: "0x0102ffff" as LandblockId,
			landblockOrigin: new Vec3(localX, localY, localZ),
			scope: { kind: "outdoor" },
		} satisfies ResolvedSceneOrigin,
	};
}

/** A sweep source whose answers are resolved by the test, so timing is explicit. */
function deferredSweeps() {
	const requests: BoomSweepRequest[] = [];
	let resolveNext: ((distance: number) => void) | null = null;
	const source: BoomSweepSource = {
		sweep: (request) => {
			requests.push(request);
			return new Promise<number>((resolve) => {
				resolveNext = resolve;
			});
		},
	};
	return {
		requests,
		settle: async (distance: number) => {
			const resolve = resolveNext;
			if (!resolve) throw new Error("No sweep is in flight.");
			resolveNext = null;
			resolve(distance);
			await Promise.resolve();
			await Promise.resolve();
			await Promise.resolve();
		},
		source,
	};
}

function session(source: BoomSweepSource, onSweepError = vi.fn()) {
	return {
		errors: onSweepError,
		session: new BoomCameraSession(
			{
				onSweepError,
				sweepRadius: 0.3,
				sweeps: source,
				tuning: TUNING,
			},
			6,
		),
	};
}

describe("boomAnchor", () => {
	it("lifts the entity root into canonical scene coordinates", () => {
		const anchor = boomAnchor(target(10, 20, 5));

		// Landblock 0x0102 is (1, 2) at 192 m each; scene +Z runs south, so +Y north negates.
		expect(anchor.x).toBeCloseTo(192 + 10);
		expect(anchor.z).toBeCloseTo(-384 + 5);
		// The head sits one anchor height above the root.
		expect(anchor.y).toBeCloseTo(20 + 1.5);
	});
});

describe("BoomCameraSession", () => {
	it("renders at the requested distance before any sweep has answered", () => {
		const sweeps = deferredSweeps();
		const { session: boom } = session(sweeps.source);

		const position = boom.advance(
			target(),
			LOOKING_NORTH,
			IDLE_BOOM_INPUT,
			1 / 60,
		);

		const anchor = boomAnchor(target());
		expect(
			Math.hypot(
				position.x - anchor.x,
				position.y - anchor.y,
				position.z - anchor.z,
			),
		).toBeCloseTo(6);
	});

	it("keeps at most one sweep in flight, so a slow host cannot queue frames", () => {
		const sweeps = deferredSweeps();
		const { session: boom } = session(sweeps.source);

		for (let frame = 0; frame < 10; frame += 1) {
			boom.advance(target(), LOOKING_NORTH, IDLE_BOOM_INPUT, 1 / 60);
		}

		expect(sweeps.requests).toHaveLength(1);
	});

	it("asks about the desired reach rather than the clamped one", async () => {
		const sweeps = deferredSweeps();
		const { session: boom } = session(sweeps.source);
		boom.advance(target(), LOOKING_NORTH, IDLE_BOOM_INPUT, 1 / 60);
		await sweeps.settle(2);
		boom.advance(target(), LOOKING_NORTH, IDLE_BOOM_INPUT, 1 / 60);

		// A pinned boom that asked about its own pinned distance would never learn it can recover.
		expect(sweeps.requests[1]?.distance).toBe(6);
	});

	it("pulls the camera in once a sweep reports geometry", async () => {
		const sweeps = deferredSweeps();
		const { session: boom } = session(sweeps.source);
		boom.advance(target(), LOOKING_NORTH, IDLE_BOOM_INPUT, 1 / 60);

		await sweeps.settle(2);
		const position = boom.advance(
			target(),
			LOOKING_NORTH,
			IDLE_BOOM_INPUT,
			1 / 60,
		);

		const anchor = boomAnchor(target());
		expect(
			Math.hypot(
				position.x - anchor.x,
				position.y - anchor.y,
				position.z - anchor.z,
			),
		).toBeCloseTo(2);
	});

	it("reports a failing sweep instead of throwing into the render loop", async () => {
		const failing: BoomSweepSource = {
			sweep: () => Promise.reject(new Error("host is gone")),
		};
		const { errors, session: boom } = session(failing);

		expect(() =>
			boom.advance(target(), LOOKING_NORTH, IDLE_BOOM_INPUT, 1 / 60),
		).not.toThrow();
		await Promise.resolve();
		await Promise.resolve();

		expect(errors).toHaveBeenCalledOnce();
	});

	it("ignores an answer that lands after disposal", async () => {
		const sweeps = deferredSweeps();
		const { session: boom } = session(sweeps.source);
		boom.advance(target(), LOOKING_NORTH, IDLE_BOOM_INPUT, 1 / 60);

		boom.dispose();
		await sweeps.settle(1.5);

		// The superseded answer must not clamp a boom that has already been released.
		expect(boom.state.renderedDistance).toBe(6);
	});

	it("refuses to advance after release, like every neighbouring system", () => {
		const sweeps = deferredSweeps();
		const { session: boom } = session(sweeps.source);
		boom.dispose();

		expect(() =>
			boom.advance(target(), LOOKING_NORTH, IDLE_BOOM_INPUT, 1 / 60),
		).toThrow("released boom camera");
	});

	it("follows the anchor without accumulating position state", () => {
		const sweeps = deferredSweeps();
		const { session: boom } = session(sweeps.source);
		boom.advance(target(0, 0, 0), LOOKING_NORTH, IDLE_BOOM_INPUT, 1 / 60);

		const moved = boom.advance(
			target(100, 0, 0),
			LOOKING_NORTH,
			IDLE_BOOM_INPUT,
			1 / 60,
		);

		// A chasing body would still be catching up; a derived position arrives with the anchor.
		expect(moved.x - boomAnchor(target(100, 0, 0)).x).toBeCloseTo(0);
	});
});
