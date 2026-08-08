import type { SceneNodeId } from "../scene";
import { EffectSystem } from "../systems/effect-system";
import {
	BehaviorEventRouter,
	behaviorTargetId,
	type BehaviorTarget,
} from "./behavior-event-router";

/**
 * Wire a router over a real `EffectSystem` for tests that exercise a producer, not the router.
 *
 * Targets are reported live and chained activation throws: a test that reaches either has left the
 * scope this harness is meant for and should build its own consumers.
 */
export function buildEffectRouter(effects: EffectSystem = new EffectSystem()): {
	readonly effects: EffectSystem;
	readonly router: BehaviorEventRouter;
} {
	const router = new BehaviorEventRouter(
		{
			audio: {
				playSound: () => "unprepared",
				playSoundTableKey: () => "unprepared",
			},
			effects,
			particles: { createEmitter: () => "unprepared" },
			scheduler: {
				scheduleActivation: () => {
					throw new Error(
						"This harness has no script clock; build explicit consumers instead.",
					);
				},
			},
			targets: { isLive: () => true },
		},
		256,
	);
	return { effects, router };
}

/**
 * Install effect state for a node the way the entity owner does.
 *
 * Effect state belongs to the entity, not to playback, so a test driving `AnimationSystem` directly
 * must stand in for that owner.
 */
export function installEffectState(
	effects: EffectSystem,
	nodeId: string,
	partCount = 1,
): void {
	effects.install(nodeId as SceneNodeId, partCount);
}

/** The single-generation target a test uses when generation reuse is not what it is proving. */
export function testTarget(nodeId: string): BehaviorTarget {
	return { generation: 1, targetId: behaviorTargetId(nodeId) };
}
