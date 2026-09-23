import { z } from "zod";
import {
	normalizeSpellTab,
	SPELL_BAR_INDICES,
} from "./client-spell-bar-state.js";
import { MAX_ACTION_BARS } from "./client-action-bar-contract.js";
import { CLIENT_INSPECTION_PREVIEW_HEIGHT } from "./client-inspection-layout.js";
import { COMBAT_GAUGE_SIZE } from "./client-combat-bar-state.js";
import { ENTITY_SHADOW_MODES } from "../lib/game/renderer/entity-shadow-modes.js";
import { TEXTURE_FILTERING_POLICIES } from "../lib/game/renderer/texture-filtering-policy.js";
import {
	CLIENT_FONT_FAMILY_OPTIONS,
	CLIENT_GRAPHICS_RANGES,
} from "./client-settings-values.js";
import {
	CLIENT_KEYBOARD_V6_DEFAULTS,
	clientKeyboardSettingsSchema,
	clientKeyboardSettingsV6Schema,
	clientKeyboardSettingsV7Schema,
	clientKeyboardSettingsV8Schema,
} from "./client-input-settings.js";

const unsigned = z.number().int().nonnegative().max(0xffff_ffff);
const positiveSafeInteger = z
	.number()
	.int()
	.positive()
	.max(Number.MAX_SAFE_INTEGER);
const finiteNumber = z.number().finite();

const hudAxisAnchorSchema = z
	.object({
		alignment: z.enum(["start", "center", "end"]),
		offset: finiteNumber,
	})
	.strict()
	.readonly();

const hudPlacementSchema = z
	.object({
		horizontal: hudAxisAnchorSchema,
		vertical: hudAxisAnchorSchema,
		preferredWidth: finiteNumber.nonnegative(),
		preferredHeight: finiteNumber.nonnegative(),
	})
	.strict()
	.readonly();

/** A fixed-size tray uses its longer saved axis to encode orientation. */
const statusTrayPlacementSchema = hudPlacementSchema.refine(
	(placement) =>
		placement.preferredWidth > 0 &&
		placement.preferredHeight > 0 &&
		placement.preferredWidth !== placement.preferredHeight,
	{
		message: "status tray needs positive dimensions with a distinct long axis",
	},
);

const clientHudLayoutV1Schema = z
	.object({
		character: hudPlacementSchema,
		spellBar: hudPlacementSchema,
		chat: hudPlacementSchema,
		spells: hudPlacementSchema,
		inventory: hudPlacementSchema,
		worldContainer: hudPlacementSchema,
		debug: hudPlacementSchema,
		frameRate: hudPlacementSchema,
		jumpPower: hudPlacementSchema,
		minimap: hudPlacementSchema,
		selectedEntity: hudPlacementSchema,
		shortcuts: hudPlacementSchema,
		toast: hudPlacementSchema,
	})
	.strict()
	.readonly();

const clientHudLayoutV2Schema = clientHudLayoutV1Schema
	.unwrap()
	.extend({ inspection: hudPlacementSchema })
	.strict()
	.readonly();

const clientHudLayoutV3Schema = clientHudLayoutV2Schema
	.unwrap()
	.extend({ combatBar: hudPlacementSchema })
	.strict()
	.readonly();

const clientHudLayoutV4Schema = clientHudLayoutV3Schema
	.unwrap()
	.extend({ settings: hudPlacementSchema })
	.strict()
	.readonly();

const chatFilterTagSchema = z.enum(["chat", "combat"]);
const chatFiltersSchema = z
	.array(chatFilterTagSchema)
	.max(2)
	.refine(
		(tags) => tags.length < 2 || (tags[0] === "chat" && tags[1] === "combat"),
		{ message: "chat filters must be unique and in canonical order" },
	)
	.readonly();

