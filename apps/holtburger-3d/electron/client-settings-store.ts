import { constants } from "node:fs";
import { copyFile, readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { replaceLocalFile } from "./replace-local-file.js";
import {
	repairSettingsEntry,
	pruneUnsupportedSettings,
} from "./client-settings-repair.js";
import type { ZodType, output } from "zod";
import {
	clientUserSettingsSchema,
	clientCharacterSettingsSchema,
	clientWindowSettingsSchema,
	type ClientWindowSettings,
	type ClientUserSettings,
} from "../src/client/client-settings-contract.js";
import {
	logicalClientHudViewport,
	createClientHudLayout,
	type ClientHudLayout,
} from "../src/client/client-hud-layout.js";
import { createDefaultClientUserSections } from "../src/client/client-settings-defaults.js";
import { CLIENT_UI_DEFAULTS } from "../src/client/client-ui-defaults.js";
import {
	clientCharacterSectionEntry,
	clientCharacterSectionSchemas,
	clientHudPlacementEntries,
	clientHudPlacementEntry,
	clientHudPlacementSchemas,
	clientSettingsCollectionSchema,
	clientUserSectionEntry,
	clientUserSectionSchemas,
	clientUserSettingsContextSchema,
	clientWindowSettingsEntry,
	emptyClientSettingsCollection,
	readClientSettingsSection,
	type ClientCharacterSectionKey,
	type ClientCharacterSettingsPatch,
	type ClientHudPlacementKey,
	type ClientSettingsCollection,
	type ClientUserSectionKey,
	type ClientUserSectionValues,
	type ClientUserSettingsPatch,
} from "../src/client/client-settings-sections.js";

export type ClientSettingsReadMode = "persisted" | "fresh";

/** Electron-main filesystem owner for independently versioned settings sections. */
export class ClientSettingsStore {
	readonly #path: string;
	readonly #initialWindow: ClientWindowSettings;
	#document: ClientSettingsCollection = emptyClientSettingsCollection();
	#writeTail: Promise<void> = Promise.resolve();

	constructor(path: string, initialWindow: ClientWindowSettings) {
		this.#path = path;
		this.#initialWindow = clientWindowSettingsSchema.parse(initialWindow);
	}

	/** Load once before consumers can observe settings. */
	async load(): Promise<readonly string[]> {
		return this.#queueWrite<readonly string[]>((document) => {
			const repaired = repairSettingsEntry(
				document.user.window,
				clientWindowSettingsSchema,
				this.#initialWindow,
				"window",
			);
			return {
				document:
					repaired.entry === undefined
						? document
						: {
								...document,
								user: { ...document.user, window: repaired.entry },
							},
				result: repaired.notices,
				backup: true,
			};
		});
	}

	/** Assemble complete settings only after the persisted scale is known. Missing sections stay sparse on disk. */
	async loadUser(context: unknown, mode: ClientSettingsReadMode) {
		const request = clientUserSettingsContextSchema.parse(context);
		const defaults = createDefaultClientUserSections(request.platform);
		return this.#queueWrite((document) => {
			if (mode === "fresh")
				return {
					document,
					result: {
						settings: {
							...defaults,
							hudLayout: createClientHudLayout(
								CLIENT_UI_DEFAULTS,
								logicalClientHudViewport(request.viewport, defaults.ui.uiScale),
								request.shortcutCount,
							),
						},
						repaired: [],
					},
				};
			const user = repairEntries(
				document.user,
				clientUserSectionSchemas,
				defaults,
				"user",
			);
			const values = readSupportedValues(
				user.entries,
				clientUserSectionSchemas,
				"user",
			);
			const ui = values.ui ?? defaults.ui;
			const layoutDefaults = createClientHudLayout(
				CLIENT_UI_DEFAULTS,
				logicalClientHudViewport(request.viewport, ui.uiScale),
				request.shortcutCount,
			);
			const hud = clientHudPlacementEntries({
				...document,
				user: user.entries,
			});
			const notices = [...user.notices];
			let placements: SupportedValues<typeof clientHudPlacementSchemas> = {};
			if (hud.kind === "invalid") throw new Error(hud.reason);
			if (hud.kind === "loaded") {
				const repaired = repairEntries(
					hud.value,
					clientHudPlacementSchemas,
					layoutDefaults,
					"hudPlacements",
				);
				user.entries.hudPlacements = repaired.entries;
				placements = readSupportedValues(
					repaired.entries,
					clientHudPlacementSchemas,
					"hudPlacements",
				);
				notices.push(...repaired.notices);
			}
			const settings: ClientUserSettings = {
				...defaults,
				...values,
				hudLayout: { ...layoutDefaults, ...placements },
			};
			return {
				document: { ...document, user: user.entries },
				result: { settings, repaired: notices },
				backup: true,
			};
		});
	}

	/** Repair supported values for the requested profile after file-wide structural normalization. */
	async loadCharacter(
		profileKey: string,
		defaults: unknown,
		mode: ClientSettingsReadMode,
	) {
		const values = {
			...clientCharacterSettingsSchema.parse(defaults),
			lastKnownName: null,
		};
		if (mode === "fresh") {
			await this.#queueWrite((document) => document);
			return { sections: {}, repaired: [] };
		}
		const repaired = await this.#queueWrite<readonly string[]>((document) => {
			const profile = document.characters[profileKey];
			if (profile === undefined) return { document, result: [] };
			const result = repairEntries(
				profile,
				clientCharacterSectionSchemas,
				values,
				"character",
			);
			return {
				document: {
					...document,
					characters: { ...document.characters, [profileKey]: result.entries },
				},
				result: result.notices,
				backup: true,
			};
		});
		return {
			sections: readSupportedValues(
				this.#document.characters[profileKey] ?? {},
				clientCharacterSectionSchemas,
				"character",
			),
			repaired,
		};
	}

	/** Native geometry has been normalized before restoration. */
	readWindow(): ClientWindowSettings {
		const read = readClientSettingsSection(
			this.#document.user.window,
			clientWindowSettingsSchema,
			"window",
		);
		if (read.kind === "invalid") throw new Error(read.reason);
		return read.kind === "loaded" ? read.value : this.#initialWindow;
	}

	/** Persist a validated patch after file-wide structural normalization. */
	saveUserPatch(patch: ClientUserSettingsPatch): Promise<void> {
		const sections = validatedUserEntries(patch.sections);
		const placements = validatedHudEntries(patch.hudPlacements);
		return this.#queueWrite((document) => {
			const user = { ...document.user };
			for (const [key, entry] of Object.entries(sections)) {
				user[key] = entry;
			}
			if (Object.keys(placements).length > 0) {
				const hud = { ...requireHudEntries(document) };
				for (const [key, entry] of Object.entries(placements)) {
					hud[key] = entry;
				}
				user.hudPlacements = hud;
			}
			return { ...document, user };
		});
	}

	/** Explicit reset replaces supported preferences while retaining native window geometry. */
	resetUser(settings: unknown): Promise<void> {
		const { hudLayout, ...values } = clientUserSettingsSchema.parse(settings);
		const sections = validatedUserEntries(values);
		const placements = validatedHudEntries(hudLayout);
		return this.#queueWrite((document) => ({
			...document,
			user: { ...document.user, ...sections, hudPlacements: placements },
		}));
	}

	saveCharacterPatch(
		profileKey: string,
		patch: ClientCharacterSettingsPatch,
	): Promise<void> {
		if (profileKey.length === 0)
			throw new Error("Character profile key is empty");
		const sections = validatedCharacterEntries(patch);
		return this.#queueWrite((document) => {
			const profile = { ...document.characters[profileKey] };
			for (const [key, entry] of Object.entries(sections)) {
				profile[key] = entry;
			}
			return {
				...document,
				characters: { ...document.characters, [profileKey]: profile },
			};
		});
	}

	updateWindow(settings: unknown): Promise<void> {
		const entry = clientWindowSettingsEntry(settings);
		return this.#queueWrite((document) => {
			return { ...document, user: { ...document.user, window: entry } };
		});
	}

	/** Wait for every queued replacement; each write caller retains its own failure result. */
	async flush(): Promise<void> {
		await this.#writeTail;
	}

	#queueWrite<Result = void>(
		change: (document: ClientSettingsCollection) =>
			| ClientSettingsCollection
			| {
					readonly document: ClientSettingsCollection;
					readonly result: Result;
					/** Keep the exact source before a normalization changes persisted choices. */
					readonly backup?: boolean;
			  },
	): Promise<Result> {
		const write = this.#writeTail.then(async () => {
			const current = await this.#readDocument();
			const pruned = pruneUnsupportedSettings(current);
			const changed = change(pruned.document);
			const document = "document" in changed ? changed.document : changed;
			// Object key order is presentation, not a preference change. All mutations
			// share this decision so no-op loads and saves cannot create backups or writes.
			if (!isDeepStrictEqual(document, current)) {
				if (
					pruned.notices.length > 0 ||
					("document" in changed && changed.backup)
				)
					await copyFile(
						this.#path,
						`${this.#path}.backup-${randomUUID()}`,
						constants.COPYFILE_EXCL,
					);
				await replaceLocalFile(
					this.#path,
					`${JSON.stringify(document, null, 2)}\n`,
				);
			}
			this.#document = document;
			if (pruned.notices.length > 0)
				console.warn(
					`Client settings normalized: ${pruned.notices.join("; ")}`,
				);
			return ("document" in changed ? changed.result : undefined) as Result;
		});
		this.#writeTail = write.then(
			() => undefined,
			() => undefined,
		);
		return write;
	}

	async #readDocument(): Promise<ClientSettingsCollection> {
		let source: string;
		try {
			source = await readFile(this.#path, "utf8");
		} catch (error) {
			if (isNodeError(error) && error.code === "ENOENT")
				return emptyClientSettingsCollection();
			throw error;
		}
		let decoded: unknown;
		try {
			decoded = JSON.parse(source);
		} catch (error) {
			throw new Error(`Invalid client settings JSON at ${this.#path}`, {
				cause: error,
			});
		}
		const parsed = clientSettingsCollectionSchema.safeParse(decoded);
		if (!parsed.success) {
			if (
				typeof decoded === "object" &&
				decoded !== null &&
				"schemaVersion" in decoded
			)
				throw new Error(
					`Legacy client settings at ${this.#path}; convert this file to the collection format before using this path`,
				);
			throw new Error(`Invalid client settings collection at ${this.#path}`, {
				cause: parsed.error,
			});
		}
		return parsed.data;
	}
}

