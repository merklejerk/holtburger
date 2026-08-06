import { describe, expect, it } from "vitest";
import type { DecodedAnimationHook } from "../../assets/decode-animation-record";
import { AABB3, Mat4, Vec3 } from "../math/types";
import { createRotationMat4 } from "../math/matrices";
import { rotationVectorQuaternion } from "./animation-playback";
import type { ObjectVisualTemplate } from "../systems/object-visual-template-repository";
import type { PreparedAnimation } from "./animation-asset-repository";
import { prepareDynamicAnimation } from "./prepared-dynamic-animation";

describe("prepareDynamicAnimation", () => {
	it("sweeps retail-composed part bounds and envelopes unbounded visual-root rotation", () => {
		const first = Mat4.identity();
		first.m41 = 1;
		const second = Mat4.identity();
		second.m41 = -1;
		const prepared = prepareDynamicAnimation(
			animation([first, second], [setOmegaHook()]),
			template(),
			new Vec3(3, 1, 1),
			AABB3.zero(),
		);

		expect(prepared.kind).toBe("activatable");
		if (prepared.kind !== "activatable") return;
		expect(prepared.hasUnboundedVisualRootRotation).toBe(true);
		expect(prepared.localBounds).toEqual(
			new AABB3(
				new Vec3(-Math.sqrt(153), -Math.sqrt(153), -Math.sqrt(153)),
				new Vec3(Math.sqrt(153), Math.sqrt(153), Math.sqrt(153)),
			),
		);
	});

	it("activates despite a ReplaceObject hook, which retail never executes", () => {
		// Retail defines no `Execute` for hook type 5, so an owner carrying one draws identically
		// whether we run it or not. Blocking activation over it would withhold correct animation.
		const replacement: DecodedAnimationHook = {
			authoredOrder: 0,
			direction: "forward",
			frameIndex: 0,
			kind: "replace-object",
			rawPayload: new Uint8Array([1]),
		};

		expect(
			prepareDynamicAnimation(
				animation([Mat4.identity()], [replacement]),
				template(),
				new Vec3(1, 1, 1),
				AABB3.zero(),
			),
		).toMatchObject({ kind: "activatable" });
	});

	it("retains static presentation for a hook that would misrender the object", () => {
		const unsupported: DecodedAnimationHook = {
			authoredOrder: 0,
			blocksActivation: true,
			command: "no-draw",
			direction: "forward",
			frameIndex: 0,
			kind: "unimplemented",
			payload: { bytes: new Uint8Array([1]), kind: "raw" },
			sourceType: 16,
		};

		expect(
			prepareDynamicAnimation(
				animation([Mat4.identity()], [unsupported]),
				template(),
				new Vec3(1, 1, 1),
				AABB3.zero(),
			),
		).toMatchObject({
			blockingHooks: [unsupported],
			kind: "retain-static-presentation",
		});
	});

	it("activates TransparentPart after its effect owner is installed", () => {
		const transparentPart: DecodedAnimationHook = {
			authoredOrder: 0,
			direction: "both",
			durationSeconds: 0.5,
			end: 1,
			frameIndex: 0,
			kind: "transparent-part",
			partIndex: 0,
			start: 0,
		};

		expect(
			prepareDynamicAnimation(
				animation([Mat4.identity()], [transparentPart]),
				template(),
				new Vec3(1, 1, 1),
				AABB3.zero(),
			),
		).toMatchObject({ kind: "activatable" });
	});

	it("covers orientations between authored rigid-part keyframes", () => {
		const halfTurn = createRotationMat4(
			rotationVectorQuaternion(new Vec3(0, 0, Math.PI)),
		);
		const prepared = prepareDynamicAnimation(
			animation([Mat4.identity(), halfTurn], []),
			{
				...template(),
				parts: [
					{
						...template().parts[0]!,
						defaultScale: new Vec3(1, 1, 1),
						localBounds: new AABB3(new Vec3(2, 0, 0), new Vec3(2, 0, 0)),
					},
				],
			},
			new Vec3(1, 1, 1),
			AABB3.zero(),
		);

		expect(prepared.localBounds).toEqual(
			new AABB3(new Vec3(-2, -2, -2), new Vec3(2, 2, 2)),
		);
	});
});

function animation(
	partFrames: readonly Mat4[],
	hooks: readonly DecodedAnimationHook[],
): PreparedAnimation {
	return {
		frameCount: partFrames.length,
		framesPerSecond: 30,
		hooks,
		id: "0x03000001",
		partCount: 1,
		partFrames,
		positionFrames: [],
	};
}

function template(): ObjectVisualTemplate {
	return {
		appearanceKey: "appearance:test",
		baseBounds: null,
		geometry: [],
		key: "object-visual-template:0x02000001/appearance:test" as never,
		parts: [
			{
				defaultScale: new Vec3(2, 1, 1),
				drawUnits: [],
				geometry: "object-geometry:test" as never,
				key: "part-visual-template:test" as never,
				localBounds: new AABB3(new Vec3(1, 0, 0), new Vec3(1, 0, 0)),
				partIndex: 0,
			},
		],
		textureRequirements: [],
	};
}

function setOmegaHook(): DecodedAnimationHook {
	return {
		authoredOrder: 0,
		direction: "forward",
		frameIndex: 0,
		kind: "set-omega",
		omega: new Vec3(0, 0, 1),
	};
}