const clientUserSettingsV1Schema = z
	.object({
		hudLayout: clientHudLayoutV1Schema,
		spellBarShape: z.enum(["single", "double"]),
		minimapViewDiameters: z
			.object({
				indoor: finiteNumber.positive(),
				outdoor: finiteNumber.positive(),
			})
			.strict()
			.readonly(),
		chatFilters: chatFiltersSchema,
		weatherEnabled: z.boolean(),
	})
	.strict()
	.readonly();

/** User-scoped client presentation preferences shared by every local character. */
const clientUserSettingsV2Schema = clientUserSettingsV1Schema
	.unwrap()
	.extend({
		hudLayout: clientHudLayoutV2Schema,
		inspection: z
			.object({
				previewHeight: finiteNumber
					.min(CLIENT_INSPECTION_PREVIEW_HEIGHT.minimum)
					.max(CLIENT_INSPECTION_PREVIEW_HEIGHT.maximum),
			})
			.strict()
			.readonly(),
	})
	.strict()
	.readonly();

const clientUserSettingsV3Schema = clientUserSettingsV2Schema
	.unwrap()
	.extend({ hudLayout: clientHudLayoutV3Schema })
	.strict()
	.readonly();

/** User-scoped graphics preferences; implementation tuning stays in renderer policy. */
export const clientGraphicsSettingsSchema = z
	.object({
		viewDistance: z
			.number()
			.int()
			.min(CLIENT_GRAPHICS_RANGES.viewDistance.minimum)
			.max(CLIENT_GRAPHICS_RANGES.viewDistance.maximum),
		ambientOcclusionEnabled: z.boolean(),
		entityShadowMode: z.enum(ENTITY_SHADOW_MODES),
		verticalFovDegrees: finiteNumber
			.min(CLIENT_GRAPHICS_RANGES.verticalFovDegrees.minimum)
			.max(CLIENT_GRAPHICS_RANGES.verticalFovDegrees.maximum),
		textureFiltering: z.enum(TEXTURE_FILTERING_POLICIES),
		renderScale: finiteNumber
			.min(CLIENT_GRAPHICS_RANGES.renderScale.minimum)
			.max(CLIENT_GRAPHICS_RANGES.renderScale.maximum),
		weatherEnabled: z.boolean(),
	})
	.strict()
	.readonly();
export type ClientGraphicsSettings = z.infer<
	typeof clientGraphicsSettingsSchema
>;

const clientUserSettingsV4Schema = clientUserSettingsV3Schema
	.unwrap()
	.omit({ weatherEnabled: true })
	.extend({
		hudLayout: clientHudLayoutV4Schema,
		graphics: clientGraphicsSettingsSchema,
	})
	.strict()
	.readonly();

/** User-scoped font roles; scaling remains an intentionally disabled UI control. */
export const clientUiSettingsSchema = z
	.object({
		fonts: z
			.object({
				body: z.enum(CLIENT_FONT_FAMILY_OPTIONS),
				heading: z.enum(CLIENT_FONT_FAMILY_OPTIONS),
				mono: z.enum(CLIENT_FONT_FAMILY_OPTIONS),
			})
			.strict()
			.readonly(),
	})
	.strict()
	.readonly();
export type ClientUiSettings = z.infer<typeof clientUiSettingsSchema>;

const clientUserSettingsV5Schema = clientUserSettingsV4Schema
	.unwrap()
	.extend({ ui: clientUiSettingsSchema })
	.strict()
	.readonly();

const clientUserSettingsV6Schema = clientUserSettingsV5Schema
	.unwrap()
	.extend({ input: clientKeyboardSettingsV6Schema })
	.strict()
	.readonly();

const clientUserSettingsV7Schema = clientUserSettingsV5Schema
	.unwrap()
	.extend({ input: clientKeyboardSettingsV7Schema })
	.strict()
	.readonly();

const clientUserSettingsV8Schema = clientUserSettingsV5Schema
	.unwrap()
	.extend({ input: clientKeyboardSettingsV8Schema })
	.strict()
	.readonly();

const clientUserSettingsV9Schema = clientUserSettingsV5Schema
	.unwrap()
	.extend({ input: clientKeyboardSettingsSchema })
	.strict()
	.readonly();
