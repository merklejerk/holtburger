import { describe, expect, it } from "vitest";
import {
	clientLocalSettingsDocumentV1Schema,
	clientLocalSettingsDocumentV2Schema,
	clientLocalSettingsDocumentV3Schema,
	clientUserSettingsSchema,
	parseClientCharacterSettings,
	parseClientLocalSettingsDocument,
} from "./client-settings-contract";
import {
	createDefaultClientCharacterSettings,
	createDefaultClientUserSettings,
} from "./client-settings-defaults";

const viewport = { width: 1440, height: 900 };

function document() {
	return {
		schemaVersion: 3 as const,
		user: {
			window: {
				normalBounds: { x: 100, y: 100, width: 1440, height: 900 },
				maximized: false,
			},
			client: createDefaultClientUserSettings(viewport, 8),
		},
		characters: {
			"example.test:9000/0x50000001": {
				lastKnownName: "Example",
				settings: createDefaultClientCharacterSettings(),
			},
		},
	};
}

function versionOneDocument() {
	const current = versionTwoDocument();
	const versionOneClient = { ...current.user.client };
	const versionOneHudLayout = { ...versionOneClient.hudLayout };
	Reflect.deleteProperty(versionOneClient, "inspection");
	Reflect.deleteProperty(versionOneHudLayout, "inspection");
	return {
		...current,
		schemaVersion: 1 as const,
		user: {
			...current.user,
			client: { ...versionOneClient, hudLayout: versionOneHudLayout },
		},
	};
}

function versionTwoDocument() {
	const current = document();
	const client = { ...current.user.client };
	const hudLayout = { ...client.hudLayout };
	Reflect.deleteProperty(hudLayout, "combatBar");
	const characters = structuredClone(current.characters);
	for (const profile of Object.values(characters))
		Reflect.deleteProperty(profile.settings, "combatControls");
	return {
		...current,
		schemaVersion: 2 as const,
		user: { ...current.user, client: { ...client, hudLayout } },
		characters,
	};
}

describe("client settings contract", () => {
	it("preserves precise combat slider values", () => {
		const parsed = parseClientCharacterSettings({
			...createDefaultClientCharacterSettings(),
			combatControls: {
				melee: { height: "high", power: 0.6 },
				missile: { height: "low", accuracy: 0.625 },
			},
		});
		expect(parsed.combatControls).toEqual({
			melee: { height: "high", power: 0.6 },
			missile: { height: "low", accuracy: 0.625 },
		});
		expect(parseClientCharacterSettings(parsed)).toEqual(parsed);
	});

	it("accepts and round-trips runtime defaults", () => {
		const value = document();
		expect(parseClientLocalSettingsDocument(value)).toEqual(value);
		expect(clientLocalSettingsDocumentV3Schema.parse(value)).toEqual(value);
	});

	it("migrates v1 with stable inspection layout defaults", () => {
		const value = versionOneDocument();
		expect(clientLocalSettingsDocumentV1Schema.parse(value)).toEqual(value);
		expect(parseClientLocalSettingsDocument(value)).toEqual(document());
	});

	it("migrates v2 combat defaults without disturbing existing settings", () => {
		const value = versionTwoDocument();
		expect(clientLocalSettingsDocumentV2Schema.parse(value)).toEqual(value);
		expect(parseClientLocalSettingsDocument(value)).toEqual(document());
	});

	it("rejects unknown fields and unsupported versions", () => {
		expect(() => parseClientLocalSettingsDocument({})).toThrow(
			"Client settings document has no schemaVersion",
		);
		expect(() =>
			parseClientLocalSettingsDocument({ ...document(), extra: true }),
		).toThrow();
		expect(() =>
			parseClientLocalSettingsDocument({ ...document(), schemaVersion: 4 }),
		).toThrow("Unsupported client settings schema version 4");
	});

	it("rejects malformed fixed collections and duplicate action bar identities", () => {
		const defaults = createDefaultClientCharacterSettings();
		expect(() =>
			parseClientCharacterSettings({
				...defaults,
				spellBarBindings: {
					tabs: defaults.spellBarBindings.tabs.slice(0, 9),
				},
			}),
		).toThrow();
		expect(() =>
			parseClientCharacterSettings({
				...defaults,
				actionBars: [defaults.actionBars[0], defaults.actionBars[0]],
			}),
		).toThrow("action bar identities must be unique");
	});

	it("rejects non-finite geometry and non-canonical chat filters", () => {
		const defaults = createDefaultClientUserSettings(viewport, 8);
		expect(() =>
			clientUserSettingsSchema.parse({
				...defaults,
				hudLayout: {
					...defaults.hudLayout,
					chat: {
						...defaults.hudLayout.chat,
						preferredWidth: Number.NaN,
					},
				},
			}),
		).toThrow();
		expect(() =>
			clientUserSettingsSchema.parse({
				...defaults,
				chatFilters: ["combat", "chat"],
			}),
		).toThrow("chat filters must be unique and in canonical order");
	});
});
