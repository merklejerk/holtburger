import { z } from "zod";
import { packAffinitiesSchema } from "./pack-affinity-contract.js";
import { uiThemeIdSchema } from "../../app/theme/ui-theme-contract.js";
import { entityAlertRulesSchema } from "../world/entity-alerts.js";
import { loadoutActionContentSchema } from "../inventory/loadout.js";

import {
	normalizeSpellTab,
	SPELL_BAR_INDICES,
} from "../magic/spell-bar-state.js";
import { MAX_ACTION_BARS } from "../hud/action-bar-contract.js";
import { CLIENT_INSPECTION_PREVIEW_HEIGHT } from "../inventory/inspection-layout.js";
import { ENTITY_SHADOW_MODES } from "../../lib/game/renderer/shadows/entity-shadow-modes.js";
import { TEXTURE_FILTERING_POLICIES } from "../../lib/game/renderer/webgl2/texture-filtering-policy.js";
import {
	CLIENT_AUDIO_DEFAULTS,
	CLIENT_CAMERA_DEFAULTS,
	CLIENT_CHAT_SUPPRESSION_DEFAULTS,
	CLIENT_FONT_FAMILY_OPTIONS,
	CLIENT_GRAPHICS_DEFAULTS,
	CLIENT_GRAPHICS_RANGES,
	CLIENT_HUD_WINDOW_OPACITY,
	CLIENT_IDLE_CAMERA_ORBIT_DELAY_SECONDS,
	CLIENT_LOCK_INTERACTION_DEFAULTS,
	CLIENT_TEXT_SCALE,
	CLIENT_UI_SCALE,
	CLIENT_UI_SETTINGS_DEFAULTS,
	CLIENT_VITAL_WARNING_PERCENT,
} from "./settings-defaults.js";
import { clientInputSettingsSchema } from "./input-settings.js";
import {
	clientClockFormatSchema,
	clientEnvironmentOverridesSchema,
} from "./environment-settings.js";

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
		nearby: hudPlacementSchema,
		social: hudPlacementSchema,
		journal: hudPlacementSchema,
		enchantments: hudPlacementSchema,
		characterSheet: hudPlacementSchema,
		inventory: hudPlacementSchema,
		worldContainer: hudPlacementSchema,
		locks: hudPlacementSchema,
		salvage: hudPlacementSchema,
		barber: hudPlacementSchema,
		vendor: hudPlacementSchema,
		houseCrystal: hudPlacementSchema,
		logopolis: hudPlacementSchema,
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

/** Independent visibility choices for named channels in the retained chat buffer. */
const clientChatChannelFiltersSchema = z
	.object({
		/** Public world chat. */
		general: z.boolean(),
		/** Buying and selling chat. */
		trade: z.boolean(),
		/** Looking-for-group chat. */
		lfg: z.boolean(),
		/** Roleplaying chat. */
		roleplay: z.boolean(),
		/** Allegiance chat and allegiance broadcasts share one choice. */
		allegiance: z.boolean(),
		/** Generic society chat and all three society-specific channels. */
		society: z.boolean(),
		/** Olthoi chat. */
		olthoi: z.boolean(),
	})
	.strict()
	.readonly();
export type ClientChatChannelFilters = z.infer<
	typeof clientChatChannelFiltersSchema
>;

/** Local chat admission preferences; suppressed messages never enter retained history. */
const clientChatSuppressionSettingsSchema = z
	.object({
		/** Hide successful self defense against physical attacks and hostile spells. */
		hideSelfEvasionsAndResists: z
			.boolean()
			.default(CLIENT_CHAT_SUPPRESSION_DEFAULTS.hideSelfEvasionsAndResists),
		/** Hide casting words from every speaker, preserving other magic feedback. */
		hideSpellIncantations: z
			.boolean()
			.default(CLIENT_CHAT_SUPPRESSION_DEFAULTS.hideSpellIncantations),
	})
	.strict()
	.readonly();
export type ClientChatSuppressionSettings = z.infer<
	typeof clientChatSuppressionSettingsSchema
>;

/** Local lock interaction policy; server gameplay options do not own this automation. */
const clientLockInteractionSettingsSchema = z
	.object({
		/** Opt in to trying distinct inventory key templates before offering lockpicks. */
		autoUseKeys: z
			.boolean()
			.default(CLIENT_LOCK_INTERACTION_DEFAULTS.autoUseKeys),
	})
	.strict()
	.readonly();
export type ClientLockInteractionSettings = z.infer<
	typeof clientLockInteractionSettingsSchema
>;

/** Local camera behavior preferences, independent of server gameplay options. */
export const clientCameraSettingsSchema = z
	.object({
		/** World-idle delay in seconds before horizontal camera orbit starts; zero disables it. */
		idleOrbitDelaySeconds: z
			.number()
			.int()
			.min(CLIENT_IDLE_CAMERA_ORBIT_DELAY_SECONDS.minimum)
			.max(CLIENT_IDLE_CAMERA_ORBIT_DELAY_SECONDS.maximum)
			.default(CLIENT_CAMERA_DEFAULTS.idleOrbitDelaySeconds),
	})
	.strict()
	.readonly();
export type ClientCameraSettings = z.infer<typeof clientCameraSettingsSchema>;