/** Historical v10 user settings included vendor geometry but not the status tray. */
const clientHudLayoutV10Schema = clientHudLayoutV4Schema
	.unwrap()
	.extend({ vendor: hudPlacementSchema })
	.strict()
	.readonly();

const clientUserSettingsV10Schema = clientUserSettingsV9Schema
	.unwrap()
	.extend({ hudLayout: clientHudLayoutV10Schema })
	.strict()
	.readonly();

/** Current user settings retain the status tray independently of character vitals. */
export const clientUserSettingsSchema = clientUserSettingsV10Schema
	.unwrap()
	.extend({
		hudLayout: clientHudLayoutV10Schema
			.unwrap()
			.extend({ statusTray: statusTrayPlacementSchema })
			.strict()
			.readonly(),
	})
	.strict()
	.readonly();
export type ClientUserSettings = z.infer<typeof clientUserSettingsSchema>;

const consumableIdentitySchema = z
	.object({
		wcid: unsigned,
		category: z.enum(["food", "healing-kit", "charged-mana-stone"]),
	})
	.strict()
	.readonly();

const actionContentSchema = z
	.object({
		kind: z.enum(["equipment", "direct", "targeted"]),
		item: unsigned,
		replacement: consumableIdentitySchema.nullable(),
	})
	.strict()
	.readonly();

const actionSlotsSchema = z
	.tuple([
		actionContentSchema.nullable(),
		actionContentSchema.nullable(),
		actionContentSchema.nullable(),
		actionContentSchema.nullable(),
		actionContentSchema.nullable(),
		actionContentSchema.nullable(),
		actionContentSchema.nullable(),
		actionContentSchema.nullable(),
		actionContentSchema.nullable(),
		actionContentSchema.nullable(),
	])
	.readonly();

const actionBarSchema = z
	.object({
		id: positiveSafeInteger,
		orientation: z.enum(["horizontal", "vertical"]),
		shape: z.enum(["single", "double"]),
		anchor: z
			.object({
				horizontal: hudAxisAnchorSchema,
				vertical: hudAxisAnchorSchema,
			})
			.strict()
			.readonly(),
		slots: actionSlotsSchema,
	})
	.strict()
	.readonly();

const spellIdSchema = unsigned.positive().nullable();
const spellTabSchema = z
	.array(spellIdSchema)
	.min(SPELL_BAR_INDICES.length)
	.transform(normalizeSpellTab);
const spellTabsSchema = z
	.tuple([
		spellTabSchema,
		spellTabSchema,
		spellTabSchema,
		spellTabSchema,
		spellTabSchema,
		spellTabSchema,
		spellTabSchema,
		spellTabSchema,
		spellTabSchema,
		spellTabSchema,
	])
	.readonly();

/** Character-scoped local shortcuts, never ACE/retail configuration authority. */
const clientCharacterSettingsV2Schema = z
	.object({
		actionBars: z
			.array(actionBarSchema)
			.min(1)
			.max(MAX_ACTION_BARS)
			.refine(
				(bars) => new Set(bars.map((bar) => bar.id)).size === bars.length,
				{ message: "action bar identities must be unique" },
			)
			.readonly(),
		spellBarBindings: z.object({ tabs: spellTabsSchema }).strict().readonly(),
	})
	.strict()
	.readonly();

const attackHeightSchema = z.enum(["low", "medium", "high"]);

export const clientCharacterSettingsSchema = clientCharacterSettingsV2Schema
	.unwrap()
	.extend({
		combatControls: z
			.object({
				melee: z
					.object({
						height: attackHeightSchema,
						power: finiteNumber.min(0).max(1),
					})
					.strict()
					.readonly(),
				missile: z
					.object({
						height: attackHeightSchema,
						accuracy: finiteNumber.min(0).max(1),
					})
					.strict()
					.readonly(),
			})
			.strict()
			.readonly(),
	})
	.strict()
	.readonly();
export type ClientCharacterSettings = z.infer<
	typeof clientCharacterSettingsSchema
