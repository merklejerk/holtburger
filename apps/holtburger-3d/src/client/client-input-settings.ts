import { z } from "zod";
import { INPUT_DEFAULTS } from "../lib/input/input-defaults.js";
import {
	ACTION_BAR_COMMANDS,
	CHARACTER_ACTIONS,
	CLIENT_SHORTCUT_ACTIONS,
	COMBAT_BREAKPOINT_KEYS,
	COMBAT_HEIGHT_KEYS,
	INPUT_DIGIT_KEYS,
	type ClientKeyboardConfiguration,
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

/** Strict, user-scoped keyboard map; Explorer camera and pointer fields are excluded. */
export const clientKeyboardSettingsSchema = z
	.object({
		character: z
			.record(z.enum(CHARACTER_ACTIONS), bindingListSchema)
			.readonly(),
		client: z
			.record(z.enum(CLIENT_SHORTCUT_ACTIONS), bindingListSchema)
			.readonly(),
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

/** Historical v7 map included a configurable character-picker confirmation key. */
export const clientKeyboardSettingsV7Schema = clientKeyboardSettingsSchema
	.unwrap()
	.extend({
		client: z
			.record(
				z.enum([...CLIENT_SHORTCUT_ACTIONS, "enterWorld"] as const),
				bindingListSchema,
			)
			.readonly(),
	})
	.strict()
	.readonly();

/** Historical v6 map also included a separate focused-bar cancellation binding. */
export const clientKeyboardSettingsV6Schema = clientKeyboardSettingsV7Schema
	.unwrap()
	.extend({
		actionBars: clientKeyboardSettingsV7Schema
			.unwrap()
			.shape.actionBars.unwrap()
			.extend({
				commands: z
					.record(
						z.enum([...ACTION_BAR_COMMANDS, "cancel"] as const),
						bindingListSchema,
					)
					.readonly(),
			})
			.strict()
			.readonly(),
	})
	.strict()
	.readonly();

/** Current user keyboard defaults; Explorer and pointer policy stay outside persistence. */
export const CLIENT_KEYBOARD_DEFAULTS: ClientKeyboardConfiguration = {
	character: INPUT_DEFAULTS.character,
	client: INPUT_DEFAULTS.client,
	spellBar: INPUT_DEFAULTS.spellBar,
	combatBar: INPUT_DEFAULTS.combatBar,
	actionBars: INPUT_DEFAULTS.actionBars,
};

/** Last v6 default shape, retained for migration of v5 documents. */
export const CLIENT_KEYBOARD_V6_DEFAULTS = {
	...CLIENT_KEYBOARD_DEFAULTS,
	client: {
		...CLIENT_KEYBOARD_DEFAULTS.client,
		enterWorld: [{ key: "Enter" }],
	},
	actionBars: {
		...CLIENT_KEYBOARD_DEFAULTS.actionBars,
		commands: {
			...CLIENT_KEYBOARD_DEFAULTS.actionBars.commands,
			cancel: [{ key: "Escape" }],
		},
	},
};

/** Build one client-owned resolved policy while retaining fixed pointer and Explorer fly maps. */
export function clientInputConfiguration(
	keyboard: ClientKeyboardConfiguration,
): InputConfiguration {
	return {
		...INPUT_DEFAULTS,
		...keyboard,
	};
}
