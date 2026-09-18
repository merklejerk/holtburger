import { describe, expect, it } from "vitest";
import {
	clientLocalSettingsDocumentV1Schema,
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
		schemaVersion: 1 as const,
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

describe("client settings contract", () => {
	it("accepts and round-trips runtime defaults", () => {
		const value = document();
		expect(parseClientLocalSettingsDocument(value)).toEqual(value);
		expect(clientLocalSettingsDocumentV1Schema.parse(value)).toEqual(value);
	});

	it("rejects unknown fields and unsupported versions", () => {
		expect(() => parseClientLocalSettingsDocument({})).toThrow(
			"Client settings document has no schemaVersion",
		);
		expect(() =>
			parseClientLocalSettingsDocument({ ...document(), extra: true }),
		).toThrow();
		expect(() =>
			parseClientLocalSettingsDocument({ ...document(), schemaVersion: 2 }),
		).toThrow("Unsupported client settings schema version 2");
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