>;

export const clientWindowSettingsSchema = z
	.object({
		normalBounds: z
			.object({
				x: z.number().int().safe(),
				y: z.number().int().safe(),
				width: z.number().int().positive().safe(),
				height: z.number().int().positive().safe(),
			})
			.strict()
			.readonly(),
		maximized: z.boolean(),
	})
	.strict()
	.readonly();
export type ClientWindowSettings = z.infer<typeof clientWindowSettingsSchema>;

const characterProfileV2Schema = z
	.object({
		lastKnownName: z.string().min(1).max(128).nullable(),
		settings: clientCharacterSettingsV2Schema,
	})
	.strict()
	.readonly();

/** Complete first-version disk document. Partial documents are never durable. */
export const clientLocalSettingsDocumentV1Schema = z
	.object({
		schemaVersion: z.literal(1),
		user: z
			.object({
				window: clientWindowSettingsSchema,
				client: clientUserSettingsV1Schema,
			})
			.strict()
			.readonly(),
		characters: z
			.record(z.string().min(1), characterProfileV2Schema)
			.readonly(),
	})
	.strict()
	.readonly();
type ClientLocalSettingsDocumentV1 = z.infer<
	typeof clientLocalSettingsDocumentV1Schema
>;

/** Current durable document after all migrations have been applied. */
export const clientLocalSettingsDocumentV2Schema = z
	.object({
		schemaVersion: z.literal(2),
		user: z
			.object({
				window: clientWindowSettingsSchema,
				client: clientUserSettingsV2Schema,
			})
			.strict()
			.readonly(),
		characters: z
			.record(z.string().min(1), characterProfileV2Schema)
			.readonly(),
	})
	.strict()
	.readonly();
type ClientLocalSettingsDocumentV2 = z.infer<
	typeof clientLocalSettingsDocumentV2Schema
>;

const characterProfileSchema = z
	.object({
		lastKnownName: z.string().min(1).max(128).nullable(),
		settings: clientCharacterSettingsSchema,
	})
	.strict()
	.readonly();

export const clientLocalSettingsDocumentV3Schema = z
	.object({
		schemaVersion: z.literal(3),
		user: z
			.object({
				window: clientWindowSettingsSchema,
				client: clientUserSettingsV3Schema,
			})
			.strict()
			.readonly(),
		characters: z.record(z.string().min(1), characterProfileSchema).readonly(),
	})
	.strict()
	.readonly();
type ClientLocalSettingsDocumentV3 = z.infer<
	typeof clientLocalSettingsDocumentV3Schema
>;

export const clientLocalSettingsDocumentV4Schema = z
	.object({
		schemaVersion: z.literal(4),
		user: z
			.object({
				window: clientWindowSettingsSchema,
				client: clientUserSettingsV4Schema,
			})
			.strict()
			.readonly(),
		characters: z.record(z.string().min(1), characterProfileSchema).readonly(),
	})
	.strict()
	.readonly();
type ClientLocalSettingsDocumentV4 = z.infer<
	typeof clientLocalSettingsDocumentV4Schema
>;

export const clientLocalSettingsDocumentV5Schema = z
	.object({
		schemaVersion: z.literal(5),
		user: z
			.object({
				window: clientWindowSettingsSchema,
				client: clientUserSettingsV5Schema,
			})
			.strict()
			.readonly(),
		characters: z.record(z.string().min(1), characterProfileSchema).readonly(),
	})
	.strict()
	.readonly();
type ClientLocalSettingsDocumentV5 = z.infer<
	typeof clientLocalSettingsDocumentV5Schema
>;

export const clientLocalSettingsDocumentV6Schema = z
	.object({
		schemaVersion: z.literal(6),
		user: z
			.object({
				window: clientWindowSettingsSchema,
				client: clientUserSettingsV6Schema,
			})
			.strict()
			.readonly(),
		characters: z.record(z.string().min(1), characterProfileSchema).readonly(),
	})
	.strict()
	.readonly();
