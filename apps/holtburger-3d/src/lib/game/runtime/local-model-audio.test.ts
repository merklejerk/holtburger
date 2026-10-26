import { describe, expect, it, vi } from "vitest";
import {
	behaviorTargetId,
	type BehaviorTarget,
} from "../behavior/behavior-event-router";
import { datAssetId } from "./dynamic-entity-presentation";
import { withSilentLocalModelAudio } from "./local-model-audio";
import { localSceneModelOwnerId, dynamicEntityOwnerId } from "./owner-ids";

describe("local model behavior audio", () => {
	it("suppresses both sound routes for local body, equipment, and part ownership", () => {
		const audio = {
			playSound: vi.fn(() => "played" as const),
			playSoundTableKey: vi.fn(() => "played" as const),
		};
		const local = localSceneModelOwnerId(1);
		const sink = withSilentLocalModelAudio(audio, () => local);
		for (const id of ["body", "equipment", "part"]) {
			const target: BehaviorTarget = {
				targetId: behaviorTargetId(id),
				generation: 1,
			};
			expect(
				sink.playSound(target, {
					soundId: datAssetId(0x20000001),
					probability: 1,
					volume: 1,
				}),
			).toBe("suppressed");
			expect(sink.playSoundTableKey(target, 1)).toBe("suppressed");
		}
		expect(audio.playSound).not.toHaveBeenCalled();
		expect(audio.playSoundTableKey).not.toHaveBeenCalled();
	});
	it.each([dynamicEntityOwnerId(1), null])(
		"delegates unchanged for world or non-model owner %s",
		(owner) => {
			const audio = {
				playSound: vi.fn(() => "unprepared" as const),
				playSoundTableKey: vi.fn(() => "played" as const),
			};
			const sink = withSilentLocalModelAudio(audio, () => owner);
			const target = { targetId: behaviorTargetId("world"), generation: 2 };
			const sound = {
				soundId: datAssetId(0x20000001),
				probability: 0.4,
				volume: 0.8,
			};
			expect(sink.playSound(target, sound)).toBe("unprepared");
			expect(sink.playSoundTableKey(target, 7)).toBe("played");
			expect(audio.playSound).toHaveBeenCalledWith(target, sound);
			expect(audio.playSoundTableKey).toHaveBeenCalledWith(target, 7);
		},
	);
});
