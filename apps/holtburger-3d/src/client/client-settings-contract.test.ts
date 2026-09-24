import { describe, expect, it } from "vitest";
import { SPELL_BAR_INDICES } from "./client-spell-bar-state";
import {
	clientLocalSettingsDocumentV1Schema,
	clientLocalSettingsDocumentV2Schema,
	clientLocalSettingsDocumentV3Schema,
	clientLocalSettingsDocumentV4Schema,
	clientLocalSettingsDocumentV5Schema,
	clientLocalSettingsDocumentV6Schema,
	clientLocalSettingsDocumentV7Schema,
	clientLocalSettingsDocumentV8Schema,
	clientLocalSettingsDocumentV9Schema,
	clientLocalSettingsDocumentV10Schema,
	clientLocalSettingsDocumentV11Schema,
	clientLocalSettingsDocumentV12Schema,
	clientUserSettingsSchema,
	parseClientCharacterSettings,
	parseClientLocalSettingsDocument,
} from "./client-settings-contract";
import {
	createDefaultClientCharacterSettings,
	createDefaultClientUserSettings,
} from "./client-settings-defaults";
import { resolveClientHudPlacement } from "./client-hud-layout";
import { rotateHudTray, hudTrayOrientation } from "./client-hud-tray-layout";

const viewport = { width: 1440, height: 900 };

/** Historical v11 migration output stays fixed when live HUD defaults change. */
const migratedStatusTray = {
	horizontal: { alignment: "start", offset: 16 },
	vertical: { alignment: "start", offset: 96 },
	preferredWidth: 158,
	preferredHeight: 32,
} as const;

