import {
	buildEffectRouter,
	installEffectState,
	testTarget,
} from "../behavior/behavior-test-harness";
import { describe, expect, it, vi } from "vitest";
import type { AdvancedAnimationFrame } from "../systems/animation-system";
import { AnimationSystem } from "../systems/animation-system";
import { wholeAnimationClip } from "../animation/animation-playback";
import {
	prepareAnimation,
	type PreparedAnimation,
} from "../animation/animation-asset-repository";
import { Mat4 } from "../math/types";
import { AnimationPresentationScheduler } from "./animation-presentation-scheduler";

/**
 * An animation system plus the one-node install these tests need.
 *
 * Effect state belongs to the entity rather than to playback, so a test driving `AnimationSystem`
 * directly has to install it the way `DynamicEntitySystem` does in production. Selection is all
 * these tests observe, so every node plays the same single-frame clip.
 */
function buildAnimationSystem() {
	const { effects, router } = buildEffectRouter();
	const system = new AnimationSystem<string>(effects, router);
	const play = (nodeId: string, ownerId = "owner") => {
		const target = testTarget(nodeId);
		installEffectState(effects, target.targetId);
		system.applyMotion(
			ownerId,
			target,
			"explicit",
			{ kind: "install", clip: wholeAnimationClip(testAnimation()) },
			{ kind: "remove" },
			[Mat4.identity()],
			{ kind: "ordinary" },
		);
	};
	return { play, system };
}