/** Repair supported values after the transaction has pruned unsupported sections. */
function repairEntries(
	raw: Readonly<Record<string, unknown>>,
	schemas: Readonly<Record<string, ZodType>>,
	defaults: Readonly<Record<string, unknown>>,
	label: string,
): { entries: Record<string, unknown>; notices: string[] } {
	const entries = { ...raw };
	const notices: string[] = [];
	for (const [key, schema] of Object.entries(schemas)) {
		const repaired = repairSettingsEntry(
			raw[key],
			schema,
			defaults[key],
			`${label}.${key}`,
		);
		if (repaired.entry === undefined) delete entries[key];
		else entries[key] = repaired.entry;
		notices.push(...repaired.notices);
	}
	return { entries, notices };
}

function validatedUserEntries(
	values: Partial<ClientUserSectionValues> | undefined,
): Record<string, unknown> {
	const entries: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(values ?? {})) {
		if (!(key in clientUserSectionSchemas))
			throw new Error(`Unknown user settings section ${key}`);
		entries[key] = clientUserSectionEntry(key as ClientUserSectionKey, value);
	}
	return entries;
}

function validatedHudEntries(
	values: Partial<ClientHudLayout> | undefined,
): Record<string, unknown> {
	const entries: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(values ?? {})) {
		if (!(key in clientHudPlacementSchemas))
			throw new Error(`Unknown HUD placement ${key}`);
		entries[key] = clientHudPlacementEntry(key as ClientHudPlacementKey, value);
	}
	return entries;
}

