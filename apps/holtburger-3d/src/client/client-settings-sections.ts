import { z } from "zod";
import {
	clientCharacterSettingsSchema,
	clientUserSettingsSchema,
	clientWindowSettingsSchema,
	type ClientCharacterSettings,
	type ClientUserSettings,
	type ClientWindowSettings,
} from "./client-settings-contract.js";
import type { ClientHudLayout } from "./client-hud-layout.js";

const userShape = clientUserSettingsSchema.unwrap().shape;
const hudShape = userShape.hudLayout.unwrap().shape;
const characterShape = clientCharacterSettingsSchema.unwrap().shape;

/** Independently saved user preferences; HUD placements have their own key space. */
export const clientUserSectionSchemas = {
	spellBarShape: userShape.spellBarShape,
	minimapViewDiameters: userShape.minimapViewDiameters,
	chatFilters: userShape.chatFilters,
	graphics: userShape.graphics,
	audio: userShape.audio,
	ui: userShape.ui,
	input: userShape.input,
	inspection: userShape.inspection,
} as const;
export type ClientUserSectionKey = keyof typeof clientUserSectionSchemas;
export type ClientUserSectionValues = Omit<ClientUserSettings, "hudLayout">;

/** Each HUD surface evolves independently; the tray has an additional shape invariant. */
export const clientHudPlacementSchemas = hudShape;
export type ClientHudPlacementKey = keyof ClientHudLayout;

/** Independently saved character preferences and display metadata. */
export const clientCharacterSectionSchemas = {
	actionBars: characterShape.actionBars,
	spellBarBindings: characterShape.spellBarBindings,
	combatControls: characterShape.combatControls,
	lastKnownName: z.string().min(1).max(128).nullable(),
} as const;
export type ClientCharacterSectionKey =
	keyof typeof clientCharacterSectionSchemas;
export type ClientCharacterSectionValues = ClientCharacterSettings & {
	readonly lastKnownName: string | null;
};
export type ClientCharacterSectionValue<Key extends ClientCharacterSectionKey> =
	Key extends keyof ClientCharacterSettings
		? ClientCharacterSettings[Key]
		: string | null;

/** A section version changes only when its own value contract changes. */
export interface ClientSettingsEntry<Value = unknown> {
	readonly version: number;
	readonly value: Value;
}

export interface ClientUserSettingsPatch {
	readonly sections?: Partial<ClientUserSectionValues>;
	readonly hudPlacements?: Partial<ClientHudLayout>;
}

export type ClientCharacterSettingsPatch =
	Partial<ClientCharacterSectionValues>;

export const clientUserSectionsSchema = z
	.object(clientUserSectionSchemas)
	.partial()
	.strict();
export const clientHudPlacementsSchema = z
	.object(clientHudPlacementSchemas)
	.partial()
	.strict();
export const clientCharacterSectionsSchema = z
	.object(clientCharacterSectionSchemas)
	.partial()
	.strict();
export const clientUserSettingsPatchSchema = z
	.object({
		sections: clientUserSectionsSchema.optional(),
		hudPlacements: clientHudPlacementsSchema.optional(),
	})
	.strict();

/** The envelope version describes only the collection structure. */
export interface ClientSettingsCollection {
	readonly formatVersion: 1;
	readonly user: Readonly<Record<string, unknown>>;
	readonly characters: Readonly<
		Record<string, Readonly<Record<string, unknown>>>
	>;
}

export const clientSettingsCollectionSchema: z.ZodType<ClientSettingsCollection> =
	z
		.object({
			formatVersion: z.literal(1),
			user: z.record(z.string(), z.unknown()),
			characters: z.record(
				z.string().min(1),
				z.record(z.string(), z.unknown()),
			),
		})
		.strict()
		.readonly();

const entrySchema = z
	.object({ version: z.number().int().positive(), value: z.unknown() })
	.strict();

export type ClientSectionRead<Value> =
	| { readonly kind: "missing" }
	| { readonly kind: "loaded"; readonly value: Value }
	| { readonly kind: "unavailable"; readonly reason: string };

/** Parse only a section owned by this build; unknown siblings remain opaque. */
export function readClientSettingsSection<Value>(
	raw: unknown,
	schema: z.ZodType<Value>,
	label: string,
): ClientSectionRead<Value> {
	if (raw === undefined) return { kind: "missing" };
	const entry = entrySchema.safeParse(raw);
	if (!entry.success)
		return { kind: "unavailable", reason: `${label} has an invalid entry` };
	if (entry.data.version !== 1)
		return {
			kind: "unavailable",
			reason: `${label} uses unsupported version ${entry.data.version}`,
		};
	const value = schema.safeParse(entry.data.value);
	return value.success
		? { kind: "loaded", value: value.data }
		: { kind: "unavailable", reason: `${label} has an invalid value` };
}

/** Validate the new value before constructing a durable section. */
function clientSettingsEntry<Value>(
	value: unknown,
	schema: z.ZodType<Value>,
): ClientSettingsEntry<Value> {
	return { version: 1, value: schema.parse(value) };
}

export function clientUserSectionEntry<Key extends ClientUserSectionKey>(
	key: Key,
	value: unknown,
): ClientSettingsEntry<ClientUserSettings[Key]> {
	return {
		version: 1,
		value: clientUserSectionSchemas[key].parse(
			value,
		) as ClientUserSettings[Key],
	};
}

export function clientHudPlacementEntry<Key extends ClientHudPlacementKey>(
	key: Key,
	value: unknown,
): ClientSettingsEntry<ClientHudLayout[Key]> {
	return clientSettingsEntry(
		value,
		clientHudPlacementSchemas[key] as z.ZodType<ClientHudLayout[Key]>,
	);
}

export function clientCharacterSectionEntry<
	Key extends ClientCharacterSectionKey,
>(
	key: Key,
	value: unknown,
): ClientSettingsEntry<ClientCharacterSectionValue<Key>> {
	return {
		version: 1,
		value: clientCharacterSectionSchemas[key].parse(
			value,
		) as ClientCharacterSectionValue<Key>,
	};
}

export function clientWindowSettingsEntry(
	value: unknown,
): ClientSettingsEntry<ClientWindowSettings> {
	return clientSettingsEntry(value, clientWindowSettingsSchema);
}

export function emptyClientSettingsCollection(): ClientSettingsCollection {
	return { formatVersion: 1, user: {}, characters: {} };
}

/** Keep malformed placement maps isolated from otherwise valid user sections. */
export function clientHudPlacementEntries(
	collection: ClientSettingsCollection,
): ClientSectionRead<Readonly<Record<string, unknown>>> {
	const raw = collection.user.hudPlacements;
	if (raw === undefined) return { kind: "missing" };
	if (typeof raw !== "object" || raw === null || Array.isArray(raw))
		return {
			kind: "unavailable",
			reason: "hudPlacements has an invalid map",
		};
	return { kind: "loaded", value: raw as Readonly<Record<string, unknown>> };
}