type ClientLocalSettingsDocumentV6 = z.infer<
	typeof clientLocalSettingsDocumentV6Schema
>;

export const clientLocalSettingsDocumentV7Schema = z
	.object({
		schemaVersion: z.literal(7),
		user: z
			.object({
				window: clientWindowSettingsSchema,
				client: clientUserSettingsV7Schema,
			})
			.strict()
			.readonly(),
		characters: z.record(z.string().min(1), characterProfileSchema).readonly(),
	})
	.strict()
	.readonly();
type ClientLocalSettingsDocumentV7 = z.infer<
	typeof clientLocalSettingsDocumentV7Schema
>;

export const clientLocalSettingsDocumentV8Schema = z
	.object({
		schemaVersion: z.literal(8),
		user: z
			.object({
				window: clientWindowSettingsSchema,
				client: clientUserSettingsV8Schema,
			})
			.strict()
			.readonly(),
		characters: z.record(z.string().min(1), characterProfileSchema).readonly(),
	})
	.strict()
	.readonly();
type ClientLocalSettingsDocumentV8 = z.infer<
	typeof clientLocalSettingsDocumentV8Schema
>;

/** Version nine introduced a configurable wielded-caster shortcut. */
export const clientLocalSettingsDocumentV9Schema = z
	.object({
		schemaVersion: z.literal(9),
		user: z
			.object({
				window: clientWindowSettingsSchema,
				client: clientUserSettingsV9Schema,
			})
			.strict()
			.readonly(),
		characters: z.record(z.string().min(1), characterProfileSchema).readonly(),
	})
	.strict()
	.readonly();
type ClientLocalSettingsDocumentV9 = z.infer<
	typeof clientLocalSettingsDocumentV9Schema
>;

/** Current durable document includes independently retained vendor geometry. */
export const clientLocalSettingsDocumentV10Schema =
	clientLocalSettingsDocumentV9Schema
		.unwrap()
		.extend({
			schemaVersion: z.literal(10),
			user: z
				.object({
					window: clientWindowSettingsSchema,
					client: clientUserSettingsV10Schema,
				})
				.strict()
				.readonly(),
		})
		.strict()
		.readonly();
type ClientLocalSettingsDocumentV10 = z.infer<
	typeof clientLocalSettingsDocumentV10Schema
>;

/** Current durable document includes independently retained status tray geometry. */
export const clientLocalSettingsDocumentV11Schema =
	clientLocalSettingsDocumentV10Schema
		.unwrap()
		.extend({
			schemaVersion: z.literal(11),
			user: z
				.object({
					window: clientWindowSettingsSchema,
					client: clientUserSettingsSchema,
				})
				.strict()
				.readonly(),
		})
		.strict()
		.readonly();
export type ClientLocalSettingsDocument = z.infer<
	typeof clientLocalSettingsDocumentV11Schema
>;

/**
 * Historical v2 defaults are fixed migration data, not live UI defaults. Future default changes
 * must not change the result of migrating the same v1 document.
 */
const V2_INSPECTION_PLACEMENT = {
	horizontal: { alignment: "end", offset: 32 },
	vertical: { alignment: "center", offset: 0 },
	preferredWidth: 410,
	preferredHeight: 500,
} as const;

function migrateClientLocalSettingsDocumentV1(
	document: ClientLocalSettingsDocumentV1,
): ClientLocalSettingsDocumentV2 {
	return clientLocalSettingsDocumentV2Schema.parse({
		...document,
		schemaVersion: 2,
		user: {
			...document.user,
			client: {
				...document.user.client,
				hudLayout: {
					...document.user.client.hudLayout,
					inspection: V2_INSPECTION_PLACEMENT,
				},
				inspection: {
					previewHeight: CLIENT_INSPECTION_PREVIEW_HEIGHT.initial,
				},
			},
		},
	});
}