/** User-scoped graphics preferences; implementation tuning stays in renderer policy. */
export const clientGraphicsSettingsSchema = z
	.object({
		viewDistance: z
			.number()
			.int()
			.min(CLIENT_GRAPHICS_RANGES.viewDistance.minimum)
			.max(CLIENT_GRAPHICS_RANGES.viewDistance.maximum),
		ambientOcclusionEnabled: z.boolean(),
		/** Saved sealed-interior ambient; older profiles inherit the shared baseline. */
		sealedInteriorAmbientLevel: finiteNumber
			.min(CLIENT_GRAPHICS_RANGES.sealedInteriorAmbientLevel.minimum)
			.max(CLIENT_GRAPHICS_RANGES.sealedInteriorAmbientLevel.maximum)
			.default(CLIENT_GRAPHICS_DEFAULTS.sealedInteriorAmbientLevel),
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

const CLIENT_NAMEPLATE_MODES = ["minimal", "smart", "always"] as const;
const clientNameplateModeSchema = z.enum(CLIENT_NAMEPLATE_MODES);
export type ClientNameplateMode = z.infer<typeof clientNameplateModeSchema>;

/** User-scoped overhead nameplate presentation mode; bar visibility remains independent authority. */
export const clientNameplateSettingsSchema = z
	.object({
		mode: clientNameplateModeSchema,
	})
	.strict()
	.readonly();
export type ClientNameplateSettings = z.infer<
	typeof clientNameplateSettingsSchema
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

/** User-scoped UI sizing, typography, and vital warning thresholds. */
export const clientUiSettingsSchema = z
	.object({
		/** Show the FPS HUD; older profiles keep it hidden until explicitly enabled. */
		showFps: z.boolean().default(CLIENT_UI_SETTINGS_DEFAULTS.showFps),
		/** Reveal combat control labels on hover; older profiles receive help by default. */
		showHelpLabels: z
			.boolean()
			.default(CLIENT_UI_SETTINGS_DEFAULTS.showHelpLabels),
		/** Enable the unlock window and automatic-key workflow; existing profiles keep it enabled. */
		useUnlockHelper: z
			.boolean()
			.default(CLIENT_UI_SETTINGS_DEFAULTS.useUnlockHelper),
		/** Absent choices use the client default; explicit Base/null and saved IDs are retained. */
		themeId: uiThemeIdSchema
			.nullable()
			.default(CLIENT_UI_SETTINGS_DEFAULTS.themeId),
		/** Older sections inherit neutral scaling without losing fonts or warning thresholds. */
		textScale: finiteNumber
			.min(CLIENT_TEXT_SCALE.minimum)
			.max(CLIENT_TEXT_SCALE.maximum)
			.default(CLIENT_UI_SETTINGS_DEFAULTS.textScale),
		/** Overall UI geometry starts neutral when older sections omit this preference. */
		uiScale: finiteNumber
			.min(CLIENT_UI_SCALE.minimum)
			.max(CLIENT_UI_SCALE.maximum)
			.default(CLIENT_UI_SETTINGS_DEFAULTS.uiScale),
		/** Floating-window background opacity; old profiles retain the existing tint. */
		hudWindowOpacity: finiteNumber
			.min(CLIENT_HUD_WINDOW_OPACITY.minimum)
			.max(CLIENT_HUD_WINDOW_OPACITY.maximum)
			.default(CLIENT_UI_SETTINGS_DEFAULTS.hudWindowOpacity),
		/** Profiles without warnings get the same thresholds as first-run settings. */
		vitalWarningThresholds: clientVitalWarningThresholdsSchema.default(
			CLIENT_UI_SETTINGS_DEFAULTS.vitalWarningThresholds,
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

/** User-owned mix preferences; in-game output and title music have independent levels. */
export const clientAudioSettingsSchema = z
	.object({
		/** In-game output multiplier, independent of spatial audibility and title music. */
		masterVolume: finiteNumber.min(0).max(1),
		/** Gameplay effects, including portal transition cues. */
		effectVolume: finiteNumber.min(0).max(1),
		/** Independent title-music level; older profiles receive the declared initial level. */
		musicVolume: finiteNumber
			.min(0)
			.max(1)
			.default(CLIENT_AUDIO_DEFAULTS.musicVolume),
		/** Environmental ambience. */
		ambientVolume: finiteNumber.min(0).max(1),
		/** Keep gameplay audio and title music audible when the window lacks focus. */
		playInBackground: z
			.boolean()
			.default(CLIENT_AUDIO_DEFAULTS.playInBackground),
		/** Silence all output, including title music, without discarding saved volume levels. */
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
		/** Stable emote identities shared across characters and servers on this local profile. */
		recentEmotes: z.array(z.string().min(1)).readonly(),
		chatFilters: chatFiltersSchema,
		/** User-wide named-channel visibility, independent of retained history. */
		chatChannelFilters: clientChatChannelFiltersSchema,
		/** Buffer timestamp visibility shared across characters on this local profile. */
		chatTimestamps: z.boolean(),
		chatSuppression: clientChatSuppressionSettingsSchema,
		lockInteractions: clientLockInteractionSettingsSchema,
		camera: clientCameraSettingsSchema,
		graphics: clientGraphicsSettingsSchema,
		nameplates: clientNameplateSettingsSchema,
		audio: clientAudioSettingsSchema,
		ui: clientUiSettingsSchema,
		clockFormat: clientClockFormatSchema,
		environmentOverrides: clientEnvironmentOverridesSchema,
		input: clientInputSettingsSchema,
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
		/** Last confirmed carried container, retained while an item is equipped. */
		packAffinities: packAffinitiesSchema,
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

export {
	clientWindowSettingsSchema,
	type ClientWindowSettings,
} from "../../app/desktop/window-settings-contract.js";
