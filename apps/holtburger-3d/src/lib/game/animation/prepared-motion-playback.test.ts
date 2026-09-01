import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DecodedAnimationHook } from "../../assets/decode-animation-record";
import type { DatAssetId } from "../game-types";
import { AABB3, Mat4, Vec3 } from "../math/types";
import type { ObjectVisualTemplate } from "../systems/object-visual-template-repository";
import type {
	PreparedAnimation,
	PreparedMotionClosure,
} from "./animation-asset-repository";
import { prepareMotionPlayback } from "./prepared-motion-playback";

/** One part at the origin with a unit-ish box, so a pose's translation drives the bound. */
function template(partCount = 1): ObjectVisualTemplate {
	return {
		appearanceKey: "fixture",
		parts: Array.from({ length: partCount }, (_, partIndex) => ({
			defaultScale: new Vec3(1, 1, 1),
			localBounds: new AABB3(new Vec3(0, 0, 0), new Vec3(0, 0, 0)),
			partIndex,
		})),
	} as unknown as ObjectVisualTemplate;
}

/** One frame per entry, translating the single part to the given x offset. */
function animation(
	id: string,
	offsets: readonly number[],
	hooks: readonly DecodedAnimationHook[] = [],
	partCount = 1,
): PreparedAnimation {
	return {
		frameCount: offsets.length,
		framesPerSecond: 30,
		hooks,
		id: id as DatAssetId,
		partCount,
		partFrames: offsets.flatMap((x) => {
			const pose = Mat4.identity();
			pose.m41 = x;
			return Array.from({ length: partCount }, () => pose);
		}),
		positionFrames: [],
	} as unknown as PreparedAnimation;
}

function closure(
	animations: readonly PreparedAnimation[],
): PreparedMotionClosure {
	return {
		animations: new Map(
			animations.map((value) => [value.id as DatAssetId, value]),
		),
		motionTableId: "0x09000001" as DatAssetId,
		release: () => {},
	};
}

const staticBounds = AABB3.zero();

beforeEach(() => {
	vi.restoreAllMocks();
	vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("prepareMotionPlayback", () => {
	it("covers every clip with one bound rather than one bound per clip", () => {
		const playback = prepareMotionPlayback(
			closure([
				animation("0x03000001", [0, 1]),
				animation("0x03000002", [0, -4]),
				animation("0x03000003", [0, 7]),
			]),
			template(),
			new Vec3(1, 1, 1),
			staticBounds,
		);

		expect(playback.clips.size).toBe(3);
		expect(playback.localBounds.min.x).toBeCloseTo(-4);
		expect(playback.localBounds.max.x).toBeCloseTo(7);
	});

	it("scales the sweep by the entity's own scale", () => {
		const playback = prepareMotionPlayback(
			closure([animation("0x03000001", [0, 2])]),
			template(),
			new Vec3(3, 1, 1),
			staticBounds,
		);

		expect(playback.localBounds.max.x).toBeCloseTo(6);
	});

	/// A content defect skips its clip and complains; the entity still animates from the rest of
	/// its table, because refusing to spawn over one bad clip is worse than playing the others.
	it("skips a clip whose hooks would misrender the object and keeps the rest", () => {
		const blocking: DecodedAnimationHook = {
			blocksActivation: true,
			kind: "unimplemented",
		} as unknown as DecodedAnimationHook;

		const playback = prepareMotionPlayback(
			closure([
				animation("0x03000001", [0, 1]),
				animation("0x03000abc", [0, 50], [blocking]),
			]),
			template(),
			new Vec3(1, 1, 1),
			staticBounds,
		);

		expect([...playback.clips.keys()]).toEqual(["0x03000001"]);
		expect(playback.localBounds.max.x).toBeCloseTo(1);
		expect(console.warn).toHaveBeenCalledOnce();
	});

	/// One continuous root rotation would otherwise inflate the shared bound to a sphere for every
	/// other clip the entity can reach.
	it("skips a clip with continuous visual-root rotation", () => {
		const omega = { kind: "set-omega" } as unknown as DecodedAnimationHook;

		const playback = prepareMotionPlayback(
			closure([
				animation("0x03000001", [0, 1]),
				animation("0x03000def", [0, 1], [omega]),
			]),
			template(),
			new Vec3(1, 1, 1),
			staticBounds,
		);

		expect([...playback.clips.keys()]).toEqual(["0x03000001"]);
	});

	it("accepts a partial clip and retains static coverage for untouched parts", () => {
		const playback = prepareMotionPlayback(
			closure([animation("0x03000001", [0, 1], [], 1)]),
			template(3),
			new Vec3(1, 1, 1),
			staticBounds,
		);

		expect(playback.clips.size).toBe(1);
		expect(playback.localBounds.max.x).toBe(1);
		expect(console.warn).not.toHaveBeenCalled();
	});

	it("keeps a clip whose collision hook is owned by host simulation", () => {
		const ethereal: DecodedAnimationHook = {
			authoredOrder: 0,
			frameIndex: 0,
			direction: "forward",
			blocksActivation: false,
			command: "ethereal",
			kind: "unimplemented",
			sourceType: 6,
			payload: { kind: "ethereal", ethereal: true },
		};
		const playback = prepareMotionPlayback(
			closure([animation("0x03000559", [0, 1], [ethereal])]),
			template(),
			new Vec3(1, 1, 1),
			staticBounds,
		);

		expect([...playback.clips.keys()]).toEqual(["0x03000559"]);
		expect(console.warn).not.toHaveBeenCalled();
	});

	/// An entity whose every clip was refused keeps its authored pose, which is what an entity with
	/// no playback at all already does.
	it("falls back to the static bound when nothing is playable", () => {
		const omega = { kind: "set-omega" } as unknown as DecodedAnimationHook;

		const playback = prepareMotionPlayback(
			closure([animation("0x03000fff", [0, 1], [omega])]),
			template(),
			new Vec3(1, 1, 1),
			staticBounds,
		);

		expect(playback.clips.size).toBe(0);
		expect(playback.localBounds).toEqual(staticBounds);
		expect(playback.localBounds).not.toBe(staticBounds);
	});

	it("complains once per table and clip rather than once per entity", () => {
		const omega = { kind: "set-omega" } as unknown as DecodedAnimationHook;
		const build = () =>
			prepareMotionPlayback(
				closure([animation("0x03000eee", [0, 1], [omega])]),
				template(),
				new Vec3(1, 1, 1),
				staticBounds,
			);

		build();
		build();
		build();

		expect(console.warn).toHaveBeenCalledOnce();
	});
});