function migrateClientLocalSettingsDocumentV2(
	document: ClientLocalSettingsDocumentV2,
): ClientLocalSettingsDocumentV3 {
	return clientLocalSettingsDocumentV3Schema.parse({
		...document,
		schemaVersion: 3,
		user: {
			...document.user,
			client: {
				...document.user.client,
				hudLayout: {
					...document.user.client.hudLayout,
					combatBar: {
						...document.user.client.hudLayout.spellBar,
						preferredWidth: COMBAT_GAUGE_SIZE.width,
						preferredHeight: COMBAT_GAUGE_SIZE.height,
					},
				},
			},
		},
		characters: Object.fromEntries(
			Object.entries(document.characters).map(([guid, profile]) => [
				guid,
				{
					...profile,
					settings: {
						...profile.settings,
						combatControls: {
							melee: { height: "medium", power: 0.5 },
							missile: { height: "medium", accuracy: 0.5 },
						},
					},
				},
			]),
		),
	});
}

/** Historical v4 additions retain their original absence values when defaults change. */
const V4_SETTINGS_PLACEMENT = {
	horizontal: { alignment: "end", offset: 16 },
	vertical: { alignment: "center", offset: 0 },
	preferredWidth: 430,
	preferredHeight: 500,
} as const;

function migrateClientLocalSettingsDocumentV3(
	document: ClientLocalSettingsDocumentV3,
): ClientLocalSettingsDocumentV4 {
	const { weatherEnabled, ...client } = document.user.client;
	return clientLocalSettingsDocumentV4Schema.parse({
		...document,
		schemaVersion: 4,
		user: {
			...document.user,
			client: {
				...client,
				hudLayout: {
					...client.hudLayout,
					settings: V4_SETTINGS_PLACEMENT,
				},
				graphics: {
					viewDistance: 6,
					ambientOcclusionEnabled: true,
					entityShadowMode: "shadow-maps",
					verticalFovDegrees: 75,
					textureFiltering: "anisotropic-2x",
					renderScale: 1,
					weatherEnabled,
				},
			},
		},
	});
}

/** Historical v5 font defaults stay fixed if later theme preferences change. */
const V5_UI_SETTINGS = {
	fonts: { body: "theme", heading: "theme", mono: "theme" },
} as const;

function migrateClientLocalSettingsDocumentV4(
	document: ClientLocalSettingsDocumentV4,
): ClientLocalSettingsDocumentV5 {
	return clientLocalSettingsDocumentV5Schema.parse({
		...document,
		schemaVersion: 5,
		user: {
			...document.user,
			client: { ...document.user.client, ui: V5_UI_SETTINGS },
		},
	});
}

function migrateClientLocalSettingsDocumentV5(
	document: ClientLocalSettingsDocumentV5,
): ClientLocalSettingsDocumentV6 {
	return clientLocalSettingsDocumentV6Schema.parse({
		...document,
		schemaVersion: 6,
		user: {
			...document.user,
			client: {
				...document.user.client,
				input: CLIENT_KEYBOARD_V6_DEFAULTS,
			},
		},
	});
}

/** Retire the duplicate focused-bar cancel binding; the shared client cancel now owns it. */
function migrateClientLocalSettingsDocumentV6(
	document: ClientLocalSettingsDocumentV6,
): ClientLocalSettingsDocumentV7 {
	const { cancel, ...commands } =
		document.user.client.input.actionBars.commands;
	void cancel;
	return clientLocalSettingsDocumentV7Schema.parse({
		...document,
		schemaVersion: 7,
		user: {
			...document.user,
			client: {
				...document.user.client,
				input: {
					...document.user.client.input,
					actionBars: {
						...document.user.client.input.actionBars,
						commands,
					},
				},
			},
		},
	});
}

/** Character selection now uses native form controls, so its old shortcut is discarded. */
function migrateClientLocalSettingsDocumentV7(
	document: ClientLocalSettingsDocumentV7,
): ClientLocalSettingsDocumentV8 {
	const { enterWorld, ...client } = document.user.client.input.client;
	void enterWorld;
	return clientLocalSettingsDocumentV8Schema.parse({
		...document,
		schemaVersion: 8,
		user: {
			...document.user,
			client: {
				...document.user.client,
				input: { ...document.user.client.input, client },
			},
		},
	});
}

