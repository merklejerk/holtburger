import { z } from "zod";
import { entityAlertRulesSchema } from "./client-entity-alerts.js";
import { loadoutActionContentSchema } from "./client-loadout.js";

import {
	normalizeSpellTab,
	SPELL_BAR_INDICES,
} from "./client-spell-bar-state.js";
import { MAX_ACTION_BARS } from "./client-action-bar-contract.js";
import { CLIENT_INSPECTION_PREVIEW_HEIGHT } from "./client-inspection-layout.js";
import { ENTITY_SHADOW_MODES } from "../lib/game/renderer/entity-shadow-modes.js";
import { TEXTURE_FILTERING_POLICIES } from "../lib/game/renderer/texture-filtering-policy.js";
import {
	CLIENT_FONT_FAMILY_OPTIONS,
	CLIENT_VITAL_WARNING_PERCENT,
	CLIENT_VITAL_WARNING_THRESHOLDS,
	CLIENT_GRAPHICS_RANGES,
} from "./client-settings-values.js";
import { clientKeyboardSettingsSchema } from "./client-input-settings.js";
import {
	clientClockFormatSchema,
	clientEnvironmentOverridesSchema,
} from "./client-environment-settings.js";

import { clientCombatIndicatorSettingsSchema } from "./client-combat-indicator-settings.js";

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

/** Every current surface has one value schema; adding a surface does not version the file. */
const clientHudLayoutSchema = z
	.object({
		character: hudPlacementSchema,
		partyHud: hudPlacementSchema,
		statusTray: statusTrayPlacementSchema,
		spellBar: hudPlacementSchema,
		combatBar: hudPlacementSchema,
		chat: hudPlacementSchema,
		spells: hudPlacementSchema,
		nearby: hudPlacementSchema,
		social: hudPlacementSchema,
		journal: hudPlacementSchema,
		enchantments: hudPlacementSchema,
		characterSheet: hudPlacementSchema,
		inventory: hudPlacementSchema,
		worldContainer: hudPlacementSchema,
		vendor: hudPlacementSchema,
		houseCrystal: hudPlacementSchema,
		trade: hudPlacementSchema,
		inspection: hudPlacementSchema,
		book: hudPlacementSchema,
		debug: hudPlacementSchema,
		world: hudPlacementSchema,
		settings: hudPlacementSchema,
		frameRate: hudPlacementSchema,
		jumpPower: hudPlacementSchema,
		minimap: hudPlacementSchema,
		selectedEntity: hudPlacementSchema,
		shortcuts: hudPlacementSchema,
		toast: hudPlacementSchema,
	})
	.strict()
	.readonly();

const chatFiltersSchema = z
	.array(z.enum(["chat", "combat"]))
	.max(2)
	.refine(
		(tags) => tags.length < 2 || (tags[0] === "chat" && tags[1] === "combat"),
		{ message: "chat filters must be unique and in canonical order" },
	)
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

/** Each vital's remaining-percentage threshold activates its glow and veins together. */
const vitalWarningPercentSchema = z
	.number()
	.int()
	.min(CLIENT_VITAL_WARNING_PERCENT.minimum)
	.max(CLIENT_VITAL_WARNING_PERCENT.maximum);
const clientVitalWarningThresholdsSchema = z
	.object({
		/** Remaining health percentage that activates the warning. */
		health: vitalWarningPercentSchema,
		/** Remaining stamina percentage that activates the warning. */
		stamina: vitalWarningPercentSchema,
		/** Remaining mana percentage that activates the warning. */
		mana: vitalWarningPercentSchema,
	})
	.strict()
	.readonly();
export type ClientVitalWarningThresholds = z.infer<
	typeof clientVitalWarningThresholdsSchema
>;

/** User-scoped fonts and vital warning thresholds; scaling remains planned. */
export const clientUiSettingsSchema = z
	.object({
		/** Profiles without warnings get the same thresholds as first-run settings. */
		vitalWarningThresholds: clientVitalWarningThresholdsSchema.default(
			CLIENT_VITAL_WARNING_THRESHOLDS,
		),
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

/** User-owned mix preferences; master and mute affect output, categories affect spatial gain. */
export const clientAudioSettingsSchema = z
	.object({
		/** Final output multiplier, independent of spatial audibility. */
		masterVolume: finiteNumber.min(0).max(1),
		/** Gameplay effects, including portal transition cues. */
		effectVolume: finiteNumber.min(0).max(1),
		/** Environmental ambience. */
		ambientVolume: finiteNumber.min(0).max(1),
		/** Silence output without discarding the saved mix. */
		muted: z.boolean(),
	})
	.strict()
	.readonly();
export type ClientAudioSettings = z.infer<typeof clientAudioSettingsSchema>;

/** Composed runtime view; persistence validates and saves its sections independently. */
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
		graphics: clientGraphicsSettingsSchema,
		audio: clientAudioSettingsSchema,
		ui: clientUiSettingsSchema,
		combatIndicators: clientCombatIndicatorSettingsSchema,
		clockFormat: clientClockFormatSchema,
		environmentOverrides: clientEnvironmentOverridesSchema,
		input: clientKeyboardSettingsSchema,
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
export type ClientUserSettings = z.infer<typeof clientUserSettingsSchema>;

const consumableIdentitySchema = z
	.object({
		wcid: unsigned,
		category: z.enum(["food", "healing-kit", "charged-mana-stone"]),
	})
	.strict()
	.readonly();

const itemActionContentSchema = z
	.object({
		kind: z.enum(["equipment", "direct", "targeted"]),
		item: unsigned,
		replacement: consumableIdentitySchema.nullable(),
	})
	.strict()
	.readonly();

const actionContentSchema = z.union([
	itemActionContentSchema,
	loadoutActionContentSchema,
]);

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

const attackHeightSchema = z.enum(["low", "medium", "high"]);

/** Character-scoped local shortcuts and combat controls, never server authority. */
export const clientCharacterSettingsSchema = z
	.object({
		/** Character-local entity name alerts, never server authority. */
		entityAlerts: entityAlertRulesSchema,
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

/** Native window state is available before renderer settings bootstrap. */
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
