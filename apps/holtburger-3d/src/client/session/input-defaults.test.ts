import { describe, expect, it } from "vitest";
import { AppInput } from "../../lib/input/app-input";
import { createInputDefaults } from "../../lib/input/input-defaults";
import { INPUT_PLATFORMS } from "../../lib/input/input-platform";
import {
	CLIENT_BINDING_ROWS,
	conflictingClientBindings,
} from "../settings/binding-catalog";
import {
	createClientInputDefaults,
	clientInputSettingsSchema,
} from "../settings/input-settings";

describe("platform input defaults", () => {
	it.each(INPUT_PLATFORMS)(
		"supports word deletion defaults, rebinding, and clearing on %s",
		(platform) => {
			const defaults = createInputDefaults(platform);
			const input = new AppInput(defaults);
			const chord = {
				key: "w",
				shiftKey: false,
				ctrlKey: true,
				altKey: false,
				metaKey: false,
			};
			expect(input.shortcut("chatDeletePreviousWord", chord)).toBe(true);
			for (const modifier of ["shiftKey", "altKey", "metaKey"] as const)
				expect(
					input.shortcut("chatDeletePreviousWord", {
						...chord,
						[modifier]: true,
					}),
				).toBe(false);
			input.replaceConfiguration({
				...defaults,
				client: { ...defaults.client, chatDeletePreviousWord: [{ key: "F8" }] },
			});
			expect(input.shortcut("chatDeletePreviousWord", chord)).toBe(false);
			expect(
				input.shortcut("chatDeletePreviousWord", {
					key: "F8",
					shiftKey: false,
				}),
			).toBe(true);
			input.replaceConfiguration({
				...defaults,
				client: { ...defaults.client, chatDeletePreviousWord: [] },
			});
			expect(
				input.shortcut("chatDeletePreviousWord", {
					key: "F8",
					shiftKey: false,
				}),
			).toBe(false);
		},
	);
	it.each(INPUT_PLATFORMS)(
		"resolves usable history controls on %s",
		(platform) => {
			const defaults = createInputDefaults(platform);
			const input = new AppInput(defaults);
			expect(
				input.shortcut("holdChatHistory", { key: "Meta", shiftKey: false }),
			).toBe(platform === "mac");
			expect(
				input.shortcut("holdChatHistory", { key: "Control", shiftKey: false }),
			).toBe(platform !== "mac");
			const settings = createClientInputDefaults(platform);
			expect(clientInputSettingsSchema.parse(settings)).toEqual(settings);
			const row = CLIENT_BINDING_ROWS.find(
				(entry) => entry.id === "client.holdChatHistory",
			);
			if (row === undefined)
				throw new Error("Missing held-history binding definition");
			for (const binding of settings.client.holdChatHistory)
				expect(conflictingClientBindings(settings, row, binding, null)).toEqual(
					[],
				);
		},
	);

	it("preserves explicit saved choices independently of platform defaults", () => {
		for (const binding of [[], [{ key: "Control" }], [{ key: "F12" }]]) {
			const defaults = createClientInputDefaults("mac");
			const saved = {
				...defaults,
				client: { ...defaults.client, holdChatHistory: binding },
			};
			expect(
				clientInputSettingsSchema.parse(saved).client.holdChatHistory,
			).toEqual(binding);
		}
	});

	it("creates independent binding arrays for editing and reset", () => {
		const first = createClientInputDefaults("mac");
		const second = createClientInputDefaults("mac");
		expect(first).toEqual(second);
		expect(first.client.holdChatHistory).not.toBe(
			second.client.holdChatHistory,
		);
		expect(first.character.forward).not.toBe(second.character.forward);
	});
});