/** Add the original caster chord without changing historical migration defaults. */
function migrateClientLocalSettingsDocumentV8(
	document: ClientLocalSettingsDocumentV8,
): ClientLocalSettingsDocumentV9 {
	return clientLocalSettingsDocumentV9Schema.parse({
		...document,
		schemaVersion: 9,
		user: {
			...document.user,
			client: {
				...document.user.client,
				input: {
					...document.user.client.input,
					spellBar: {
						...document.user.client.input.spellBar,
						caster: [
							{
								code: "Digit1",
								ctrl: true,
								shift: true,
								alt: false,
								meta: false,
							},
						],
					},
				},
			},
		},
	});
}

/** Validate a user snapshot at an IPC or composition boundary. */
export function parseClientUserSettings(value: unknown): ClientUserSettings {
	return clientUserSettingsSchema.parse(value);
}

/** Validate a character snapshot at an IPC or composition boundary. */
export function parseClientCharacterSettings(
	value: unknown,
): ClientCharacterSettings {
	return clientCharacterSettingsSchema.parse(value);
}

/** Dispatch durable versions explicitly so older clients never overwrite newer state. */
function parseClientLocalSettingsDocumentV7(
	value: unknown,
): ClientLocalSettingsDocumentV7 {
	if (
		typeof value !== "object" ||
		value === null ||
		!("schemaVersion" in value)
	)
		throw new Error("Client settings document has no schemaVersion");
	switch (value.schemaVersion) {
		case 1:
			return migrateClientLocalSettingsDocumentV6(
				migrateClientLocalSettingsDocumentV5(
					migrateClientLocalSettingsDocumentV4(
						migrateClientLocalSettingsDocumentV3(
							migrateClientLocalSettingsDocumentV2(
								migrateClientLocalSettingsDocumentV1(
									clientLocalSettingsDocumentV1Schema.parse(value),
								),
							),
						),
					),
				),
			);
		case 2:
			return migrateClientLocalSettingsDocumentV6(
				migrateClientLocalSettingsDocumentV5(
					migrateClientLocalSettingsDocumentV4(
						migrateClientLocalSettingsDocumentV3(
							migrateClientLocalSettingsDocumentV2(
								clientLocalSettingsDocumentV2Schema.parse(value),
							),
						),
					),
				),
			);
		case 3:
			return migrateClientLocalSettingsDocumentV6(
				migrateClientLocalSettingsDocumentV5(
					migrateClientLocalSettingsDocumentV4(
						migrateClientLocalSettingsDocumentV3(
							clientLocalSettingsDocumentV3Schema.parse(value),
						),
					),
				),
			);
		case 4:
			return migrateClientLocalSettingsDocumentV6(
				migrateClientLocalSettingsDocumentV5(
					migrateClientLocalSettingsDocumentV4(
						clientLocalSettingsDocumentV4Schema.parse(value),
					),
				),
			);
		case 5:
			return migrateClientLocalSettingsDocumentV6(
				migrateClientLocalSettingsDocumentV5(
					clientLocalSettingsDocumentV5Schema.parse(value),
				),
			);
		case 6:
			return migrateClientLocalSettingsDocumentV6(
				clientLocalSettingsDocumentV6Schema.parse(value),
			);
		case 7:
			return clientLocalSettingsDocumentV7Schema.parse(value);
		default:
			throw new Error(
				`Unsupported client settings schema version ${String(value.schemaVersion)}`,
			);
	}
}

/** Upgrade every supported document to the current user-scoped settings contract. */
function parseClientLocalSettingsDocumentV9(
	value: unknown,
): ClientLocalSettingsDocumentV9 {
	if (
		typeof value === "object" &&
		value !== null &&
		"schemaVersion" in value &&
		value.schemaVersion === 9
	)
		return clientLocalSettingsDocumentV9Schema.parse(value);
	if (
		typeof value === "object" &&
		value !== null &&
		"schemaVersion" in value &&
		value.schemaVersion === 8
	)
		return migrateClientLocalSettingsDocumentV8(
			clientLocalSettingsDocumentV8Schema.parse(value),
		);
	return migrateClientLocalSettingsDocumentV8(
		migrateClientLocalSettingsDocumentV7(
			parseClientLocalSettingsDocumentV7(value),
		),
	);
}

