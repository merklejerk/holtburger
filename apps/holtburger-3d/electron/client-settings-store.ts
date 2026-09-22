import { open, mkdir, readFile, rename, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import type {
	ClientCharacterSettings,
	ClientLocalSettingsDocument,
	ClientUserSettings,
	ClientWindowSettings,
} from "../src/client/client-settings-contract.js";
import {
	parseClientCharacterSettings,
	parseClientLocalSettingsDocument,
	parseClientUserSettings,
	clientWindowSettingsSchema,
} from "../src/client/client-settings-contract.js";

export type LoadedClientUserSettings =
	| { readonly kind: "missing" }
	| { readonly kind: "loaded"; readonly settings: ClientUserSettings };

export type LoadedClientCharacterSettings =
	| { readonly kind: "missing" }
	| {
			readonly kind: "loaded";
			readonly settings: ClientCharacterSettings;
			readonly lastKnownName: string | null;
	  };

export type ClientSettingsReadMode = "persisted" | "fresh";

interface MutableSettingsState {
	window: ClientWindowSettings;
	user: ClientUserSettings | null;
	characters: ClientLocalSettingsDocument["characters"];
}

/** Electron-main filesystem owner for the complete client settings document. */
export class ClientSettingsStore {
	readonly #path: string;
	#state: MutableSettingsState;
	#writeTail: Promise<void> = Promise.resolve();
	#temporarySequence = 0;
	#userWrittenThisSession = false;
	readonly #charactersWrittenThisSession = new Set<string>();

	constructor(path: string, initialWindow: ClientWindowSettings) {
		this.#path = path;
		this.#state = {
			window: clientWindowSettingsSchema.parse(initialWindow),
			user: null,
			characters: {},
		};
	}

	/** Load once before consumers can observe or mutate settings. */
	async load(): Promise<void> {
		let source: string;
		try {
			source = await readFile(this.#path, "utf8");
		} catch (error) {
			if (isNodeError(error) && error.code === "ENOENT") return;
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
		try {
			const document = parseClientLocalSettingsDocument(decoded);
			this.#state = {
				window: document.user.window,
				user: document.user.client,
				characters: document.characters,
			};
		} catch (error) {
			throw new Error(`Invalid client settings at ${this.#path}`, {
				cause: error,
			});
		}
	}

	readWindow(): ClientWindowSettings {
		return this.#state.window;
	}

	readUser(mode: ClientSettingsReadMode): LoadedClientUserSettings {
		if (mode === "fresh" && !this.#userWrittenThisSession)
			return { kind: "missing" };
		return this.#state.user === null
			? { kind: "missing" }
			: { kind: "loaded", settings: this.#state.user };
	}

	readCharacter(
		profileKey: string,
		mode: ClientSettingsReadMode,
	): LoadedClientCharacterSettings {
		if (mode === "fresh" && !this.#charactersWrittenThisSession.has(profileKey))
			return { kind: "missing" };
		const profile = this.#state.characters[profileKey];
		return profile === undefined
			? { kind: "missing" }
			: {
					kind: "loaded",
					settings: profile.settings,
					lastKnownName: profile.lastKnownName,
				};
	}

	saveUser(settings: unknown): Promise<void> {
		this.#state = { ...this.#state, user: parseClientUserSettings(settings) };
		this.#userWrittenThisSession = true;
		return this.#queueWrite();
	}

	saveCharacter(
		profileKey: string,
		settings: unknown,
		lastKnownName: string | null,
	): Promise<void> {
		if (this.#state.user === null)
			throw new Error("Cannot save character settings before user bootstrap");
		if (profileKey.length === 0)
			throw new Error("Character profile key is empty");
		const name =
			lastKnownName === null ? null : zodCharacterName(lastKnownName);
		this.#state = {
			...this.#state,
			characters: {
				...this.#state.characters,
				[profileKey]: {
					lastKnownName: name,
					settings: parseClientCharacterSettings(settings),
				},
			},
		};
		this.#charactersWrittenThisSession.add(profileKey);
		return this.#queueWrite();
	}

	updateWindow(settings: unknown): Promise<void> {
		this.#state = {
			...this.#state,
			window: clientWindowSettingsSchema.parse(settings),
		};
		return this.#state.user === null ? Promise.resolve() : this.#queueWrite();
	}

	/** Wait for every queued replacement; each write caller retains its own failure result. */
	async flush(): Promise<void> {
		await this.#writeTail;
	}

	#queueWrite(): Promise<void> {
		const document = this.#document();
		const write = this.#writeTail.then(() => this.#replace(document));
		this.#writeTail = write.catch(() => undefined);
		return write;
	}

	#document(): ClientLocalSettingsDocument {
		if (this.#state.user === null)
			throw new Error("Cannot create settings document before user bootstrap");
		return {
			schemaVersion: 9,
			user: { window: this.#state.window, client: this.#state.user },
			characters: this.#state.characters,
		};
	}

	async #replace(document: ClientLocalSettingsDocument): Promise<void> {
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
				if (!isNodeError(error) || error.code !== "ENOENT") {
					replacementError ??= error;
				}
			}
		}
		if (replacementError !== undefined) throw replacementError;
	}
}

function zodCharacterName(value: string): string {
	const trimmed = value.trim();
	if (trimmed.length === 0 || trimmed.length > 128)
		throw new Error("Last-known character name must contain 1-128 characters");
	return trimmed;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
	return error instanceof Error && "code" in error;
}
