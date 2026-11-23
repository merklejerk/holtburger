import { z } from "zod";
import {
	clientSettingsEntry,
	clientUserSectionSchemas,
	type ClientSectionRead,
	type ClientSettingsCollection,
	type ClientSettingsEntry,
} from "../../client/settings/settings-sections.js";
import type {
	ClientAudioSettings,
	ClientGraphicsSettings,
	ClientUiSettings,
} from "../../client/settings/settings-contract.js";
import type { ClientInputConfiguration } from "../../lib/input/input-contract.js";
import {
	explorerHudLayoutSchema,
	explorerHudPlacementSchemas,
	explorerInputSettingsSchema,
	explorerWorldSettingsSchema,
	type ExplorerHudLayout,
	type ExplorerHudPlacementKey,
	type ExplorerInputSettings,
	type ExplorerWorldSettings,
} from "./explorer-settings-contract.js";

/** Shared + Explorer-owned runtime sections read and patched by Explorer mode. */
export const explorerRuntimeSectionSchemas = {
	graphics: clientUserSectionSchemas.graphics,
	ui: clientUserSectionSchemas.ui,
	audio: clientUserSectionSchemas.audio,
	input: clientUserSectionSchemas.input,
	explorerWorld: explorerWorldSettingsSchema,
	explorerInput: explorerInputSettingsSchema,
} as const;
export type ExplorerRuntimeSectionKey =
	keyof typeof explorerRuntimeSectionSchemas;

/** Composed Explorer runtime settings: shared graphics/appearance/audio/input plus Explorer-only sections. */
export interface ExplorerUserSettings {
	readonly graphics: ClientGraphicsSettings;
	readonly ui: ClientUiSettings;
	readonly audio: ClientAudioSettings;
	readonly input: ClientInputConfiguration;
	readonly explorerWorld: ExplorerWorldSettings;
	readonly explorerInput: ExplorerInputSettings;
	readonly explorerHudLayout: ExplorerHudLayout;
}

export interface ExplorerUserSettingsPatch {
	readonly sections?: Partial<Omit<ExplorerUserSettings, "explorerHudLayout">>;
	readonly explorerHudPlacements?: Partial<ExplorerHudLayout>;
}

export const explorerUserSettingsPatchSchema = z
	.object({
		sections: z
			.object(explorerRuntimeSectionSchemas)
			.partial()
			.strict()
			.optional(),
		explorerHudPlacements: z
			.object(explorerHudPlacementSchemas)
			.partial()
			.strict()
			.optional(),
	})
	.strict();

/** Explorer-scoped reset payload; shared sections, launcher prefs, and Client state stay intact. */
export const explorerResetSettingsSchema = z
	.object({
		explorerWorld: explorerWorldSettingsSchema,
		explorerInput: explorerInputSettingsSchema,
		explorerHudLayout: explorerHudLayoutSchema,
	})
	.strict()
	.readonly();
export type ExplorerResetSettings = z.infer<typeof explorerResetSettingsSchema>;

export function explorerRuntimeSectionEntry<
	Key extends ExplorerRuntimeSectionKey,
>(key: Key, value: unknown): ClientSettingsEntry<ExplorerUserSettings[Key]> {
	return {
		version: 1,
		value: explorerRuntimeSectionSchemas[key].parse(
			value,
		) as ExplorerUserSettings[Key],
	};
}

export function explorerHudPlacementEntry<Key extends ExplorerHudPlacementKey>(
	key: Key,
	value: unknown,
): ClientSettingsEntry<ExplorerHudLayout[Key]> {
	return clientSettingsEntry(
		value,
		explorerHudPlacementSchemas[key] as z.ZodType<ExplorerHudLayout[Key]>,
	);
}

/** Keep malformed Explorer placement maps isolated from otherwise valid user sections. */
export function explorerHudPlacementEntries(
	collection: ClientSettingsCollection,
): ClientSectionRead<Readonly<Record<string, unknown>>> {
	const raw = collection.user.explorerHudPlacements;
	if (raw === undefined) return { kind: "missing" };
	if (typeof raw !== "object" || raw === null || Array.isArray(raw))
		return {
			kind: "invalid",
			reason: "explorerHudPlacements has an invalid map",
		};
	return { kind: "loaded", value: raw as Readonly<Record<string, unknown>> };
}