/** Fixed migration data; changing live HUD defaults must not move existing users' windows. */
const V10_VENDOR_PLACEMENT = {
	horizontal: { alignment: "start", offset: 370 },
	vertical: { alignment: "start", offset: 170 },
	preferredWidth: 420,
	preferredHeight: 500,
} as const;

/** Upgrade every supported historical document to v10. */
function parseClientLocalSettingsDocumentV10(
	value: unknown,
): ClientLocalSettingsDocumentV10 {
	if (
		typeof value === "object" &&
		value !== null &&
		"schemaVersion" in value &&
		value.schemaVersion === 10
	)
		return clientLocalSettingsDocumentV10Schema.parse(value);
	const previous = parseClientLocalSettingsDocumentV9(value);
	return clientLocalSettingsDocumentV10Schema.parse({
		...previous,
		schemaVersion: 10,
		user: {
			...previous.user,
			client: {
				...previous.user.client,
				hudLayout: {
					...previous.user.client.hudLayout,
					vendor: V10_VENDOR_PLACEMENT,
				},
			},
		},
	});
}

/** The old default character height reserved room for icons now owned by the tray. */
const V11_OLD_CHARACTER_HEIGHT = 132;
const V11_CHARACTER_HEIGHT = 72;
const V11_TRAY_WIDTH = 158;
const V11_TRAY_HEIGHT = 32;
const V11_TRAY_TOP_FROM_CHARACTER = 80;

/** Retain an icon row's old position relative to its character panel across anchor modes. */
function migratedTrayAxisOffset(
	alignment: "start" | "center" | "end",
	offset: number,
	characterSize: number,
	traySize: number,
	displacement: number,
): number {
	switch (alignment) {
		case "start":
			return offset + displacement;
		case "center":
			return offset + displacement + (traySize - characterSize) / 2;
		case "end":
			return offset + characterSize - displacement - traySize;
	}
}

/** Upgrade every supported document while retaining every existing panel placement. */
export function parseClientLocalSettingsDocument(
	value: unknown,
): ClientLocalSettingsDocument {
	if (
		typeof value === "object" &&
		value !== null &&
		"schemaVersion" in value &&
		value.schemaVersion === 11
	)
		return clientLocalSettingsDocumentV11Schema.parse(value);
	const previous = parseClientLocalSettingsDocumentV10(value);
	const character = previous.user.client.hudLayout.character;
	return clientLocalSettingsDocumentV11Schema.parse({
		...previous,
		schemaVersion: 11,
		user: {
			...previous.user,
			client: {
				...previous.user.client,
				hudLayout: {
					...previous.user.client.hudLayout,
					character: {
						...character,
						preferredHeight:
							character.preferredHeight === V11_OLD_CHARACTER_HEIGHT
								? V11_CHARACTER_HEIGHT
								: character.preferredHeight,
					},
					statusTray: {
						horizontal: {
							alignment: character.horizontal.alignment,
							offset: migratedTrayAxisOffset(
								character.horizontal.alignment,
								character.horizontal.offset,
								character.preferredWidth,
								V11_TRAY_WIDTH,
								0,
							),
						},
						vertical: {
							alignment: character.vertical.alignment,
							offset: migratedTrayAxisOffset(
								character.vertical.alignment,
								character.vertical.offset,
								character.preferredHeight,
								V11_TRAY_HEIGHT,
								V11_TRAY_TOP_FROM_CHARACTER,
							),
						},
						preferredWidth: V11_TRAY_WIDTH,
						preferredHeight: V11_TRAY_HEIGHT,
					},
				},
			},
		},
	});
}