function document() {
	return {
		schemaVersion: 12 as const,
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

function versionElevenDocument() {
	const current = document();
	const { enchantments, ...hudLayout } = current.user.client.hudLayout;
	void enchantments;
	return {
		...current,
		schemaVersion: 11 as const,
		user: { ...current.user, client: { ...current.user.client, hudLayout } },
	};
}

function versionTenDocument() {
	const current = versionElevenDocument();
	const { statusTray, ...hudLayout } = current.user.client.hudLayout;
	void statusTray;
	return {
		...current,
		schemaVersion: 10 as const,
		user: {
			...current.user,
			client: {
				...current.user.client,
				hudLayout: {
					...hudLayout,
					character: { ...hudLayout.character, preferredHeight: 132 },
				},
			},
		},
	};
}

function versionNineDocument() {
	const current = versionTenDocument();
	const { vendor, ...hudLayout } = current.user.client.hudLayout;
	void vendor;
	return {
		...current,
		schemaVersion: 9 as const,
		user: { ...current.user, client: { ...current.user.client, hudLayout } },
	};
}

function versionEightDocument() {
	const current = versionNineDocument();
	const { caster, ...spellBar } = current.user.client.input.spellBar;
	void caster;
	return {
		...current,
		schemaVersion: 8 as const,
		user: {
			...current.user,
			client: {
				...current.user.client,
				input: { ...current.user.client.input, spellBar },
			},
		},
	};
}

function versionSevenDocument() {
	const current = versionEightDocument();
	return {
		...current,
		schemaVersion: 7 as const,
		user: {
			...current.user,
			client: {
				...current.user.client,
				input: {
					...current.user.client.input,
					client: {
						...current.user.client.input.client,
						enterWorld: [{ key: "Enter" }],
					},
				},
			},
		},
	};
}

function versionSixDocument() {
	const current = versionSevenDocument();
	return {
		...current,
		schemaVersion: 6 as const,
		user: {
			...current.user,
			client: {
				...current.user.client,
				input: {
					...current.user.client.input,
					actionBars: {
						...current.user.client.input.actionBars,
						commands: {
							...current.user.client.input.actionBars.commands,
							cancel: [{ key: "Escape" }],
						},
					},
				},
			},
		},
	};
}

function versionFiveDocument() {
	const current = versionSixDocument();
	const { input, ...client } = current.user.client;
	void input;
	return {
		...current,
		schemaVersion: 5 as const,
		user: { ...current.user, client },
	};
}

function versionFourDocument() {
	const current = versionFiveDocument();
	const { ui, ...client } = current.user.client;
	void ui;
	return {
		...current,
		schemaVersion: 4 as const,
		user: { ...current.user, client },
	};
}

function versionThreeDocument() {
	const current = versionFourDocument();
	const { graphics, ...client } = current.user.client;
	const { settings, ...hudLayout } = client.hudLayout;
	void settings;
	return {
		...current,
		schemaVersion: 3 as const,
		user: {
			...current.user,
			client: { ...client, hudLayout, weatherEnabled: graphics.weatherEnabled },
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
	const current = versionThreeDocument();
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
		expect(clientLocalSettingsDocumentV12Schema.parse(value)).toEqual(value);
	});

	it("persists a rotated status tray and restores its original geometry", () => {
		const current = document();
		const horizontal = current.user.client.hudLayout.statusTray;
		const vertical = rotateHudTray(horizontal);
		const rotated = {
			...current,
			user: {
				...current.user,
				client: {
					...current.user.client,
					hudLayout: { ...current.user.client.hudLayout, statusTray: vertical },
				},
			},
		};
		expect(hudTrayOrientation(vertical)).toBe("vertical");
		expect(parseClientLocalSettingsDocument(rotated)).toEqual(rotated);
		expect(rotateHudTray(vertical)).toEqual(horizontal);
	});

	it("rejects a tray placement that cannot encode an orientation", () => {
		const current = document();
		const invalid = {
			...current,
			user: {
				...current.user,
				client: {
					...current.user.client,
					hudLayout: {
						...current.user.client.hudLayout,
						statusTray: {
							...current.user.client.hudLayout.statusTray,
							preferredHeight:
								current.user.client.hudLayout.statusTray.preferredWidth,
						},
					},
				},
			},
		};
		expect(() => parseClientLocalSettingsDocument(invalid)).toThrow(
			"status tray needs positive dimensions with a distinct long axis",
		);
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

	it("migrates v3 weather and HUD placement into user preferences", () => {
		const value = versionThreeDocument();
		expect(clientLocalSettingsDocumentV3Schema.parse(value)).toEqual(value);
		expect(parseClientLocalSettingsDocument(value)).toEqual(document());
	});

	it("migrates v4 font roles without changing graphics or character settings", () => {
		const value = versionFourDocument();
		expect(clientLocalSettingsDocumentV4Schema.parse(value)).toEqual(value);
		expect(parseClientLocalSettingsDocument(value)).toEqual(document());
	});

	it("migrates v5 keyboard defaults into user preferences", () => {
		const value = versionFiveDocument();
		expect(clientLocalSettingsDocumentV5Schema.parse(value)).toEqual(value);
		expect(parseClientLocalSettingsDocument(value)).toEqual(document());
	});

	it("migrates v6 by retiring only the duplicate focused-bar cancel binding", () => {
		const value = versionSixDocument();
		expect(clientLocalSettingsDocumentV6Schema.parse(value)).toEqual(value);
		expect(parseClientLocalSettingsDocument(value)).toEqual(document());
		const remapped = {
			...value,
			user: {
				...value.user,
				client: {
					...value.user.client,
					input: {
						...value.user.client.input,
						client: {
							...value.user.client.input.client,
							cancel: [{ key: "Backspace" }],
						},
						actionBars: {
							...value.user.client.input.actionBars,
							commands: {
								...value.user.client.input.actionBars.commands,
								cancel: [{ key: "Delete" }],
							},
						},
					},
				},
			},
		};
		const migrated = parseClientLocalSettingsDocument(remapped);
		expect(migrated.user.client.input.client.cancel).toEqual([
			{ key: "Backspace" },
		]);
		expect(migrated.user.client.input.actionBars.commands).not.toHaveProperty(
			"cancel",
		);
	});

	it("migrates v7 by retiring character-picker confirmation without changing other keys", () => {
		const value = versionSevenDocument();
		expect(clientLocalSettingsDocumentV7Schema.parse(value)).toEqual(value);
		const remapped = {
			...value,
			user: {
				...value.user,
				client: {
					...value.user.client,
					input: {
						...value.user.client.input,
						client: {
							...value.user.client.input.client,
							enterWorld: [{ key: "F5" }],
							chat: [{ key: "F6" }],
						},
					},
				},
			},
		};
		const migrated = parseClientLocalSettingsDocument(remapped);
		expect(migrated.user.client.input.client).not.toHaveProperty("enterWorld");
		expect(migrated.user.client.input.client.chat).toEqual([{ key: "F6" }]);
	});

	it("migrates v8 with the default wielded-caster shortcut", () => {
		const value = versionEightDocument();
		expect(clientLocalSettingsDocumentV8Schema.parse(value)).toEqual(value);
		expect(parseClientLocalSettingsDocument(value)).toEqual(document());
	});

	it("adds vendor geometry to v9 while preserving edited existing placements", () => {
		const previous = versionNineDocument();
		const placement = {
			...previous.user.client.hudLayout.inventory,
			preferredWidth: 678,
		};
		const value = {
			...previous,
			user: {
				...previous.user,
				client: {
					...previous.user.client,
					hudLayout: {
						...previous.user.client.hudLayout,
						inventory: placement,
						character: {
							...previous.user.client.hudLayout.character,
							preferredHeight: 180,
						},
					},
				},
			},
		};
		expect(clientLocalSettingsDocumentV9Schema.parse(value)).toEqual(value);
		const migrated = parseClientLocalSettingsDocument(value);
		const { vendor, statusTray, enchantments, ...preserved } =
			migrated.user.client.hudLayout;
		expect(preserved).toEqual(value.user.client.hudLayout);
		expect(vendor.preferredWidth).toBeGreaterThan(0);
		expect(vendor.preferredHeight).toBeGreaterThan(0);
		expect(statusTray).toEqual(migratedStatusTray);
		expect(enchantments).toEqual(document().user.client.hudLayout.enchantments);
		expect(parseClientLocalSettingsDocument(migrated)).toEqual(migrated);
	});

	it("adds independent status tray geometry to v10 while preserving edited placements", () => {
		const previous = versionTenDocument();
		const character = {
			...previous.user.client.hudLayout.character,
			preferredWidth: 678,
			preferredHeight: 180,
		};
		const value = {
			...previous,
			user: {
				...previous.user,
				client: {
					...previous.user.client,
					hudLayout: { ...previous.user.client.hudLayout, character },
				},
			},
		};
		expect(clientLocalSettingsDocumentV10Schema.parse(value)).toEqual(value);
		const migrated = parseClientLocalSettingsDocument(value);
		const { statusTray, enchantments, ...preserved } =
			migrated.user.client.hudLayout;
		expect(preserved).toEqual(value.user.client.hudLayout);
		expect(statusTray).toEqual(migratedStatusTray);
		expect(enchantments).toEqual(document().user.client.hudLayout.enchantments);
	});

	it("adds enchantments placement to v11 while retaining edited geometry", () => {
		const previous = versionElevenDocument();
		const value = {
			...previous,
			user: {
				...previous.user,
				client: {
					...previous.user.client,
					hudLayout: {
						...previous.user.client.hudLayout,
						spells: {
							...previous.user.client.hudLayout.spells,
							preferredWidth: 512,
						},
					},
				},
			},
		};
		expect(clientLocalSettingsDocumentV11Schema.parse(value)).toEqual(value);
		const migrated = parseClientLocalSettingsDocument(value);
		const { enchantments, ...preserved } = migrated.user.client.hudLayout;
		expect(preserved).toEqual(value.user.client.hudLayout);
		expect(enchantments).toEqual(document().user.client.hudLayout.enchantments);
	});

	it("shrinks the historical default character height after moving its icons", () => {
		const previous = versionTenDocument();
		const migrated = parseClientLocalSettingsDocument(previous);
		expect(migrated.user.client.hudLayout.character).toEqual({
			...previous.user.client.hudLayout.character,
			preferredHeight: 72,
		});
	});

	it("places a migrated tray beside a moved character across different anchors", () => {
		const previous = versionTenDocument();
		const character = {
			...previous.user.client.hudLayout.character,
			horizontal: { alignment: "end" as const, offset: 30 },
			vertical: { alignment: "center" as const, offset: -25 },
		};
		const migrated = parseClientLocalSettingsDocument({
			...previous,
			user: {
				...previous.user,
				client: {
					...previous.user.client,
					hudLayout: { ...previous.user.client.hudLayout, character },
				},
			},
		});
		const priorRect = resolveClientHudPlacement(character, viewport, {
			width: 0,
			height: 0,
		});
		const trayRect = resolveClientHudPlacement(
			migrated.user.client.hudLayout.statusTray,
			viewport,
			{ width: 0, height: 0 },
		);
		expect(trayRect.left).toBe(priorRect.left);
		expect(trayRect.top - priorRect.top).toBe(80);
	});

	it("rejects unknown fields and unsupported versions", () => {
		expect(() => parseClientLocalSettingsDocument({})).toThrow(
			"Client settings document has no schemaVersion",
		);
		expect(() =>
			parseClientLocalSettingsDocument({ ...document(), extra: true }),
		).toThrow();
		expect(() =>
			parseClientLocalSettingsDocument({ ...document(), schemaVersion: 13 }),
		).toThrow("Unsupported client settings schema version 13");
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

	it("normalizes saved spell tabs while preserving occupied overflow addresses", () => {
		const defaults = createDefaultClientCharacterSettings();
		const tabs = [...defaults.spellBarBindings.tabs];
		tabs[0] = SPELL_BAR_INDICES.map(() => 1);
		tabs[1] = [...SPELL_BAR_INDICES.map(() => null), 2, null, null];
		const parsed = parseClientCharacterSettings({
			...defaults,
			spellBarBindings: { tabs },
		});
		expect(parsed.spellBarBindings.tabs[0]).toEqual([...tabs[0], null]);
		expect(parsed.spellBarBindings.tabs[1]).toEqual([
			...SPELL_BAR_INDICES.map(() => null),
			2,
			null,
		]);
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
