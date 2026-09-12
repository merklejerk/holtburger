import type { InputConfiguration } from "./input-contract";

/** Default input policy. Edit bindings here; controllers consume semantic actions. */
export const INPUT_DEFAULTS = {
	/** Grounded character drive and charged jump in both modes. */
	character: {
		/** Advance along the character's facing. */
		forward: [{ key: "w" }],
		/** Retreat along the character's facing. */
		backward: [{ key: "s" }],
		/** Rotate the character left. */
		turnLeft: [{ key: "a" }],
		/** Rotate the character right. */
		turnRight: [{ key: "d" }],
		/** Translate left without changing facing. */
		strafeLeft: [{ key: "z" }],
		/** Translate right without changing facing. */
		strafeRight: [{ key: "c" }],
		/** Hold to select walking gait. */
		walk: [{ key: "Shift" }],
		/** Hold to charge and release to jump; activates an aimed precise jump. */
		jump: [{ key: " " }],
	},
	/** Explorer camera translation, rotation, and precision control. */
	fly: {
		/** Move forward along the camera basis. */
		forward: [{ key: "w" }],
		/** Move backward along the camera basis. */
		backward: [{ key: "s" }],
		/** Rotate camera yaw left. */
		turnLeft: [{ key: "a" }],
		/** Rotate camera yaw right. */
		turnRight: [{ key: "d" }],
		/** Move along camera-local left. */
		strafeLeft: [{ key: "z" }],
		/** Move along camera-local right. */
		strafeRight: [{ key: "c" }],
		/** Move along camera-local up; either binding may remain held. */
		ascend: [{ key: " " }, { key: "PageUp" }],
		/** Move along camera-local down. */
		descend: [{ key: "PageDown" }],
		/** Hold to slow camera motion and pointer gestures. */
		precision: [{ key: "Shift" }],
	},
	/** Contextual client and chat commands. */
	client: {
		/** Use the currently selected entity. */
		interact: [{ key: "r" }],
		/** Enter the aimed jump interaction. */
		preciseJump: [{ key: "j", shift: true }],
		/** Cancel precise jump or return from chat to the viewport. */
		cancel: [{ key: "Escape" }],
		/** Submit the selected character before entering gameplay. */
		enterWorld: [{ key: "Enter" }],
		/** Activate chat while the game owns the keyboard. */
		chat: [{ key: "Enter" }],
		/** Scroll toward earlier messages while chat owns focus. */
		chatPreviousPage: [{ key: "PageUp" }],
		/** Scroll toward later messages while chat owns focus. */
		chatNextPage: [{ key: "PageDown" }],
	},
	/** Viewport gesture activation buttons. */
	pointer: {
		/** Client click selection and drag orbit share one gesture. */
		clientInteract: [0],
		/** Activate the currently aimed precise jump. */
		preciseJumpActivate: [0],
		/** Drag to orbit the possessed Explorer character. */
		possessionOrbit: [0],
		/** Drag to rotate an Explorer fly camera. */
		flyRotate: [0],
		/** Drag to translate an Explorer fly camera. */
		flyPan: [1, 2],
	},
} satisfies InputConfiguration;
