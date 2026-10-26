import type {
	BehaviorConsumers,
	BehaviorTarget,
} from "../behavior/behavior-event-router";
import { isLocalSceneModelOwnerId, type DynamicOwnerId } from "./owner-ids";

/** Suppress local compositions at the behavior seam, leaving world/listener audio policy intact. */
export function withSilentLocalModelAudio(
	audio: BehaviorConsumers["audio"],
	ownerOf: (target: BehaviorTarget) => DynamicOwnerId | null,
): BehaviorConsumers["audio"] {
	const isSilent = (target: BehaviorTarget): boolean => {
		const owner = ownerOf(target);
		return owner !== null && isLocalSceneModelOwnerId(owner);
	};
	return {
		playSound: (target, sound) =>
			isSilent(target) ? "suppressed" : audio.playSound(target, sound),
		playSoundTableKey: (target, soundType) =>
			isSilent(target)
				? "suppressed"
				: audio.playSoundTableKey(target, soundType),
	};
}
