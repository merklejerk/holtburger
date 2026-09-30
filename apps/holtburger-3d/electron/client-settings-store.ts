import { open, mkdir, readFile, rename, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import type { ZodType } from "zod";
import {
	clientUserSettingsSchema,
	clientWindowSettingsSchema,
	type ClientWindowSettings,
} from "../src/client/client-settings-contract.js";
import type { ClientHudLayout } from "../src/client/client-hud-layout.js";
import {
	clientCharacterSectionEntry,
	clientCharacterSectionSchemas,
	clientHudPlacementEntries,
	clientHudPlacementEntry,
	clientHudPlacementSchemas,
	clientSettingsCollectionSchema,
	clientUserSectionEntry,
	clientUserSectionSchemas,
	clientWindowSettingsEntry,
	emptyClientSettingsCollection,
	readClientSettingsSection,
	type ClientCharacterSectionKey,
	type ClientCharacterSectionValues,
	type ClientCharacterSettingsPatch,
	type ClientHudPlacementKey,
	type ClientSettingsCollection,
	type ClientUserSectionKey,
	type ClientUserSectionValues,
	type ClientUserSettingsPatch,
} from "../src/client/client-settings-sections.js";

export type ClientSettingsReadMode = "persisted" | "fresh";

/** Values this build can use; unavailable keys are reported and never overwritten. */
export interface LoadedClientUserSettings {
	readonly sections: Partial<ClientUserSectionValues>;
	readonly hudPlacements: Partial<ClientHudLayout>;
	readonly unavailable: readonly string[];
}

/** Character sections can be loaded even when one section belongs to a newer build. */
export interface LoadedClientCharacterSettings {
	readonly sections: Partial<ClientCharacterSectionValues>;
	readonly unavailable: readonly string[];
}

/** Electron-main filesystem owner for independently versioned settings sections. */
export class ClientSettingsStore {
	readonly #path: string;
	readonly #initialWindow: ClientWindowSettings;
	#document: ClientSettingsCollection = emptyClientSettingsCollection();
	#writeTail: Promise<void> = Promise.resolve();
	#temporarySequence = 0;

	constructor(path: string, initialWindow: ClientWindowSettings) {
		this.#path = path;
		this.#initialWindow = clientWindowSettingsSchema.parse(initialWindow);
	}

	/** Load once before consumers can observe settings. */
	async load(): Promise<void> {
		this.#document = await this.#readDocument();
	}

	readWindow(): {
		readonly settings: ClientWindowSettings;
		readonly unavailable: string | null;
	} {
		const read = readClientSettingsSection(
			this.#document.user.window,
			clientWindowSettingsSchema,
			"window",
		);
		return read.kind === "loaded"
			? { settings: read.value, unavailable: null }
			: {
					settings: this.#initialWindow,
					unavailable: read.kind === "unavailable" ? read.reason : null,
				};
	}

	readUser(mode: ClientSettingsReadMode): LoadedClientUserSettings {
		const sections: Record<string, unknown> = {};
		const hudPlacements: Record<string, unknown> = {};
		const unavailable: string[] = [];
		for (const key of Object.keys(
			clientUserSectionSchemas,
		) as ClientUserSectionKey[]) {
			const read = readClientSettingsSection(
				this.#document.user[key],
				clientUserSectionSchemas[key] as ZodType,
				`user.${key}`,
			);
			if (read.kind === "unavailable") unavailable.push(read.reason);
			else if (read.kind === "loaded" && mode === "persisted")
				sections[key] = read.value;
		}
		const hud = clientHudPlacementEntries(this.#document);
		if (hud.kind === "unavailable") unavailable.push(hud.reason);
		else if (hud.kind === "loaded") {
			for (const key of Object.keys(
				clientHudPlacementSchemas,
			) as ClientHudPlacementKey[]) {
				const read = readClientSettingsSection(
					hud.value[key],
					clientHudPlacementSchemas[key],
					`hudPlacements.${key}`,
				);
				if (read.kind === "unavailable") unavailable.push(read.reason);
				else if (read.kind === "loaded" && mode === "persisted")
					hudPlacements[key] = read.value;
			}
		}
		return {
			sections: sections as Partial<ClientUserSectionValues>,
			hudPlacements: hudPlacements as Partial<ClientHudLayout>,
			unavailable,
		};
	}

	readCharacter(
		profileKey: string,
		mode: ClientSettingsReadMode,
	): LoadedClientCharacterSettings {
		const profile = this.#document.characters[profileKey];
		const sections: Record<string, unknown> = {};
		const unavailable: string[] = [];
		for (const key of Object.keys(
			clientCharacterSectionSchemas,
		) as ClientCharacterSectionKey[]) {
			const read = readClientSettingsSection(
				profile?.[key],
				clientCharacterSectionSchemas[key] as ZodType,
				`character.${key}`,
			);
			if (read.kind === "unavailable") unavailable.push(read.reason);
			else if (read.kind === "loaded" && mode === "persisted")
				sections[key] = read.value;
		}
		return {
			sections: sections as Partial<ClientCharacterSectionValues>,
			unavailable,
		};
	}

	/** Change only the keys named by the renderer; unknown siblings remain on disk. */
	saveUserPatch(patch: ClientUserSettingsPatch): Promise<void> {
		const sections = validatedUserEntries(patch.sections);
		const placements = validatedHudEntries(patch.hudPlacements);
		return this.#queueWrite((document) => {
			const user = { ...document.user };
			for (const [key, entry] of Object.entries(sections)) {
				assertWritable(
					user[key],
					clientUserSectionSchemas[key as ClientUserSectionKey] as ZodType,
					`user.${key}`,
				);
				user[key] = entry;
			}
			if (Object.keys(placements).length > 0) {
				const hud = { ...requireHudEntries(document) };
				for (const [key, entry] of Object.entries(placements)) {
					assertWritable(
						hud[key],
						clientHudPlacementSchemas[key as ClientHudPlacementKey],
						`hudPlacements.${key}`,
					);
					hud[key] = entry;
				}
				user.hudPlacements = hud;
			}
			return { ...document, user };
		});
	}

	/** Explicit reset replaces supported values and reports every blocked section. */
	resetUser(settings: unknown): Promise<readonly string[]> {
		const parsed = clientUserSettingsSchema.parse(settings);
		const { hudLayout, ...values } = parsed;
		const sections = validatedUserEntries(values);
		const placements = validatedHudEntries(hudLayout);
		return this.#queueWrite<readonly string[]>((document) => {
			const user = { ...document.user };
			const unavailable: string[] = [];
			for (const [key, entry] of Object.entries(sections)) {
				const read = readClientSettingsSection(
					user[key],
					clientUserSectionSchemas[key as ClientUserSectionKey] as ZodType,
					`user.${key}`,
				);
				if (read.kind === "unavailable") unavailable.push(read.reason);
				else user[key] = entry;
			}
			const existing = clientHudPlacementEntries(document);
			if (existing.kind === "unavailable") unavailable.push(existing.reason);
			else {
				const hud = { ...(existing.kind === "loaded" ? existing.value : {}) };
				for (const [key, entry] of Object.entries(placements)) {
					const read = readClientSettingsSection(
						hud[key],
						clientHudPlacementSchemas[key as ClientHudPlacementKey],
						`hudPlacements.${key}`,
					);
					if (read.kind === "unavailable") unavailable.push(read.reason);
					else hud[key] = entry;
				}
				user.hudPlacements = hud;
			}
			return { document: { ...document, user }, result: unavailable };
		});
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
				assertWritable(
					profile[key],
					clientCharacterSectionSchemas[key as ClientCharacterSectionKey],
					`character.${key}`,
				);
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
			assertWritable(
				document.user.window,
				clientWindowSettingsSchema,
				"window",
			);
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
			  },
	): Promise<Result> {
		const write = this.#writeTail.then(async () => {
			const current = await this.#readDocument();
			const changed = change(current);
			const document = "document" in changed ? changed.document : changed;
			await this.#replace(document);
			this.#document = document;
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

	async #replace(document: ClientSettingsCollection): Promise<void> {
		await mkdir(dirname(this.#path), { recursive: true });
		const temporaryPath = `${this.#path}.tmp-${process.pid}-${this.#temporarySequence++}`;
		let temporaryCreated = false;
		let replacementError: unknown;
		try {
			const file = await open(temporaryPath, "wx", 0o600);
			temporaryCreated = true;
			try {
				await file.writeFile(`${JSON.stringify(document, null, 2)}\n`, "utf8");
				await file.sync();
			} finally {
				await file.close();
			}
			await rename(temporaryPath, this.#path);
			temporaryCreated = false;
		} catch (error) {
			replacementError = error;
		}
		if (temporaryCreated) {
			try {
				await unlink(temporaryPath);
			} catch (error) {
				if (!isNodeError(error) || error.code !== "ENOENT")
					replacementError ??= error;
			}
		}
		if (replacementError !== undefined) throw replacementError;
	}
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
	if (read.kind === "unavailable") throw new Error(read.reason);
	return read.kind === "loaded" ? read.value : {};
}

function assertWritable(raw: unknown, schema: ZodType, label: string): void {
	const read = readClientSettingsSection(raw, schema, label);
	if (read.kind === "unavailable") throw new Error(read.reason);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
	return error instanceof Error && "code" in error;
}