function validatedCharacterEntries(
	values: ClientCharacterSettingsPatch,
): Record<string, unknown> {
	const entries: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(values)) {
		if (!(key in clientCharacterSectionSchemas))
			throw new Error(`Unknown character settings section ${key}`);
		const normalized =
			key === "lastKnownName" && typeof value === "string"
				? value.trim()
				: value;
		entries[key] = clientCharacterSectionEntry(
			key as ClientCharacterSectionKey,
			normalized,
		);
	}
	return entries;
}

function requireHudEntries(
	document: ClientSettingsCollection,
): Readonly<Record<string, unknown>> {
	const read = clientHudPlacementEntries(document);
	if (read.kind === "invalid") throw new Error(read.reason);
	return read.kind === "loaded" ? read.value : {};
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
	return error instanceof Error && "code" in error;
}

/** Preserve each schema's output type while reading an independently optional persisted section map. */
type SupportedValues<Schemas extends Readonly<Record<string, ZodType>>> = {
	readonly [Key in keyof Schemas]?: output<Schemas[Key]>;
};

/** Only normalized, supported values may enter runtime settings assembly. */
function readSupportedValues<Schemas extends Readonly<Record<string, ZodType>>>(
	raw: Readonly<Record<string, unknown>>,
	schemas: Schemas,
	label: string,
): SupportedValues<Schemas> {
	const values: Record<string, unknown> = {};
	for (const [key, schema] of Object.entries(schemas)) {
		const read = readClientSettingsSection(raw[key], schema, label + "." + key);
		if (read.kind === "invalid") throw new Error(read.reason);
		if (read.kind === "loaded") values[key] = read.value;
	}
	// The dynamic iteration preserves the exact schema key and parsed value pairing.
	return values as SupportedValues<Schemas>;
}
