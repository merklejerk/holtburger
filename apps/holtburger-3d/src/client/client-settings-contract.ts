import { z } from "zod";
import { MAX_ACTION_BARS } from "./client-action-bar-contract.js";

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

const clientHudLayoutSchema = z
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

const chatFilterTagSchema = z.enum(["chat", "combat"]);
const chatFiltersSchema = z
	.array(chatFilterTagSchema)
	.max(2)
	.refine(
		(tags) => tags.length < 2 || (tags[0] === "chat" && tags[1] === "combat"),
		{ message: "chat filters must be unique and in canonical order" },
	)
	.readonly();

/** User-scoped client presentation preferences shared by every local character. */
export const clientUserSettingsSchema = z
	.object({
		hudLayout: clientHudLayoutSchema,
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
export const clientCharacterSettingsSchema = z
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

const characterProfileSchema = z
	.object({
		lastKnownName: z.string().min(1).max(128).nullable(),
		settings: clientCharacterSettingsSchema,
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
				client: clientUserSettingsSchema,
			})
			.strict()
			.readonly(),
		characters: z.record(z.string().min(1), characterProfileSchema).readonly(),
	})
	.strict()
	.readonly();
export type ClientLocalSettingsDocumentV1 = z.infer<
	typeof clientLocalSettingsDocumentV1Schema
>;

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
): ClientLocalSettingsDocumentV1 {
	if (
		typeof value !== "object" ||
		value === null ||
		!("schemaVersion" in value)
	)
		throw new Error("Client settings document has no schemaVersion");
	if (value.schemaVersion !== 1)
		throw new Error(
			`Unsupported client settings schema version ${String(value.schemaVersion)}`,
		);
	return clientLocalSettingsDocumentV1Schema.parse(value);
}
