import { z } from "zod";
import { INPUT_DEFAULTS } from "../lib/input/input-defaults.js";
import {
	ACTION_BAR_COMMANDS,
	CHARACTER_ACTIONS,
	PRECISE_JUMP_ACTIONS,
	CLIENT_SHORTCUT_ACTIONS,
	COMBAT_BREAKPOINT_KEYS,
	COMBAT_HEIGHT_KEYS,
	INPUT_DIGIT_KEYS,
	type ClientKeyboardConfiguration,
	type ClientInputConfiguration,
	type InputConfiguration,
} from "../lib/input/input-contract.js";

const modifiers = {
	shift: z.boolean().optional(),
	ctrl: z.boolean().optional(),
	alt: z.boolean().optional(),
	meta: z.boolean().optional(),
};
const keyBindingSchema = z.union([
	z
		.object({ key: z.string().min(1), ...modifiers })
		.strict()
		.readonly(),
	z
		.object({ code: z.string().min(1), ...modifiers })
		.strict()
		.readonly(),
]);
const bindingListSchema = z.array(keyBindingSchema).readonly();
const digitBindingsSchema = z
	.record(z.enum(INPUT_DIGIT_KEYS), bindingListSchema)
	.readonly();

/** Shared keyboard fields before the spell-bar caster shortcut is added. */
const keyboardSettingsBaseSchema = z
	.object({
		character: z
			.record(z.enum(CHARACTER_ACTIONS), bindingListSchema)
			.readonly(),
		preciseJump: z
			.record(z.enum(PRECISE_JUMP_ACTIONS), bindingListSchema)
			.readonly()
			.default(INPUT_DEFAULTS.preciseJump),
		client: z.preprocess(
			// Fill missing shortcut defaults without replacing saved bindings; retire old jump step actions.
			(value) => {
				if (typeof value !== "object" || value === null || Array.isArray(value))
					return value;
				const current = {
					toggleInventory: INPUT_DEFAULTS.client.toggleInventory,
					toggleCharacter: INPUT_DEFAULTS.client.toggleCharacter,
					toggleSocial: INPUT_DEFAULTS.client.toggleSocial,
					toggleWorld: INPUT_DEFAULTS.client.toggleWorld,
					toggleJournal: INPUT_DEFAULTS.client.toggleJournal,
					toggleSettings: INPUT_DEFAULTS.client.toggleSettings,

					splitStack: INPUT_DEFAULTS.client.splitStack,
					toggleChatHistory: INPUT_DEFAULTS.client.toggleChatHistory,
					holdChatHistory: INPUT_DEFAULTS.client.holdChatHistory,
					...value,
				};
				Reflect.deleteProperty(current, "preciseJumpPowerUp");
				Reflect.deleteProperty(current, "preciseJumpPowerDown");
				return current;
			},
			z.record(z.enum(CLIENT_SHORTCUT_ACTIONS), bindingListSchema).readonly(),
		),
		spellBar: z
			.object({ tabs: digitBindingsSchema, cells: digitBindingsSchema })
			.strict()
			.readonly(),
		combatBar: z
			.object({
				breakpoints: z
					.record(z.enum(COMBAT_BREAKPOINT_KEYS), bindingListSchema)
					.readonly(),
				heights: z
					.record(z.enum(COMBAT_HEIGHT_KEYS), bindingListSchema)
					.readonly(),
			})
			.strict()
			.readonly(),
		actionBars: z
			.object({
				focus: digitBindingsSchema,
				cells: digitBindingsSchema,
				commands: z
					.record(z.enum(ACTION_BAR_COMMANDS), bindingListSchema)
					.readonly(),
				alternate: z.enum(["shift", "ctrl", "alt", "meta"]),
			})
			.strict()
			.readonly(),
	})
	.strict()
	.readonly();

/** Keyboard-only schema used as the base of persisted client input. */
export const clientKeyboardSettingsSchema = keyboardSettingsBaseSchema
	.unwrap()
	.extend({
		spellBar: keyboardSettingsBaseSchema
			.unwrap()
			.shape.spellBar.unwrap()
			.extend({ caster: bindingListSchema })
			.strict()
			.readonly(),
	})
	.strict()
	.readonly();

/** Keyboard defaults shared by per-action resets and complete input defaults. */
export const CLIENT_KEYBOARD_DEFAULTS: ClientKeyboardConfiguration = {
	character: INPUT_DEFAULTS.character,
	preciseJump: INPUT_DEFAULTS.preciseJump,
	client: INPUT_DEFAULTS.client,
	spellBar: INPUT_DEFAULTS.spellBar,
	combatBar: INPUT_DEFAULTS.combatBar,
	actionBars: INPUT_DEFAULTS.actionBars,
};

/** Complete client input defaults, shared by resets and missing-field normalization. */
export const CLIENT_INPUT_DEFAULTS: ClientInputConfiguration = {
	...CLIENT_KEYBOARD_DEFAULTS,
	mouseMovement: true,
};

/** User-scoped input; retiring the old mouse block must not discard saved keyboard bindings. */
export const clientInputSettingsSchema = z.preprocess(
	(value) => {
		if (typeof value !== "object" || value === null || Array.isArray(value))
			return value;
		const current = { ...value };
		Reflect.deleteProperty(current, "mouse");
		return current;
	},
	clientKeyboardSettingsSchema
		.unwrap()
		.extend({
			mouseMovement: z.boolean().default(CLIENT_INPUT_DEFAULTS.mouseMovement),
		})
		.strict()
		.readonly(),
);

/** Resolve keyboard policy while retaining Explorer camera maps; client mouse policy has its own owner. */
export function clientInputConfiguration(
	keyboard: ClientKeyboardConfiguration,
): InputConfiguration {
	return {
		...INPUT_DEFAULTS,
		...keyboard,
	};
}
