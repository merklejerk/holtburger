import { z } from "zod";
import { MAX_ACTION_BARS } from "./client-action-bar-contract.js";
import { CLIENT_INSPECTION_PREVIEW_HEIGHT } from "./client-inspection-layout.js";
import {
	COMBAT_GAUGE_SIZE,
	nearestCombatBreakpoint,
} from "./client-combat-bar-state.js";

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

const clientHudLayoutSchema = clientHudLayoutV2Schema
	.unwrap()
	.extend({ combatBar: hudPlacementSchema })
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

export const clientUserSettingsSchema = clientUserSettingsV2Schema
	.unwrap()
	.extend({ hudLayout: clientHudLayoutSchema })
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
	.tuple([
		spellIdSchema,
		spellIdSchema,
		spellIdSchema,
		spellIdSchema,
		spellIdSchema,
		spellIdSchema,
		spellIdSchema,
		spellIdSchema,
		spellIdSchema,
		spellIdSchema,
	])
	.readonly();
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
						power: finiteNumber
							.min(0)
							.max(1)
							.transform(nearestCombatBreakpoint),
					})
					.strict()
					.readonly(),
				missile: z
					.object({
						height: attackHeightSchema,
						accuracy: finiteNumber
							.min(0)
							.max(1)
							.transform(nearestCombatBreakpoint),
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
				client: clientUserSettingsSchema,
			})
			.strict()
			.readonly(),
		characters: z.record(z.string().min(1), characterProfileSchema).readonly(),
	})
	.strict()
	.readonly();
export type ClientLocalSettingsDocument = z.infer<
	typeof clientLocalSettingsDocumentV3Schema
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
): ClientLocalSettingsDocument {
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
export function parseClientLocalSettingsDocument(
	value: unknown,
): ClientLocalSettingsDocument {
	if (
		typeof value !== "object" ||
		value === null ||
		!("schemaVersion" in value)
	)
		throw new Error("Client settings document has no schemaVersion");
	switch (value.schemaVersion) {
		case 1:
			return migrateClientLocalSettingsDocumentV2(
				migrateClientLocalSettingsDocumentV1(
					clientLocalSettingsDocumentV1Schema.parse(value),
				),
			);
		case 2:
			return migrateClientLocalSettingsDocumentV2(
				clientLocalSettingsDocumentV2Schema.parse(value),
			);
		case 3:
			return clientLocalSettingsDocumentV3Schema.parse(value);
		default:
			throw new Error(
				`Unsupported client settings schema version ${String(value.schemaVersion)}`,
			);
	}
}
