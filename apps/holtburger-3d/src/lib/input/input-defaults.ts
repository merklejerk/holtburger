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
		/** Select the authoritative local player identity. */
		selectSelf: [{ key: "x", ctrl: false, alt: false, meta: false }],
		/** Stable forward creature traversal. */
		nextCreature: [
			{ key: "Tab", shift: false, ctrl: false, alt: false, meta: false },
		],
		/** Stable reverse creature traversal. */
		previousCreature: [
			{ key: "Tab", shift: true, ctrl: false, alt: false, meta: false },
		],
		/** World objects can be acquired behind the camera. */
		nextNonCreature: [
			{ key: "Tab", shift: false, ctrl: true, alt: false, meta: false },
		],
		/** Stable reverse world-object traversal, including behind the camera. */
		previousNonCreature: [
			{ key: "Tab", shift: true, ctrl: true, alt: false, meta: false },
		],
		/** Stable forward traversal over unopened corpses in the world-object ring. */
		nextUnopenedCorpse: [
			{ key: "v", shift: false, ctrl: false, alt: false, meta: false },
		],
		/** Stable reverse traversal over unopened corpses in the world-object ring. */
		previousUnopenedCorpse: [
			{ key: "v", shift: true, ctrl: false, alt: false, meta: false },
		],
		/** Use the currently selected entity. */
		interact: [{ key: "r" }],
		/** Request authoritative examination facts for the selected entity. */
		examine: [{ key: "e", shift: false, ctrl: false, alt: false, meta: false }],
		/** Toggle peace/combat with either character on the backquote key. */
		toggleCombat: [
			{ key: "`", ctrl: false, alt: false, meta: false },
			{ key: "~", ctrl: false, alt: false, meta: false },
		],
		/** Give the selected inventory item to the previous selected recipient. */
		give: [{ key: "g", ctrl: false, alt: false, meta: false }],
		/** Toggle persistent forward movement while gameplay owns the keyboard. */
		toggleAutoRun: [{ key: "q", ctrl: false, alt: false, meta: false }],
		/** Enter the aimed jump interaction. */
		preciseJump: [{ key: "j", shift: true }],
		/** Cancel the active context, then clear selection when gameplay owns Escape. */
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
	/** Exact modifier chords for gameplay spell tabs and casting. */
	spellBar: {
		tabs: {
			0: [
				{ code: "Digit1", shift: true, ctrl: false, alt: false, meta: false },
			],
			1: [
				{ code: "Digit2", shift: true, ctrl: false, alt: false, meta: false },
			],
			2: [
				{ code: "Digit3", shift: true, ctrl: false, alt: false, meta: false },
			],
			3: [
				{ code: "Digit4", shift: true, ctrl: false, alt: false, meta: false },
			],
			4: [
				{ code: "Digit5", shift: true, ctrl: false, alt: false, meta: false },
			],
			5: [
				{ code: "Digit6", shift: true, ctrl: false, alt: false, meta: false },
			],
			6: [
				{ code: "Digit7", shift: true, ctrl: false, alt: false, meta: false },
			],
			7: [
				{ code: "Digit8", shift: true, ctrl: false, alt: false, meta: false },
			],
			8: [
				{ code: "Digit9", shift: true, ctrl: false, alt: false, meta: false },
			],
			9: [
				{ code: "Digit0", shift: true, ctrl: false, alt: false, meta: false },
			],
		},
		cells: {
			0: [
				{ code: "Digit1", shift: false, ctrl: false, alt: false, meta: false },
			],
			1: [
				{ code: "Digit2", shift: false, ctrl: false, alt: false, meta: false },
			],
			2: [
				{ code: "Digit3", shift: false, ctrl: false, alt: false, meta: false },
			],
			3: [
				{ code: "Digit4", shift: false, ctrl: false, alt: false, meta: false },
			],
			4: [
				{ code: "Digit5", shift: false, ctrl: false, alt: false, meta: false },
			],
			5: [
				{ code: "Digit6", shift: false, ctrl: false, alt: false, meta: false },
			],
			6: [
				{ code: "Digit7", shift: false, ctrl: false, alt: false, meta: false },
			],
			7: [
				{ code: "Digit8", shift: false, ctrl: false, alt: false, meta: false },
			],
			8: [
				{ code: "Digit9", shift: false, ctrl: false, alt: false, meta: false },
			],
			9: [
				{ code: "Digit0", shift: false, ctrl: false, alt: false, meta: false },
			],
		},
	},
	/** Direct attack-power/accuracy selection while a physical combat HUD is active. */
	combatBar: {
		breakpoints: {
			0: [
				{ code: "Digit1", shift: false, ctrl: false, alt: false, meta: false },
			],
			1: [
				{ code: "Digit2", shift: false, ctrl: false, alt: false, meta: false },
			],
			2: [
				{ code: "Digit3", shift: false, ctrl: false, alt: false, meta: false },
			],
			3: [
				{ code: "Digit4", shift: false, ctrl: false, alt: false, meta: false },
			],
			4: [
				{ code: "Digit5", shift: false, ctrl: false, alt: false, meta: false },
			],
		},
		heights: {
			0: [
				{ code: "Digit1", shift: true, ctrl: false, alt: false, meta: false },
			],
			1: [
				{ code: "Digit2", shift: true, ctrl: false, alt: false, meta: false },
			],
			2: [
				{ code: "Digit3", shift: true, ctrl: false, alt: false, meta: false },
			],
		},
	},
	/** Action bar shortcuts. Numbered entries use zero-based positions (0 is bar/cell 1, 9 is 0).
	 * Physical codes keep digits addressable while Shift changes their printed characters.
	 * Cell/confirm bindings allow modifiers so the alternate-side modifier can be remapped freely.
	 */
	actionBars: {
		focus: {
			0: [
				{ code: "Digit1", ctrl: true, shift: false, alt: false, meta: false },
			],
			1: [
				{ code: "Digit2", ctrl: true, shift: false, alt: false, meta: false },
			],
			2: [
				{ code: "Digit3", ctrl: true, shift: false, alt: false, meta: false },
			],
			3: [
				{ code: "Digit4", ctrl: true, shift: false, alt: false, meta: false },
			],
			4: [
				{ code: "Digit5", ctrl: true, shift: false, alt: false, meta: false },
			],
			5: [
				{ code: "Digit6", ctrl: true, shift: false, alt: false, meta: false },
			],
			6: [
				{ code: "Digit7", ctrl: true, shift: false, alt: false, meta: false },
			],
			7: [
				{ code: "Digit8", ctrl: true, shift: false, alt: false, meta: false },
			],
			8: [
				{ code: "Digit9", ctrl: true, shift: false, alt: false, meta: false },
			],
			9: [
				{ code: "Digit0", ctrl: true, shift: false, alt: false, meta: false },
			],
		},
		cells: {
			0: [{ code: "Digit1" }],
			1: [{ code: "Digit2" }],
			2: [{ code: "Digit3" }],
			3: [{ code: "Digit4" }],
			4: [{ code: "Digit5" }],
			5: [{ code: "Digit6" }],
			6: [{ code: "Digit7" }],
			7: [{ code: "Digit8" }],
			8: [{ code: "Digit9" }],
			9: [{ code: "Digit0" }],
		},
		commands: {
			up: [{ key: "ArrowUp" }],
			down: [{ key: "ArrowDown" }],
			left: [{ key: "ArrowLeft" }],
			right: [{ key: "ArrowRight" }],
			confirm: [{ key: "Enter" }],
			cancel: [{ key: "Escape" }],
		},
		alternate: "shift",
	},
	/** Viewport gesture activation buttons. */
	pointer: {
		/** Client click selection and drag orbit share one gesture. */
		clientInteract: [0],
		/** Select and examine a viewport entity. */
		clientExamine: [2],
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