describe("AnimationPresentationScheduler", () => {
	it("preserves full cadence when the offscreen interval is zero", () => {
		const { frame } = advancedFrame(["scene-node:1", "scene-node:2"], 0);
		const scheduler = new AnimationPresentationScheduler(
			(_nodeId, _selected, ordinary) => ordinary,
		);
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
		const { play, system } = buildAnimationSystem();
		play("scene-node:1");
		play("scene-node:2");
		const scheduler = new AnimationPresentationScheduler(
			(_nodeId, _selected, ordinary) => ordinary,
		);
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
		const { play, system } = buildAnimationSystem();
		play("scene-node:1");
		const scheduler = new AnimationPresentationScheduler(
			(_nodeId, _selected, ordinary) => ordinary,
		);
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
		const { play, system } = buildAnimationSystem();
		play("scene-node:1");
		const scheduler = new AnimationPresentationScheduler(
			(_nodeId, _selected, ordinary) => ordinary,
		);
		scheduler.setOffscreenSampleIntervalSeconds(1);
		scheduler.select(system.advance(0), 0);
		system.removeOwner("owner");
		play("scene-node:2");

		expect(scheduler.select(system.advance(0.1), 0.1).selectedNodeIds).toEqual([
			"scene-node:2",
		]);
		expect(scheduler.getDiagnostics().trackedPlaybackCount).toBe(1);
	});

	it("samples a multi-view visibility union once and resets lifecycle state", () => {
		const { play, system } = buildAnimationSystem();
		play("scene-node:1");
		play("scene-node:2");
		const scheduler = new AnimationPresentationScheduler(
			(_nodeId, _selected, ordinary) => ordinary,
		);
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
		const { play, system } = buildAnimationSystem();
		play("scene-node:1");
		const scheduler = new AnimationPresentationScheduler(
			(_nodeId, _selected, ordinary) => ordinary,
		);
		scheduler.setOffscreenSampleIntervalSeconds(1);
		scheduler.select(system.advance(10), 10);

		expect(scheduler.select(system.advance(12), 12).selectedNodeIds).toEqual([
			"scene-node:1",
		]);
		expect(scheduler.select(system.advance(5), 5).selectedNodeIds).toEqual([
			"scene-node:1",
		]);
	});

	it("limits selected samples while immediately restoring full cadence when policy changes", () => {
		const { frame } = advancedFrame(["scene-node:1"], 0);
		let interval = 0.5;
		const scheduler = new AnimationPresentationScheduler(
			(_nodeId, selected, ordinary) => (selected ? interval : ordinary),
		);
		scheduler.select(frame, 0);
		scheduler.completeFrame({ selectedDynamicNodeIds: frame.activeNodeIds }, 0);
		expect(scheduler.select(frame, 0.1).selectedNodeIds).toEqual([]);
		expect(scheduler.select(frame, 0.5).selectedNodeIds).toEqual(
			frame.activeNodeIds,
		);
		interval = 0;
		expect(scheduler.select(frame, 0.51).selectedNodeIds).toEqual(
			frame.activeNodeIds,
		);
		interval = 0.5;
		expect(scheduler.select(frame, 0.4).selectedNodeIds).toEqual(
			frame.activeNodeIds,
		);
	});

	it("keeps semantic hooks advancing when selected visual samples are held", () => {
		const run = (interval: number) => {
			const { effects, router } = buildEffectRouter();
			const system = new AnimationSystem<string>(effects, router);
			const target = testTarget("scene-node:1");
			installEffectState(effects, target.targetId);
			const animation = prepareAnimation(
				{
					id: "0x03000001",
					frameCount: 4,
					partCount: 1,
					partFrames: [0, 1, 2, 3].map(() => Mat4.identity()),
					positionFrames: [],
					hooks: [
						{
							kind: "no-draw",
							noDraw: true,
							frameIndex: 1,
							direction: "both",
							authoredOrder: 0,
						},
					],
				},
				"0x03000001",
				30,
			);
			const dispatch = vi.spyOn(router, "dispatch");
			system.applyMotion(
				"owner",
				target,
				"explicit",
				{ kind: "install", clip: wholeAnimationClip(animation) },
				{ kind: "remove" },
				[Mat4.identity()],
				{ kind: "ordinary" },
			);
			const scheduler = new AnimationPresentationScheduler(
				(_nodeId, selected, ordinary) => (selected ? interval : ordinary),
			);
			let samples = 0;
			let semanticSteps = 0;
			for (let tick = 0; tick <= 120; tick += 1) {
				const time = tick / 120;
				effects.advance(time);
				const frame = system.advance(time);
				semanticSteps += system.getDiagnostics().lastSemanticStepCount;
				const selection = scheduler.select(frame, time);
				samples += system.sample(frame, selection.selectedNodeIds).length;
				scheduler.completeFrame(
					{ selectedDynamicNodeIds: frame.activeNodeIds },
					time,
				);
			}
			const hooks = dispatch.mock.calls.map(
				([hook, target, provenance, mode]) => ({
					hook,
					target,
					provenance,
					mode,
				}),
			);
			system.destroy();
			return { samples, semanticSteps, hooks };
		};
		const full = run(0);
		const held = run(0.1);
		expect(held.samples).toBeLessThan(full.samples);
		expect(full.hooks.length).toBeGreaterThan(0);
		expect(held.hooks).toEqual(full.hooks);
		expect(held.semanticSteps).toBe(full.semanticSteps);
	});

	it("rejects invalid intervals returned by selected-pose policy", () => {
		const { frame } = advancedFrame(["scene-node:1"], 0);
		const scheduler = new AnimationPresentationScheduler(
			(_nodeId, selected, ordinary) => (selected ? Number.NaN : ordinary),
		);
		scheduler.select(frame, 0);
		scheduler.completeFrame({ selectedDynamicNodeIds: frame.activeNodeIds }, 0);
		expect(() => scheduler.select(frame, 0.1)).toThrow(
			"finite and non-negative",
		);
	});

	it("rejects invalid policy and duplicate renderer feedback", () => {
		const scheduler = new AnimationPresentationScheduler(
			(_nodeId, _selected, ordinary) => ordinary,
		);

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
	const { play, system } = buildAnimationSystem();
	for (const nodeId of nodeIds) play(nodeId);
	return { frame: system.advance(timeSeconds) };
}

function testAnimation(): PreparedAnimation {
	return prepareAnimation(
		{
			frameCount: 1,
			hooks: [],
			id: "0x03000001",
			partCount: 1,
			partFrames: [Mat4.identity()],
			positionFrames: [],
		},
		"0x03000001",
		30,
	);
}
