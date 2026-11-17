import { expect, it } from "vitest";
import {
	createClientInputDefaults,
	clientInputSettingsSchema,
} from "../src/client/client-input-settings";
import { repairSettingsValue } from "./settings-value-repair";

it("adds word deletion to older profiles while preserving custom and unbound actions", () => {
	const defaults = createClientInputDefaults("windows");
	const { chatDeletePreviousWord, ...olderActions } = defaults.client;
	const raw = {
		...defaults,
		client: { ...olderActions, chat: [], toggleInventory: [{ key: "F9" }] },
	};
	const repaired = repairSettingsValue(
		raw,
		clientInputSettingsSchema,
		defaults,
		"input",
	);
	expect(repaired.notices).toEqual([]);
	expect(repaired.value.client).toEqual({
		...raw.client,
		chatDeletePreviousWord,
	});
	expect(
		clientInputSettingsSchema.parse({
			...repaired.value,
			client: { ...repaired.value.client, chatDeletePreviousWord: [] },
		}).client.chatDeletePreviousWord,
	).toEqual([]);
});

it("adds the console key only when an older profile leaves it free", () => {
	const defaults = createClientInputDefaults("windows");
	const { toggleConsole, ...olderActions } = defaults.client;
	const oldProfile = { ...defaults, client: olderActions };
	expect(
		clientInputSettingsSchema.parse(oldProfile).client.toggleConsole,
	).toEqual(toggleConsole);

	const occupied = {
		...oldProfile,
		character: { ...oldProfile.character, forward: [{ code: "F9" }] },
	};
	const restored = clientInputSettingsSchema.parse(occupied);
	expect(restored.client.toggleConsole).toEqual([]);
	expect(restored.character.forward).toEqual(occupied.character.forward);
	expect(
		clientInputSettingsSchema.parse({
			...oldProfile,
			client: { ...olderActions, toggleConsole: [] },
		}).client.toggleConsole,
	).toEqual([]);
});
