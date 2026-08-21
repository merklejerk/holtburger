import type { CharacterInputKey } from "./character-input-controller";

/** Complete browser binding profile shared by third-person character entry points. */
export interface ThirdPersonCharacterControlProfile {
	readonly boomWheel: true;
	readonly characterKey: (browserKey: string) => CharacterInputKey | null;
	readonly orbitPointerButton: 0;
	readonly pointerPrecisionModifier: null;
	readonly scheme: "possessed-character";
}

/**
 * Body-relative character controls used by possession and the future playable-client entry point.
 * Camera orbit is deliberately pointer-only; keyboard turn belongs exclusively to the body.
 */
export const THIRD_PERSON_CHARACTER_CONTROL_PROFILE: ThirdPersonCharacterControlProfile =
	Object.freeze({
		boomWheel: true,
		characterKey(browserKey: string): CharacterInputKey | null {
			const normalized = browserKey.toLowerCase();
			if (["w", "a", "s", "d", "z", "c", "shift"].includes(normalized))
				return normalized as CharacterInputKey;
			return browserKey === " " ? "space" : null;
		},
		orbitPointerButton: 0,
		pointerPrecisionModifier: null,
		scheme: "possessed-character",
	});
