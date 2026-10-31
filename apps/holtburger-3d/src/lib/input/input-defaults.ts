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
	/** Held controls active only during precise targeting. */
	preciseJump: {
		/** Raise the selected jump power continuously. */
		increasePower: [{ key: "w" }],
		/** Lower the selected jump power continuously. */
		decreasePower: [{ key: "s" }],
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
		/** Toggle the inventory system panel. */
		toggleInventory: [
			{ key: "b", shift: false, ctrl: false, alt: false, meta: false },
		],
		/** Toggle the character system panel. */
		toggleCharacter: [
			{ key: "f", shift: false, ctrl: false, alt: false, meta: false },
		],
		/** Toggle the social system panel. */
		toggleSocial: [
			{ key: "o", shift: false, ctrl: false, alt: false, meta: false },
		],
		/** Toggle the world system panel. */
		toggleWorld: [
			{ key: "m", shift: false, ctrl: false, alt: false, meta: false },
		],
		/** Toggle the journal system panel. */
		toggleJournal: [
			{ key: "j", shift: false, ctrl: false, alt: false, meta: false },
		],
		/** Toggle the settings system panel. */
		toggleSettings: [
			{ key: "F10", shift: false, ctrl: false, alt: false, meta: false },
		],
		/** Toggle the independent nearby entity list and alerts window. */
		toggleNearby: [
			{ key: "f", shift: false, ctrl: true, alt: false, meta: false },
		],

		/** Select the authoritative local player identity. */
		selectSelf: [{ key: "x", ctrl: false, alt: false, meta: false }],
		/** Forward traversal over creatures and usable non-corpse objects, honoring the target view preference. */
		nextInteractable: [
			{ key: "Tab", shift: false, ctrl: false, alt: false, meta: false },
		],
		/** Reverse traversal over creatures and usable non-corpse objects, honoring the target view preference. */
		previousInteractable: [
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
		/** Forward traversal restricted to world-classified hostile creatures. */
		nextHostile: [
			{ key: "e", shift: false, ctrl: true, alt: false, meta: false },
		],
		/** Reverse traversal restricted to world-classified hostile creatures. */
		previousHostile: [
			{ key: "e", shift: true, ctrl: true, alt: false, meta: false },
		],
		/** Use the currently selected entity. */
		interact: [{ key: "r", ctrl: false, alt: false, meta: false }],
		/** Request authoritative examination facts for the selected entity. */
		examine: [{ key: "e", shift: false, ctrl: false, alt: false, meta: false }],
		/** Toggle peace/combat with either character on the backquote key. */
		toggleCombat: [
			{ key: "`", ctrl: false, alt: false, meta: false },
			{ key: "~", ctrl: false, alt: false, meta: false },
		],
		/** Give the selected inventory item to the last selected eligible recipient. */
		give: [{ key: "g", ctrl: false, alt: false, meta: false }],
		/** Open the quantity dialog for the selected owned stack. */
		splitStack: [
			{ key: "y", shift: false, ctrl: false, alt: false, meta: false },
		],
		/** Toggle persistent forward movement while gameplay owns the keyboard. */
		toggleAutoRun: [{ key: "q", ctrl: false, alt: false, meta: false }],
		/** Enter the aimed jump interaction. */
		preciseJump: [{ key: "j", shift: true }],
		/** Cancel the active context, then clear selection when gameplay owns Escape. */
		cancel: [{ key: "Escape" }],
		/** Activate chat while the game owns the keyboard. */
		chat: [{ key: "Enter", ctrl: false, alt: false, meta: false }],
		/** Hold to browse curated social emotes while gameplay owns input. */
		openEmotes: [
			{ key: "t", shift: false, ctrl: false, alt: false, meta: false },
		],
		/** Toggle history interaction outside editors; native selection copy takes precedence. */
		toggleChatHistory: [
			{ key: "c", ctrl: true, shift: false, alt: false, meta: false },
		],
		/** Temporarily enable history pointer interaction without taking typing focus. */
		holdChatHistory: [{ key: "Control" }],
		/** Scroll toward earlier messages while chat owns focus. */
		chatPreviousPage: [{ key: "PageUp" }],
		/** Scroll toward later messages while chat owns focus. */
		chatNextPage: [{ key: "PageDown" }],
	},
	/** Exact modifier chords for gameplay spell tabs and casting. */
	spellBar: {
		caster: [
			{ code: "Digit1", ctrl: true, shift: true, alt: false, meta: false },
		],
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
		},
		alternate: "shift",
	},
	/** Viewport gesture activation buttons. */
	pointer: {
		/** Drag to orbit the possessed Explorer character. */
		possessionOrbit: [0],
		/** Drag to rotate an Explorer fly camera. */
		flyRotate: [0],
		/** Drag to translate an Explorer fly camera. */
		flyPan: [1, 2],
	},
} satisfies InputConfiguration;
