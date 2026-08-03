import { describe, expect, it } from "vitest";
import type { AdvancedAnimationFrame } from "../systems/animation-system";
import { AnimationSystem } from "../systems/animation-system";
import { EffectSystem } from "../systems/effect-system";
import type { PreparedAnimation } from "../animation/animation-asset-repository";
import { Mat4 } from "../math/types";
import {
	AnimationPresentationScheduler,
	DEFAULT_OFFSCREEN_ANIMATION_SAMPLE_INTERVAL_SECONDS,
} from "./animation-presentation-scheduler";

describe("AnimationPresentationScheduler", () => {
	it("uses the product offscreen cadence by default", () => {
		const { frame } = advancedFrame(["scene-node:1"], 0);
		const scheduler = new AnimationPresentationScheduler();
		scheduler.select(frame, 0);

		expect(
			scheduler.select(
				frame,
				DEFAULT_OFFSCREEN_ANIMATION_SAMPLE_INTERVAL_SECONDS / 2,
			).selectedNodeIds,
		).toEqual([]);
		expect(
			scheduler.select(
				frame,
				DEFAULT_OFFSCREEN_ANIMATION_SAMPLE_INTERVAL_SECONDS,
			).selectedNodeIds,
		).toEqual(["scene-node:1"]);
	});

	it("preserves full cadence when the offscreen interval is zero", () => {
		const { frame } = advancedFrame(["scene-node:1", "scene-node:2"], 0);
		const scheduler = new AnimationPresentationScheduler();
		scheduler.setOffscreenSampleIntervalSeconds(0);

		expect(scheduler.select(frame, 0)).toMatchObject({
			offscreenNodeCount: 2,
			selectedNodeIds: ["scene-node:1", "scene-node:2"],
			visibleNodeCount: 0,
		});
		expect(scheduler.select(frame, 0.01).selectedNodeIds).toEqual([
			"scene-node:1",
			"scene-node:2",
		]);
	});

	it("samples previous-frame visibility every frame and offscreen roots on interval", () => {
		const system = new AnimationSystem<string>(new EffectSystem());
		system.install("owner", "scene-node:1", "resident:1", clip());
		system.install("owner", "scene-node:2", "resident:2", clip());
		const scheduler = new AnimationPresentationScheduler();
		scheduler.setOffscreenSampleIntervalSeconds(0.1);

		const initial = scheduler.select(system.advance(0), 0);
		expect(initial.selectedNodeIds).toEqual(["scene-node:1", "scene-node:2"]);
		scheduler.completeFrame({ selectedDynamicNodeIds: ["scene-node:1"] }, 0);

		expect(scheduler.select(system.advance(0.05), 0.05)).toMatchObject({
			offscreenNodeCount: 0,
			selectedNodeIds: ["scene-node:1"],
			visibleNodeCount: 1,
		});
		expect(scheduler.select(system.advance(0.1), 0.1)).toMatchObject({
			offscreenNodeCount: 1,
			selectedNodeIds: ["scene-node:1", "scene-node:2"],
			visibleNodeCount: 1,
		});
	});

	it("bounds first-visible staleness to one completed feedback frame", () => {
		const system = new AnimationSystem<string>(new EffectSystem());
		system.install("owner", "scene-node:1", "resident:1", clip());
		const scheduler = new AnimationPresentationScheduler();
		scheduler.setOffscreenSampleIntervalSeconds(1);
		scheduler.select(system.advance(0), 0);

		expect(scheduler.select(system.advance(0.1), 0.1).selectedNodeIds).toEqual(
			[],
		);
		scheduler.completeFrame({ selectedDynamicNodeIds: ["scene-node:1"] }, 0.1);
		expect(scheduler.getDiagnostics()).toMatchObject({
			lastMaximumVisiblePresentationAgeSeconds: 0.1,
			lastNewlyVisiblePlaybackCount: 1,
		});
		expect(scheduler.select(system.advance(0.2), 0.2).selectedNodeIds).toEqual([
			"scene-node:1",
		]);
	});

	it("drops retired identities and treats replacements as immediately due", () => {
		const system = new AnimationSystem<string>(new EffectSystem());
		system.install("owner", "scene-node:1", "resident:1", clip());
		const scheduler = new AnimationPresentationScheduler();
		scheduler.setOffscreenSampleIntervalSeconds(1);
		scheduler.select(system.advance(0), 0);
		system.removeOwner("owner");
		system.install("owner", "scene-node:2", "resident:2", clip());

		expect(scheduler.select(system.advance(0.1), 0.1).selectedNodeIds).toEqual([
			"scene-node:2",
		]);
		expect(scheduler.getDiagnostics().trackedPlaybackCount).toBe(1);
	});

	it("samples a multi-view visibility union once and resets lifecycle state", () => {
		const system = new AnimationSystem<string>(new EffectSystem());
		system.install("owner", "scene-node:1", "resident:1", clip());
		system.install("owner", "scene-node:2", "resident:2", clip());
		const scheduler = new AnimationPresentationScheduler();
		scheduler.setOffscreenSampleIntervalSeconds(1);
		scheduler.select(system.advance(0), 0);
		scheduler.completeFrame(
			{
				selectedDynamicNodeIds: [
					"scene-node:1",
					"scene-node:2",
					"scene-node:999",
				],
			},
			0,
		);
		expect(scheduler.getDiagnostics().previousFrameVisibleCount).toBe(2);

		expect(scheduler.select(system.advance(0.1), 0.1)).toMatchObject({
			selectedNodeIds: ["scene-node:1", "scene-node:2"],
			visibleNodeCount: 2,
		});
		scheduler.clear();
		expect(scheduler.getDiagnostics()).toMatchObject({
			previousFrameVisibleCount: 0,
			trackedPlaybackCount: 0,
		});
		expect(scheduler.select(system.advance(0.2), 0.2).selectedNodeIds).toEqual([
			"scene-node:1",
			"scene-node:2",
		]);
	});

	it("samples offscreen roots immediately after a long frame gap or clock regression", () => {
		const system = new AnimationSystem<string>(new EffectSystem());
		system.install("owner", "scene-node:1", "resident:1", clip());
		const scheduler = new AnimationPresentationScheduler();
		scheduler.setOffscreenSampleIntervalSeconds(1);
		scheduler.select(system.advance(10), 10);

		expect(scheduler.select(system.advance(12), 12).selectedNodeIds).toEqual([
			"scene-node:1",
		]);
		expect(scheduler.select(system.advance(5), 5).selectedNodeIds).toEqual([
			"scene-node:1",
		]);
	});

	it("rejects invalid policy and duplicate renderer feedback", () => {
		const scheduler = new AnimationPresentationScheduler();

		expect(() => scheduler.setOffscreenSampleIntervalSeconds(-1)).toThrow(
			"finite and non-negative",
		);
		expect(() =>
			scheduler.completeFrame(
				{ selectedDynamicNodeIds: ["scene-node:1", "scene-node:1"] },
				0,
			),
		).toThrow("duplicate dynamic node IDs");
	});
});

function advancedFrame(
	nodeIds: readonly `scene-node:${number}`[],
	timeSeconds: number,
): { readonly frame: AdvancedAnimationFrame } {
	const system = new AnimationSystem<string>(new EffectSystem());
	for (const [index, nodeId] of nodeIds.entries()) {
		system.install("owner", nodeId, `resident:${index}`, clip());
	}
	return { frame: system.advance(timeSeconds) };
}

function clip(): PreparedAnimation {
	return {
		frameCount: 1,
		framesPerSecond: 30,
		hooks: [],
		id: "0x03000001",
		partCount: 1,
		partFrames: [Mat4.identity()],
		positionFrames: [],
	};
}
