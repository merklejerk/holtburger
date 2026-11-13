import type { InputPlatform } from "../lib/input/input-platform.js";
import equal from "fast-deep-equal";
import { z } from "zod";
import { createInputDefaults } from "../lib/input/input-defaults.js";
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
		// Normalize saved Space bindings to the same physical selector as new captures.
		.transform(({ key, ...modifiers }) =>
			key === " " ? { code: "Space", ...modifiers } : { key, ...modifiers },
		)
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
			.readonly(),
		client: z.preprocess(
			// Normalize retired shortcut identities without inserting default bindings.
			(value) => {
				if (typeof value !== "object" || value === null || Array.isArray(value))
					return value;
				const current = { ...value };
				// Rename saved actions without replacing explicit new-name bindings (including unbound lists).
				for (const [oldAction, action] of [
					["nextInteractable", "nextSmartCombat"],
					["previousInteractable", "previousSmartCombat"],
					["nextCreature", "nextSmartCombat"],
					["previousCreature", "previousSmartCombat"],
					["nextUnopenedCorpse", "nextCorpse"],
					["previousUnopenedCorpse", "previousCorpse"],
				] as const) {
					if (!Reflect.has(current, action) && Reflect.has(current, oldAction))
						Reflect.set(current, action, Reflect.get(current, oldAction));
					Reflect.deleteProperty(current, oldAction);
				}
				// Retired acquisition actions must not invalidate an otherwise usable saved profile.
				Reflect.deleteProperty(current, "nextHostile");
				Reflect.deleteProperty(current, "previousHostile");
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

/** Change detection covers exactly the persisted keyboard groups, excluding mouse preferences. */
const keyboardGroups = Object.keys(
	clientKeyboardSettingsSchema.unwrap().shape,
) as (keyof ClientKeyboardConfiguration)[];

/** Platform-independent preferences shared by construction and missing-field validation. */
const inputPreferenceDefaults = {
	targetOnlyInView: false,
	smartTabHostileOnly: false,
	mouseMovement: true,
	invertCameraHorizontal: false,
	invertCameraVertical: false,
	invertSteeringHorizontal: false,
	invertSteeringVertical: false,
} as const;

/** Resolve keyboard groups for per-binding reset and persisted keyboard contracts. */
export function createClientKeyboardDefaults(
	platform: InputPlatform,
): ClientKeyboardConfiguration {
	const { character, preciseJump, client, spellBar, combatBar, actionBars } =
		createInputDefaults(platform);
	return { character, preciseJump, client, spellBar, combatBar, actionBars };
}

/** Build first-run and complete reset policy from one explicit platform fact. */
export function createClientInputDefaults(
	platform: InputPlatform,
): ClientInputConfiguration {
	return {
		...createClientKeyboardDefaults(platform),
		...inputPreferenceDefaults,
	};
}

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
			/** Profiles without this preference inherit the default target acquisition policy. */
			targetOnlyInView: z
				.boolean()
				.default(inputPreferenceDefaults.targetOnlyInView),
			/** Older profiles retain broad smart Tab acquisition. */
			smartTabHostileOnly: z
				.boolean()
				.default(inputPreferenceDefaults.smartTabHostileOnly),
			mouseMovement: z.boolean().default(inputPreferenceDefaults.mouseMovement),
			invertCameraHorizontal: z
				.boolean()
				.default(inputPreferenceDefaults.invertCameraHorizontal),
			invertCameraVertical: z
				.boolean()
				.default(inputPreferenceDefaults.invertCameraVertical),
			invertSteeringHorizontal: z
				.boolean()
				.default(inputPreferenceDefaults.invertSteeringHorizontal),
			invertSteeringVertical: z
				.boolean()
				.default(inputPreferenceDefaults.invertSteeringVertical),
		})
		.strict()
		.readonly(),
);

/** Resolve keyboard policy while retaining Explorer camera maps; client mouse policy has its own owner. */
export function clientInputConfiguration(
	keyboard: ClientKeyboardConfiguration,
	platform: InputPlatform,
): InputConfiguration {
	return {
		...createInputDefaults(platform),
		...keyboard,
	};
}

/** Acquisition and axis preferences do not change physical key ownership; only binding edits require cancellation. */
export function clientKeyboardSettingsEqual(
	left: ClientKeyboardConfiguration,
	right: ClientKeyboardConfiguration,
): boolean {
	return keyboardGroups.every((group) => equal(left[group], right[group]));
}
