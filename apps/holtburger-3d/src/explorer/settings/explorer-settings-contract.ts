import { z } from "zod";
import { FLY_ACTIONS } from "../../lib/input/input-contract.js";
import { INPUT_PLATFORMS } from "../../lib/input/input-platform.js";
import { EXPLORER_TUNING } from "../explorer-tuning.js";
import {
	EXPLORER_FLY_SPEED_RANGE,
	EXPLORER_INPUT_DEFAULTS,
	EXPLORER_WORLD_DEFAULTS,
} from "./explorer-settings-defaults.js";

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

const modifiers = {
	shift: z.boolean().optional(),
	ctrl: z.boolean().optional(),
	alt: z.boolean().optional(),
	meta: z.boolean().optional(),
};

const keyBindingSchema = z.union([
	z
		.object({ key: z.string().min(1), ...modifiers })
		.strict()
		.transform(({ key, ...rest }) =>
			key === " " ? { code: "Space", ...rest } : { key, ...rest },
		)
		.readonly(),
	z
		.object({ code: z.string().min(1), ...modifiers })
		.strict()
		.readonly(),
]);

const bindingListSchema = z.array(keyBindingSchema).readonly();

/** Persisted Explorer Launcher form preferences; shared with the picker document. */
export const explorerLauncherSettingsSchema = z
	.object({
		contentPath: z.string().min(1).nullable(),
		weenieCatalogPath: z.string().min(1).nullable(),
		initialLocation: z.string().trim().min(1).nullable(),
	})
	.strict()
	.readonly();
export type ExplorerLauncherSettings = z.infer<
	typeof explorerLauncherSettingsSchema
>;

const radiusSchema = z
	.number()
	.int()
	.min(EXPLORER_TUNING.residency.minimumRadius)
	.max(EXPLORER_TUNING.residency.maximumRadius);

/** Explorer-scoped world residency, camera follow, fly speed, and minimap zoom preferences. */
export const explorerWorldSettingsSchema = z
	.object({
		radii: z
			.object({
				terrainRadius: radiusSchema,
				buildingRadius: radiusSchema.nullable(),
				envCellRadius: radiusSchema.nullable(),
				explicitObjectRadius: radiusSchema.nullable(),
				generatedObjectRadius: radiusSchema.nullable(),
			})
			.strict()
			.readonly()
			.default(EXPLORER_WORLD_DEFAULTS.radii),
		interestFollowsCamera: z
			.boolean()
			.default(EXPLORER_WORLD_DEFAULTS.interestFollowsCamera),
		audioFollowsCamera: z
			.boolean()
			.default(EXPLORER_WORLD_DEFAULTS.audioFollowsCamera),
		flySpeed: finiteNumber
			.min(EXPLORER_FLY_SPEED_RANGE.minimum)
			.max(EXPLORER_FLY_SPEED_RANGE.maximum)
			.default(EXPLORER_WORLD_DEFAULTS.flySpeed),
		minimapViewDiameters: z
			.object({
				indoor: finiteNumber.positive(),
				outdoor: finiteNumber.positive(),
			})
			.strict()
			.readonly()
			.default(EXPLORER_WORLD_DEFAULTS.minimapViewDiameters),
		showNameplates: z.boolean().default(EXPLORER_WORLD_DEFAULTS.showNameplates),
	})
	.strict()
	.readonly();
export type ExplorerWorldSettings = z.infer<typeof explorerWorldSettingsSchema>;

/** Explorer-scoped input preferences: remappable fly bindings, fly inversion, and Explorer shortcuts. */
export const explorerInputSettingsSchema = z
	.object({
		fly: z
			.record(z.enum(FLY_ACTIONS), bindingListSchema)
			.readonly()
			.default(EXPLORER_INPUT_DEFAULTS.fly),
		toggleHud: bindingListSchema.default(EXPLORER_INPUT_DEFAULTS.toggleHud),
		despawnSelected: bindingListSchema.default(
			EXPLORER_INPUT_DEFAULTS.despawnSelected,
		),
		togglePossession: bindingListSchema.default(
			EXPLORER_INPUT_DEFAULTS.togglePossession,
		),
		invertFlyHorizontal: z
			.boolean()
			.default(EXPLORER_INPUT_DEFAULTS.invertFlyHorizontal),
		invertFlyVertical: z
			.boolean()
			.default(EXPLORER_INPUT_DEFAULTS.invertFlyVertical),
	})
	.strict()
	.readonly();
export type ExplorerInputSettings = z.infer<typeof explorerInputSettingsSchema>;

/** Placement map for Explorer's independent HUD surfaces. */
export const explorerHudLayoutSchema = z
	.object({
		navigation: hudPlacementSchema,
		scene: hudPlacementSchema,
		visuals: hudPlacementSchema,
		entities: hudPlacementSchema,
		inspection: hudPlacementSchema,
		diagnostics: hudPlacementSchema,
		settings: hudPlacementSchema,
		minimap: hudPlacementSchema,
		selectedEntity: hudPlacementSchema,
		shortcuts: hudPlacementSchema,
		frameRate: hudPlacementSchema,
		jumpPower: hudPlacementSchema,
		possessionRelease: hudPlacementSchema,
		toast: hudPlacementSchema,
	})
	.strict()
	.readonly();
export type ExplorerHudLayout = z.infer<typeof explorerHudLayoutSchema>;
export type ExplorerHudPlacementKey = keyof ExplorerHudLayout;

/** Browser facts needed to assemble Explorer user settings before mounting. */
export const explorerUserSettingsContextSchema = z
	.object({
		platform: z.enum(INPUT_PLATFORMS),
	})
	.strict();
export type ExplorerUserSettingsContext = z.infer<
	typeof explorerUserSettingsContextSchema
>;

/** Independently persisted Explorer-only user sections in `client-settings.json`. */
export const explorerUserSectionSchemas = {
	explorerLauncher: explorerLauncherSettingsSchema,
	explorerWorld: explorerWorldSettingsSchema,
	explorerInput: explorerInputSettingsSchema,
} as const;
export const explorerHudPlacementSchemas =
	explorerHudLayoutSchema.unwrap().shape;
